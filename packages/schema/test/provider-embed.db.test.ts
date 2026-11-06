import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { HNI_TABLEAU_EMBEDS } from '../src/content/provider-embed.ts'
import { seedScenario, type Scenario } from './fixtures.ts'
import { TestDatabase, expectSqlState } from './harness.ts'
let db: TestDatabase
let s: Scenario
beforeAll(async () => {
  db = await TestDatabase.create('provider_embed')
  s = await seedScenario(db)
})
afterAll(async () => db?.close())
function save(node: unknown, actor?: string) {
  return db.asUser(actor ?? s.superAdmin, c =>
    c.query('SELECT * FROM app.upsert_section_def_version($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)', [
      `tableau-${Math.random().toString(36).slice(2, 10)}`,
      'HNI chart',
      'Data',
      '',
      '',
      '',
      JSON.stringify({ nodes: [], policyVersion: 4, cssPolicyVersion: 6 }),
      '[]',
      'provider-test-hash',
      4,
      6,
      'Governed source Tableau',
      false,
      'structured',
      JSON.stringify({ schemaVersion: 3, fields: [], nodes: [{ type: 'element', tag: 'div', children: [node] }] }),
      3,
    ]),
  )
}
describe('provider embed storage and role boundary', () => {
  it('stores either known view and refuses contributors changing the provider definition', async () => {
    for (const node of Object.values(HNI_TABLEAU_EMBEDS)) expect((await save(node)).rowCount).toBe(1)
    await expectSqlState(save(HNI_TABLEAU_EMBEDS.map, s.contributorA), 'CMS02')
  })
  it('refuses arbitrary URLs, identifiers, iframe syntax and null identifier bypasses at the DB gate', async () => {
    for (const node of [
      { ...HNI_TABLEAU_EMBEDS.map, src: 'https://evil.test' },
      { ...HNI_TABLEAU_EMBEDS.map, srcdoc: '<script>bad</script>' },
      { ...HNI_TABLEAU_EMBEDS.map, workbook: '../another' },
      { ...HNI_TABLEAU_EMBEDS.map, view: 'another' },
      { ...HNI_TABLEAU_EMBEDS.map, provider: null },
      { ...HNI_TABLEAU_EMBEDS.map, workbook: null },
      { ...HNI_TABLEAU_EMBEDS.map, view: null },
      { ...HNI_TABLEAU_EMBEDS.map, title: '' },
      { type: 'element', tag: 'iframe', attributes: { src: 'https://public.tableau.com' } },
    ])
      await expectSqlState(save(node), 'CMS04')
  })
})
