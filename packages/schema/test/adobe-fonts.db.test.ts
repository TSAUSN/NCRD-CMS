import { beforeAll, afterAll, it, expect } from 'vitest'
import { TestDatabase, expectSqlState } from './harness.ts'
import { seedScenario, type Scenario } from './fixtures.ts'
import { SAWSO_THEME } from '../../seeds/src/core-themes.ts'
let db: TestDatabase, s: Scenario
const fonts = {
  heading: "'trajan-pro-3', 'Source Serif 4', Georgia, serif",
  body: "'proxima-nova', 'Open Sans', Arial, sans-serif",
  adobeKit: { id: 'euh2hvn', enabled: true, domains: ['sawso.staging.localhost', 'localhost'] },
}
beforeAll(async () => {
  db = await TestDatabase.create('adobe_fonts')
  s = await seedScenario(db)
})
afterAll(async () => {
  await db?.close()
})
async function save(kit: unknown) {
  return db.asUser(s.superAdmin, async c => {
    const h = (await c.query('SELECT revision FROM themes WHERE site_id=$1', [s.siteA])).rows[0]!
    return c.query('SELECT app.save_theme_draft($1,$2,$3)', [
      s.siteA,
      h.revision,
      JSON.stringify({ ...SAWSO_THEME, fonts: { ...fonts, adobeKit: kit } }),
    ])
  })
}
it('accepts the approved kit and rejects arbitrary hosts, kit IDs and extra properties', async () => {
  await expect(save(fonts.adobeKit)).resolves.toBeDefined()
  for (const family of ['proxima-nova-condensed', 'proxima-nova-extra-condensed'])
    await db.asUser(s.superAdmin, async c => {
      const h = (await c.query('SELECT revision FROM themes WHERE site_id=$1', [s.siteA])).rows[0]!
      await c.query('SELECT app.save_theme_draft($1,$2,$3)', [
        s.siteA,
        h.revision,
        JSON.stringify({
          ...SAWSO_THEME,
          fonts: { ...fonts, body: "'" + family + "', 'Open Sans', Arial, sans-serif" },
        }),
      ])
    })
  for (const kit of [
    { ...fonts.adobeKit, id: 'other' },
    { ...fonts.adobeKit, domains: ['https://example.test'] },
    { ...fonts.adobeKit, domains: ['a.test:443'] },
    { ...fonts.adobeKit, domains: [123] },
    { ...fonts.adobeKit, domains: ['a..test'] },
    { ...fonts.adobeKit, url: 'https://evil.test/fonts.css' },
  ])
    await expectSqlState(save(kit), 'CMS04')
})
it('never permits Trajan headings on a chapter site', async () => {
  await db.as('owner', c => c.query('UPDATE sites SET chapters_enabled=true WHERE id=$1', [s.siteA]))
  await expectSqlState(save(fonts.adobeKit), 'CMS04')
})
