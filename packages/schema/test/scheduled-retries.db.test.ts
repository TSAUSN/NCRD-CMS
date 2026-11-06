import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { TestDatabase, expectSqlState, CHECKED_CLEAN } from './harness.ts'
import { seedScenario, heroContent, type Scenario } from './fixtures.ts'
let db: TestDatabase
let s: Scenario
let number = 0
beforeAll(async () => {
  db = await TestDatabase.create('scheduled_retries')
  s = await seedScenario(db)
})
afterAll(async () => {
  await db?.close()
})
async function beat() {
  await db.asWorker('retry-tests', c => c.query("SELECT app.worker_heartbeat('worker','test')"))
}
async function fixture(action: 'publish' | 'unpublish' = 'publish') {
  await beat()
  const page = await db.asUser(s.editorA, async c => {
    const id = (
      await c.query('SELECT app.create_page($1,$2,$3) AS id', [s.siteA, `retry-${++number}`, 'Retry test page'])
    ).rows[0]!.id
    let draft = (await c.query('SELECT * FROM app.save_page_draft($1,0,$2,$3)', [id, heroContent(s.heroDefId), '{}']))
      .rows[0]!
    if (action === 'unpublish') {
      const published = (
        await c.query('SELECT * FROM app.publish_page($1,$2,$3,$4,$5)', [id, draft.revision, ...CHECKED_CLEAN])
      ).rows[0]!
      draft = { ...draft, revision: published.revision }
    }
    const job = (
      await c.query('SELECT app.schedule_page_action($1,$2,$3,$4,$5,2,$6,NULL,$7) AS id', [
        id,
        draft.revision,
        draft.version_id,
        action,
        new Date(Date.now() + 3600000),
        action === 'publish' ? '[]' : null,
        randomUUID(),
      ])
    ).rows[0]!.id
    return {
      pageId: id,
      revision: draft.revision as string,
      versionId: draft.version_id as string,
      jobId: job as string,
    }
  })
  // Synthetic terminal infrastructure failure: no real delayed publication.
  await db.as('owner', c =>
    c.query(
      "UPDATE scheduled_actions SET status='failed',finished_at=now(),attempt_count=5,failure_kind='attempts_exhausted',last_error='Synthetic connection failure' WHERE id=$1",
      [page.jobId],
    ),
  )
  return page
}
type Fixture = Awaited<ReturnType<typeof fixture>>
const newIntent = () => ({ runAt: new Date(Date.now() + 3600000), requestId: randomUUID() })
function retry(
  f: Fixture,
  intention = newIntent(),
  user = s.editorA,
  readiness: string | null = '[]',
  override: string | null = null,
) {
  return db.asUser(
    user,
    async c =>
      (
        await c.query('SELECT app.retry_page_schedule($1,$2,$3,2,$4,$5,$6) AS id', [
          f.jobId,
          f.revision,
          intention.runAt,
          readiness,
          override,
          intention.requestId,
        ])
      ).rows[0]!.id as string,
  )
}
const row = (id: string) =>
  db.as('owner', async c => (await c.query('SELECT * FROM scheduled_actions WHERE id=$1', [id])).rows[0]!)
