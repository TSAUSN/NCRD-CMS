import { randomUUID } from 'node:crypto'
import { beforeAll, afterAll, expect, it } from 'vitest'
import { ThemeTokens } from '../src/content/theme.ts'
import { SEED_SECTION_DEFS, upsertArguments } from '../../seeds/src/index.ts'
import { seedScenario, type Scenario } from './fixtures.ts'
import { CHECKED_CLEAN, TestDatabase, expectSqlState } from './harness.ts'
import { compileStructuredSection } from '../../renderer/src/index.ts'

let db: TestDatabase, s: Scenario, definitionId: string, definitionVersion: number
beforeAll(async () => {
  db = await TestDatabase.create('section_appearance')
  s = await seedScenario(db)
  const hero = { ...SEED_SECTION_DEFS.find(entry => entry.slug === 'hero')!, slug: 'appearance-hero' }
  const row = (
    await db.asUser(s.superAdmin, c =>
      c.query(
        'SELECT * FROM app.upsert_section_def_version($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)',
        upsertArguments(hero),
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
    async c =>
      (
        await c.query('SELECT app.create_page($1,$2,$3) AS id', [
          s.siteA,
          `appearance-${randomUUID().slice(0, 8)}`,
          'Appearance',
        ])
      ).rows[0]!.id as string,
  )
}
function content(appearance?: unknown) {
  return [
    {
      section_def_id: definitionId,
      section_def_version: definitionVersion,
      values: { heading: 'Appearance', intro: 'Unchanged content' },
      ...(appearance === undefined ? {} : { appearance }),
    },
  ]
}
async function save(pageId: string, appearance?: unknown, actor = s.editorA, revision = 0) {
  return db.asUser(
    actor,
    async c =>
      (
        await c.query('SELECT * FROM app.save_page_draft($1,$2,$3,$4)', [
          pageId,
          revision,
          JSON.stringify(content(appearance)),
          '{}',
        ])
      ).rows[0]!,
  )
}

it('lets a contributor save closed choices and carries them unchanged into the canonical published manifest', async () => {
  const pageId = await page(),
    appearance = { surface: 'primary', spacing: 'compact', width: 'reading', align: 'start' }
  const saved = await save(pageId, appearance, s.contributorA)
  expect(saved.carries_trusted_code).toBe(false)
  const manifest = (
    await db.asUser(s.editorA, c => c.query('SELECT app.build_render_manifest($1) AS manifest', [saved.version_id]))
  ).rows[0]!.manifest
  expect(manifest.sections[0].instance.appearance).toEqual(appearance)
  await db.asUser(s.editorA, c =>
    c.query('SELECT app.publish_page($1,$2,$3,$4,$5)', [pageId, saved.revision, ...CHECKED_CLEAN]),
  )
  const published = (
    await db.asUser(s.editorA, c => c.query('SELECT render_manifest FROM published_routes WHERE page_id=$1', [pageId]))
  ).rows[0]!.render_manifest
  expect(published.sections[0].instance.appearance).toEqual(appearance)
})

it('keeps absent appearance absent and never rewrites the definition defaults', async () => {
  const saved = await save(await page())
  const manifest = (
    await db.asUser(s.editorA, c => c.query('SELECT app.build_render_manifest($1) AS manifest', [saved.version_id]))
  ).rows[0]!.manifest
  expect(manifest.sections[0].instance).not.toHaveProperty('appearance')
})

it('persists phone order only for a single supported two-column group', async () => {
  await expectSqlState(save(await page(), { mobileOrder: 'reverse' }), 'CMS04')
  const document = {
    schemaVersion: 3,
    fields: [
      { name: 'left', type: 'text', label: 'Left' },
      { name: 'right', type: 'text', label: 'Right' },
    ],
    nodes: [
      {
        type: 'element',
        tag: 'section',
        children: [
          {
            type: 'element',
            tag: 'div',
            attributes: { class: 'builder-columns' },
            children: [
              { type: 'element', tag: 'div', children: [{ type: 'text', field: 'left' }] },
              { type: 'element', tag: 'div', children: [{ type: 'text', field: 'right' }] },
            ],
          },
        ],
      },
    ],
  }
  const compiled = compileStructuredSection({ slug: 'mobile-columns', document, sourceCss: '' })
  expect(compiled.blocking).toEqual([])
  const definition = (
    await db.asUser(s.superAdmin, c =>
      c.query('SELECT * FROM app.upsert_section_def_version($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)', [
        'mobile-columns',
        'Columns',
        'Content',
        '',
        '',
        '',
        JSON.stringify({ nodes: [], policyVersion: 4, cssPolicyVersion: 6 }),
        JSON.stringify(document.fields.map(f => ({ id: f.name, kind: f.type, label: f.label, constraints: {} }))),
        compiled.renderHash,
        4,
        6,
        'Phone stacking',
        false,
        'structured',
        JSON.stringify(document),
        3,
      ]),
    )
  ).rows[0]
  const pageId = await page()
  const saved = (
    await db.asUser(s.contributorA, c =>
      c.query('SELECT * FROM app.save_page_draft($1,0,$2,$3)', [
        pageId,
        JSON.stringify([
          {
            section_def_id: definition.section_def_id,
            section_def_version: definition.version,
            values: { left: 'First', right: 'Second' },
            appearance: { mobileOrder: 'reverse' },
          },
        ]),
        '{}',
      ]),
    )
  ).rows[0]
  const manifest = (
    await db.asUser(s.editorA, c => c.query('SELECT app.build_render_manifest($1) AS manifest', [saved.version_id]))
  ).rows[0].manifest
  expect(manifest.sections[0].instance.appearance).toEqual({ mobileOrder: 'reverse' })
})

it('rejects unknown keys, arbitrary CSS, wrong shapes and foreign readers at the real command boundary', async () => {
  const pageId = await page()
  for (const appearance of [
    { width: '120px' },
    { background: 'red' },
    { surface: null },
    'compact',
    { align: 'justify' },
  ]) {
    await expectSqlState(save(pageId, appearance), 'CMS04')
  }
  await expectSqlState(save(pageId, { width: 'wide' }, s.editorB), 'CMS02')
  await expectSqlState(save(pageId, { width: 'wide' }, s.disabled), 'CMS02')
})

it('requires a supported structured container and keeps advanced code separate', async () => {
  const pageId = await page()
  const legacy = { ...content({ width: 'reading' })[0], section_def_id: s.heroDefId, section_def_version: 1 }
  await expectSqlState(
    db.asUser(s.editorA, c =>
      c.query('SELECT * FROM app.save_page_draft($1,0,$2,$3)', [pageId, JSON.stringify([legacy]), '{}']),
    ),
    'CMS04',
  )
  const withCode = { ...content({ width: 'reading' })[0], custom_css: '.x{padding:1rem}' }
  await expectSqlState(
    db.asUser(s.superAdmin, c =>
      c.query('SELECT * FROM app.save_page_draft($1,0,$2,$3)', [pageId, JSON.stringify([withCode]), '{}']),
    ),
    'CMS04',
  )
})

it('blocks a later theme publication that would break the selected surface pair', async () => {
  const pageId = await page(),
    saved = await save(pageId, { surface: 'soft' })
  await db.asUser(s.editorA, c =>
    c.query('SELECT app.publish_page($1,$2,$3,$4,$5)', [pageId, saved.revision, ...CHECKED_CLEAN]),
  )
  const theme = (
    await db.asUser(s.superAdmin, c =>
      c.query(
        'SELECT t.revision,v.tokens FROM themes t JOIN theme_versions v ON v.id=t.draft_version_id WHERE t.site_id=$1',
        [s.siteA],
      ),
    )
  ).rows[0]!
  const tokens = ThemeTokens.parse(theme.tokens)
  tokens.colors.surfaceAlt = tokens.colors.ink
  const draft = (
    await db.asUser(s.superAdmin, c =>
      c.query('SELECT * FROM app.save_theme_draft($1,$2,$3)', [s.siteA, theme.revision, JSON.stringify(tokens)]),
    )
  ).rows[0]!
  await expectSqlState(
    db.asUser(s.superAdmin, c => c.query('SELECT * FROM app.publish_theme($1,$2)', [s.siteA, draft.revision])),
    'CMS04',
  )
  const before = (
    await db.asUser(s.editorA, c =>
      c.query("SELECT payload #>> '{theme,colors,surfaceAlt}' AS color FROM published_site_shells WHERE site_id=$1", [
        s.siteA,
      ]),
    )
  ).rows[0]!.color
  expect(before).not.toBe(tokens.colors.ink)
})
