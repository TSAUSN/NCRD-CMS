import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { TestDatabase } from '@cms/schema/testing'
import { seedScenario, type Scenario } from '@cms/schema/fixtures'
import { createFakeDomainProvisioner, configuredDomainProvisioner } from '@cms/platform'
import { createDomainHandler } from '../src/domains.ts'
import { drainOutbox } from '../src/handlers.ts'
let db: TestDatabase
let s: Scenario
beforeAll(async () => {
  db = await TestDatabase.create('domain_worker')
  s = await seedScenario(db)
  await db.as('owner', c => c.query("UPDATE outbox SET status='delivered',processed_at=now() WHERE status='pending'"))
})
afterAll(async () => {
  await db?.close()
})
it('performs attach/check/records through the queue and detached cleanup after routing revocation', async () => {
  const id = await db.asUser(
    s.superAdmin,
    async c => (await c.query("SELECT app.add_domain($1,'worker.example.org',false) AS id", [s.siteA])).rows[0]!.id,
  )
  const provider = createFakeDomainProvisioner()
  provider.advance('worker.example.org', 'live')
  const attach = vi.spyOn(provider, 'attach')
  const detach = vi.spyOn(provider, 'detach')
  const handlers = new Map([['domain.sync', createDomainHandler(db.pool('worker'), 'domain-worker', provider)]])
  expect((await drainOutbox(db.pool('worker'), 'domain-worker', handlers)).delivered).toBe(1)
  expect(attach).toHaveBeenCalledWith(
    'worker.example.org',
    s.siteA,
    expect.objectContaining({ siteId: s.siteA, providerRef: null }),
  )
  const row = await db.asUser(
    s.superAdmin,
    async c => (await c.query('SELECT * FROM domains WHERE id=$1', [id])).rows[0]!,
  )
  expect(row.status).toBe('live')
  expect(row.dns_records).toContainEqual({
    type: 'TXT',
    name: '_cms-verify.worker.example.org',
    value: row.verify_token,
  })
  await db.asUser(s.superAdmin, c => c.query("SELECT app.remove_domain($1,0,'worker.example.org')", [id]))
  expect(
    (await db.as('public', c => c.query("SELECT * FROM public_api.resolve_host('worker.example.org')"))).rows,
  ).toHaveLength(0)
  expect((await drainOutbox(db.pool('worker'), 'domain-worker', handlers)).delivered).toBe(1)
  expect(detach).toHaveBeenCalledWith('worker.example.org', expect.objectContaining({ siteId: s.siteA }))
  expect(
    (await db.asUser(s.superAdmin, c => c.query('SELECT removed_at FROM domains WHERE id=$1', [id]))).rows[0]!
      .removed_at,
  ).toBeInstanceOf(Date)
})
it('keeps unconfigured production connections retryable, never live', async () => {
  const id = await db.asUser(
    s.superAdmin,
    async c =>
      (await c.query("SELECT app.add_domain($1,'unconfigured.example.org',false) AS id", [s.siteA])).rows[0]!.id,
  )
  const handlers = new Map([
    [
      'domain.sync',
      createDomainHandler(db.pool('worker'), 'no-provider', configuredDomainProvisioner({ NODE_ENV: 'production' })),
    ],
  ])
  const result = await drainOutbox(db.pool('worker'), 'no-provider', handlers)
  expect(result.retrying).toBe(1)
  expect(result.delivered).toBe(0)
  const row = await db.asUser(
    s.superAdmin,
    async c => (await c.query('SELECT status FROM domains WHERE id=$1', [id])).rows[0]!,
  )
  expect(row.status).toBe('pending_dns')
})
it('serializes provider calls for the same hostname across independent leased events', async () => {
  const id = await db.asUser(
    s.superAdmin,
    async c => (await c.query("SELECT app.add_domain($1,'locked.example.org',false) AS id", [s.siteA])).rows[0]!.id,
  )
  const connection = await db.pool('worker').connect()
  await connection.query('SELECT pg_advisory_lock(hashtextextended($1,630))', [id])
  const provider = createFakeDomainProvisioner()
  const attach = vi.spyOn(provider, 'attach')
  try {
    const handlers = new Map([['domain.sync', createDomainHandler(db.pool('worker'), 'locked-provider', provider)]])
    expect((await drainOutbox(db.pool('worker'), 'locked-provider', handlers)).retrying).toBe(1)
    expect(attach).not.toHaveBeenCalled()
  } finally {
    await connection.query('SELECT pg_advisory_unlock(hashtextextended($1,630))', [id])
    connection.release()
  }
})
it('refuses another tenant’s domain in a damaged event before contacting a provider or recording a receipt', async () => {
  const id = await db.asUser(
    s.superAdmin,
    async c => (await c.query("SELECT app.add_domain($1,'other-site.example.org',false) AS id", [s.siteB])).rows[0]!.id,
  )
  await db.as('owner', async c => {
    await c.query(
      "UPDATE outbox SET status='delivered',processed_at=now(),leased_until=NULL,lease_token_hash=NULL WHERE status IN ('pending','running')",
    )
    await c.query(
      "INSERT INTO outbox(site_id,event_type,payload) VALUES($1,'domain.sync',jsonb_build_object('domain_id',$2::text))",
      [s.siteA, id],
    )
  })
  const provider = createFakeDomainProvisioner()
  const attach = vi.spyOn(provider, 'attach')
  const event = await db.asWorker(
    'tenant-guard',
    async c => (await c.query('SELECT * FROM app.claim_outbox(60)')).rows[0]!,
  )
  const handler = createDomainHandler(db.pool('worker'), 'tenant-guard', provider)
  await handler.handle(event)
  expect(attach).not.toHaveBeenCalled()
  await db.asWorker('tenant-guard', c =>
    c.query('SELECT app.record_domain_result($1,$2,0,$3,$4,$5,NULL,NULL)', [
      event.id,
      event.lease_token,
      'live',
      'foreign-receipt',
      '[]',
    ]),
  )
  const domain = await db.asUser(
    s.superAdmin,
    async c => (await c.query('SELECT status,provider_ref,last_checked_at FROM domains WHERE id=$1', [id])).rows[0]!,
  )
  expect(domain).toEqual({ status: 'pending_dns', provider_ref: null, last_checked_at: null })
})
