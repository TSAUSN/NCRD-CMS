import { beforeAll, afterAll, it, expect, vi } from 'vitest'
import { TestDatabase, CHECKED_CLEAN } from '@cms/schema/testing'
import { seedScenario, type Scenario } from '@cms/schema/fixtures'
import { compileSection, renderSection, type RenderManifest } from '@cms/renderer'
import { mapErrors } from '@cms/domain'
let db: TestDatabase,
  s: Scenario,
  actor: string,
  pageId: string,
  versionId: string,
  definitionId: string,
  listId: string
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
import { readCollectionBindingOptions } from '../src/lib/collection-binding-options.ts'
import { withDraftListPreview } from '../src/lib/draft-list-preview.ts'
import { loadInlineList, saveInlineListItem } from '../src/app/pages/[pageId]/inline-list-actions.ts'
const fields = [
    { key: 'title', label: 'Workshop title', type: 'text', required: false },
    { key: 'presenter', label: 'Presenter', type: 'text', required: false },
  ],
  slots = [
    {
      id: 'workshops',
      kind: 'repeat' as const,
      label: 'Workshops',
      constraints: {
        collection: true,
        item: {
          unit: 'Workshop',
          fields: [
            { id: 'title', kind: 'text', label: 'Workshop title' },
            { id: 'presenter', kind: 'text', label: 'Presenter' },
          ],
        },
      },
    },
  ],
  sourceHtml =
    '<div><table data-toggle="table"><tbody>{{#workshops}}<tr><th>{{title}}</th><td>{{presenter}}</td></tr>{{/workshops}}</tbody></table></div>'
beforeAll(async () => {
  db = await TestDatabase.create('original_editor')
  s = await seedScenario(db)
  actor = s.editorA
  await db.asUser(s.superAdmin, async c => {
    const list = (
      await c.query('SELECT * FROM app.create_collection($1,$2,$3,$4,$5,$6)', [
        s.siteA,
        'workshops',
        'Workshops',
        'workshops',
        JSON.stringify(fields),
        JSON.stringify({
          schemaVersion: 1,
          titleField: 'title',
          subtitleField: 'presenter',
          imageField: null,
          groupField: null,
        }),
      ])
    ).rows[0]!
    listId = list.collection_id
    await c.query('SELECT * FROM app.publish_collection_schema($1,$2)', [listId, list.revision])
    await c.query('SELECT * FROM app.save_collection_entries($1,0,$2)', [
      listId,
      JSON.stringify([
        { id: null, stableKey: 'original', values: { title: 'Original workshop', presenter: 'Original presenter' } },
        { id: null, stableKey: 'source-blank', values: { title: '', presenter: '' } },
      ]),
    ])
    await c.query('SELECT * FROM app.publish_collection_entries($1,1)', [listId])
    const compiled = compileSection({ sourceHtml, slots })
    definitionId = (
      await c.query(
        'SELECT section_def_id FROM app.upsert_section_def_version($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)',
        [
          'original-editor-workshops',
          'Workshops',
          'Better Together',
          sourceHtml,
          '',
          '',
          JSON.stringify(compiled.ast),
          JSON.stringify(slots),
          compiled.renderHash,
          compiled.ast.policyVersion,
          compiled.ast.cssPolicyVersion,
          'Original native list',
          false,
          'legacy',
          null,
          null,
          'site',
          s.siteA,
        ],
      )
    ).rows[0]!.section_def_id
    pageId = (await c.query("SELECT app.create_page($1,'workshops','Workshops') AS id", [s.siteA])).rows[0]!.id
    const saved = (
      await c.query('SELECT * FROM app.save_page_draft($1,0,$2,$3)', [
        pageId,
        JSON.stringify([
          {
            section_def_id: definitionId,
            section_def_version: 1,
            values: { workshops: { readerKey: 'workshops', selection: { mode: 'automatic', limit: 200 } } },
          },
        ]),
        '{}',
      ])
    ).rows[0]!
    versionId = saved.version_id
    await c.query('SELECT app.publish_page($1,$2,$3,$4,$5)', [pageId, saved.revision, ...CHECKED_CLEAN])
  })
})
afterAll(async () => {
  await db?.close()
})
it('offers compatible native list choices only for the original declared field and same site', async () => {
  const options = await db.asUser(s.editorA, c =>
    readCollectionBindingOptions(c, s.siteA, definitionId, 1, 'workshops'),
  )
  expect(options).toHaveLength(1)
  expect(options![0]).toMatchObject({ readerKey: 'workshops', compatible: true, problem: null })
  expect(options![0]!.entries).toHaveLength(2)
  expect(
    await db.asUser(s.superAdmin, c => readCollectionBindingOptions(c, s.siteB, definitionId, 1, 'workshops')),
  ).toBeNull()
  expect(
    await db.asUser(s.editorA, c => readCollectionBindingOptions(c, s.siteA, definitionId, 1, 'missing')),
  ).toBeNull()
})
it('requires a title for new items, preserves the source blank row, and projects drafts only privately', async () => {
  const loaded = await loadInlineList(pageId, 'workshops')
  if (!loaded.ok) throw new Error(loaded.message)
  expect(
    await saveInlineListItem({
      pageId,
      readerKey: 'workshops',
      entryRevision: loaded.list.entryRevision,
      values: { title: '', presenter: '' },
    }),
  ).toMatchObject({ ok: false, message: 'Workshop title is required.' })
  expect(
    await saveInlineListItem({
      pageId,
      readerKey: 'workshops',
      entryRevision: loaded.list.entryRevision,
      values: { title: 'A coordinator addition', presenter: 'Coordinator' },
    }),
  ).toMatchObject({ ok: true })
  const live = (
    await db.as('owner', c => c.query('SELECT render_manifest FROM published_routes WHERE page_id=$1', [pageId]))
  ).rows[0]!.render_manifest as RenderManifest
  expect(renderSection(live.sections[0]!, 0)).not.toContain('A coordinator addition')
  const preview = await db.asUser(s.editorA, c => withDraftListPreview(c, structuredClone(live), versionId, s.siteA))
  expect(renderSection(preview.sections[0]!, 0)).toContain('<th>A coordinator addition</th><td>Coordinator</td>')
  expect(renderSection(preview.sections[0]!, 0)).toContain('<tr><th></th><td></td></tr>')
  actor = s.editorB
  expect(await loadInlineList(pageId, 'workshops')).toMatchObject({ ok: false })
  actor = s.editorA
})
