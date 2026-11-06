import { beforeAll, afterAll, describe, it, expect } from 'vitest'
import { TestDatabase, expectSqlState } from './harness.ts'
import { seedScenario, type Scenario } from './fixtures.ts'

let db: TestDatabase, s: Scenario, localDef: string
beforeAll(async () => {
  db = await TestDatabase.create('thumbnail_retry')
  s = await seedScenario(db)
  await db.asUser(s.superAdmin, async client => {
    await client.query("SELECT app.set_site_membership($1,$2,'site_admin')", [s.editorA, s.siteA])
    localDef = (
      await client.query(
        'SELECT section_def_id FROM app.upsert_section_def_version($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)',
        [
          'retry-local',
          'Site preview',
          'Test',
          '<p>Preview</p>',
          '',
          '',
          JSON.stringify({ nodes: [{ kind: 'html', value: '<p>Preview</p>' }], policyVersion: 4, cssPolicyVersion: 6 }),
          '[]',
          'retry-local-hash',
          4,
          6,
          'Test version',
          false,
          'legacy',
          null,
          null,
          'site',
          s.siteA,
        ],
      )
    ).rows[0]!.section_def_id
  })
  await db.as('owner', client =>
    client.query("UPDATE outbox SET status='delivered',processed_at=now() WHERE status='pending'"),
  )
})
afterAll(async () => {
  await db?.close()
})
async function failed(
  siteId: string | null = null,
  definition = s.heroDefId,
  event = 'section_def.thumbnail_requested',
) {
  return db.as(
    'owner',
    async client =>
      (
        await client.query(
          "INSERT INTO outbox(site_id,event_type,payload,status,attempts,max_attempts,last_error,failed_at) VALUES($1,$2,$3,'dead',3,5,'thumbnail-renders-nothing',now()) RETURNING id",
          [siteId, event, JSON.stringify({ section_def_id: definition, version: 1, slug: 'fixture' })],
        )
      ).rows[0]!.id as string,
  )
}
async function retry(user: string, id: string) {
  return db.asUser(
    user,
    async client => (await client.query('SELECT * FROM app.retry_thumbnail_delivery($1)', [id])).rows[0]!,
  )
}
async function snapshot() {
  return db.asUser(
    s.superAdmin,
    async client => (await client.query('SELECT app.inbox_snapshot() AS value')).rows[0]!.value,
  )
}
async function finish(id: string, ok: boolean) {
  await db.as('owner', client => client.query("UPDATE outbox SET next_attempt_at='2000-01-01' WHERE id=$1", [id]))
  return db.asWorker('thumbnail-test', async client => {
    const job = (await client.query('SELECT * FROM app.claim_outbox(60)')).rows[0]!
    expect(job.id).toBe(id)
    await client.query('SELECT app.settle_outbox($1,$2,$3,$4,$5)', [
      id,
      job.lease_token,
      ok,
      ok ? null : 'thumbnail-test-failure',
      true,
    ])
  })
}

