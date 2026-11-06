import { afterAll, beforeAll, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { TestDatabase } from '@cms/schema/testing'
import { SITE_FONT_REGISTRY, ThemeTokens, DEFAULT_THEME_TOKENS } from '@cms/schema'
import { compileSection, sectionScopeSelector } from '@cms/renderer'
import { seedScenario, type Scenario } from '@cms/schema/fixtures'
import type { SiteShell } from '@cms/renderer'
import {
  SITE_DRAFT_PREVIEW_SQL,
  withSiteDrafts,
  readSitePreview,
  type SiteDraftPreviewRow,
} from '../src/lib/site-preview.ts'
import { renderDefinitionPreview } from '../src/lib/definition-preview-render.ts'

let db: TestDatabase
let s: Scenario
beforeAll(async () => {
  db = await TestDatabase.create('admin_site_preview')
  s = await seedScenario(db)
})
afterAll(async () => {
  await db?.close()
})

it('reads saved site heads without changing the published shell', async () => {
  await db.asUser(s.superAdmin, async client => {
    const live = (
      await client.query<{ payload: SiteShell }>('SELECT payload FROM published_site_shells WHERE site_id=$1', [
        s.siteA,
      ])
    ).rows[0]!.payload
    const draft = (await client.query<SiteDraftPreviewRow>(SITE_DRAFT_PREVIEW_SQL, [s.siteA])).rows[0]!
    const original = ThemeTokens.parse(draft.theme)
    const theme = { ...original, colors: { ...original.colors, primary: '#0055aa' } }
    const revision = (await client.query('SELECT revision FROM themes WHERE site_id=$1', [s.siteA])).rows[0]!.revision
    await client.query('SELECT app.save_theme_draft($1,$2,$3)', [s.siteA, revision, JSON.stringify(theme)])
    const saved = (await client.query<SiteDraftPreviewRow>(SITE_DRAFT_PREVIEW_SQL, [s.siteA])).rows[0]!
    expect(withSiteDrafts(live, saved).theme.colors?.primary).toBe('#0055aa')
    expect(withSiteDrafts(live, saved).canonical_host).toBe(live.canonical_host)
    expect(
      (await client.query('SELECT payload FROM published_site_shells WHERE site_id=$1', [s.siteA])).rows[0]!.payload,
    ).toEqual(live)
  })
})

it('does not expose another site to an editor', async () => {
  expect((await db.asUser(s.editorA, client => client.query(SITE_DRAFT_PREVIEW_SQL, [s.siteB]))).rows).toEqual([])
})

it('allows contributors to preview their own site and scopes super admins to the requested site', async () => {
  const own = await db.asUser(s.contributorA, client => client.query(SITE_DRAFT_PREVIEW_SQL, [s.siteA]))
  expect(own.rows.map(row => row.id)).toEqual([s.siteA])
  const other = await db.asUser(s.superAdmin, client => client.query(SITE_DRAFT_PREVIEW_SQL, [s.siteB]))
  expect(other.rows.map(row => row.id)).toEqual([s.siteB])
})

it('shares saved appearance and draft-only routes across private previews without changing public state', async () => {
  await db.asUser(s.superAdmin, async client => {
    const before = await readSitePreview(client, s.siteA)
    const target = (
      await client.query('SELECT app.create_page($1,$2,$3) AS id', [s.siteA, 'saved-route', 'Private destination'])
    ).rows[0]!.id
    const revision = (await client.query('SELECT revision FROM navigations WHERE site_id=$1', [s.siteA])).rows[0]!
      .revision
    await client.query('SELECT app.save_navigation_draft($1,$2,$3,$4)', [
      s.siteA,
      revision,
      JSON.stringify([{ label: 'Private destination', target: { type: 'page', page_id: target }, visible: true }]),
      'manual',
    ])
    const saved = await readSitePreview(client, s.siteA, 'draft')
    expect(saved!.shell.theme.colors?.primary).toBe('#0055aa')
    expect(saved!.shell.navigation[0]!.label).toBe('Private destination')
    expect(saved!.navigationPaths[target]).toBe('/saved-route')
    expect(saved!.shell.canonical_host).toBe(before!.shell.canonical_host)
    const published = await readSitePreview(client, s.siteA, 'published')
    expect(published).toEqual(before)
    expect(published!.navigationPaths).not.toHaveProperty(target)
  })
})

it('requires access to the requested preview site in both contexts, including fallback shells', async () => {
  for (const context of ['published', 'draft'] as const) {
    expect(await db.asUser(s.editorA, client => readSitePreview(client, s.siteB, context))).toBeNull()
    expect(await db.asUser(s.contributorA, client => readSitePreview(client, s.siteA, context))).not.toBeNull()
    expect(await db.asUser(s.superAdmin, client => readSitePreview(client, s.siteB, context))).not.toBeNull()
    expect(
      await db.asUser(s.superAdmin, client => readSitePreview(client, '99999999-9999-4999-8999-999999999999', context)),
    ).toBeNull()
  }
})

it('renders registered fonts only from the authorized preview site without making them public', async () => {
  const font = SITE_FONT_REGISTRY['trajan-regular']
  async function addFont(siteId: string) {
    const id = randomUUID()
    await db.asUser(s.superAdmin, client =>
      client.query('SELECT app.import_site_asset($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)', [
        siteId,
        id,
        'font',
        `site-assets/${siteId}/${id}/${font.sha256}`,
        font.mimeType,
        99,
        font.sha256,
        font.filename,
        'trajan-regular',
        JSON.stringify({ path: `fonts/${font.filename}`, sha256: font.sha256, manifest_sha256: 'b'.repeat(64) }),
      ]),
    )
    return id
  }
  const ownFonts = [await addFont(s.siteA), await addFont(s.siteA)].sort()
  const foreignFont = await addFont(s.siteB)
  const compiled = compileSection({
    sourceHtml: '<p>Font preview</p>',
    sourceCss: "p{font-family:'Trajan Pro 3'}",
    slots: [],
    scopeSelector: sectionScopeSelector('font-preview')!,
  })
  expect(compiled.blocking).toEqual([])
  const definition = {
    section_def_id: randomUUID(),
    version: 1,
    slug: 'font-preview',
    slots: [],
    compiled_ast: compiled.ast,
    css: compiled.css,
    sanitizer_policy_version: compiled.ast.policyVersion,
    css_policy_version: compiled.ast.cssPolicyVersion,
  }
  for (const context of ['published', 'draft'] as const) {
    const preview = await db.asUser(s.contributorA, client => readSitePreview(client, s.siteA, context))
    expect(preview?.fonts).toEqual([{ assetId: ownFonts[0], fontKey: 'trajan-regular' }])
    const html = renderDefinitionPreview({ definition, name: 'Font example', preview: preview! })
    expect(html).toContain(`@font-face{font-family:'Trajan Pro 3';src:url('/assets/${ownFonts[0]}')`)
    expect(html).not.toContain(foreignFont)
    expect(await db.asUser(s.editorA, client => readSitePreview(client, s.siteB, context))).toBeNull()
    const other = await db.asUser(s.superAdmin, client => readSitePreview(client, s.siteB, context))
    expect(other?.fonts).toEqual([{ assetId: foreignFont, fontKey: 'trajan-regular' }])
  }
  expect(
    (
      await db.asUser(s.contributorA, client =>
        client.query('SELECT id FROM app.resolve_site_asset($1)', [ownFonts[0]]),
      )
    ).rows,
  ).toEqual([{ id: ownFonts[0] }])
  expect(
    (
      await db.as('public', client =>
        client.query('SELECT id FROM public_api.resolve_site_asset($1,$2)', [
          'site-a.staging.example.test',
          ownFonts[0],
        ]),
      )
    ).rows,
  ).toEqual([])
})

it('keeps a new private site staging address for host-gated Adobe previews without publishing a shell', async () => {
  await db.asUser(s.superAdmin, async client => {
    const slug = 'font-preview-' + randomUUID().slice(0, 8),
      site = (
        await client.query('SELECT app.create_site($1,$2,$3,$4,$5,$6) AS id', [
          slug,
          '[Site]',
          'resource',
          slug + '.staging.localhost',
          JSON.stringify(DEFAULT_THEME_TOKENS),
          '[]',
        ])
      ).rows[0]!.id
    const address = (await client.query('SELECT staging_hostname FROM sites WHERE id=$1', [site])).rows[0]!
      .staging_hostname
    const preview = await readSitePreview(client, site, 'draft')
    expect(address).toBeTruthy()
    expect(preview!.shell.staging_host).toBe(address)
    expect(
      (await client.query('SELECT initial_release_required FROM sites WHERE id=$1', [site])).rows[0]!
        .initial_release_required,
    ).toBe(true)
    expect((await client.query('SELECT page_id FROM published_routes WHERE site_id=$1', [site])).rows).toEqual([])
  })
})
