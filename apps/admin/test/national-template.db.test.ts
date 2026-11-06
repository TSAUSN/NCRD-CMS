import { randomUUID } from 'node:crypto'
import { beforeAll, afterAll, it, expect } from 'vitest'
import { TestDatabase } from '@cms/schema/testing'
import { evaluateVersionReadiness } from '@cms/platform'
import { addEditorRepeatItem } from '../src/lib/editor-repeat-item.ts'
import { repeatItemKeys } from '@cms/schema'
import { seedScenario, type Scenario } from '@cms/schema/fixtures'
import type { MediaStore } from '@cms/platform'
import { starterSiteSetup } from '@cms/seeds/archetypes'
import { SAWSO_THEME } from '@cms/seeds/core-themes'
import { installCoreLibrary } from '@cms/seeds/core-install'
import { CORE_LIBRARY, coreUpsertArguments } from '@cms/seeds/core-library'
import { createSiteFromSetupInTransaction } from '../src/lib/site-creation.ts'
import { nationalTemplateSites, reviewNationalSite, applyNationalTemplate } from '../src/lib/national-template.ts'
import { startNationalSite } from '../src/lib/national-copy.ts'
import { publishStarterFixture } from './site-fixture.ts'
let db: TestDatabase, s: Scenario, source: string
const store: MediaStore = {
  get: async () => null,
  put: async (key, bytes, contentType) => ({ objectKey: key, bytes: bytes.length, contentType }),
  remove: async () => {},
  createSignedUpload: async () => {
    throw Error('unused')
  },
}
beforeAll(async () => {
  db = await TestDatabase.create('national_template_flow')
  s = await seedScenario(db)
  source = await db.asUser(s.superAdmin, async client => {
    await installCoreLibrary(client)
    const setup = { ...starterSiteSetup('resource'), slug: 'sawso', name: '[Source site]', theme: SAWSO_THEME }
    const result = await createSiteFromSetupInTransaction(client, randomUUID(), setup, 'sawso.staging.localhost')
    const page = (
      await client.query(
        'SELECT p.id,p.revision,v.content,v.meta FROM pages p JOIN page_versions v ON v.id=p.draft_version_id WHERE p.site_id=$1 ORDER BY p.sort_index LIMIT 1',
        [result.siteId],
      )
    ).rows[0]!
    page.content[0].appearance = { width: 'full', spacing: 'compact' }
    await client.query('SELECT app.save_page_draft($1,$2,$3,$4,$5,$6)', [
      page.id,
      page.revision,
      JSON.stringify(page.content),
      JSON.stringify(page.meta),
      'checkpoint',
      '[Layout choice]',
    ])
    await publishStarterFixture(client, result.siteId)
    const head = (await client.query('SELECT revision FROM themes WHERE site_id=$1', [result.siteId])).rows[0]!
    const old = structuredClone(SAWSO_THEME)
    delete old.presentation!.template
    await client.query('SELECT app.save_theme_draft($1,$2,$3)', [result.siteId, head.revision, JSON.stringify(old)])
    const entry = structuredClone(CORE_LIBRARY.find(section => section.definition.slug === 'core-split-hero')!)
    if (entry.definition.kind !== 'legacy') throw Error('fixture needs the shared hero')
    entry.definition.sourceCss = (entry.definition.sourceCss ?? '') + ' .row{letter-spacing:0}'
    await client.query(
      'SELECT * FROM app.upsert_section_def_version($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)',
      coreUpsertArguments(entry),
    )
    return result.siteId
  })
})
afterAll(async () => {
  await db?.close()
})
it('reviews real differences, applies shared pins as drafts and leaves public versions and source words intact', async () => {
  await db.asUser(s.superAdmin, async client => {
    const before = (
      await client.query('SELECT id,published_version_id,draft_version_id FROM pages WHERE site_id=$1 ORDER BY id', [
        source,
      ])
    ).rows
    const plan = await reviewNationalSite(client, source)
    expect(plan.review.themeChanged).toBe(true)
    expect(plan.review.changedPages.length).toBeGreaterThan(0)
    const text = JSON.stringify(plan.changes.map(change => change.page.content.map(section => section.values)))
    const result = await applyNationalTemplate(client, [{ id: source, fingerprint: plan.review.fingerprint }])
    expect(result.sites).toBe(1)
    expect(result.pages).toBeGreaterThan(0)
    const after = (
      await client.query('SELECT id,published_version_id,draft_version_id FROM pages WHERE site_id=$1 ORDER BY id', [
        source,
      ])
    ).rows
    expect(after.map(page => page.published_version_id)).toEqual(before.map(page => page.published_version_id))
    const next = await reviewNationalSite(client, source)
    expect(next.review.connected).toBe(true)
    expect(next.changes).toHaveLength(0)
    for (const change of plan.changes) {
      const saved = (
        await client.query(
          'SELECT v.content FROM pages p JOIN page_versions v ON v.id=p.draft_version_id WHERE p.id=$1',
          [change.page.id],
        )
      ).rows[0]!.content
      expect(saved.map((section: { values: unknown }) => section.values)).toEqual(
        change.content.map(section => section.values),
      )
    }
    expect(text.length).toBeGreaterThan(0)
  })
})
it('rejects a stale review and every non-Super-admin entry point', async () => {
  const review = await db.asUser(s.superAdmin, client => reviewNationalSite(client, source))
  await db.asUser(s.superAdmin, async client => {
    const page = (
      await client.query(
        'SELECT p.id,p.revision,v.content,v.meta FROM pages p JOIN page_versions v ON v.id=p.draft_version_id WHERE p.site_id=$1 LIMIT 1',
        [source],
      )
    ).rows[0]!
    await client.query('SELECT app.save_page_draft($1,$2,$3,$4,$5,$6)', [
      page.id,
      page.revision,
      JSON.stringify(page.content),
      JSON.stringify(page.meta),
      'checkpoint',
      '[Saved edit]',
    ])
  })
  await expect(
    db.asUser(s.superAdmin, client =>
      applyNationalTemplate(client, [{ id: source, fingerprint: review.review.fingerprint }]),
    ),
  ).rejects.toThrow('changed after this review')
  await expect(db.asUser(s.editorA, client => nationalTemplateSites(client))).rejects.toThrow('Only a super admin')
  await expect(
    db.asUser(s.editorA, client =>
      startNationalSite(
        client,
        randomUUID(),
        { name: '[Private]', slug: 'private-denied', source: 'home', bringWords: false, bringStories: false },
        store,
      ),
    ),
  ).rejects.toThrow('Only a super admin')
})
it('copies a site privately and keeps its current sections attached to the shared library', async () => {
  await db.asUser(s.superAdmin, async client => {
    const retired = (
      await client.query("SELECT app.create_page($1,'retired-copy-page','[Archived source page]') AS id", [source])
    ).rows[0]!.id
    await client.query('SELECT app.archive_page($1,0)', [retired])
    const sourceBefore = (
      await client.query(
        'SELECT id,revision,draft_version_id,published_version_id,archived_at FROM pages WHERE site_id=$1 ORDER BY id',
        [source],
      )
    ).rows
    const request = randomUUID(),
      input = {
        name: '[Private copy]',
        slug: 'private-copy',
        source: 'copy' as const,
        sourceSiteId: source,
        bringWords: false,
        bringStories: false,
      }
    const result = await startNationalSite(client, request, input, store)
    const state = (await client.query('SELECT initial_release_required FROM sites WHERE id=$1', [result.siteId]))
      .rows[0]!
    expect(state.initial_release_required).toBe(true)
    expect(
      (
        await client.query(
          'SELECT count(*)::int AS count FROM pages WHERE site_id=$1 AND published_version_id IS NOT NULL',
          [result.siteId],
        )
      ).rows[0]!.count,
    ).toBe(0)
    const pins = (
      await client.query(
        "SELECT d.scope,v.content FROM pages p JOIN page_versions v ON v.id=p.draft_version_id CROSS JOIN LATERAL jsonb_array_elements(v.content) item JOIN section_defs d ON d.id=(item->>'section_def_id')::uuid WHERE p.site_id=$1",
        [result.siteId],
      )
    ).rows
    expect(pins.length).toBeGreaterThan(0)
    expect(pins.every(pin => pin.scope === 'global')).toBe(true)
    const sourcePages = (
        await client.query(
          'SELECT p.slug,v.content FROM pages p JOIN page_versions v ON v.id=p.draft_version_id WHERE p.site_id=$1 ORDER BY p.slug',
          [source],
        )
      ).rows,
      copiedPages = (
        await client.query(
          'SELECT p.slug,v.content FROM pages p JOIN page_versions v ON v.id=p.draft_version_id WHERE p.site_id=$1 ORDER BY p.slug',
          [result.siteId],
        )
      ).rows
    for (const page of copiedPages) {
      const original = sourcePages.find(row => row.slug === page.slug)!
      for (const [index, section] of page.content.entries())
        for (const [key, value] of Object.entries(section.values))
          if (value && typeof value === 'object' && 'items' in value)
            expect(repeatItemKeys(value, 48)).toEqual(repeatItemKeys(original.content[index].values[key], 48))
    }
    expect(JSON.stringify(pins)).toContain('__cms_sample_fields')
    expect(JSON.stringify(pins)).toContain('\"width\":\"full\"')
    expect(
      (
        await client.query("SELECT count(*)::int AS count FROM section_defs WHERE site_id=$1 AND status='active'", [
          result.siteId,
        ])
      ).rows[0]!.count,
    ).toBe(0)
    expect(copiedPages.some(page => page.slug === 'retired-copy-page')).toBe(false)
    expect(
      (
        await client.query(
          'SELECT id,revision,draft_version_id,published_version_id,archived_at FROM pages WHERE site_id=$1 ORDER BY id',
          [source],
        )
      ).rows,
    ).toEqual(sourceBefore)
    const again = await startNationalSite(client, request, input, store)
    expect(again.siteId).toBe(result.siteId)
  })
})
it('starts from a saved set or Home only and retries without overwriting later saved work', async () => {
  for (const source of ['templates', 'home'] as const)
    await db.asUser(s.superAdmin, async client => {
      const request = randomUUID(),
        input = { name: '[Private starter]', slug: 'private-' + source, source, bringWords: false, bringStories: false }
      const first = await startNationalSite(client, request, input, store)
      const before = (await client.query('SELECT id,revision FROM pages WHERE site_id=$1 ORDER BY id', [first.siteId]))
        .rows
      expect(before).toHaveLength(source === 'templates' ? 2 : 1)
      await startNationalSite(client, request, input, store)
      expect(
        (await client.query('SELECT id,revision FROM pages WHERE site_id=$1 ORDER BY id', [first.siteId])).rows,
      ).toEqual(before)
    })
})

