import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { TestDatabase, expectSqlState } from './harness.ts'
import { seedScenario, heroContent, type Scenario } from './fixtures.ts'

let db: TestDatabase, s: Scenario
let page: { id: string; revision: string; version: string }
beforeAll(async () => {
  db = await TestDatabase.create('archivedsitepages')
  s = await seedScenario(db)
  page = await db.asUser(s.superAdmin, async client => {
    const id = (
      await client.query('SELECT app.create_page($1,$2,$3) AS id', [s.siteA, 'archive-reference', 'Archive reference'])
    ).rows[0]!.id
    const saved = (
      await client.query('SELECT * FROM app.save_page_draft($1,0,$2,$3)', [id, heroContent(s.heroDefId), '{}'])
    ).rows[0]!
    const site = (await client.query('SELECT revision FROM sites WHERE id=$1', [s.siteA])).rows[0]!
    await client.query('SELECT app.archive_site($1,$2)', [s.siteA, site.revision])
    return { id, revision: saved.revision, version: saved.version_id }
  })
})
afterAll(async () => {
  await db?.close()
})
async function snapshot() {
  return db.as(
    'owner',
    async client =>
      (
        await client.query(
          `SELECT
    (SELECT jsonb_agg(to_jsonb(p) ORDER BY id) FROM pages p WHERE site_id=$1) AS pages,
    (SELECT jsonb_agg(to_jsonb(v) ORDER BY id) FROM page_versions v WHERE site_id=$1) AS versions,
    (SELECT count(*) FROM audit_log WHERE site_id=$1) AS audit,
    (SELECT count(*) FROM outbox WHERE site_id=$1) AS outbox`,
          [s.siteA],
        )
      ).rows[0],
  )
}
describe('archived sites keep page content read-only', () => {
  it('refuses stale open editor saves, restores and new empty pages without changing history', async () => {
    const before = await snapshot()
    for (const actor of [s.superAdmin, s.editorA, s.contributorA]) {
      await expectSqlState(
        db.asUser(actor, c =>
          c.query('SELECT * FROM app.save_page_draft($1,$2,$3,$4)', [
            page.id,
            page.revision,
            heroContent(s.heroDefId, 'Must not change'),
            '{}',
          ]),
        ),
        'CMS04',
      )
      await expectSqlState(
        db.asUser(actor, c =>
          c.query('SELECT * FROM app.restore_version_as_draft($1,$2,$3)', [page.id, page.revision, page.version]),
        ),
        'CMS04',
      )
    }
    await expectSqlState(
      db.asUser(s.editorA, c => c.query('SELECT app.create_page($1,$2,$3)', [s.siteA, 'must-not-create', 'Blocked'])),
      'CMS04',
    )
    expect(await snapshot()).toEqual(before)
  })
  it('retains authorized historical reads and does not widen cross-site visibility', async () => {
    expect(
      (await db.asUser(s.editorA, c => c.query('SELECT id FROM page_versions WHERE id=$1', [page.version]))).rows,
    ).toHaveLength(1)
    expect(
      (await db.asUser(s.editorB, c => c.query('SELECT id FROM page_versions WHERE id=$1', [page.version]))).rows,
    ).toHaveLength(0)
  })
  it('still permits creating and saving pages on another active site', async () => {
    const result = await db.asUser(s.superAdmin, async client => {
      const id = (
        await client.query('SELECT app.create_page($1,$2,$3) AS id', [s.siteB, 'still-active', 'Active page'])
      ).rows[0]!.id
      return (await client.query('SELECT * FROM app.save_page_draft($1,0,$2,$3)', [id, '[]', '{}'])).rows[0]
    })
    expect(result?.revision).toBe('1')
  })
})
