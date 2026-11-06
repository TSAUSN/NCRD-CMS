import { createHash, randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { CHECKED_CLEAN, TestDatabase, expectSqlState } from '@cms/schema/testing'
import { seedScenario, type Scenario } from '@cms/schema/fixtures'
import { SiteSetup } from '@cms/schema'
import { installCoreLibrary } from '@cms/seeds/core-install'
import { starterSiteSetup } from '@cms/seeds/archetypes'
import { ECHELON_THEME } from '@cms/seeds/core-themes'
import { mapErrors } from '@cms/domain'
import { renderPage, type RenderManifest } from '@cms/renderer'

let db: TestDatabase
let s: Scenario
vi.mock('@cms/platform', async original => ({
  ...(await original<object>()),
  asUser: (identity: { userId: string }, run: Parameters<TestDatabase['asUser']>[1]) =>
    mapErrors(() => db.asUser(identity.userId, run)),
}))
import { createSiteFromSetupInTransaction } from '../src/lib/site-creation.ts'
import {
  listReleaseCandidates,
  planSiteRelease,
  executeSiteRelease,
  previewSiteReleasePage,
} from '../src/lib/releases.ts'
import { readSitePreview } from '../src/lib/site-preview.ts'
beforeAll(async () => {
  db = await TestDatabase.create('site_creation')
  s = await seedScenario(db)
  await db.asUser(s.superAdmin, client => installCoreLibrary(client))
})
afterAll(async () => {
  await db?.close()
})
function setup(kind: SiteSetup['kind']) {
  const slug = `starter-${randomUUID().slice(0, 8)}`
  return SiteSetup.parse({ ...starterSiteSetup(kind), name: 'A new site', slug })
}

describe('site starter creation', () => {
  it('creates a private chapter template with optional page-owned board and photos', async () => {
    const base = setup('resource'),
      plan = SiteSetup.parse({
        ...base,
        theme: ECHELON_THEME,
        pages: [{ ...base.pages[0]!, template: 'chapter', intro: '[Chapter introduction]', body: '' }],
      })
    const result = await db.asUser(s.superAdmin, client =>
      createSiteFromSetupInTransaction(client, randomUUID(), plan, `${plan.slug}.staging.example.test`),
    )
    await db.asUser(s.superAdmin, async client => {
      expect((await client.query('SELECT id FROM collections WHERE site_id=$1', [result.siteId])).rows).toEqual([])
      const page = (
        await client.query(
          'SELECT p.id,p.revision,p.draft_version_id,v.content,v.meta FROM pages p JOIN page_versions v ON v.id=p.draft_version_id WHERE p.site_id=$1',
          [result.siteId],
        )
      ).rows[0]!
      expect(
        page.content.map((section: { label: string; hidden: boolean }) => [section.label, section.hidden]),
      ).toEqual([
        ['Page header', false],
        ['About this chapter', false],
        ['Board', true],
        ['Photos', true],
        ['Join us', false],
      ])
      const appearance = await readSitePreview(client, result.siteId)
      const html = async (version: string) =>
        renderPage({
          manifest: (await client.query('SELECT app.build_initial_preview_manifest($1) AS manifest', [version]))
            .rows[0]!.manifest,
          ...appearance!,
          isStaging: true,
        }).html
      expect(await html(page.draft_version_id)).not.toContain('[Board member 1] (sample)')
      page.content.find((section: { label: string }) => section.label === 'Board').hidden = false
      const saved = (
        await client.query('SELECT * FROM app.save_page_draft($1,$2,$3,$4)', [
          page.id,
          page.revision,
          JSON.stringify(page.content),
          JSON.stringify(page.meta),
        ])
      ).rows[0]!
      const shown = await html(saved.version_id)
      expect(shown).toContain('[Board member 1] (sample)')
      expect(shown).toContain('[Board member 2] (sample)')
      expect(shown).toContain('body{margin:0;background:#d9d9d9')
    })
    expect(
      (await db.as('public', client => client.query('SELECT * FROM public_api.site_routes($1)', [result.hostname])))
        .rows,
    ).toEqual([])
  })
  it.each(['resource', 'event'] as const)(
    'creates a private %s starter, previews its saved design, then releases it deliberately',
    async kind => {
      const plan = setup(kind)
      const host = `${plan.slug}.staging.example.test`
      const result = await db.asUser(s.superAdmin, client =>
        createSiteFromSetupInTransaction(client, randomUUID(), plan, host),
      )
      const routes = await db.as('public', client => client.query('SELECT * FROM public_api.site_routes($1)', [host]))
      expect(routes.rows).toEqual([])
      expect(
        (await db.as('public', client => client.query('SELECT * FROM public_api.resolve_route($1,$2)', [host, '/'])))
          .rows,
      ).toEqual([])
      await db.asUser(s.superAdmin, async client => {
        expect((await client.query('SELECT id FROM section_defs WHERE site_id=$1', [result.siteId])).rows).toEqual([])
        expect(
          (
            await client.query('SELECT id FROM themes WHERE site_id=$1 AND published_version_id IS NOT NULL', [
              result.siteId,
            ])
          ).rows,
        ).toEqual([])
        expect(
          (
            await client.query('SELECT id FROM global_elements WHERE site_id=$1 AND published_version_id IS NOT NULL', [
              result.siteId,
            ])
          ).rows,
        ).toEqual([])
        expect(
          (
            await client.query('SELECT id FROM navigations WHERE site_id=$1 AND published_version_id IS NOT NULL', [
              result.siteId,
            ])
          ).rows,
        ).toEqual([])
        expect(
          (
            await client.query(
              'SELECT id FROM collections WHERE site_id=$1 AND published_schema_version_id IS NOT NULL',
              [result.siteId],
            )
          ).rows,
        ).toEqual([])
        expect(
          (await client.query('SELECT site_id FROM published_site_shells WHERE site_id=$1', [result.siteId])).rows,
        ).toEqual([])
        const appearance = await readSitePreview(client, result.siteId)
        expect(appearance?.shell.theme).toEqual(plan.theme)
        expect(appearance?.shell.header).toMatchObject({ brand: { siteName: plan.name } })
        for (const page of (await client.query('SELECT draft_version_id FROM pages WHERE site_id=$1', [result.siteId]))
          .rows) {
          const manifest = (
            await client.query<{ manifest: RenderManifest }>(
              'SELECT app.build_initial_preview_manifest($1) AS manifest',
              [page.draft_version_id],
            )
          ).rows[0]!.manifest
          const html = renderPage({ manifest, ...appearance!, isStaging: true }).html
          expect(html).toContain(plan.name)
          expect(html).toContain(plan.theme.colors.primary)
        }
      })
      const lists = await db.asUser(s.superAdmin, client =>
        client.query('SELECT reader_key FROM collections WHERE site_id=$1', [result.siteId]),
      )
      expect(lists.rows.map(row => row.reader_key).sort()).toEqual(
        kind === 'event' ? ['program', 'speakers'] : ['resources'],
      )
      const candidates = await listReleaseCandidates(s.superAdmin, result.siteId)
      expect(new Set(candidates.map(item => item.type))).toEqual(
        new Set(['page', 'theme', 'frame', 'navigation', 'collection_schema']),
      )
      const release = await planSiteRelease(s.superAdmin, randomUUID(), result.siteId, candidates)
      expect(
        release.preview_report
          .flatMap(check => check.report.blocking)
          .every(finding => finding.rule === 'sample_content'),
      ).toBe(true)
      expect(
        release.preview_report
          .flatMap(check => check.report.blocking)
          .some(finding => finding.rule === 'sample_content'),
      ).toBe(true)
      const firstPage = candidates.find(item => item.type === 'page')!
      expect(await previewSiteReleasePage(s.superAdmin, release.id, firstPage.id)).toContain(plan.name)
      expect(
        (await db.as('public', client => client.query('SELECT * FROM public_api.site_routes($1)', [host]))).rows,
      ).toEqual([])
      await executeSiteRelease(s.superAdmin, release.id, 'Confirmed: Publish with sample content.')
      await executeSiteRelease(s.superAdmin, release.id, 'Confirmed: Publish with sample content.')
      const live = await db.as('public', client => client.query('SELECT * FROM public_api.site_routes($1)', [host]))
      expect(live.rows.map(row => row.path).sort()).toEqual(plan.pages.map(page => `/${page.slug}`).sort())
      const home = await db.as('public', client =>
        client.query('SELECT * FROM public_api.resolve_route($1,$2)', [host, '/']),
      )
      expect(home.rows[0]).toMatchObject({ site_id: result.siteId, is_staging: true })
      expect(home.rows[0]!.render_manifest.sections[0].instance.values.heading).toBe(plan.name)
      expect(
        (
          await db.asUser(s.superAdmin, client =>
            client.query('SELECT initial_release_required FROM sites WHERE id=$1', [result.siteId]),
          )
        ).rows[0]!.initial_release_required,
      ).toBe(false)
    },
  )
  it('keeps hosts, local media and a separately published frame private until the first complete release', async () => {
    const plan = setup('resource'),
      site = await db.asUser(s.superAdmin, client =>
        createSiteFromSetupInTransaction(client, randomUUID(), plan, `${plan.slug}.staging.example.test`),
      )
    const local = randomUUID(),
      shared = randomUUID(),
      custom = `${plan.slug}.example.test`
    await db.as('owner', async client => {
      await client.query("INSERT INTO domains(site_id,hostname_normalized,status) VALUES($1,$2,'live')", [
        site.siteId,
        custom,
      ])
      for (const [id, owner] of [
        [local, site.siteId],
        [shared, null],
      ])
        await client.query(
          "INSERT INTO media(id,site_id,object_key,content_hash,original_name,alt_text,width,height,bytes,mime_type,status) VALUES($1,$2,$3,$4,'private.jpg','Private image',10,10,99,'image/jpeg','ready')",
          [id, owner, `private-startup/${id}.jpg`, String(id).replaceAll('-', '').padEnd(64, 'a')],
        )
    })
    expect
      .soft(
        (
          await db.as('public', client =>
            client.query("SELECT media_id FROM public_api.resolve_media($1,$2,'original')", [site.hostname, local]),
          )
        ).rows,
      )
      .toEqual([])
    const hash = 'a'.repeat(64),
      name = 'private.pdf'
    const digest = createHash('sha256').update(`cms-site-document:1:${site.siteId}:${hash}:${name}`).digest('hex')
    const document = `${digest.slice(0, 8)}-${digest.slice(8, 12)}-4${digest.slice(13, 16)}-a${digest.slice(17, 20)}-${digest.slice(20, 32)}`
    await db.asUser(s.superAdmin, async client => {
      await client.query('SELECT app.upload_site_document($1,$2,99,$3,$4)', [site.siteId, document, hash, name])
      const slug = `private-frame-${randomUUID().slice(0, 8)}`
      const html = `<img src="/media/${shared}/original" alt="Private image"><a href="/assets/${document}">Private document</a>`
      const definition = (
        await client.query('SELECT * FROM app.upsert_section_def_version($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)', [
          slug,
          slug,
          'Frame',
          html,
          '',
          '',
          JSON.stringify({ policyVersion: 4, cssPolicyVersion: 6, nodes: [{ kind: 'html', value: html }] }),
          '[]',
          slug,
          4,
          6,
          'Private startup boundary',
          false,
        ])
      ).rows[0]!
      await client.query("SELECT app.set_section_def_placement($1,'header')", [definition.section_def_id])
      const heads = (
        await client.query(
          'SELECT g.kind,g.revision,v.content FROM global_elements g JOIN global_element_versions v ON v.id=g.draft_version_id WHERE g.site_id=$1',
          [site.siteId],
        )
      ).rows
      const header = {
        schemaVersion: 2,
        enabled: true,
        sticky: false,
        component: { section_def_id: definition.section_def_id, section_def_version: 1, values: {} },
      }
      const saved = (
        await client.query('SELECT * FROM app.save_global_elements_draft($1,$2,$3,$4,$5)', [
          site.siteId,
          heads.find(head => head.kind === 'header')!.revision,
          heads.find(head => head.kind === 'footer')!.revision,
          JSON.stringify(header),
          JSON.stringify(heads.find(head => head.kind === 'footer')!.content),
        ])
      ).rows[0]!
      await client.query('SELECT * FROM app.publish_global_elements($1,$2,$3)', [
        site.siteId,
        saved.header_revision,
        saved.footer_revision,
      ])
      expect((await readSitePreview(client, site.siteId))?.shell.header).toMatchObject({
        component: { section_def_id: definition.section_def_id },
      })
    })
    for (const host of [site.hostname, custom]) {
      const result = await db.as('public', async client => ({
        host: (await client.query('SELECT * FROM public_api.resolve_host($1)', [host])).rows,
        local: (await client.query("SELECT media_id FROM public_api.resolve_media($1,$2,'original')", [host, local]))
          .rows,
        shared: (await client.query("SELECT media_id FROM public_api.resolve_media($1,$2,'original')", [host, shared]))
          .rows,
        document: (await client.query('SELECT id FROM public_api.resolve_site_asset($1,$2)', [host, document])).rows,
      }))
      expect.soft(result).toEqual({ host: [], local: [], shared: [], document: [] })
    }
    const release = await planSiteRelease(
      s.superAdmin,
      randomUUID(),
      site.siteId,
      await listReleaseCandidates(s.superAdmin, site.siteId),
    )
    expect(
      release.preview_report
        .flatMap(check => check.report.blocking)
        .every(finding => finding.rule === 'sample_content'),
    ).toBe(true)
    expect(
      release.preview_report.flatMap(check => check.report.blocking).some(finding => finding.rule === 'sample_content'),
    ).toBe(true)
    await executeSiteRelease(s.superAdmin, release.id, 'Confirmed: Publish with sample content.')
    for (const host of [site.hostname, custom]) {
      expect(
        (
          await db.as('public', client =>
            client.query("SELECT media_id FROM public_api.resolve_media($1,$2,'original')", [host, shared]),
          )
        ).rows,
      ).toEqual([{ media_id: shared }])
      expect(
        (
          await db.as('public', client =>
            client.query('SELECT id FROM public_api.resolve_site_asset($1,$2)', [host, document]),
          )
        ).rows,
      ).toEqual([{ id: document }])
    }
  })
  it('keeps two conferences independent when one changes its year, design and speaker records', async () => {
    const sites = []
    for (const year of [2030, 2031]) {
      const plan = setup('event')
      plan.name = `Fictional conference ${year}`
      plan.theme.colors.primary = year === 2030 ? '#003087' : '#165b43'
      const site = await db.asUser(s.superAdmin, client =>
        createSiteFromSetupInTransaction(client, randomUUID(), plan, `${plan.slug}.staging.example.test`),
      )
      const speaker = await db.asUser(s.superAdmin, async client => {
        const collection = (
          await client.query("SELECT id,entry_revision FROM collections WHERE site_id=$1 AND reader_key='speakers'", [
            site.siteId,
          ])
        ).rows[0]!
        await client.query('SELECT app.save_collection_entries($1,$2,$3)', [
          collection.id,
          collection.entry_revision,
          JSON.stringify([
            {
              id: null,
              stableKey: 'sample-speaker',
              values: {
                name: `Sample speaker ${year}`,
                role: 'Fictional role',
                bio: '<p>Fictional biography.</p>',
                photo: '',
              },
            },
          ]),
        ])
        return collection.id as string
      })
      const release = await planSiteRelease(
        s.superAdmin,
        randomUUID(),
        site.siteId,
        await listReleaseCandidates(s.superAdmin, site.siteId),
      )
      expect(
        release.preview_report
          .flatMap(check => check.report.blocking)
          .every(finding => finding.rule === 'sample_content'),
      ).toBe(true)
      expect(
        release.preview_report
          .flatMap(check => check.report.blocking)
          .some(finding => finding.rule === 'sample_content'),
      ).toBe(true)
      await executeSiteRelease(s.superAdmin, release.id, 'Confirmed: Publish with sample content.')
      sites.push({ ...site, speaker })
    }
    const [first, second] = sites
    const publicRoute = (host: string) =>
      db.as(
        'public',
        async client =>
          (await client.query('SELECT * FROM public_api.resolve_route($1,$2)', [host, '/speakers'])).rows[0],
      )
    const firstBefore = await publicRoute(first!.hostname),
      secondBefore = await publicRoute(second!.hostname)
    expect(JSON.stringify(firstBefore)).toContain('Sample speaker 2030')
    expect(JSON.stringify(secondBefore)).toContain('Sample speaker 2031')
    expect(first!.speaker).not.toBe(second!.speaker)
    await db.asUser(s.superAdmin, async client => {
      const collection = (await client.query('SELECT entry_revision FROM collections WHERE id=$1', [first!.speaker]))
        .rows[0]!
      const entry = (
        await client.query(
          'SELECT e.id,v.values FROM collection_entries e JOIN collection_entry_versions v ON v.id=e.draft_version_id WHERE e.collection_id=$1',
          [first!.speaker],
        )
      ).rows[0]!
      await client.query('SELECT app.save_collection_entries($1,$2,$3)', [
        first!.speaker,
        collection.entry_revision,
        JSON.stringify([
          { id: entry.id, stableKey: 'sample-speaker', values: { ...entry.values, name: 'Sample speaker 2032' } },
        ]),
      ])
      const theme = (
        await client.query(
          'SELECT t.revision,v.tokens FROM themes t JOIN theme_versions v ON v.id=t.draft_version_id WHERE t.site_id=$1',
          [first!.siteId],
        )
      ).rows[0]!
      await client.query('SELECT app.save_theme_draft($1,$2,$3)', [
        first!.siteId,
        theme.revision,
        JSON.stringify({ ...theme.tokens, colors: { ...theme.tokens.colors, primary: '#34475a' } }),
      ])
    })
    expect(await publicRoute(first!.hostname)).toEqual(firstBefore)
    expect(await publicRoute(second!.hostname)).toEqual(secondBefore)
    const update = await planSiteRelease(
      s.superAdmin,
      randomUUID(),
      first!.siteId,
      await listReleaseCandidates(s.superAdmin, first!.siteId),
    )
    expect(
      update.preview_report.flatMap(check => check.report.blocking).every(finding => finding.rule === 'sample_content'),
    ).toBe(true)
    expect(
      update.preview_report.flatMap(check => check.report.blocking).some(finding => finding.rule === 'sample_content'),
    ).toBe(true)
    await expect(executeSiteRelease(s.superAdmin, update.id, '')).rejects.toThrow('sample content')
    await executeSiteRelease(s.superAdmin, update.id, 'Confirmed: Publish with sample content.')
    const firstAfter = JSON.stringify(await publicRoute(first!.hostname))
    expect(firstAfter).toContain('Sample speaker 2032')
    expect(firstAfter).toContain('#34475a')
    expect(await publicRoute(second!.hostname)).toEqual(secondBefore)
  }, 60_000)
  it('builds the draft menu from the planned pages that should be in it, in their order', async () => {
    const base = setup('resource')
    const plan = SiteSetup.parse({ ...base, pages: [base.pages[0], { ...base.pages[2]!, menu: false }, base.pages[1]] })
    const result = await db.asUser(s.superAdmin, client =>
      createSiteFromSetupInTransaction(client, randomUUID(), plan, `${plan.slug}.staging.example.test`),
    )
    await db.asUser(s.superAdmin, async client => {
      const pages = new Map(
        (
          await client.query<{ id: string; title: string }>('SELECT id,title FROM pages WHERE site_id=$1', [
            result.siteId,
          ])
        ).rows.map(row => [row.id, row.title]),
      )
      expect(pages.size).toBe(3)
      const tree = (
        await client.query(
          'SELECT v.tree FROM navigations n JOIN navigation_versions v ON v.id=n.draft_version_id WHERE n.site_id=$1',
          [result.siteId],
        )
      ).rows[0]!.tree
      expect(
        tree.map((item: { label: string; target: { page_id: string } }) => [
          item.label,
          pages.get(item.target.page_id),
        ]),
      ).toEqual([
        ['Home', 'Home'],
        ['Resources', 'Resources'],
      ])
    })
    // A setup file from before the choice existed keeps every page in the menu.
    expect(
      SiteSetup.parse({ ...base, pages: base.pages.map(({ menu: _menu, ...page }) => page) }).pages.every(
        page => page.menu,
      ),
    ).toBe(true)
  })

  it('opens a nested page from the page above it in the menu, and lists the footer pages once they exist', async () => {
    const base = setup('resource')
    // Home, Resources, then About nested under Resources and in the footer.
    const plan = SiteSetup.parse({
      ...base,
      slug: `${base.slug}-nested`,
      pages: [base.pages[0], { ...base.pages[1]!, footer: true }, { ...base.pages[2]!, nested: true, footer: true }],
    })
    const result = await db.asUser(s.superAdmin, client =>
      createSiteFromSetupInTransaction(client, randomUUID(), plan, `${plan.slug}.staging.example.test`),
    )
    await db.asUser(s.superAdmin, async client => {
      const pages = new Map(
        (
          await client.query<{ id: string; title: string }>('SELECT id,title FROM pages WHERE site_id=$1', [
            result.siteId,
          ])
        ).rows.map(row => [row.id, row.title]),
      )
      type Item = { label: string; target: { page_id: string }; children?: Item[] }
      const tree = (
        await client.query<{ tree: Item[] }>(
          'SELECT v.tree FROM navigations n JOIN navigation_versions v ON v.id=n.draft_version_id WHERE n.site_id=$1',
          [result.siteId],
        )
      ).rows[0]!.tree
      const shape = (items: Item[]): unknown[] =>
        items.map(item =>
          item.children ? [pages.get(item.target.page_id), shape(item.children)] : pages.get(item.target.page_id),
        )
      expect(shape(tree)).toEqual(['Home', ['Resources', ['About this project']]])
      const footer = (
        await client.query(
          'SELECT v.content FROM global_elements g JOIN global_element_versions v ON v.id=g.draft_version_id WHERE g.site_id=$1 AND g.kind=$2',
          [result.siteId, 'footer'],
        )
      ).rows[0]!.content
      expect(
        footer.groups.map((group: { heading: string; links: { label: string; target: { page_id: string } }[] }) => [
          group.heading,
          group.links.map(link => [link.label, pages.get(link.target.page_id)]),
        ]),
      ).toEqual([
        [
          'On this site',
          [
            ['Resources', 'Resources'],
            ['About this project', 'About this project'],
          ],
        ],
      ])
    })
    // Links planned for every page arrive with the frame; page links come first.
    const linked = SiteSetup.parse({
      ...base,
      slug: `${base.slug}-links`,
      pages: [base.pages[0], { ...base.pages[1]!, footer: true }],
      header: {
        ...base.header,
        utilityLinks: [{ label: 'Donate', target: { type: 'url', url: 'https://give.example.org/' } }],
      },
      footer: {
        ...base.footer,
        groups: [
          { heading: 'Useful links', links: [{ label: 'Annual report', target: { type: 'url', url: '/report' } }] },
        ],
      },
    })
    const third = await db.asUser(s.superAdmin, client =>
      createSiteFromSetupInTransaction(client, randomUUID(), linked, `${linked.slug}.staging.example.test`),
    )
    await db.asUser(s.superAdmin, async client => {
      const frames = Object.fromEntries(
        (
          await client.query<{ kind: string; content: Record<string, unknown> }>(
            'SELECT g.kind,v.content FROM global_elements g JOIN global_element_versions v ON v.id=g.draft_version_id WHERE g.site_id=$1',
            [third.siteId],
          )
        ).rows.map(row => [row.kind, row.content]),
      )
      expect(frames.header!.utilityLinks).toEqual([
        { label: 'Donate', target: { type: 'url', url: 'https://give.example.org/' } },
      ])
      expect(
        (frames.footer!.groups as { heading: string; links: { label: string }[] }[]).map(group => [
          group.heading,
          group.links.map(link => link.label),
        ]),
      ).toEqual([
        ['On this site', ['Resources']],
        ['Useful links', ['Annual report']],
      ])
    })
    // Left out of the menu, the page it sits under no longer holds it.
    const orphan = SiteSetup.parse({
      ...base,
      slug: `${base.slug}-orphan`,
      pages: [base.pages[0], { ...base.pages[1]!, menu: false }, { ...base.pages[2]!, nested: true }],
    })
    const second = await db.asUser(s.superAdmin, client =>
      createSiteFromSetupInTransaction(client, randomUUID(), orphan, `${orphan.slug}.staging.example.test`),
    )
    await db.asUser(s.superAdmin, async client => {
      const tree = (
        await client.query(
          'SELECT v.tree FROM navigations n JOIN navigation_versions v ON v.id=n.draft_version_id WHERE n.site_id=$1',
          [second.siteId],
        )
      ).rows[0]!.tree
      expect(
        tree.map((item: { label: string; children?: unknown[] }) => [item.label, item.children?.length ?? 0]),
      ).toEqual([
        ['Home', 0],
        ['About this project', 0],
      ])
    })
  })

  it('returns the existing site when the same committed request is retried', async () => {
    const plan = setup('resource'),
      id = randomUUID(),
      host = `${plan.slug}.staging.example.test`
    const first = await db.asUser(s.superAdmin, client => createSiteFromSetupInTransaction(client, id, plan, host))
    const second = await db.asUser(s.superAdmin, client => createSiteFromSetupInTransaction(client, id, plan, host))
    expect(second).toEqual(first)
    const versions = await db.asUser(s.superAdmin, client =>
      client.query('SELECT id FROM page_versions WHERE site_id=$1', [first.siteId]),
    )
    expect(versions.rows).toHaveLength(plan.pages.length)
  })
  it('keeps an unready theme repairable as a private draft and refuses its first release', async () => {
    const plan = setup('resource')
    plan.theme.colors.primary = '#ffffff'
    plan.theme.colors.primaryContrast = '#ffffff'
    const site = await db.asUser(s.superAdmin, client =>
      createSiteFromSetupInTransaction(client, randomUUID(), plan, `${plan.slug}.staging.example.test`),
    )
    await expect(
      planSiteRelease(s.superAdmin, randomUUID(), site.siteId, await listReleaseCandidates(s.superAdmin, site.siteId)),
    ).rejects.toMatchObject({ kind: 'invalid_state' })
    expect(
      (
        await db.asUser(s.superAdmin, client =>
          client.query('SELECT id FROM themes WHERE site_id=$1 AND published_version_id IS NOT NULL', [site.siteId]),
        )
      ).rows,
    ).toEqual([])
    expect(
      (await db.as('public', client => client.query('SELECT * FROM public_api.site_routes($1)', [site.hostname]))).rows,
    ).toEqual([])
  })

  it('rolls back all setup artifacts on a mid-creation failure and allows a clean retry', async () => {
    const plan = setup('resource'),
      request = randomUUID(),
      host = `${plan.slug}.staging.example.test`
    const invalid = { ...plan, pages: [...plan.pages, { ...plan.pages[0]! }] }
    await expectSqlState(
      db.asUser(s.superAdmin, client => createSiteFromSetupInTransaction(client, request, invalid, host)),
      'CMS04',
      '23505',
    )
    expect(
      (await db.as('owner', client => client.query('SELECT id FROM sites WHERE slug=$1', [plan.slug]))).rows,
    ).toEqual([])
    expect(
      (await db.asUser(s.superAdmin, client => createSiteFromSetupInTransaction(client, request, plan, host))).siteId,
    ).toBeTruthy()
  })

  it('refuses first-page publication without its complete shell, including direct command calls', async () => {
    const plan = setup('event'),
      site = await db.asUser(s.superAdmin, client =>
        createSiteFromSetupInTransaction(client, randomUUID(), plan, `${plan.slug}.staging.example.test`),
      )
    const candidates = await listReleaseCandidates(s.superAdmin, site.siteId),
      home = candidates.find(item => item.type === 'page')!
    await expect(planSiteRelease(s.superAdmin, randomUUID(), site.siteId, [home])).rejects.toMatchObject({
      kind: 'invalid_state',
    })
    await expectSqlState(
      db.asUser(s.superAdmin, client =>
        client.query('SELECT app.publish_page($1,$2,$3,$4,$5)', [home.id, home.revision, ...CHECKED_CLEAN]),
      ),
      'CMS04',
    )
    expect(
      (await db.as('public', client => client.query('SELECT * FROM public_api.site_routes($1)', [site.hostname]))).rows,
    ).toEqual([])
    await expect(
      planSiteRelease(
        s.superAdmin,
        randomUUID(),
        site.siteId,
        candidates.filter(item => item.type !== 'collection_schema'),
      ),
    ).rejects.toMatchObject({ kind: 'invalid_state' })
  })

  it('limits private schema previews to members and never includes draft records', async () => {
    const plan = setup('resource'),
      site = await db.asUser(s.superAdmin, client =>
        createSiteFromSetupInTransaction(client, randomUUID(), plan, `${plan.slug}.staging.example.test`),
      )
    const version = await db.asUser(s.superAdmin, async client => {
      await client.query('SELECT app.set_site_membership($1,$2,$3)', [s.contributorA, site.siteId, 'contributor'])
      const collection = (await client.query('SELECT id FROM collections WHERE site_id=$1', [site.siteId])).rows[0]!
      await client.query('SELECT app.save_collection_entries($1,0,$2)', [
        collection.id,
        JSON.stringify([
          {
            id: null,
            stableKey: 'private-record',
            values: { title: 'Unpublished confidential record', resource_url: 'https://example.test/private.pdf' },
          },
        ]),
      ])
      return (
        await client.query("SELECT draft_version_id FROM pages WHERE site_id=$1 AND slug='resources'", [site.siteId])
      ).rows[0]!.draft_version_id
    })
    const manifest = (
      await db.asUser(s.contributorA, client =>
        client.query('SELECT app.build_initial_preview_manifest($1) AS manifest', [version]),
      )
    ).rows[0]!.manifest
    expect(JSON.stringify(manifest)).not.toContain('Unpublished confidential record')
    await expectSqlState(
      db.asUser(s.editorB, client => client.query('SELECT app.build_initial_preview_manifest($1)', [version])),
      'CMS03',
    )
    for (const role of ['public', 'worker'] as const)
      await expectSqlState(
        db.as(role, client => client.query('SELECT app.build_initial_preview_manifest($1)', [version])),
        '42501',
      )
    await expectSqlState(
      db.asUser(s.superAdmin, client => client.query('SELECT app.build_render_manifest($1)', [version])),
      'CMS04',
    )
  })

  it('previews incomplete collection modes as repairable drafts while refusing their publication', async () => {
    const plan = setup('resource'),
      site = await db.asUser(s.superAdmin, client =>
        createSiteFromSetupInTransaction(client, randomUUID(), plan, `${plan.slug}.staging.example.test`),
      )
    for (const selection of [{}, { mode: null }, { mode: 'automatic' }, { mode: 'manual' }]) {
      const version = await db.asUser(s.superAdmin, async client => {
        const page = (
          await client.query(
            "SELECT p.id,p.revision,v.content,v.meta FROM pages p JOIN page_versions v ON v.id=p.draft_version_id WHERE p.site_id=$1 AND p.slug='resources'",
            [site.siteId],
          )
        ).rows[0]!
        const repeat = page.content.find((section: { values: Record<string, unknown> }) => section.values['resources'])
        repeat.values.resources.selection = selection
        return (
          await client.query('SELECT * FROM app.save_page_draft($1,$2,$3,$4)', [
            page.id,
            page.revision,
            JSON.stringify(page.content),
            JSON.stringify(page.meta),
          ])
        ).rows[0]!.version_id
      })
      expect(version).toBeTruthy()
      const preview = await db.asUser(s.superAdmin, client =>
        client.query('SELECT app.build_initial_preview_manifest($1) AS manifest', [version]),
      )
      expect(JSON.stringify(preview.rows[0]!.manifest)).toContain('cms_unconfigured')
      await expectSqlState(
        db.asUser(s.superAdmin, client => client.query('SELECT app.build_render_manifest($1)', [version])),
        'CMS04',
      )
    }
  })
  it('does not let an editor create a site by calling around the wizard', async () => {
    const plan = setup('event')
    await expectSqlState(
      db.asUser(s.editorA, client =>
        createSiteFromSetupInTransaction(client, randomUUID(), plan, `${plan.slug}.staging.example.test`),
      ),
      'CMS02',
    )
  })
  it('removes archived staging and custom-domain hosts while retaining admin content', async () => {
    const plan = setup('resource'),
      host = `${plan.slug}.staging.example.test`
    const created = await db.asUser(s.superAdmin, client =>
      createSiteFromSetupInTransaction(client, randomUUID(), plan, host),
    )
    const release = await planSiteRelease(
      s.superAdmin,
      randomUUID(),
      created.siteId,
      await listReleaseCandidates(s.superAdmin, created.siteId),
    )
    await executeSiteRelease(s.superAdmin, release.id, 'Confirmed: Publish with sample content.')
    const custom = `${plan.slug}.example.test`
    await db.as('owner', client =>
      client.query("INSERT INTO domains(site_id,hostname_normalized,status) VALUES($1,$2,'live')", [
        created.siteId,
        custom,
      ]),
    )
    expect(
      (await db.as('public', client => client.query('SELECT * FROM public_api.resolve_host($1)', [custom]))).rows,
    ).toHaveLength(1)
    await db.asUser(s.superAdmin, client => client.query('SELECT app.archive_site($1,$2)', [created.siteId, 0]))
    expect(
      (await db.as('public', client => client.query('SELECT * FROM public_api.resolve_host($1)', [host]))).rows,
    ).toEqual([])
    expect(
      (await db.as('public', client => client.query('SELECT * FROM public_api.resolve_host($1)', [custom]))).rows,
    ).toEqual([])
    expect(
      (await db.asUser(s.superAdmin, client => client.query('SELECT id FROM pages WHERE site_id=$1', [created.siteId])))
        .rows,
    ).toHaveLength(plan.pages.length)
  })
})
