import { beforeAll, afterAll, it, expect } from 'vitest'
import { TestDatabase } from './harness.ts'
import { seedScenario, type Scenario } from './fixtures.ts'
import { SAWSO_THEME } from '../../seeds/src/core-themes.ts'
let db: TestDatabase, s: Scenario
beforeAll(async () => {
  db = await TestDatabase.create('sawso_reference_contrast')
  s = await seedScenario(db)
})
afterAll(async () => {
  await db?.close()
})
it('permits only the exact owner-approved reference pair and keeps ordinary contrast and role checks', async () => {
  async function save(tokens: unknown) {
    return db.asUser(s.superAdmin, async c => {
      const head = (await c.query('SELECT revision FROM themes WHERE site_id=$1', [s.siteA])).rows[0]!
      return (
        await c.query('SELECT * FROM app.save_theme_draft($1,$2,$3)', [s.siteA, head.revision, JSON.stringify(tokens)])
      ).rows[0]!.revision
    })
  }
  const ordinary = structuredClone(SAWSO_THEME)
  delete ordinary.presentation!.referenceContrast
  let revision = await save(ordinary)
  await expect(
    db.asUser(s.superAdmin, c => c.query('SELECT app.publish_theme($1,$2)', [s.siteA, revision])),
  ).rejects.toThrow('primary foreground and background contrast')
  const wrong = structuredClone(SAWSO_THEME)
  wrong.colors.primary = '#ff9999'
  await expect(save(wrong)).rejects.toThrow('exact red/white pair')
  revision = await save(SAWSO_THEME)
  await expect(
    db.asUser(s.editorA, c => c.query('SELECT app.publish_theme($1,$2)', [s.siteA, revision])),
  ).rejects.toThrow('not permitted')
  await expect(
    db.asUser(s.superAdmin, c => c.query('SELECT app.publish_theme($1,$2)', [s.siteA, revision])),
  ).resolves.toBeDefined()
  const manifest = { sections: [{ instance: { appearance: { surface: 'primary' } } }] }
  await expect(
    db.as('owner', c =>
      c.query('SELECT app.assert_section_appearance_contrast($1,$2)', [
        JSON.stringify(manifest),
        JSON.stringify(SAWSO_THEME),
      ]),
    ),
  ).resolves.toBeDefined()
  await expect(
    db.as('owner', c =>
      c.query('SELECT app.assert_section_appearance_contrast($1,$2)', [
        JSON.stringify(manifest),
        JSON.stringify(ordinary),
      ]),
    ),
  ).rejects.toThrow('section appearance needs')
  const badBody = structuredClone(SAWSO_THEME)
  badBody.colors.ink = '#ffffff'
  revision = await save(badBody)
  await expect(
    db.asUser(s.superAdmin, c => c.query('SELECT app.publish_theme($1,$2)', [s.siteA, revision])),
  ).rejects.toThrow('body text and surface contrast')
})
