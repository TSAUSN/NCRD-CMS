import { beforeAll, afterAll, it, expect } from 'vitest'
import { TestDatabase, expectSqlState } from './harness.ts'
import { seedScenario, heroContent, type Scenario } from './fixtures.ts'
let db: TestDatabase, s: Scenario
beforeAll(async () => {
  db = await TestDatabase.create('repeatdefs')
  s = await seedScenario(db)
})
afterAll(async () => {
  await db?.close()
})
it('keeps repeated instances in order and still refuses a bad second version of the same definition', async () => {
  const old = (
    await db.as('owner', c =>
      c.query(
        'SELECT d.slug,d.name,d.category,v.* FROM section_defs d JOIN section_def_versions v ON v.section_def_id=d.id WHERE d.id=$1',
        [s.heroDefId],
      ),
    )
  ).rows[0]!
  const newer = (
    await db.asUser(s.superAdmin, c =>
      c.query('SELECT * FROM app.upsert_section_def_version($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)', [
        old.slug,
        old.name,
        old.category,
        old.source_html,
        old.source_css,
        old.compiled_css,
        JSON.stringify(old.compiled_ast),
        JSON.stringify(old.slots),
        'repeat-version-two',
        old.sanitizer_policy_version,
        old.css_policy_version,
        'Second version',
      ]),
    )
  ).rows[0]!
  const sections = Array.from({ length: 20 }, (_, i) => JSON.parse(heroContent(s.heroDefId, '[Section ' + i + ']'))[0])
  sections.push({
    ...sections[0],
    section_def_version: newer.version,
    values: { heading: '[New version]', intro: '[Reviewed paragraph]' },
  })
  const saved = (
    await db.asUser(s.editorA, c =>
      c.query('SELECT * FROM app.save_page_draft($1,0,$2,$3)', [s.pageA, JSON.stringify(sections), '{}']),
    )
  ).rows[0]!
  const manifest = (
    await db.asUser(s.editorA, c => c.query('SELECT app.build_render_manifest($1) AS manifest', [saved.version_id]))
  ).rows[0]!.manifest
  expect(manifest.sections).toHaveLength(21)
  expect(
    manifest.sections.map((row: { instance: { values: { heading: string } } }) => row.instance.values.heading),
  ).toEqual([...Array.from({ length: 20 }, (_, i) => '[Section ' + i + ']'), '[New version]'])
  await db.as('owner', c =>
    c.query('UPDATE section_def_versions SET sanitizer_policy_version=1 WHERE section_def_id=$1 AND version=$2', [
      s.heroDefId,
      newer.version,
    ]),
  )
  await expectSqlState(
    db.asUser(s.editorA, c => c.query('SELECT app.build_render_manifest($1)', [saved.version_id])),
    'CMS04',
  )
})
