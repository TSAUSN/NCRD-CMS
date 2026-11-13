import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { TestDatabase } from '@cms/schema/testing'
import { seedScenario, type Scenario } from '@cms/schema/fixtures'
import { createFakeDomainProvisioner } from '@cms/platform'
import { drainOutbox } from '../src/handlers.ts'
import { createDomainHandler } from '../src/domains.ts'
import { createSiteHostingHandler } from '../src/site-hosting.ts'

let db: TestDatabase, s: Scenario
beforeEach(async () => {
  db = await TestDatabase.create('hosting_recovery')
  s = await seedScenario(db)
  await db.as('owner', async c => {
    await c.query("UPDATE sites SET staging_hostname='worker-recovery.web.app' WHERE id=$1", [s.siteA])
    await c.query("UPDATE outbox SET status='delivered',processed_at=now() WHERE status='pending'")
  })
})
afterEach(async () => {
  await db?.close()
})
async function failure(type: string, payload: object) {
  return db.as(
    'owner',
    async c =>
      (
        await c.query(
          "INSERT INTO outbox(site_id,event_type,payload,status,failed_at,last_error) VALUES($1,$2,$3,'dead',now(),'Firebase Hosting returned HTTP 403') RETURNING id",
          [s.siteA, type, JSON.stringify(payload)],
        )
      ).rows[0]!.id as string,
  )
}
async function retry(id: string) {
  return db.asUser(
    s.superAdmin,
    async c => (await c.query('SELECT * FROM app.retry_hosting_delivery($1)', [id])).rows[0]!,
  )
}
async function active(id: string) {
  return db.as(
    'owner',
    async c => (await c.query('SELECT app.outbox_failure_is_active($1) AS active', [id])).rows[0]!.active,
  )
}
async function domain() {
  const id = await db.asUser(
    s.superAdmin,
    async c =>
      (await c.query("SELECT app.add_domain($1,'worker-recovery.example.org',false) AS id", [s.siteA])).rows[0]!
        .id as string,
  )
  await db.as('owner', c => c.query("UPDATE outbox SET status='delivered',processed_at=now() WHERE status='pending'"))
  return id
}

it('delivers the governed domain retry through the real handler and records provider proof', async () => {
  const d = await domain(),
    failed = await failure('domain.sync', { domain_id: d, revision: 0 })
  const work = await retry(failed),
    provider = createFakeDomainProvisioner()
  const attach = vi.spyOn(provider, 'attach')
  const result = await drainOutbox(
    db.pool('worker'),
    'recover-domain',
    new Map([['domain.sync', createDomainHandler(db.pool('worker'), 'recover-domain', provider)]]),
  )
  expect(result).toMatchObject({ delivered: 1, dead: 0, retrying: 0 })
  expect(attach).toHaveBeenCalledOnce()
  expect(await active(failed)).toBe(false)
  const record = (await db.as('owner', c => c.query('SELECT status,last_error FROM outbox WHERE id=$1', [failed])))
    .rows[0]!
  expect(record).toEqual({ status: 'dead', last_error: 'Firebase Hosting returned HTTP 403' })
  expect(
    (await db.as('owner', c => c.query('SELECT status FROM outbox WHERE id=$1', [work.retry_id]))).rows[0]!.status,
  ).toBe('delivered')
})
it('keeps the failure active while Hosting is unavailable and resolves it after a real handler retry', async () => {
  const failed = await failure('site.hosting_requested', { site_id: s.siteA }),
    work = await retry(failed)
  const ensureSite = vi
    .fn()
    .mockRejectedValueOnce(new Error('Firebase Hosting returned HTTP 403'))
    .mockResolvedValue(undefined)
  const handlers = new Map([
    ['site.hosting_requested', createSiteHostingHandler(db.pool('worker'), 'recover-site', { ensureSite })],
  ])
  expect((await drainOutbox(db.pool('worker'), 'recover-site', handlers)).retrying).toBe(1)
  expect(await active(failed)).toBe(true)
  await db.as('owner', c => c.query("UPDATE outbox SET next_attempt_at='2000-01-01' WHERE id=$1", [work.retry_id]))
  expect((await drainOutbox(db.pool('worker'), 'recover-site', handlers)).delivered).toBe(1)
  expect(ensureSite).toHaveBeenCalledWith('worker-recovery.web.app')
  expect(await active(failed)).toBe(false)
})
it('refuses a changed native target before invoking Hosting', async () => {
  const failed = await failure('site.hosting_requested', { site_id: s.siteA }),
    work = await retry(failed)
  await db.as('owner', c => c.query("UPDATE sites SET staging_hostname='changed.web.app' WHERE id=$1", [s.siteA]))
  const event = await db.asWorker(
    'stale-site',
    async c => (await c.query('SELECT * FROM app.claim_outbox(60)')).rows[0]!,
  )
  expect(event.id).toBe(work.retry_id)
  const ensureSite = vi.fn().mockResolvedValue(undefined)
  await expect(createSiteHostingHandler(db.pool('worker'), 'stale-site', { ensureSite }).handle(event)).rejects.toThrow(
    'hosting recovery target changed',
  )
  expect(ensureSite).not.toHaveBeenCalled()
  expect(await active(failed)).toBe(true)
})
it('refuses a changed domain revision before invoking the provider', async () => {
  const d = await domain(),
    failed = await failure('domain.sync', { domain_id: d, revision: 0 }),
    work = await retry(failed)
  await db.as('owner', c => c.query('UPDATE domains SET revision=1 WHERE id=$1', [d]))
  const event = await db.asWorker(
    'stale-domain',
    async c => (await c.query('SELECT * FROM app.claim_outbox(60)')).rows[0]!,
  )
  expect(event.id).toBe(work.retry_id)
  const provider = createFakeDomainProvisioner(),
    attach = vi.spyOn(provider, 'attach')
  await expect(createDomainHandler(db.pool('worker'), 'stale-domain', provider).handle(event)).rejects.toThrow(
    'domain recovery target changed',
  )
  expect(attach).not.toHaveBeenCalled()
  expect(await active(failed)).toBe(true)
})
it('refuses to record recovery when a domain changes during the provider call', async () => {
  const d = await domain(),
    failed = await failure('domain.sync', { domain_id: d, revision: 0 })
  await retry(failed)
  const provider = createFakeDomainProvisioner(),
    attach = provider.attach.bind(provider)
  vi.spyOn(provider, 'attach').mockImplementation(async (...args) => {
    const result = await attach(...args)
    await db.as('owner', c => c.query('UPDATE domains SET revision=1 WHERE id=$1', [d]))
    return result
  })
  const result = await drainOutbox(
    db.pool('worker'),
    'mid-flight-domain',
    new Map([['domain.sync', createDomainHandler(db.pool('worker'), 'mid-flight-domain', provider)]]),
  )
  expect(result).toMatchObject({ dead: 1, delivered: 0, retrying: 0 })
  expect(await active(failed)).toBe(true)
  expect(
    (await db.as('owner', c => c.query('SELECT last_checked_at FROM domains WHERE id=$1', [d]))).rows[0]!
      .last_checked_at,
  ).toBeNull()
})
