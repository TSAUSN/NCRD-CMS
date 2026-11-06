import { beforeAll, afterAll, it, expect } from 'vitest'
import { TestDatabase, expectSqlState } from './harness.ts'
import { seedScenario, type Scenario } from './fixtures.ts'
import { SAWSO_THEME } from '../../seeds/src/core-themes.ts'
let db: TestDatabase, s: Scenario
beforeAll(async () => {
  db = await TestDatabase.create('national_template')
  s = await seedScenario(db)
  await db.asUser(s.superAdmin, c =>
    c.query("SELECT app.set_site_membership($1,$2,'site_admin')", [s.editorA, s.siteA]),
  )
})
afterAll(async () => {
  await db?.close()
})
async function save(actor: string, tokens: unknown) {
  return db.asUser(actor, async c => {
    const head = (await c.query('SELECT revision,published_version_id FROM themes WHERE site_id=$1', [s.siteA]))
      .rows[0]!
    await c.query('SELECT app.save_theme_draft($1,$2,$3)', [s.siteA, head.revision, JSON.stringify(tokens)])
    return head
  })
}
it('keeps template drafts private and prevents site admins bypassing the colour and layout lock', async () => {
  const before = await save(s.superAdmin, SAWSO_THEME)
  const altered = structuredClone(SAWSO_THEME)
  altered.colors.primary = '#123456'
  delete altered.presentation!.referenceContrast
  await expectSqlState(save(s.editorA, altered), 'CMS02')
  const detached = structuredClone(SAWSO_THEME)
  delete detached.presentation!.template
  await expectSqlState(save(s.editorA, detached), 'CMS02')
  const unlocked = structuredClone(SAWSO_THEME)
  unlocked.presentation!.template!.mayChangeColours = true
  await expectSqlState(save(s.editorA, unlocked), 'CMS02')
  const layout = structuredClone(SAWSO_THEME)
  layout.radius = '0rem'
  await expectSqlState(save(s.editorA, layout), 'CMS02')
  const font = structuredClone(SAWSO_THEME)
  font.fonts.heading = "'Open Sans', Arial, sans-serif"
  await expect(save(s.editorA, font)).resolves.toBeDefined()
  const after = await db.asUser(
    s.superAdmin,
    async c => (await c.query('SELECT published_version_id FROM themes WHERE site_id=$1', [s.siteA])).rows[0]!,
  )
  expect(after.published_version_id).toBe(before.published_version_id)
  await expectSqlState(save(s.contributorA, SAWSO_THEME), 'CMS02')
})
it('validates the bounded parent identity and policy at the database boundary', async () => {
  for (const policy of [
    { id: 'other', version: 1, mayChangeColours: false },
    { id: 'national', version: 0, mayChangeColours: false },
    { id: 'national', version: 1, mayChangeColours: 'false' },
    { id: 'national', version: 1, mayChangeColours: false, css: 'body{}' },
  ]) {
    const tokens = { ...SAWSO_THEME, presentation: { ...SAWSO_THEME.presentation, template: policy } }
    await expectSqlState(save(s.superAdmin, tokens), 'CMS04')
  }
})