describe('thumbnail retry recovery', () => {
  it('queues one linked retry and clears active failure counts only after success while preserving evidence', async () => {
    const id = await failed()
    const original = (
      await db.as('owner', client =>
        client.query('SELECT status,attempts,max_attempts,last_error,failed_at FROM outbox WHERE id=$1', [id]),
      )
    ).rows[0]
    expect((await snapshot()).items.find((item: { id: string }) => item.id === id)?.canRetryThumbnail).toBe(true)
    const before = Number(
      (await db.asUser(s.superAdmin, client => client.query('SELECT outbox_dead FROM app.job_queue_health()'))).rows[0]!
        .outbox_dead,
    )
    const first = await retry(s.superAdmin, id),
      again = await retry(s.superAdmin, id)
    expect(first).toEqual(again)
    expect(first.retry_status).toBe('pending')
    const pending = (await snapshot()).items.find((item: { id: string }) => item.id === id)
    expect(pending).toMatchObject({ canRetryThumbnail: false, retryId: first.retry_id, retryStatus: 'pending' })
    const newRow = (
      await db.as('owner', client =>
        client.query('SELECT attempts,max_attempts FROM outbox WHERE id=$1', [first.retry_id]),
      )
    ).rows[0]
    expect(newRow).toEqual({ attempts: 0, max_attempts: 5 })
    await finish(first.retry_id, true)
    expect((await snapshot()).items.find((item: { id: string }) => item.id === id)).toBeUndefined()
    expect(
      Number(
        (await db.asUser(s.superAdmin, client => client.query('SELECT outbox_dead FROM app.job_queue_health()')))
          .rows[0]!.outbox_dead,
      ),
    ).toBe(before - 1)
    expect(
      (
        await db.as('owner', client =>
          client.query('SELECT status,attempts,max_attempts,last_error,failed_at FROM outbox WHERE id=$1', [id]),
        )
      ).rows[0],
    ).toEqual(original)
    expect(
      (
        await db.as('owner', client =>
          client.query(
            "SELECT id FROM audit_log WHERE action='section_def.thumbnail_retry' AND detail->>'failed_delivery_id'=$1",
            [id],
          ),
        )
      ).rows,
    ).toHaveLength(1)
  })
  it('enforces global and site administration scope and denies arbitrary event retries', async () => {
    const global = await failed(),
      local = await failed(s.siteA, localDef),
      unrelated = await failed(s.siteA, localDef, 'page.published')
    await expectSqlState(retry(s.editorA, global), 'CMS02')
    await expectSqlState(retry(s.editorB, local), 'CMS02')
    await expectSqlState(retry(s.contributorA, local), 'CMS02')
    await expectSqlState(retry(s.disabled, local), 'CMS02')
    expect((await retry(s.editorA, local)).retry_status).toBe('pending')
    await expectSqlState(retry(s.superAdmin, unrelated), 'CMS04')
    const foreignPayload = await failed(s.siteA, s.heroDefId)
    await expectSqlState(retry(s.editorA, foreignPayload), 'CMS04')
    await expectSqlState(
      db.asUser(s.superAdmin, client =>
        client.query('INSERT INTO app.thumbnail_retry_receipts(failed_id,retry_id,requested_by) VALUES($1,$2,$3)', [
          global,
          local,
          s.superAdmin,
        ]),
      ),
      '42501',
    )
  })
  it('reuses an existing worker request and shows only the latest failure in a retry chain', async () => {
    const id = await failed()
    const waiting = (
      await db.as('owner', client =>
        client.query(
          "INSERT INTO outbox(event_type,payload) VALUES('section_def.thumbnail_requested',$1) RETURNING id",
          [JSON.stringify({ section_def_id: s.heroDefId, version: 1, slug: 'hero' })],
        ),
      )
    ).rows[0]!.id
    const linked = await retry(s.superAdmin, id)
    expect(linked.retry_id).toBe(waiting)
    await finish(waiting, false)
    const items = (await snapshot()).items
    expect(items.find((item: { id: string }) => item.id === id)).toBeUndefined()
    expect(items.find((item: { id: string }) => item.id === waiting)?.canRetryThumbnail).toBe(true)
    const second = await retry(s.superAdmin, waiting)
    await finish(second.retry_id, true)
    const complete = (await snapshot()).items
    expect(complete.some((item: { id: string }) => [id, waiting].includes(item.id))).toBe(false)
  })
  it('returns the linked result after worker completion rather than starting another job', async () => {
    const id = await failed(s.siteA, localDef)
    const first = await retry(s.editorA, id)
    await finish(first.retry_id, true)
    const repeated = await retry(s.editorA, id)
    expect(repeated).toEqual({ retry_id: first.retry_id, retry_status: 'delivered' })
    expect(
      (
        await db.as('owner', client =>
          client.query('SELECT * FROM app.thumbnail_retry_receipts WHERE failed_id=$1', [id]),
        )
      ).rows,
    ).toHaveLength(1)
  })
})