it('migrates the old three-slide template as a reviewed draft with every content value unchanged', async () => {
  await db.asUser(s.superAdmin, async client => {
    const entry = structuredClone(CORE_LIBRARY.find(section => section.definition.slug === 'core-feature-slider')!)
    if (entry.definition.kind !== 'legacy') throw Error('Expected the hero template')
    const latest = structuredClone(entry),
      fields = entry.definition.slots.find(slot => slot.id === 'slides')!.constraints.item as {
        fields: import('@cms/schema').SlotDef[]
      }
    entry.definition.slots = [
      { id: 'heading', kind: 'text', label: 'Heading', constraints: {} },
      ...[1, 2, 3].flatMap(n =>
        fields.fields
          .filter(field => ['title', 'intro', 'photo', 'primary', 'secondary'].includes(field.id))
          .map(field => ({ ...field, id: field.id + n })),
      ),
    ]
    entry.definition.sourceHtml =
      '<section><h1>{{heading}}</h1>' +
      [1, 2, 3]
        .map(
          n =>
            '<article>{{photo' +
            n +
            '}}<h2>{{title' +
            n +
            '}}</h2><p>{{intro' +
            n +
            '}}</p>{{primary' +
            n +
            '}}{{secondary' +
            n +
            '}}</article>',
        )
        .join('') +
      '</section>'
    entry.definition.sourceCss = ''
    const old = (
      await client.query(
        'SELECT * FROM app.upsert_section_def_version($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)',
        coreUpsertArguments(entry),
      )
    ).rows[0]!
    const values: Record<string, unknown> = { heading: '[Hero page]' }
    for (let n = 1; n <= 3; n++)
      Object.assign(values, {
        ['title' + n]: '[Heading ' + n + ']',
        ['intro' + n]: '[Description ' + n + ']',
        ['photo' + n]: { src: '/cms-samples/r8-landscape.png', alt: '[Photo ' + n + ']', decorative: false },
        ['primary' + n]: { label: '[Main ' + n + ']', url: '/main-' + n },
        ['secondary' + n]: { label: '[Second ' + n + ']', url: '/second-' + n },
      })
    const page = (await client.query("SELECT app.create_page($1,'hero-upgrade','[Hero update]') AS id", [source]))
      .rows[0]!.id
    await client.query('SELECT app.save_page_draft($1,0,$2,$3)', [
      page,
      JSON.stringify([{ section_def_id: old.section_def_id, section_def_version: old.version, values }]),
      '{}',
    ])
    await client.query(
      'SELECT * FROM app.upsert_section_def_version($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)',
      coreUpsertArguments(latest),
    )
    const plan = await reviewNationalSite(client, source),
      changed = plan.changes.find(change => change.page.id === page)!
    expect(changed.content[0]!.values.slides).toEqual({ items: ['i1', 'i2', 'i3'] })
    await applyNationalTemplate(client, [{ id: source, fingerprint: plan.review.fingerprint }])
    const saved = (
      await client.query(
        'SELECT p.published_version_id,v.content FROM pages p JOIN page_versions v ON v.id=p.draft_version_id WHERE p.id=$1',
        [page],
      )
    ).rows[0]!
    expect(saved.published_version_id).toBeNull()
    for (let n = 1; n <= 3; n++)
      for (const field of ['title', 'intro', 'photo', 'primary', 'secondary'])
        expect(saved.content[0].values['slides__i' + n + '__' + field]).toEqual(values[field + n])
  })
})

