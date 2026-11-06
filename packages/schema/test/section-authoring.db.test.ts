import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { TestDatabase, expectSqlState } from './harness.ts'
import { seedScenario, type Scenario } from './fixtures.ts'

let db: TestDatabase
let s: Scenario
let args: unknown[]
beforeAll(async () => {
  db = await TestDatabase.create('section_authoring')
  s = await seedScenario(db)
  const row = (
    await db.as('owner', client =>
      client.query('SELECT * FROM section_def_versions WHERE section_def_id=$1 AND version=1', [s.heroDefId]),
    )
  ).rows[0]!
  args = [
    'hero',
    'Updated hero',
    'Openers',
    row.source_html,
    row.source_css,
    row.compiled_css,
    JSON.stringify(row.compiled_ast),
    JSON.stringify(row.slots),
    row.render_hash,
    row.sanitizer_policy_version,
    row.css_policy_version,
    'A new version',
    row.carries_trusted_code,
    row.definition_kind,
    row.structured_doc ? JSON.stringify(row.structured_doc) : null,
    row.structured_schema_version,
    'global',
    null,
  ]
})
afterAll(async () => {
  await db?.close()
})
const statement =
  'SELECT * FROM app.save_section_def_version($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)'

describe('section authoring compare-and-set', () => {
  it('creates a new immutable version without replacing the preceding version', async () => {
    const result = await db.asUser(s.superAdmin, client => client.query(statement, [...args, 1, s.heroDefId]))
    expect(result.rows[0]).toMatchObject({ section_def_id: s.heroDefId, version: 2 })
    const versions = await db.as('owner', client =>
      client.query('SELECT version,source_html FROM section_def_versions WHERE section_def_id=$1 ORDER BY version', [
        s.heroDefId,
      ]),
    )
    expect(versions.rows.map(row => row.version)).toEqual([1, 2])
    expect(versions.rows[0]!.source_html).toBe(args[3])
  })
  it('does not let a create form silently overwrite an existing definition', async () => {
    await expectSqlState(
      db.asUser(s.superAdmin, client => client.query(statement, [...args, 0, null])),
      'CMS01',
    )
  })
  it('refuses stale versions, missing revisions and a changed definition identity', async () => {
    await expectSqlState(
      db.asUser(s.superAdmin, client => client.query(statement, [...args, 1, s.heroDefId])),
      'CMS01',
    )
    await expectSqlState(
      db.asUser(s.superAdmin, client => client.query(statement, [...args, null, s.heroDefId])),
      'CMS04',
    )
    const renamed = [...args]
    renamed[0] = 'other-short-name'
    await expectSqlState(
      db.asUser(s.superAdmin, client => client.query(statement, [...renamed, 2, s.heroDefId])),
      'CMS04',
    )
  })
  it('lets exactly one concurrent edit win the same expected version', async () => {
    const outcomes = await Promise.allSettled(
      [1, 2].map(() => db.asUser(s.superAdmin, client => client.query(statement, [...args, 2, s.heroDefId]))),
    )
    expect(outcomes.filter(outcome => outcome.status === 'fulfilled')).toHaveLength(1)
    const refused = outcomes.find(outcome => outcome.status === 'rejected') as PromiseRejectedResult
    expect(refused.reason.code).toBe('CMS01')
  })
  it('does not allow ordinary editors to modify global definitions', async () => {
    await expectSqlState(
      db.asUser(s.editorA, client => client.query(statement, [...args, 3, s.heroDefId])),
      'CMS02',
    )
  })
})
