import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { SITE_FONT_REGISTRY, ThemeTokens } from '@cms/schema'
import { compileSection } from '@cms/renderer'
import { CHECKED_CLEAN, TestDatabase } from '@cms/schema/testing'
import { heroContent, seedScenario, type Scenario } from '@cms/schema/fixtures'

let db: TestDatabase
let s: Scenario
let actor: string
let sourceVersion: string
let revision: number
vi.mock('server-only', () => ({}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('../src/lib/session.ts', () => ({ currentSession: async () => ({ principal: { userId: actor } }) }))
vi.mock('@cms/platform', async original => ({
  ...(await original<object>()),
  asUser: (identity: { userId: string }, run: Parameters<TestDatabase['asUser']>[1]) => db.asUser(identity.userId, run),
}))
import { applySectionUpgrade, previewSectionUpgrade } from '../src/app/pages/[pageId]/section-upgrade-actions.ts'

beforeAll(async () => {
  db = await TestDatabase.create('section_upgrade')
  s = await seedScenario(db)
  actor = s.editorA
  await db.asUser(s.superAdmin, async client => {
    const row = (
      await client.query('SELECT * FROM section_def_versions WHERE section_def_id=$1 AND version=1', [s.heroDefId])
    ).rows[0]!
    const html = row.source_html + '<p>{{new-field}}</p>'
    const slots = [
      ...row.slots,
      { id: 'new-field', kind: 'text', label: 'New field', constraints: { sourceSample: 'INVENTED NEW SAMPLE' } },
    ]
    const compiled = compileSection({
      sourceHtml: html,
      sourceCss: row.source_css,
      slots,
      scopeSelector: '.cms-section--hero',
    })
    expect(compiled.blocking).toEqual([])
    await client.query(
      'SELECT * FROM app.upsert_section_def_version($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)',
      [
        'hero',
        'Hero',
        'Openers',
        html,
        row.source_css,
        compiled.css,
        JSON.stringify(compiled.ast),
        JSON.stringify(slots),
        compiled.renderHash,
        row.sanitizer_policy_version,
        row.css_policy_version,
        'Version two',
        false,
        'legacy',
        null,
        null,
      ],
    )
  })
  const content = [...JSON.parse(heroContent(s.heroDefId, 'First')), ...JSON.parse(heroContent(s.heroDefId, 'Second'))]
  const source = await db.asUser(actor, client =>
    client.query('SELECT * FROM app.save_page_draft($1,$2,$3,$4)', [
      s.pageA,
      0,
      JSON.stringify(content),
      JSON.stringify({ title: 'Home', description: 'A test page', canonical: '/', noindex: true }),
    ]),
  )
  sourceVersion = source.rows[0]!.version_id
  const published = await db.asUser(actor, client =>
    client.query('SELECT * FROM app.publish_page($1,$2,$3,$4,$5)', [s.pageA, 1, ...CHECKED_CLEAN]),
  )
  revision = Number(published.rows[0]!.revision)
})
afterAll(async () => {
  await db?.close()
})

describe('application section upgrade against real database roles', () => {
  it('renders both sides with the requested saved appearance while leaving versions and public settings unchanged', async () => {
    const before = await db.asUser(s.superAdmin, async client => {
      const theme = (
        await client.query(
          'SELECT t.revision,v.tokens FROM themes t JOIN theme_versions v ON v.id=t.draft_version_id WHERE t.site_id=$1',
          [s.siteA],
        )
      ).rows[0]!
      const tokens = ThemeTokens.parse(theme.tokens)
      await client.query('SELECT app.save_theme_draft($1,$2,$3)', [
        s.siteA,
        theme.revision,
        JSON.stringify({ ...tokens, colors: { ...tokens.colors, primary: '#0055aa' } }),
      ])
      return (
        await client.query('SELECT revision,draft_version_id,published_version_id FROM pages WHERE id=$1', [s.pageA])
      ).rows[0]
    })
    const input = { pageId: s.pageA, sourceVersionId: sourceVersion, index: 0, targetVersion: 2 }
    const saved = await previewSectionUpgrade({ ...input, previewContext: 'draft' })
    expect(saved.ok).toBe(true)
    if (!saved.ok) throw new Error(saved.message)
    expect(saved.previewContext).toBe('draft')
    expect(saved.html).not.toContain('INVENTED NEW SAMPLE')
    expect(saved.plan.added).toContain('New field')
    for (const html of [saved.beforeHtml, saved.html]) {
      expect(html).toContain('--color-primary:#0055aa')
      expect(html).toContain('First')
      expect(html).toContain('Second')
      expect(html).not.toContain('<script')
    }
    const published = await previewSectionUpgrade(input)
    expect(published.ok).toBe(true)
    if (!published.ok) throw new Error(published.message)
    expect(published.previewContext).toBe('published')
    expect(published.html).not.toContain('--color-primary:#0055aa')
    expect(published.beforeHtml).not.toContain('--color-primary:#0055aa')
    expect(
      (
        await db.asUser(actor, client =>
          client.query('SELECT revision,draft_version_id,published_version_id FROM pages WHERE id=$1', [s.pageA]),
        )
      ).rows[0],
    ).toEqual(before)
  })
  it('refuses saved-draft previews of pages belonging to another site', async () => {
    actor = s.editorB
    try {
      expect(
        await previewSectionUpgrade({
          pageId: s.pageA,
          sourceVersionId: sourceVersion,
          index: 0,
          targetVersion: 2,
          previewContext: 'draft',
        }),
      ).toMatchObject({ ok: false })
    } finally {
      actor = s.editorA
    }
  })
  it('captures a recovery checkpoint and updates just one instance, leaving live content unchanged', async () => {
    const result = await applySectionUpgrade(
      { pageId: s.pageA, sourceVersionId: sourceVersion, index: 0, targetVersion: 2 },
      revision,
    )
    expect(result.ok).toBe(true)
    const head = (
      await db.asUser(actor, client =>
        client.query(
          `SELECT p.published_version_id,v.content,v.meta FROM pages p
      JOIN page_versions v ON v.id=p.draft_version_id WHERE p.id=$1`,
          [s.pageA],
        ),
      )
    ).rows[0]!
    expect(head.published_version_id).toBe(sourceVersion)
    expect(head.content.map((section: { section_def_version: number }) => section.section_def_version)).toEqual([2, 1])
    expect(head.content[0].values.heading).toBe('First')
    expect(head.content[0].values).not.toHaveProperty('new-field')
    expect(head.meta).toMatchObject({ canonical: '/', noindex: true })
    const checkpoints = await db.asUser(actor, client =>
      client.query("SELECT content FROM page_versions WHERE page_id=$1 AND kind='checkpoint' ORDER BY revision", [
        s.pageA,
      ]),
    )
    expect(checkpoints.rows).toHaveLength(2)
    expect(
      checkpoints.rows[0]!.content.map((section: { section_def_version: number }) => section.section_def_version),
    ).toEqual([1, 1])
  })
  it('does not apply the same preview after the page draft has moved', async () => {
    expect(
      await applySectionUpgrade(
        { pageId: s.pageA, sourceVersionId: sourceVersion, index: 0, targetVersion: 2 },
        revision,
      ),
    ).toMatchObject({ ok: false, kind: 'conflict' })
  })
  it('cannot update a page outside the verified actor’s site', async () => {
    actor = s.editorB
    expect(
      await applySectionUpgrade(
        { pageId: s.pageA, sourceVersionId: sourceVersion, index: 0, targetVersion: 2 },
        revision,
      ),
    ).toMatchObject({ ok: false })
  })
})

describe('what an updated imported section keeps', () => {
  // The V1 importer stores the site's fonts (and linked documents) beside an
  // imported section's fields; a page's registered fonts come from them. An
  // update that kept only fields rendered Echelon without its fonts.
  it('keeps the font references stored beside the fields, so the page keeps its fonts', async () => {
    const font = randomUUID(),
      registered = SITE_FONT_REGISTRY['trajan-regular']
    await db.asUser(s.superAdmin, client =>
      client.query('SELECT app.import_site_asset($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)', [
        s.siteA,
        font,
        'font',
        `site-assets/${s.siteA}/${font}/${registered.sha256}`,
        registered.mimeType,
        99,
        registered.sha256,
        registered.filename,
        'trajan-regular',
        JSON.stringify({ path: 'font/registered.otf', sha256: registered.sha256, manifest_sha256: 'b'.repeat(64) }),
      ]),
    )
    actor = s.editorA
    const page = (
      await db.asUser(s.superAdmin, client =>
        client.query('SELECT app.create_page($1,$2,$3) AS id', [s.siteA, `fonts-${font.slice(0, 8)}`, 'Fonts']),
      )
    ).rows[0]!.id as string
    const draft = await db.asUser(actor, async client => {
      const content = JSON.parse(heroContent(s.heroDefId, 'Kept'))
      content[0].values['v1-asset-0'] = { asset_id: font }
      const row = (
        await client.query('SELECT * FROM app.save_page_draft($1,$2,$3,$4)', [page, 0, JSON.stringify(content), '{}'])
      ).rows[0]!
      return { page, version: row.version_id as string, revision: Number(row.revision) }
    })
    const fonts = async (versionId: string) =>
      (await db.asUser(actor, client => client.query('SELECT app.build_render_manifest($1) AS manifest', [versionId])))
        .rows[0]!.manifest.fonts
    expect(await fonts(draft.version)).toEqual([{ assetId: font, fontKey: 'trajan-regular' }])
    expect(
      await applySectionUpgrade(
        { pageId: draft.page, sourceVersionId: draft.version, index: 0, targetVersion: 2 },
        draft.revision,
      ),
    ).toMatchObject({ ok: true })
    const head = (
      await db.asUser(actor, client =>
        client.query(
          'SELECT p.draft_version_id, v.content FROM pages p JOIN page_versions v ON v.id = p.draft_version_id WHERE p.id = $1',
          [draft.page],
        ),
      )
    ).rows[0]!
    expect(head.content[0]).toMatchObject({
      section_def_version: 2,
      values: { heading: 'Kept', 'v1-asset-0': { asset_id: font } },
    })
    expect(await fonts(head.draft_version_id)).toEqual([{ assetId: font, fontKey: 'trajan-regular' }])
  })
})