it('keeps an unfinished new hero out of the normal publication path', async () => {
  await db.asUser(s.superAdmin, async client => {
    const page = (
      await client.query(
        "SELECT p.id,p.revision,v.content,v.meta FROM pages p JOIN page_versions v ON v.id=p.draft_version_id WHERE p.site_id=$1 AND p.slug='hero-upgrade'",
        [source],
      )
    ).rows[0]!
    const entry = CORE_LIBRARY.find(entry => entry.definition.slug === 'core-feature-slider')!
    if (entry.definition.kind !== 'legacy') throw Error('Expected hero fields')
    page.content[0].values = addEditorRepeatItem(
      page.content[0].values,
      entry.definition.slots.find(slot => slot.id === 'slides')!,
    ).values
    const saved = (
      await client.query('SELECT * FROM app.save_page_draft($1,$2,$3,$4)', [
        page.id,
        page.revision,
        JSON.stringify(page.content),
        JSON.stringify(page.meta),
      ])
    ).rows[0]!
    const readiness = await evaluateVersionReadiness(client, saved.version_id, 'member')
    expect(readiness.ok).toBe(false)
    expect(readiness.blocking).toContainEqual(
      expect.objectContaining({ message: expect.stringContaining('Hero slide 4: Add a title') }),
    )
  })
})

