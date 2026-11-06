import { randomUUID } from 'node:crypto'
import { beforeAll, afterAll, expect, it } from 'vitest'
import { DEFAULT_BUTTON_APPEARANCE } from '../src/content/button-appearance.ts'
import { SEED_SECTION_DEFS, upsertArguments } from '../../seeds/src/index.ts'
import { seedScenario, type Scenario } from './fixtures.ts'
import { CHECKED_CLEAN, TestDatabase, expectSqlState } from './harness.ts'

let db: TestDatabase, s: Scenario, definitionId: string, definitionVersion: number
beforeAll(async () => {
  db = await TestDatabase.create('button_appearance')
  s = await seedScenario(db)
  const cta = { ...SEED_SECTION_DEFS.find(entry => entry.slug === 'cta')!, slug: 'appearance-action' }
  const row = (
    await db.asUser(s.superAdmin, client =>
      client.query(
        'SELECT * FROM app.upsert_section_def_version($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)',
        upsertArguments(cta),
      ),
    )
  ).rows[0]!
  definitionId = row.section_def_id
  definitionVersion = row.version
})
afterAll(async () => {
  await db?.close()
})
async function page() {
  return db.asUser(
    s.editorA,
    async client =>
      (
        await client.query('SELECT app.create_page($1,$2,$3) AS id', [
          s.siteA,
          `button-${randomUUID().slice(0, 8)}`,
          'Button appearance',
        ])
      ).rows[0]!.id as string,
  )
}
const content = (buttonAppearance: unknown) => [
  {
    section_def_id: definitionId,
    section_def_version: definitionVersion,
    values: { heading: 'A page action', action: { label: 'Contact', url: '/', buttonAppearance } },
  },
]
async function save(id: string, appearance: unknown, actor = s.contributorA, revision = 0) {
  return db.asUser(
    actor,
    async client =>
      (
        await client.query('SELECT * FROM app.save_page_draft($1,$2,$3,$4)', [
          id,
          revision,
          JSON.stringify(content(appearance)),
          '{}',
        ])
      ).rows[0]!,
  )
}

it('saves for a contributor, preserves through manifest and publish, and uses normal CAS', async () => {
  const id = await page(),
    saved = await save(id, DEFAULT_BUTTON_APPEARANCE)
  expect(saved.carries_trusted_code).toBe(false)
  const manifest = (
    await db.asUser(s.editorA, client =>
      client.query('SELECT app.build_render_manifest($1) AS manifest', [saved.version_id]),
    )
  ).rows[0]!.manifest
  expect(manifest.sections[0].instance.values.action.buttonAppearance).toEqual(DEFAULT_BUTTON_APPEARANCE)
  await expectSqlState(save(id, DEFAULT_BUTTON_APPEARANCE), 'CMS01')
  await db.asUser(s.editorA, client =>
    client.query('SELECT app.publish_page($1,$2,$3,$4,$5)', [id, saved.revision, ...CHECKED_CLEAN]),
  )
  expect(
    (
      await db.asUser(s.editorA, client =>
        client.query('SELECT render_manifest FROM published_routes WHERE page_id=$1', [id]),
      )
    ).rows[0]!.render_manifest.sections[0].instance.values.action.buttonAppearance,
  ).toEqual(DEFAULT_BUTTON_APPEARANCE)
})

it('refuses malformed choices, wrong roles/sites, and appearance on non-link fields', async () => {
  const id = await page()
  for (const value of [
    null,
    {},
    { ...DEFAULT_BUTTON_APPEARANCE, color: 'red' },
    { ...DEFAULT_BUTTON_APPEARANCE, style: 'transparent' },
    { ...DEFAULT_BUTTON_APPEARANCE, extra: true },
  ]) {
    await expectSqlState(save(id, value), 'CMS04')
  }
  for (const actor of [s.editorB, s.disabled]) await expectSqlState(save(id, DEFAULT_BUTTON_APPEARANCE, actor), 'CMS02')
  const sections = content(DEFAULT_BUTTON_APPEARANCE)
  sections[0]!.values.heading = { buttonAppearance: DEFAULT_BUTTON_APPEARANCE } as never
  await expectSqlState(
    db.asUser(s.editorA, client =>
      client.query('SELECT * FROM app.save_page_draft($1,0,$2,$3)', [id, JSON.stringify(sections), '{}']),
    ),
    'CMS04',
  )
  const withCode = [{ ...content(DEFAULT_BUTTON_APPEARANCE)[0], custom_css: '.cta{padding:1rem}' }]
  await expectSqlState(
    db.asUser(s.superAdmin, client =>
      client.query('SELECT * FROM app.save_page_draft($1,0,$2,$3)', [id, JSON.stringify(withCode), '{}']),
    ),
    'CMS04',
  )
})

it('blocks publishing against an unreadable colour pair even through the raw database command', async () => {
  const id = await page(),
    saved = await save(id, { ...DEFAULT_BUTTON_APPEARANCE, color: 'accent' })
  await db.as('owner', client => client.query("UPDATE navigations SET mode='manual' WHERE site_id=$1", [s.siteA]))
  await db.as('owner', client =>
    client.query(
      "UPDATE published_site_shells SET payload=jsonb_set(payload,'{theme,colors,accent}',to_jsonb('#ffffff'::text)) WHERE site_id=$1",
      [s.siteA],
    ),
  )
  await expectSqlState(
    db.asUser(s.editorA, client =>
      client.query('SELECT app.publish_page($1,$2,$3,$4,$5)', [id, saved.revision, ...CHECKED_CLEAN]),
    ),
    'CMS04',
  )
  expect(
    (await db.asUser(s.editorA, client => client.query('SELECT * FROM published_routes WHERE page_id=$1', [id]))).rows,
  ).toEqual([])
})

it('accepts the optional size, label weight and width choices and refuses unknown ones', async () => {
  const id = await page()
  const chosen = { ...DEFAULT_BUTTON_APPEARANCE, size: 'large', weight: 'regular', width: 'full' }
  const saved = await save(id, chosen)
  const manifest = (
    await db.asUser(s.editorA, client =>
      client.query('SELECT app.build_render_manifest($1) AS manifest', [saved.version_id]),
    )
  ).rows[0]!.manifest
  expect(manifest.sections[0].instance.values.action.buttonAppearance).toEqual(chosen)
  for (const value of [
    { ...DEFAULT_BUTTON_APPEARANCE, size: 'huge' },
    { ...DEFAULT_BUTTON_APPEARANCE, weight: 700 },
    { ...DEFAULT_BUTTON_APPEARANCE, width: '100%' },
    { size: 'large', weight: 'bold', width: 'full', style: 'solid', color: 'primary', radius: 'soft' },
  ]) {
    await expectSqlState(save(id, value, s.contributorA, Number(saved.revision)), 'CMS04')
  }
})
