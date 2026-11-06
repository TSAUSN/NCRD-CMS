import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { TestDatabase, expectSqlState } from './harness.ts'
import { seedScenario, type Scenario } from './fixtures.ts'
let db: TestDatabase
let s: Scenario
beforeAll(async () => {
  db = await TestDatabase.create('domains')
  s = await seedScenario(db)
  await db.asUser(s.superAdmin, client =>
    client.query('SELECT app.set_site_membership($1,$2,$3)', [s.editorA, s.siteA, 'site_admin']),
  )
})
afterAll(async () => {
  await db?.close()
})
const add = (host: string, paired = false, user?: string, site?: string) =>
  db.asUser(
    user ?? s.superAdmin,
    async client =>
      (await client.query('SELECT app.add_domain($1,$2,$3) AS id', [site ?? s.siteA, host, paired])).rows[0]!
        .id as string,
  )
const rows = () =>
  db.asUser(
    s.superAdmin,
    async client =>
      (await client.query('SELECT * FROM domains WHERE site_id=$1 ORDER BY hostname_normalized', [s.siteA])).rows,
  )
const worker = <T>(fn: Parameters<TestDatabase['asWorker']>[1]) => db.asWorker('domains-test', fn) as Promise<T>
async function claim(domainId: string): Promise<{ id: string; lease_token: string }> {
  await db.as('owner', client =>
    client.query(
      "UPDATE outbox SET status='delivered',processed_at=now(),leased_until=NULL,lease_token_hash=NULL WHERE status='pending' AND (event_type<>'domain.sync' OR payload->>'domain_id'<>$1)",
      [domainId],
    ),
  )
  const result = await db.asWorker('domains-test', client => client.query('SELECT * FROM app.claim_outbox(60)'))
  expect(result.rows[0]?.payload.domain_id).toBe(domainId)
  return result.rows[0]!
}
async function result(event: { id: string; lease_token: string }, revision: number, state = 'live') {
  return db.asWorker('domains-test', client =>
    client.query('SELECT app.record_domain_result($1,$2,$3,$4,$5,$6,$7,$8)', [
      event.id,
      event.lease_token,
      revision,
      state,
      'provider-reference',
      '[]',
      null,
      null,
    ]),
  )
}
describe('domain lifecycle through real roles', () => {
  it('limits every domain mutation to an active Super Admin, including direct command calls', async () => {
    const id = await add('paired.example.org', true)
    const before = await rows()
    const beforeWork = await db.asUser(s.superAdmin, client =>
      client.query("SELECT id FROM outbox WHERE event_type='domain.sync' ORDER BY id"),
    )
    const beforeAudit = await db.asUser(s.superAdmin, client =>
      client.query("SELECT id FROM audit_log WHERE action LIKE 'domain.%' ORDER BY id"),
    )
    for (const actor of [s.editorA, s.contributorA, s.editorB, s.disabled, null]) {
      await expectSqlState(
        db.asUser(actor, client => client.query('SELECT app.add_domain($1,$2,false)', [s.siteA, 'denied.example.org'])),
        'CMS02',
      )
      await expectSqlState(
        db.asUser(actor, client => client.query('SELECT app.check_domain($1)', [id])),
        'CMS02',
      )
      await expectSqlState(
        db.asUser(actor, client => client.query('SELECT app.set_primary_domain($1,0)', [id])),
        'CMS02',
      )
      await expectSqlState(
        db.asUser(actor, client => client.query("SELECT app.remove_domain($1,0,'paired.example.org')", [id])),
        'CMS02',
      )
    }
    expect(await rows()).toEqual(before)
    expect(
      (
        await db.asUser(s.superAdmin, client =>
          client.query("SELECT id FROM outbox WHERE event_type='domain.sync' ORDER BY id"),
        )
      ).rows,
    ).toEqual(beforeWork.rows)
    expect(
      (
        await db.asUser(s.superAdmin, client =>
          client.query("SELECT id FROM audit_log WHERE action LIKE 'domain.%' ORDER BY id"),
        )
      ).rows,
    ).toEqual(beforeAudit.rows)
  })
  it('validates hostname before reserving and refuses direct table writes', async () => {
    await expectSqlState(add('denied.example.org', false, s.contributorA), 'CMS02')
    await expectSqlState(add('denied.example.org', false, s.editorB), 'CMS02')
    await expectSqlState(add('denied.example.org', false, s.disabled), 'CMS02')
    for (const host of ['https://example.org', 'example.org:80', 'x..example.org', '127.0.0.1', 'x.test'])
      await expectSqlState(add(host), 'CMS04')
    await expectSqlState(
      db.asUser(s.superAdmin, client =>
        client.query("INSERT INTO domains(site_id,hostname_normalized) VALUES($1,'direct.example.org')", [s.siteA]),
      ),
      '42501',
    )
  })
  it('reserves the automatic pair atomically, retries once, and never leaks a foreign reservation', async () => {
    const id = await add('paired.example.org', true)
    expect(await add('paired.example.org', true)).toBe(id)
    expect((await rows()).filter(row => row.hostname_normalized.includes('paired'))).toHaveLength(2)
    await expectSqlState(add('www.paired.example.org', false, s.superAdmin, s.siteB), 'CMS04')
    const audits = await db.asUser(s.superAdmin, client =>
      client.query("SELECT * FROM audit_log WHERE action='domain.add' AND item_id=$1", [id]),
    )
    expect(audits.rows).toHaveLength(1)
    const other = await db.asUser(s.editorB, client => client.query('SELECT * FROM domains WHERE id=$1', [id]))
    expect(other.rows).toHaveLength(0)
  })
  it('accepts status only with an active event lease and updates canonical projection', async () => {
    const id = (await rows()).find(row => row.hostname_normalized === 'paired.example.org')!.id
    const event = await claim(id)
    await expectSqlState(result({ ...event, lease_token: '00000000-0000-0000-0000-000000000000' }, 0), 'CMS04')
    await result(event, 0)
    const resolved = await db.as('public', client =>
      client.query("SELECT * FROM public_api.resolve_host('paired.example.org')"),
    )
    expect(resolved.rows[0]?.site_id).toBe(s.siteA)
    const shell = await db.asUser(s.superAdmin, client =>
      client.query('SELECT payload FROM published_site_shells WHERE site_id=$1', [s.siteA]),
    )
    expect(shell.rows[0]!.payload.canonical_host).toBe('paired.example.org')
  })
  it('requires a live verified alias, then redirects the old primary to the new address', async () => {
    const alias = (await rows()).find(row => row.hostname_normalized === 'www.paired.example.org')!
    await expectSqlState(
      db.asUser(s.superAdmin, client => client.query('SELECT app.set_primary_domain($1,0)', [alias.id])),
      'CMS04',
    )
    await db.asUser(s.superAdmin, client => client.query('SELECT app.check_domain($1)', [alias.id]))
    await result(await claim(alias.id), 0)
    await db.asUser(s.superAdmin, client => client.query('SELECT app.set_primary_domain($1,0)', [alias.id]))
    const resolved = await db.as('public', client =>
      client.query("SELECT * FROM public_api.resolve_host('paired.example.org')"),
    )
    expect(resolved.rows[0]?.redirect_to).toBe('www.paired.example.org')
  })
  it('revokes every dependent address immediately and ignores a late attachment receipt', async () => {
    const primary = (await rows()).find(row => row.hostname_normalized === 'www.paired.example.org')!
    await db.asUser(s.superAdmin, client => client.query('SELECT app.check_domain($1)', [primary.id]))
    // Settle any prior running event, so the new check can be claimed.
    await db.as('owner', client =>
      client.query(
        "UPDATE outbox SET status='delivered',processed_at=now(),leased_until=NULL,lease_token_hash=NULL WHERE status='running'",
      ),
    )
    const event = await claim(primary.id)
    await expectSqlState(
      db.asUser(s.superAdmin, client =>
        client.query("SELECT app.remove_domain($1,$2,'wrong')", [primary.id, primary.revision]),
      ),
      'CMS04',
    )
    await db.asUser(s.superAdmin, client =>
      client.query('SELECT app.remove_domain($1,$2,$3)', [primary.id, primary.revision, primary.hostname_normalized]),
    )
    await result(event, Number(primary.revision))
    for (const host of ['paired.example.org', 'www.paired.example.org']) {
      const resolved = await db.as('public', client =>
        client.query('SELECT * FROM public_api.resolve_host($1)', [host]),
      )
      expect(resolved.rows).toHaveLength(0)
    }
    expect(
      (await rows()).filter(row => row.hostname_normalized.includes('paired')).every(row => row.status === 'removing'),
    ).toBe(true)
  })
  it('completes cleanup, exposes history and permits reuse after provider deletion', async () => {
    for (const row of (await rows()).filter(row => row.status === 'removing')) {
      await db.as('owner', client =>
        client.query(
          "UPDATE outbox SET status='delivered',processed_at=now(),leased_until=NULL,lease_token_hash=NULL WHERE status='running'",
        ),
      )
      await db.asUser(s.superAdmin, client => client.query('SELECT app.check_domain($1)', [row.id]))
      await result(await claim(row.id), Number(row.revision), 'removed')
    }
    const history = await db.asUser(s.contributorA, client =>
      client.query("SELECT * FROM domain_events WHERE status='removed'"),
    )
    expect(history.rows).toHaveLength(2)
    expect(await add('paired.example.org', true)).toEqual(expect.any(String))
  })
  it('queues periodic checks without producing duplicate pending work', async () => {
    const id = await add('periodic.example.org')
    await db.as('owner', client =>
      client.query("UPDATE domains SET last_requested_at=now()-interval '11 minutes' WHERE id=$1", [id]),
    )
    await worker(client => client.query('SELECT app.request_due_domain_checks()'))
    await worker(client => client.query('SELECT app.request_due_domain_checks()'))
    const work = await db.asUser(s.superAdmin, client =>
      client.query(
        "SELECT id FROM outbox WHERE event_type='domain.sync' AND status='pending' AND payload->>'domain_id'=$1",
        [id],
      ),
    )
    expect(work.rows).toHaveLength(1)
  })
  it('routes two independently verified test subdomains to separate sites', async () => {
    const first = await add('test-one.example.org', false, s.superAdmin, s.siteA)
    const second = await add('test-two.example.org', false, s.superAdmin, s.siteB)
    for (const id of [first, second]) {
      await db.asUser(s.superAdmin, client => client.query('SELECT app.check_domain($1)', [id]))
      await result(await claim(id), 0)
      await db.asUser(s.superAdmin, async client => {
        const row = (await client.query('SELECT revision FROM domains WHERE id=$1', [id])).rows[0]!
        await client.query('SELECT app.set_primary_domain($1,$2)', [id, row.revision])
      })
      await db.as('owner', client =>
        client.query(
          "UPDATE outbox SET status='delivered',processed_at=now(),leased_until=NULL,lease_token_hash=NULL WHERE status='running'",
        ),
      )
    }
    for (const [host, site] of [
      ['test-one.example.org', s.siteA],
      ['test-two.example.org', s.siteB],
    ]) {
      const resolved = await db.as('public', client =>
        client.query('SELECT * FROM public_api.resolve_host($1)', [host]),
      )
      expect(resolved.rows).toHaveLength(1)
      expect(resolved.rows[0]!.site_id).toBe(site)
    }
    await expectSqlState(add('test-one.example.org', false, s.superAdmin, s.siteB), 'CMS04')
    expect(
      (
        await db.as('public', client =>
          client.query("SELECT * FROM public_api.resolve_host('unconnected.example.org')"),
        )
      ).rows,
    ).toHaveLength(0)
  })
})
