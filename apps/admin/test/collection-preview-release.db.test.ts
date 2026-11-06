import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { TestDatabase } from '@cms/schema/testing'
import { seedScenario, type Scenario } from '@cms/schema/fixtures'
import { SiteSetup, DEFAULT_THEME_TOKENS } from '@cms/schema'
import { installCoreLibrary } from '@cms/seeds/core-install'
import { starterSiteSetup } from '@cms/seeds/archetypes'
import { renderPage, type RenderManifest, type SiteShell } from '@cms/renderer'
import { mapErrors } from '@cms/domain'
let db: TestDatabase, s: Scenario, actor: string
vi.mock('server-only', () => ({}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('../src/lib/session.ts', () => ({
  currentSession: async () => ({ principal: { userId: actor } }),
  requireSession: async () => ({ principal: { userId: actor } }),
}))
vi.mock('@cms/platform', async original => ({
  ...(await original<object>()),
  asUser: (identity: { userId: string }, run: Parameters<TestDatabase['asUser']>[1]) =>
    mapErrors(() => db.asUser(identity.userId, run)),
}))
import { createSiteFromSetupInTransaction } from '../src/lib/site-creation.ts'
import { publishStarterFixture } from './site-fixture.ts'
import { getCollectionWorkspace } from '../src/lib/collection-queries.ts'
import { loadInlineList, saveInlineListItem } from '../src/app/pages/[pageId]/inline-list-actions.ts'
import { buildPreview } from '../src/lib/queries.ts'
import {
  executeSiteRelease,
  listReleaseCandidates,
  planSiteRelease,
  previewSiteReleasePage,
} from '../src/lib/releases.ts'
let siteId: string, pageId: string, versionId: string, collectionId: string
beforeAll(async () => {
  db = await TestDatabase.create('collection_preview_release')
  s = await seedScenario(db)
  actor = s.editorA
  const setup = SiteSetup.parse({
    ...starterSiteSetup('resource'),
    name: 'Preview contract site',
    slug: 'preview-contract',
  })
  await db.asUser(s.superAdmin, async client => {
    await installCoreLibrary(client)
    siteId = (
      await createSiteFromSetupInTransaction(client, randomUUID(), setup, 'preview-contract.staging.example.test')
    ).siteId
    // This suite tests real list records, not illustrative starter entries.
    for (const page of (
      await client.query(
        'SELECT p.id,p.revision,v.content,v.meta FROM pages p JOIN page_versions v ON v.id=p.draft_version_id WHERE p.site_id=$1',
        [siteId],
      )
    ).rows) {
      const content = page.content.map((section: { values: Record<string, unknown> }) => {
        const values = { ...section.values }
        delete values.__cms_sample_fields
        return { ...section, values }
      })
      await client.query('SELECT * FROM app.save_page_draft($1,$2,$3,$4)', [
        page.id,
        page.revision,
        JSON.stringify(content),
        JSON.stringify(page.meta),
      ])
    }
    await publishStarterFixture(client, siteId)
    await client.query('SELECT app.set_site_membership($1,$2,$3)', [s.editorA, siteId, 'editor'])
    await client.query('SELECT app.set_site_membership($1,$2,$3)', [s.contributorA, siteId, 'contributor'])
    const page = (
      await client.query("SELECT id,draft_version_id FROM pages WHERE site_id=$1 AND slug='resources'", [siteId])
    ).rows[0]!
    pageId = page.id
    versionId = page.draft_version_id
    collectionId = (
      await client.query("SELECT id FROM collections WHERE site_id=$1 AND reader_key='resources'", [siteId])
    ).rows[0]!.id
    await client.query('SELECT app.save_collection_entries($1,0,$2)', [
      collectionId,
      JSON.stringify([
        {
          id: null,
          stableKey: 'draft-report',
          values: { title: 'Private report for combined release', resource_url: 'https://example.test/report.pdf' },
        },
      ]),
    ])
    const theme = (await client.query('SELECT revision FROM themes WHERE site_id=$1', [siteId])).rows[0]!
    await client.query('SELECT app.save_theme_draft($1,$2,$3)', [
      siteId,
      theme.revision,
      JSON.stringify({ ...DEFAULT_THEME_TOKENS, colors: { ...DEFAULT_THEME_TOKENS.colors, primary: '#165b43' } }),
    ])
  })
})
afterAll(async () => {
  await db?.close()
})
async function live() {
  return db.as('public', async client => {
    const row = (
      await client.query<{ render_manifest: RenderManifest; shell_payload: SiteShell }>(
        'SELECT * FROM public_api.resolve_route($1,$2)',
        ['preview-contract.staging.example.test', '/resources'],
      )
    ).rows[0]!
    return renderPage({ manifest: row.render_manifest, shell: row.shell_payload, isStaging: true }).html
  })
}
async function projectionState() {
  return db.asUser(s.superAdmin, async client => ({
    routes: (
      await client.query('SELECT path,render_manifest FROM published_routes WHERE site_id=$1 ORDER BY path', [siteId])
    ).rows,
    shell: (await client.query('SELECT payload FROM published_site_shells WHERE site_id=$1', [siteId])).rows,
    collection: (
      await client.query('SELECT revision,entry_revision,published_entry_revision FROM collections WHERE id=$1', [
        collectionId,
      ])
    ).rows,
    audit: (await client.query('SELECT count(*)::int AS count FROM audit_log WHERE site_id=$1', [siteId])).rows,
  }))
}
describe('an editor previews and releases saved collection records with site appearance', () => {
  it('keeps an incomplete collection section editable without blanking the page or weakening publication', async () => {
    const liveBefore = await live()
    const source = await db.asUser(
      s.superAdmin,
      async client =>
        (await client.query('SELECT content FROM page_versions WHERE id=$1', [versionId])).rows[0]!.content,
    )
    const sectionIndex = source.findIndex((section: { values: Record<string, unknown> }) =>
      Object.values(section.values).some(
        value => typeof value === 'object' && value !== null && 'readerKey' in value && value.readerKey === 'resources',
      ),
    )
    expect(sectionIndex).toBeGreaterThanOrEqual(0)
    const field = Object.keys(source[sectionIndex].values).find(
      key => source[sectionIndex].values[key]?.readerKey === 'resources',
    )!
    const binding = source[sectionIndex].values[field]
    for (const [index, invalid] of [
      null,
      { ...binding, readerKey: '' },
      { ...binding, readerKey: 'missing_collection' },
      { ...binding, selection: { mode: 'automatic', limit: 201 } },
    ].entries()) {
      const content = structuredClone(source)
      content[sectionIndex].values[field] = invalid
      const page = await db.asUser(s.editorA, async client => {
        const id = (
          await client.query('SELECT app.create_page($1,$2,$3) AS id', [
            siteId,
            `incomplete-${index}`,
            `Incomplete ${index}`,
          ])
        ).rows[0]!.id
        const saved = (
          await client.query('SELECT * FROM app.save_page_draft($1,0,$2,$3)', [id, JSON.stringify(content), '{}'])
        ).rows[0]!
        return { id, version: saved.version_id }
      })
      for (const appearance of [false, true]) {
        const preview = await buildPreview(s.contributorA, page.version, siteId, appearance)
        expect(preview).not.toBeNull()
        const html = renderPage({ ...preview!, isStaging: true }).html
        expect(html).toContain('Choose a list in Content to finish this section.')
        expect(preview!.manifest.sections).toHaveLength(source.length)
        expect(html).not.toContain('Private report for combined release')
      }
      await expect(
        db.asUser(s.editorA, client => client.query('SELECT app.build_render_manifest($1)', [page.version])),
      ).rejects.toMatchObject({ code: 'CMS04' })
      await expect(
        db.asUser(s.contributorA, client =>
          client.query('SELECT app.build_render_manifest_core($1,false,true)', [page.version]),
        ),
      ).rejects.toMatchObject({ code: '42501' })
      expect(await live()).toBe(liveBefore)
      const saved = await db.asUser(
        s.editorA,
        async client =>
          (await client.query('SELECT * FROM app.save_page_draft($1,1,$2,$3)', [page.id, JSON.stringify(source), '{}']))
            .rows[0]!,
      )
      const repaired = await buildPreview(s.editorA, saved.version_id, siteId, false)
      expect(renderPage({ ...repaired!, isStaging: true }).html).not.toContain('Choose a list in Content')
    }
    await expect(buildPreview(s.editorB, versionId, siteId, false)).resolves.toBeNull()
  })
  it('keeps collection drafts out of both ordinary appearance preview modes', async () => {
    for (const draftAppearance of [false, true]) {
      const preview = await buildPreview(s.contributorA, versionId, siteId, draftAppearance)
      expect(preview).not.toBeNull()
      const html = renderPage({ ...preview!, isStaging: true }).html
      expect(html).not.toContain('Private report for combined release')
      expect(html).toContain('New resources will be shared here')
      if (draftAppearance) expect(html).toContain('#165b43')
    }
    expect(await live()).not.toContain('Private report for combined release')
  })
  it('projects saved list drafts only when the authenticated caller explicitly requests them', async () => {
    const before = await projectionState()
    const preview = await buildPreview(s.editorA, versionId, siteId, false, true)
    const html = renderPage({ ...preview!, isStaging: true, options: { preview: true } }).html
    expect(html).toContain('Private report for combined release')
    expect(html).toContain('data-cms-entry="draft-report"')
    expect(await projectionState()).toEqual(before)
    expect(await live()).not.toContain('Private report for combined release')
    expect(await buildPreview(s.editorB, versionId, siteId, false, true)).toBeNull()
  })
  it('edits a shared item from its page with list CAS while keeping public content unchanged', async () => {
    const loaded = await loadInlineList(pageId, 'resources')
    if (!loaded.ok) throw new Error(loaded.message)
    expect(loaded.usedOn).toContain('Resources')
    const entry = loaded.list.entries.find(entry => entry.stableKey === 'draft-report')!
    const changed = await saveInlineListItem({
      pageId,
      readerKey: 'resources',
      entryRevision: loaded.list.entryRevision,
      stableKey: entry.stableKey,
      values: { ...entry.values, title: 'Edited inside the page' },
    })
    expect(changed.ok).toBe(true)
    const preview = await buildPreview(actor, versionId, siteId, false, true)
    expect(renderPage({ ...preview!, isStaging: true }).html).toContain('Edited inside the page')
    expect(await live()).not.toContain('Edited inside the page')
    const stale = await saveInlineListItem({
      pageId,
      readerKey: 'resources',
      entryRevision: loaded.list.entryRevision,
      stableKey: entry.stableKey,
      values: entry.values,
    })
    expect(stale).toMatchObject({ ok: false, kind: 'conflict' })
    if (!changed.ok || !('revision' in changed)) throw new Error('Expected acknowledged list revision')
    expect(
      (
        await saveInlineListItem({
          pageId,
          readerKey: 'resources',
          entryRevision: changed.revision,
          stableKey: entry.stableKey,
          values: entry.values,
        })
      ).ok,
    ).toBe(true)
    actor = s.editorB
    try {
      expect(await loadInlineList(pageId, 'resources')).toMatchObject({ ok: false })
      expect(
        await saveInlineListItem({
          pageId,
          readerKey: 'resources',
          entryRevision: changed.revision,
          values: entry.values,
        }),
      ).toMatchObject({ ok: false })
    } finally {
      actor = s.editorA
    }
  })
  it('composes selected records and design only inside rollback preview, enforces roles, and commits once', async () => {
    const before = await projectionState()
    const selection = await listReleaseCandidates(s.superAdmin, siteId)
    expect(selection.some(item => item.type === 'collection_entries')).toBe(true)
    const plan = await planSiteRelease(s.superAdmin, randomUUID(), siteId, selection)
    // Planning writes a release record, but does not change published projections.
    const planned = await projectionState()
    expect(planned.routes).toEqual(before.routes)
    expect(planned.shell).toEqual(before.shell)
    expect(planned.collection).toEqual(before.collection)
    const html = await previewSiteReleasePage(s.superAdmin, plan.id, pageId)
    expect(html).toContain('Private report for combined release')
    expect(html).toContain('#165b43')
    expect(await projectionState()).toEqual(planned)
    await expect(previewSiteReleasePage(s.contributorA, plan.id, pageId)).rejects.toMatchObject({
      kind: 'not_authorized',
    })
    await expect(executeSiteRelease(s.contributorA, plan.id, '')).rejects.toMatchObject({ kind: 'not_authorized' })
    expect(await projectionState()).toEqual(planned)
    await executeSiteRelease(s.superAdmin, plan.id, 'Confirmed: Publish with sample content.', true)
    expect(await live()).toContain('Private report for combined release')
    const applied = await projectionState()
    await executeSiteRelease(s.superAdmin, plan.id, 'Confirmed: Publish with sample content.', true)
    expect(await projectionState()).toEqual(applied)
  })
  it('exposes old entry schema pins after a model change until records are explicitly re-saved', async () => {
    const before = (await getCollectionWorkspace(s.superAdmin, siteId, collectionId)).selected!
    expect(before.entries[0]!.schemaVersionId).toBe(before.draftSchemaVersionId)
    await db.asUser(s.superAdmin, client =>
      client.query('SELECT * FROM app.save_collection_schema($1,$2,$3,$4)', [
        collectionId,
        before.revision,
        JSON.stringify([...before.draft.fields, { key: 'edition', label: 'Edition', type: 'text', required: false }]),
        JSON.stringify(before.draft.presentation),
      ]),
    )
    const refreshed = (await getCollectionWorkspace(s.superAdmin, siteId, collectionId)).selected!
    expect(refreshed.draftSchemaVersionId).not.toBe(before.draftSchemaVersionId)
    expect(refreshed.entries[0]!.schemaVersionId).toBe(before.draftSchemaVersionId)
    expect(refreshed.entryRevision).toBe(before.entryRevision)
    await db.asUser(s.contributorA, client =>
      client.query('SELECT * FROM app.save_collection_entries($1,$2,$3)', [
        collectionId,
        refreshed.entryRevision,
        JSON.stringify(
          refreshed.entries
            .filter(entry => !entry.archived)
            .map(entry => ({ id: entry.id, stableKey: entry.stableKey, values: { ...entry.values, edition: '2026' } })),
        ),
      ]),
    )
    const migrated = (await getCollectionWorkspace(s.contributorA, siteId, collectionId)).selected!
    expect(migrated.entries[0]!.schemaVersionId).toBe(migrated.draftSchemaVersionId)
    expect(migrated.entries[0]!.values['edition']).toBe('2026')
    expect(migrated.entries[0]!.publishedValues).not.toHaveProperty('edition')
  })
})