it('retains thirteen authored hero slides through ordinary saving and the database render manifest', async () => {
  await db.asUser(s.superAdmin, async client => {
    const def = (
      await client.query(
        "SELECT d.id,v.version FROM section_defs d JOIN LATERAL(SELECT version FROM section_def_versions WHERE section_def_id=d.id ORDER BY version DESC LIMIT 1)v ON true WHERE d.slug='core-feature-slider' AND d.scope='global'",
      )
    ).rows[0]!
    const page = (await client.query("SELECT app.create_page($1,'hero-capacity','[Hero capacity]') AS id", [source]))
        .rows[0]!.id,
      keys = Array.from({ length: 13 }, (_, i) => 'i' + (i + 1)),
      values: Record<string, unknown> = { heading: '[Hero capacity]', slides: { items: keys } }
    for (const key of keys)
      Object.assign(values, {
        ['slides__' + key + '__title']: '[Story ' + key + ']',
        ['slides__' + key + '__intro']: '[Description]',
        ['slides__' + key + '__photo']: {
          src: '/cms-samples/r8-landscape.png',
          alt: '[Sample landscape]',
          decorative: false,
        },
        ['slides__' + key + '__primary']: { label: '[Read story]', url: '/story-' + key },
        ['slides__' + key + '__secondary']: { label: '', url: '' },
        ['slides__' + key + '__enabled']: 'on',
      })
    const saved = (
      await client.query('SELECT * FROM app.save_page_draft($1,0,$2,$3)', [
        page,
        JSON.stringify([{ section_def_id: def.id, section_def_version: def.version, values }]),
        '{}',
      ])
    ).rows[0]!
    const manifest = (await client.query('SELECT app.build_render_manifest($1) AS value', [saved.version_id])).rows[0]!
      .value
    expect(manifest.sections[0].instance.values.slides.items).toEqual(keys)
    expect(manifest.sections[0].instance.values.slides__i13__title).toBe('[Story i13]')
    const readiness = await evaluateVersionReadiness(client, saved.version_id, 'member')
    expect(readiness.blocking.filter(issue => issue.message.includes('Hero slide'))).toEqual([])
  })
})