it('creates one new linked attempt under the current actor, keeping original failure and live content unchanged', async () => {
  const f = await fixture()
  const before = await row(f.jobId)
  const intent = newIntent()
  const id = await retry(f, intent, s.superAdmin)
  expect(id).not.toBe(f.jobId)
  expect(await row(f.jobId)).toEqual(before)
  expect(await row(id)).toMatchObject({
    retry_of_id: f.jobId,
    version_id: f.versionId,
    created_by: s.superAdmin,
    status: 'pending',
    attempt_count: 0,
    last_error: null,
    override_reason: null,
  })
  const publicHead = await db.asUser(s.editorA, c =>
    c.query('SELECT published_version_id FROM pages WHERE id=$1', [f.pageId]),
  )
  expect(publicHead.rows[0]!.published_version_id).toBeNull()
  const audit = await db.asUser(s.editorA, c =>
    c.query("SELECT actor_id,detail FROM audit_log WHERE action='schedule.retry' AND item_id=$1", [id]),
  )
  expect(audit.rows).toHaveLength(1)
  expect(audit.rows[0]!.detail.retry_of_id).toBe(f.jobId)
  expect(await retry(f, intent, s.superAdmin)).toBe(id)
})
it('serializes competing manual retries and refuses request references already used for other intentions', async () => {
  const f = await fixture()
  const intent = newIntent()
  const pair = await Promise.all([retry(f, intent), retry(f, intent)])
  expect(pair[0]).toBe(pair[1])
  await expectSqlState(retry(f), 'CMS04')
  const other = await fixture()
  await expectSqlState(retry(other, intent), 'CMS04')
  expect(
    (await db.as('owner', c => c.query('SELECT id FROM scheduled_actions WHERE retry_of_id=$1', [f.jobId]))).rows,
  ).toHaveLength(1)
})
it('requires current access, active content, unchanged page revision and a live worker', async () => {
  const f = await fixture()
  for (const user of [s.contributorA, s.editorB, s.disabled]) await expectSqlState(retry(f, newIntent(), user), 'CMS02')
  await expectSqlState(retry({ ...f, revision: '99999' }), 'CMS01')
  await db.as('owner', c => c.query("UPDATE job_heartbeats SET last_seen_at=now()-interval '2 minutes'"))
  await expectSqlState(retry(f), 'CMS04')
  await beat()
  await db.asUser(s.editorA, c => c.query('SELECT app.archive_page($1,$2)', [f.pageId, f.revision]))
  await expectSqlState(retry(f), 'CMS04')
})
it('does not carry forward an override and validates the fresh report and explicit exception', async () => {
  const f = await fixture()
  const blocked = JSON.stringify([{ rule: 'missing_h1', severity: 'blocking', message: 'Missing heading' }])
  await db.as('owner', c =>
    c.query("UPDATE scheduled_actions SET override_reason='Earlier decision',authorized_findings=$2 WHERE id=$1", [
      f.jobId,
      blocked,
    ]),
  )
  await expectSqlState(retry(f, newIntent(), s.editorA, blocked), 'CMS04')
  await expectSqlState(retry(f, newIntent(), s.editorA, null), 'CMS04')
  const id = await retry(f, newIntent(), s.editorA, blocked, 'New reviewed decision')
  expect(await row(id)).toMatchObject({
    override_reason: 'New reviewed decision',
    authorized_findings: JSON.parse(blocked),
  })
})
it('refuses a publish retry whose pinned version is older than the current live version', async () => {
  const f = await fixture()
  await db.asUser(s.editorA, async c => {
    const draft = (
      await c.query('SELECT * FROM app.save_page_draft($1,$2,$3,$4)', [
        f.pageId,
        f.revision,
        heroContent(s.heroDefId, 'New live version'),
        '{}',
      ])
    ).rows[0]!
    f.revision = (
      await c.query('SELECT * FROM app.publish_page($1,$2,$3,$4,$5)', [f.pageId, draft.revision, ...CHECKED_CLEAN])
    ).rows[0]!.revision
  })
  await expectSqlState(retry(f), 'CMS04')
  expect(
    (await db.as('owner', c => c.query('SELECT id FROM scheduled_actions WHERE retry_of_id=$1', [f.jobId]))).rows,
  ).toEqual([])
})
it('refuses unpublish retries after a different version went live', async () => {
  const f = await fixture('unpublish')
  await db.asUser(s.editorA, async c => {
    const draft = (
      await c.query('SELECT * FROM app.save_page_draft($1,$2,$3,$4)', [
        f.pageId,
        f.revision,
        heroContent(s.heroDefId, 'New live version'),
        '{}',
      ])
    ).rows[0]!
    f.revision = (
      await c.query('SELECT * FROM app.publish_page($1,$2,$3,$4,$5)', [f.pageId, draft.revision, ...CHECKED_CLEAN])
    ).rows[0]!.revision
  })
  await expectSqlState(retry(f, newIntent(), s.editorA, null), 'CMS04')
})
it('keeps attempt chains single and only permits retrying a failed child', async () => {
  const f = await fixture()
  const id = await retry(f)
  await expectSqlState(retry({ ...f, jobId: id }), 'CMS04')
  await db.as('owner', c =>
    c.query(
      "UPDATE scheduled_actions SET status='failed',finished_at=now(),last_error='Second synthetic failure' WHERE id=$1",
      [id],
    ),
  )
  const next = await retry({ ...f, jobId: id })
  expect((await row(next)).retry_of_id).toBe(id)
  await expectSqlState(
    db.asUser(s.superAdmin, c => c.query('UPDATE scheduled_actions SET retry_of_id=NULL WHERE id=$1', [next])),
    '42501',
  )
})
