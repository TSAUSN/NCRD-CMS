import { beforeAll, afterAll, expect, it } from 'vitest'
import { TestDatabase, expectSqlState } from './harness.ts'
import { seedScenario, type Scenario } from './fixtures.ts'
let db: TestDatabase
let s: Scenario
const analytics = { measurementId: 'G-ABCD123456', enabled: true, includeStaging: false }
beforeAll(async () => {
  db = await TestDatabase.create('site_analytics')
  s = await seedScenario(db)
  await db.asUser(s.superAdmin, c =>
    c.query("SELECT app.set_site_membership($1,$2,'site_admin')", [s.editorA, s.siteA]),
  )
})
afterAll(async () => db?.close())
async function revision() {
  return db.asUser(
    s.editorA,
    async c => (await c.query('SELECT revision FROM site_settings WHERE site_id=$1', [s.siteA])).rows[0]!.revision,
  )
}
async function save(actor: string, siteId: string, rev: unknown, value: unknown) {
  return db.asUser(
    actor,
    async c =>
      (
        await c.query('SELECT app.save_site_settings_draft($1,$2,$3) AS revision', [
          siteId,
          rev,
          JSON.stringify({ schemaVersion: 1, name: 'Site A', analytics: value }),
        ])
      ).rows[0]!.revision,
  )
}
it('keeps Analytics private until publication and preserves site isolation and stale-write checks', async () => {
  const oldRevision = await revision()
  const next = await save(s.editorA, s.siteA, oldRevision, analytics)
  const before = await db.asUser(s.editorA, c =>
    c.query("SELECT payload #> '{settings,analytics}' AS analytics FROM published_site_shells WHERE site_id=$1", [
      s.siteA,
    ]),
  )
  expect(before.rows[0]!.analytics).toBeNull()
  await expectSqlState(save(s.editorA, s.siteA, oldRevision, { ...analytics, enabled: false }), 'CMS01')
  await expectSqlState(save(s.contributorA, s.siteA, next, analytics), 'CMS02')
  await expectSqlState(save(s.editorB, s.siteA, next, analytics), 'CMS02')
  await db.asUser(s.editorA, c => c.query('SELECT app.publish_site_settings($1,$2)', [s.siteA, next]))
  const after = await db.asUser(s.editorA, c =>
    c.query("SELECT payload #> '{settings,analytics}' AS analytics FROM published_site_shells WHERE site_id=$1", [
      s.siteA,
    ]),
  )
  expect(after.rows[0]!.analytics).toEqual(analytics)
  expect(
    (await db.asUser(s.editorB, c => c.query('SELECT site_id FROM published_site_shells WHERE site_id=$1', [s.siteA])))
      .rows,
  ).toHaveLength(0)
})
it('rejects invalid IDs, missing enable prerequisites and arbitrary settings code through real commands', async () => {
  for (const value of [
    { ...analytics, measurementId: 'GTM-ABCD1234' },
    { ...analytics, measurementId: '' },
    { ...analytics, measurementId: 'https://attacker.test/tag.js' },
    { ...analytics, script: '<script>bad()</script>' },
    { ...analytics, includeStaging: 'true' },
    null,
  ])
    await expectSqlState(save(s.editorA, s.siteA, await revision(), value), 'CMS04')
  await save(s.editorA, s.siteA, await revision(), { measurementId: '', enabled: false, includeStaging: false })
})
