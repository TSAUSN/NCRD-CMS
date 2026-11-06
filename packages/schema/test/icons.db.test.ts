import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { seedScenario, type Scenario } from './fixtures.ts'
import { TestDatabase, expectSqlState } from './harness.ts'
let db: TestDatabase, scenario: Scenario
beforeAll(async () => {
  db = await TestDatabase.create('icons')
  scenario = await seedScenario(db)
})
afterAll(async () => db?.close())
const save = (node: unknown, actor = scenario.superAdmin) =>
  db.asUser(actor, client =>
    client.query(
      'SELECT * FROM app.upsert_section_def_version($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)',
      [
        `icon-${Math.random().toString(36).slice(2, 10)}`,
        'Icon',
        'Content',
        '',
        '',
        '',
        JSON.stringify({ nodes: [], policyVersion: 4, cssPolicyVersion: 6 }),
        JSON.stringify([
          { id: 'symbol', kind: 'text', label: 'Icon', constraints: { presentation: 'cms-line-icons-v1' } },
        ]),
        'icon-test-hash',
        4,
        6,
        'Closed icon component',
        false,
        'structured',
        JSON.stringify({
          schemaVersion: 3,
          fields: [{ name: 'symbol', type: 'text', label: 'Icon' }],
          nodes: [{ type: 'element', tag: 'div', children: [node] }],
        }),
        3,
      ],
    ),
  )
describe('icon definition command boundary', () => {
  it('stores a fixed icon binding and refuses contributor definition writes', async () => {
    expect((await save({ type: 'icon', field: 'symbol' })).rowCount).toBe(1)
    await expectSqlState(save({ type: 'icon', field: 'symbol' }, scenario.contributorA), 'CMS02')
  })
  it('rejects missing fields, nulls, arbitrary URLs and SVG attributes', async () => {
    for (const node of [
      { type: 'icon', field: null },
      { type: 'icon', field: 'missing' },
      { type: 'icon', field: 'symbol', src: 'https://other.test' },
      { type: 'icon', field: 'symbol', onload: 'bad()' },
    ])
      await expectSqlState(save(node), 'CMS04')
  })
})
