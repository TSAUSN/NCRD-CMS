import { installCoreLibrary } from '@cms/seeds/core-install'
import { createHash, randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import sharp from 'sharp'
import { TestDatabase, expectSqlState } from '@cms/schema/testing'
import { seedScenario, type Scenario } from '@cms/schema/fixtures'
import { starterSiteSetup } from '@cms/seeds/archetypes'
import { importFrozenSiteAsset, type MediaStore } from '@cms/platform'
import { type SiteArchive, type SlotDef, type HeaderConfigV2, type FooterConfigV2 } from '@cms/schema'
import { compileSection, renderPage, sectionScopeSelector, type SectionDefView, type SiteShell } from '@cms/renderer'
import { createSiteFromSetupInTransaction } from '../src/lib/site-creation.ts'
import { publishStarterFixture } from './site-fixture.ts'
import {
  exportSiteArchiveInTransaction,
  importSiteArchiveInTransaction,
  importedId,
  prepareSiteArchive,
  remapArchiveValue,
} from '../src/lib/site-portability.ts'

let db: TestDatabase, s: Scenario, sourceSite: string, sourcePage: string, archive: SiteArchive
let historicalHeader: string,
  headerDef: string,
  footerDef: string,
  staticMedia: string,
  valueMedia: string,
  frameAsset: string
const objects = new Map<string, Uint8Array>()
const media: MediaStore = {
  get: async key => objects.get(key) ?? null,
  put: async (key, body, contentType) => {
    objects.set(key, body)
    return { objectKey: key, bytes: body.length, contentType }
  },
  remove: async key => {
    objects.delete(key)
  },
  createSignedUpload: async () => {
    throw new Error('unused')
  },
}
const slots: SlotDef[] = [
  { id: 'title', kind: 'text', label: 'Title', constraints: {} },
  { id: 'portrait', kind: 'image', label: 'Partner logo', constraints: {} },
  { id: 'menu', kind: 'navigation', label: 'Site navigation', constraints: {} },
  { id: 'download', kind: 'link', label: 'Frame download', constraints: {} },
]

async function defineFrame(slug: string, placement: 'header' | 'footer', label: string, site?: string) {
  const html = `<div class="frame">${label}: {{title}}{{portrait}}{{download}}<a href="/assets/${frameAsset}">Static report</a><img src="/media/${staticMedia}/wide" alt="Static partner"><nav>{{menu}}</nav><details><summary>Contact</summary><p>Contact copy</p></details></div>`
  const css = '.frame{display:flex;gap:1rem}'
  const compiled = compileSection({
    sourceHtml: html,
    sourceCss: css,
    slots,
    scopeSelector: sectionScopeSelector(slug)!,
  })
  expect(compiled.blocking).toEqual([])
  return db.asUser(s.superAdmin, async client => {
    const row = (
      await client.query<{ section_def_id: string; version: number }>(
        'SELECT * FROM app.upsert_section_def_version($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)',
        [
          slug,
          slug,
          'Site frame',
          html,
          css,
          compiled.css,
          JSON.stringify(compiled.ast),
          JSON.stringify(slots),
          compiled.renderHash,
          compiled.ast.policyVersion,
          compiled.ast.cssPolicyVersion,
          label,
          false,
          'legacy',
          null,
          null,
          site ? 'site' : 'global',
          site ?? null,
        ],
      )
    ).rows[0]!
    await client.query('SELECT app.set_section_def_placement($1,$2)', [row.section_def_id, placement])
    return row.section_def_id
  })
}

const header = (id: string, version: number, title: string): HeaderConfigV2 => ({
  schemaVersion: 2,
  enabled: true,
  sticky: true,
  component: {
    section_def_id: id,
    section_def_version: version,
    values: {
      title,
      portrait: { src: `/media/${valueMedia}/wide`, alt: 'Editable partner', decorative: false },
      menu: '<img src=x onerror=alert(1)>',
      download: { url: `/assets/${frameAsset}`, label: 'Download report' },
    },
  },
})
const footer = (id: string): FooterConfigV2 => ({
  schemaVersion: 2,
  enabled: true,
  component: { section_def_id: id, section_def_version: 1, values: { title: 'Footer title' } },
})

async function saveFrame(site: string, h: unknown, f: unknown, publish = false) {
  await db.asUser(s.superAdmin, async client => {
    const heads = (await client.query('SELECT kind,revision FROM global_elements WHERE site_id=$1', [site])).rows
    const saved = (
      await client.query('SELECT * FROM app.save_global_elements_draft($1,$2,$3,$4,$5)', [
        site,
        heads.find(row => row.kind === 'header')!.revision,
        heads.find(row => row.kind === 'footer')!.revision,
        JSON.stringify(h),
        JSON.stringify(f),
      ])
    ).rows[0]!
    if (publish)
      await client.query('SELECT * FROM app.publish_global_elements($1,$2,$3)', [
        site,
        saved.header_revision,
        saved.footer_revision,
      ])
  })
}

beforeAll(async () => {
  db = await TestDatabase.create('frame-portability')
  s = await seedScenario(db)
  await db.asUser(s.superAdmin, client => installCoreLibrary(client))
  sourceSite = (
    await db.asUser(s.superAdmin, client =>
      createSiteFromSetupInTransaction(
        client,
        randomUUID(),
        { ...starterSiteSetup('resource'), name: 'Frame source', slug: 'frame-source' },
        'frame-source.staging.example.test',
      ),
    )
  ).siteId
  await db.asUser(s.superAdmin, client => publishStarterFixture(client, sourceSite))
  sourcePage = (
    await db.asUser(s.superAdmin, client =>
      client.query('SELECT id FROM pages WHERE site_id=$1 ORDER BY sort_index LIMIT 1', [sourceSite]),
    )
  ).rows[0]!.id
  // Both images are global; one appears only in frame source, the other only in
  // its values. Neither has page media usage to accidentally rescue the export.
  for (const [label, color] of [
    ['static', '#2266cc'],
    ['values', '#dd6622'],
  ] as const) {
    const id = randomUUID(),
      png = await sharp({ create: { width: 16, height: 12, channels: 3, background: color } })
        .png()
        .toBuffer()
    const webp = await sharp(png).webp().toBuffer()
    objects.set(`source/${label}.png`, png)
    objects.set(`source/${label}.webp`, webp)
    const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')
    await db.as('owner', async client => {
      await client.query(
        "INSERT INTO media(id,site_id,object_key,content_hash,original_name,alt_text,width,height,bytes,mime_type,status) VALUES($1,NULL,$2,$3,$4,'Partner',16,12,$5,'image/png','ready')",
        [id, `source/${label}.png`, hash(png), `${label}.png`, png.length],
      )
      await client.query(
        "INSERT INTO media_variants(media_id,kind,object_key,content_hash,width,height,bytes,mime_type) VALUES($1,'wide',$2,$3,16,12,$4,'image/webp')",
        [id, `source/${label}.webp`, hash(webp), webp.length],
      )
    })
    if (label === 'static') staticMedia = id
    else valueMedia = id
  }
  const document = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\n%%EOF\n')
  frameAsset = (
    await db.asUser(s.superAdmin, client =>
      importFrozenSiteAsset({
        client,
        store: media,
        siteId: sourceSite,
        bytes: document,
        kind: 'document',
        originalName: 'frame-report.pdf',
        provenance: {
          path: 'synthetic/frame-report.pdf',
          sha256: createHash('sha256').update(document).digest('hex'),
          manifest_sha256: 'a'.repeat(64),
        },
      }),
    )
  ).assetId
  historicalHeader = await defineFrame('portable-historical-header', 'header', 'Historical design')
  headerDef = await defineFrame('portable-current-header', 'header', 'Version one')
  footerDef = await defineFrame('portable-footer', 'footer', 'Footer design', sourceSite)
  await saveFrame(sourceSite, header(historicalHeader, 1, 'Historical title'), footer(footerDef))
  await saveFrame(sourceSite, header(headerDef, 1, 'Live title'), footer(footerDef), true)
  await defineFrame('portable-current-header', 'header', 'Version two')
  await saveFrame(sourceSite, header(headerDef, 2, 'Private draft title'), footer(footerDef))
  // New library versions and retired choices must not rewrite old pins.
  await defineFrame('portable-current-header', 'header', 'Version three, not selected')
  await db.asUser(s.superAdmin, client =>
    client.query('SELECT app.set_frame_definition_status($1,$2)', [historicalHeader, 'retired']),
  )
  await db.asUser(s.superAdmin, async client => {
    const head = (await client.query('SELECT revision FROM navigations WHERE site_id=$1', [sourceSite])).rows[0]!
    await client.query('SELECT * FROM app.save_navigation_draft($1,$2,$3,$4)', [
      sourceSite,
      head.revision,
      JSON.stringify([
        {
          label: 'Governed page',
          visible: true,
          target: { type: 'page', page_id: sourcePage },
          children: [
            {
              label: 'Resource anchor',
              visible: true,
              target: { type: 'url', url: '/resources?campaign=frame#overview' },
            },
          ],
        },
      ]),
      'manual',
    ])
  })
  archive = await db.asUser(s.superAdmin, client => exportSiteArchiveInTransaction(client, sourceSite, media))
})
afterAll(async () => {
  await db?.close()
})

async function importedPreview(site: string) {
  return db.asUser(s.superAdmin, async client => {
    const globals = (
      await client.query(
        'SELECT g.kind,v.content FROM global_elements g JOIN global_element_versions v ON v.id=g.draft_version_id WHERE g.site_id=$1',
        [site],
      )
    ).rows
    const h = globals.find(row => row.kind === 'header')!.content as HeaderConfigV2
    const f = globals.find(row => row.kind === 'footer')!.content as FooterConfigV2
    const component = async (kind: string, content: unknown) =>
      (
        await client.query<{ def: SectionDefView }>('SELECT app.preview_global_component($1,$2,$3) AS def', [
          site,
          kind,
          JSON.stringify(content),
        ])
      ).rows[0]!.def
    const navigation = (
      await client.query(
        'SELECT v.tree FROM navigations n JOIN navigation_versions v ON v.id=n.draft_version_id WHERE n.site_id=$1',
        [site],
      )
    ).rows[0]!.tree
    const shell: SiteShell = {
      site: { id: site, name: 'Preview', slug: 'preview' },
      theme: {},
      navigation,
      header: h,
      footer: f,
      header_component: await component('header', h),
      footer_component: await component('footer', f),
      canonical_host: null,
      staging_host: null,
    }
    const page = site === sourceSite ? sourcePage : importedId(site, sourcePage)
    return renderPage({
      shell,
      manifest: { page: { id: page, version_id: 'preview', title: 'Page', path: '/' }, meta: {}, sections: [] },
      navigationPaths: { [page]: '/' },
      isStaging: true,
    }).html
  })
}

describe('authored frame content portability', () => {
  it('exports global historical/live/draft pins, site frames, placements and frame-only media', () => {
    expect(
      archive.content.section_defs
        .filter(row => row.placement !== 'page')
        .map(row => row.id)
        .sort(),
    ).toEqual([historicalHeader, headerDef, footerDef].sort())
    expect(
      archive.content.section_def_versions
        .filter(row => row.section_def_id === headerDef)
        .map(row => row.version)
        .sort(),
    ).toEqual([1, 2, 3])
    expect(archive.content.media.map(row => row.id).sort()).toEqual([staticMedia, valueMedia].sort())
    expect(archive.objects).toHaveLength(5)
    expect(archive.content.site_assets?.map(row => row.id)).toEqual([frameAsset])
    expect(archive.content.section_defs.find(row => row.id === historicalHeader)?.status).toBe('retired')
    expect(archive.content.section_def_versions.find(row => row.section_def_id === headerDef)!.slots).toEqual(slots)
    for (const forbidden of ['object_key', 'compiled_ast', 'trusted_code_approved', 'memberships', 'auth_subject']) {
      expect(JSON.stringify(archive)).not.toContain(forbidden)
    }
  })

  it('round-trips frame history, pin versions, media, governed navigation and rendered private drafts without publication', async () => {
    const id = randomUUID(),
      destination = { slug: 'frame-roundtrip', name: 'Frame roundtrip' }
    const beforeSource = await importedPreview(sourceSite)
    await db.asUser(s.superAdmin, client => importSiteArchiveInTransaction(client, id, destination, archive, media))
    expect(
      await db.asUser(s.superAdmin, client => importSiteArchiveInTransaction(client, id, destination, archive, media)),
    ).toBe(id)
    const exported = await db.asUser(s.superAdmin, client => exportSiteArchiveInTransaction(client, id, media))
    const reverse = new Map<string, string>()
    for (const rows of Object.values(archive.content))
      if (Array.isArray(rows)) for (const row of rows) if ('id' in row) reverse.set(importedId(id, row.id), row.id)
    for (const key of ['global_element_versions', 'navigation_versions'] as const) {
      expect(
        (remapArchiveValue(exported.content[key], reverse) as { id: string }[]).sort((a, b) =>
          a.id.localeCompare(b.id),
        ),
      ).toEqual([...archive.content[key]].sort((a, b) => a.id.localeCompare(b.id)))
    }
    const definitions = new Map(exported.content.section_defs.map(row => [row.id, row]))
    for (const original of archive.content.section_defs)
      expect(definitions.get(importedId(id, original.id))).toMatchObject({
        scope: 'site',
        placement: original.placement,
        status: original.status,
        slug: `import-${importedId(id, original.id)}`,
      })
    expect(exported.objects.map(row => row.base64).sort()).toEqual(archive.objects.map(row => row.base64).sort())
    const html = await importedPreview(id)
    for (const rendered of [beforeSource, html]) {
      expect(rendered).toContain('Version two: Private draft title')
      expect(rendered).toContain('Footer design: Footer title')
      expect(rendered).toContain('<a href="/" aria-current="page">Governed page</a>')
      expect(rendered).toContain('/resources?campaign=frame#overview')
      expect(rendered).toContain('<summary>Contact</summary>')
      expect(rendered).not.toContain('onerror')
      expect(rendered).not.toContain('<script')
      expect(rendered).not.toContain('Live title')
      expect(rendered).not.toContain('Version three')
      expect(rendered).toContain('Download report')
      expect(rendered).toContain('Static report')
    }
    expect(html).toContain(`/media/${importedId(id, staticMedia)}/wide`)
    expect(html).toContain(`/media/${importedId(id, valueMedia)}/wide`)
    expect(html).not.toContain(staticMedia)
    expect(html).toContain(`/assets/${importedId(id, frameAsset)}`)
    expect(html).not.toContain(frameAsset)
    await db.as('owner', async client => {
      for (const table of ['pages', 'themes', 'navigations', 'global_elements', 'site_settings']) {
        expect(
          (await client.query(`SELECT id FROM ${table} WHERE site_id=$1 AND published_version_id IS NOT NULL`, [id]))
            .rows,
        ).toEqual([])
      }
      expect(
        (await client.query('SELECT id FROM global_elements WHERE site_id=$1 AND use_on_live', [id])).rows,
      ).toEqual([])
      for (const table of [
        'published_routes',
        'published_site_shells',
        'domains',
        'scheduled_actions',
        'site_memberships',
      ]) {
        expect((await client.query(`SELECT * FROM ${table} WHERE site_id=$1`, [id])).rows).toEqual([])
      }
      expect(
        (
          await client.query(
            "SELECT payload->'header'->'component' AS component FROM published_site_shells WHERE site_id=$1",
            [sourceSite],
          )
        ).rows[0]!.component,
      ).toMatchObject({ section_def_id: headerDef, section_def_version: 1, values: { title: 'Live title' } })
      expect(
        (await client.query("SELECT * FROM audit_log WHERE site_id=$1 AND action='site.import'", [id])).rows,
      ).toHaveLength(1)
    })
  })

  it('rejects incomplete, misplaced and active-code frames before writing media', async () => {
    for (const mutation of ['missing', 'misplaced', 'trusted'] as const) {
      const bad = structuredClone(archive),
        def = bad.content.section_defs.find(row => row.id === headerDef)!
      if (mutation === 'missing')
        bad.content.section_def_versions = bad.content.section_def_versions.filter(
          row => row.section_def_id !== headerDef,
        )
      if (mutation === 'misplaced') def.placement = 'footer'
      if (mutation === 'trusted')
        for (const row of bad.content.section_def_versions.filter(row => row.section_def_id === headerDef)) {
          row.source_html = '<script>alert(1)</script>'
          row.slots = []
        }
      const before = objects.size
      await expect(
        db.asUser(s.superAdmin, client =>
          importSiteArchiveInTransaction(
            client,
            randomUUID(),
            { slug: `invalid-${mutation}`, name: 'Invalid' },
            bad,
            media,
          ),
        ),
      ).rejects.toThrow(/frame|placement|trusted code/i)
      expect(objects.size).toBe(before)
    }
  })

  it('uses a published-only pin as the imported draft without upgrading or publishing it', async () => {
    const publishedOnly = structuredClone(archive),
      id = randomUUID()
    publishedOnly.content.global_elements.forEach(row => {
      row.draft_version_id = null
    })
    await db.asUser(s.superAdmin, client =>
      importSiteArchiveInTransaction(
        client,
        id,
        { slug: 'published-frame-copy', name: 'Published frame copy' },
        publishedOnly,
        media,
      ),
    )
    const html = await importedPreview(id)
    expect(html).toContain('Version one: Live title')
    expect(html).not.toContain('Private draft title')
    const heads = (
      await db.asUser(s.superAdmin, client =>
        client.query(
          'SELECT kind,draft_version_id,published_version_id,use_on_live FROM global_elements WHERE site_id=$1',
          [id],
        ),
      )
    ).rows
    for (const original of publishedOnly.content.global_elements) {
      expect(heads.find(row => row.kind === original.kind)).toMatchObject({
        draft_version_id: importedId(id, original.published_version_id!),
        published_version_id: null,
        use_on_live: false,
      })
    }
  })

  it('imports older preset archives whose page definitions predate placement metadata', async () => {
    const source = (
      await db.asUser(s.superAdmin, client =>
        createSiteFromSetupInTransaction(
          client,
          randomUUID(),
          { ...starterSiteSetup('resource'), name: 'Legacy preset', slug: 'legacy-preset' },
          'legacy-preset.staging.example.test',
        ),
      )
    ).siteId
    const legacy = await db.asUser(s.superAdmin, client => exportSiteArchiveInTransaction(client, source, media))
    legacy.content.section_defs.forEach(row => {
      delete row.placement
    })
    const id = randomUUID()
    await db.asUser(s.superAdmin, client =>
      importSiteArchiveInTransaction(
        client,
        id,
        { slug: 'legacy-preset-copy', name: 'Legacy preset copy' },
        legacy,
        media,
      ),
    )
    expect(legacy.content.section_defs.every(row => row.placement === undefined)).toBe(true)
    const definitions = (
      await db.asUser(s.superAdmin, client => client.query('SELECT placement FROM section_defs WHERE site_id=$1', [id]))
    ).rows
    expect(definitions.length).toBeGreaterThan(0)
    expect(definitions.every(row => row.placement === 'page')).toBe(true)
  })

  it.each([
    'foreign',
    'missing-version',
    'wrong-placement',
    'trusted',
    'foreign-media',
    'foreign-navigation',
    'page-frame',
    'unmarked-script',
    'foreign-asset-url',
    'foreign-asset-id',
    'nested-reference',
  ] as const)('independently rejects %s through raw SQL and rolls back the entire destination', async mutation => {
    const id = randomUUID(),
      prepared = await prepareSiteArchive(id, { slug: `blocked-${mutation}`, name: 'Blocked' }, archive)
    const defId = importedId(id, headerDef)
    const frame = prepared.bundle.global_element_versions.find(
      row => (row.content as HeaderConfigV2).component?.section_def_id === defId,
    )!.content as HeaderConfigV2
    if (mutation === 'foreign') frame.component.section_def_id = headerDef
    if (mutation === 'missing-version') frame.component.section_def_version = 999
    if (mutation === 'wrong-placement') prepared.bundle.section_defs.find(row => row.id === defId)!.placement = 'footer'
    if (mutation === 'trusted')
      prepared.bundle.section_def_versions
        .filter(row => row.section_def_id === defId)
        .forEach(row => {
          row.carries_trusted_code = true
        })
    if (mutation === 'unmarked-script') {
      const version = prepared.bundle.section_def_versions.find(
        row => row.section_def_id === defId && row.version === frame.component.section_def_version,
      )!
      version.source_html = '<script>alert(1)</script>'
      version.slots = []
      version.compiled_ast = { ...version.compiled_ast, nodes: [{ kind: 'html', value: version.source_html }] }
      version.carries_trusted_code = false
    }
    if (mutation === 'foreign-media') frame.component.values['portrait'] = { media_id: valueMedia }
    if (mutation === 'foreign-navigation')
      prepared.bundle.navigation_versions.at(-1)!.tree = [
        { label: 'Foreign', visible: true, target: { type: 'page', page_id: sourcePage } },
      ]
    if (mutation === 'page-frame') prepared.bundle.page_versions[0]!.content[0]!.section_def_id = defId
    if (mutation === 'foreign-asset-url') frame.component.values['download'] = `/assets/${frameAsset}`
    if (mutation === 'foreign-asset-id') frame.component.values['download'] = { asset_id: frameAsset }
    if (mutation === 'nested-reference') {
      let nested: unknown = { media_id: valueMedia }
      for (let depth = 0; depth < 81; depth++) nested = { nested }
      frame.component.values['nested'] = nested
    }
    await expectSqlState(
      db.asUser(s.superAdmin, client =>
        client.query('SELECT app.import_site_content($1,$2,$3)', [id, JSON.stringify(prepared.bundle), '{}']),
      ),
      'CMS04',
    )
    expect((await db.as('owner', client => client.query('SELECT id FROM sites WHERE id=$1', [id]))).rows).toEqual([])
  })

  it('keeps export/import privileges and refuses cross-tenant draft pins before disclosing definition source', async () => {
    await expectSqlState(
      db.asUser(s.editorB, client => client.query('SELECT app.export_site_content($1)', [sourceSite])),
      'CMS02',
    )
    await expectSqlState(
      db.asUser(s.editorA, client => client.query("SELECT app.import_site_content($1,'{}','{}')", [randomUUID()])),
      'CMS02',
    )
    await expectSqlState(
      db.asUser(s.superAdmin, client => client.query('SELECT app.export_site_content_before_assets($1)', [sourceSite])),
      '42501',
    )
    const foreign = await defineFrame('foreign-secret-frame', 'header', 'Other tenant private content', s.siteB)
    await saveFrame(s.siteA, header(foreign, 1, 'Foreign draft'), footer(footerDef))
    await expectSqlState(
      db.asUser(s.superAdmin, client => client.query('SELECT app.export_site_content($1)', [s.siteA])),
      'CMS04',
    )
  })
})
