import { beforeAll, afterAll, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { TestDatabase, expectSqlState, CHECKED_CLEAN } from './harness.ts'
import { seedScenario, type Scenario } from './fixtures.ts'
import { compileSection, sectionScopeSelector, renderSection } from '../../renderer/src/index.ts'
let db: TestDatabase, s: Scenario, definition: string, listId: string, pageId: string, versionId: string
const slots = [
  {
    id: 'workshops',
    kind: 'repeat' as const,
    label: 'Workshops',
    constraints: {
      collection: true,
      item: {
        unit: 'Workshop',
        fields: [
          { id: 'title', kind: 'text', label: 'Title' },
          { id: 'presenter', kind: 'text', label: 'Presenter' },
        ],
      },
    },
  },
]
const html =
    '<div class="source"><table data-toggle="table"><tbody>{{#workshops}}<tr><th>{{title}}</th><td>{{presenter}}</td></tr>{{/workshops}}</tbody></table></div>',
  compiled = compileSection({ sourceHtml: html, slots, scopeSelector: sectionScopeSelector('original-workshops')! })
const fields = [
    { key: 'title', label: 'Title', type: 'text', required: true },
    { key: 'presenter', label: 'Presenter', type: 'text', required: false },
  ],
  presentation = {
    schemaVersion: 1,
    titleField: 'title',
    subtitleField: 'presenter',
    imageField: null,
    groupField: null,
  }
const binding = (readerKey = 'workshops', limit = 200) => ({ readerKey, selection: { mode: 'automatic', limit } })
beforeAll(async () => {
  db = await TestDatabase.create('original_lists')
  s = await seedScenario(db)
  await db.asUser(s.superAdmin, async c => {
    const list = (
      await c.query('SELECT * FROM app.create_collection($1,$2,$3,$4,$5,$6)', [
        s.siteA,
        'workshops',
        'Workshops',
        'workshops',
        JSON.stringify(fields),
        JSON.stringify(presentation),
      ])
    ).rows[0]!
    listId = list.collection_id
    await c.query('SELECT * FROM app.publish_collection_schema($1,$2)', [listId, list.revision])
    const saved = (
      await c.query('SELECT * FROM app.save_collection_entries($1,0,$2)', [
        listId,
        JSON.stringify(
          Array.from({ length: 125 }, (_, i) => ({
            id: null,
            stableKey: 'workshop-' + i,
            values: { title: 'Workshop ' + i, presenter: 'Presenter ' + i },
          })),
        ),
      ])
    ).rows[0]!
    await c.query('SELECT * FROM app.publish_collection_entries($1,$2)', [listId, saved.entry_revision])
    definition = (
      await c.query(
        'SELECT section_def_id FROM app.upsert_section_def_version($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)',
        [
          'original-workshops',
          'Workshops',
          'Better Together',
          html,
          '',
          compiled.css,
          JSON.stringify(compiled.ast),
          JSON.stringify(slots),
          compiled.renderHash,
          compiled.ast.policyVersion,
          compiled.ast.cssPolicyVersion,
          'Original template with native Lists',
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
    const page = (
      await c.query('SELECT * FROM app.save_page_draft($1,0,$2,$3)', [
        pageId,
        JSON.stringify([{ section_def_id: definition, section_def_version: 1, values: { workshops: binding() } }]),
        '{}',
      ])
    ).rows[0]!
    versionId = page.version_id
    await c.query('SELECT app.publish_page($1,$2,$3,$4,$5)', [pageId, page.revision, ...CHECKED_CLEAN])
  })
})
afterAll(async () => {
  await db?.close()
})
const manifest = async () =>
  db.as(
    'owner',
    async c =>
      (await c.query('SELECT render_manifest FROM published_routes WHERE page_id=$1', [pageId])).rows[0]!
        .render_manifest,
  )
it('publishes all125 workshop rows through the existing immutable manifest and shared sanitizer', async () => {
  const m = await manifest(),
    section = m.sections[0]
  expect(section.instance.values.workshops.entries).toHaveLength(125)
  expect(renderSection(section, 0).match(/<tr>/g) ?? []).toHaveLength(125)
  expect(renderSection(section, 0)).toContain('<th>Workshop 124</th><td>Presenter 124</td>')
  expect(section.def.definition_kind).toBe('legacy')
})
it('keeps unpublished list drafts out of the visitor manifest; publication rebuilds the same page version', async () => {
  const before = await manifest()
  await db.asUser(s.contributorA, async c => {
    const head = (await c.query('SELECT entry_revision FROM collections WHERE id=$1', [listId])).rows[0]!,
      rows = (
        await c.query(
          'SELECT e.id,e.stable_key,v.values FROM collection_entries e JOIN collection_entry_versions v ON v.id=e.draft_version_id WHERE e.collection_id=$1 AND e.archived_at IS NULL ORDER BY e.sort_index',
          [listId],
        )
      ).rows
    rows.push({ id: null, stable_key: 'new-workshop', values: { title: 'New workshop', presenter: 'Coordinator' } })
    await c.query('SELECT * FROM app.save_collection_entries($1,$2,$3)', [
      listId,
      head.entry_revision,
      JSON.stringify(rows.map(row => ({ id: row.id, stableKey: row.stable_key, values: row.values }))),
    ])
  })
  expect((await manifest()).sections[0].instance.values.workshops.entries).toHaveLength(125)
  await db.asUser(s.editorA, async c => {
    const head = (await c.query('SELECT entry_revision FROM collections WHERE id=$1', [listId])).rows[0]!
    await c.query('SELECT * FROM app.publish_collection_entries($1,$2)', [listId, head.entry_revision])
  })
  const after = await manifest()
  expect(after.page.version_id).toBe(before.page.version_id)
  expect(after.dependency_revision).not.toBe(before.dependency_revision)
  expect(after.sections[0].instance.values.workshops.entries).toHaveLength(126)
})
it('refuses foreign/missing lists and selections over200 on the strict public resolver', async () => {
  for (const value of [binding('missing'), binding('workshops', 201)])
    await expectSqlState(
      db.asUser(s.editorA, async c => {
        const page = (
          await c.query("SELECT app.create_page($1,$2,'Invalid list') AS id", [
            s.siteA,
            'invalid-' + Math.random().toString(36).slice(2),
          ])
        ).rows[0]!.id
        const saved = (
          await c.query('SELECT * FROM app.save_page_draft($1,0,$2,$3)', [
            page,
            JSON.stringify([{ section_def_id: definition, section_def_version: 1, values: { workshops: value } }]),
            '{}',
          ])
        ).rows[0]!
        await c.query('SELECT app.publish_page($1,$2,$3,$4,$5)', [page, saved.revision, ...CHECKED_CLEAN])
      }),
      'CMS04',
    )
})
it('keeps a siteB list out of siteA and accepts125 on the initial-preview path', async () => {
  await db.asUser(s.superAdmin, async c => {
    const foreign = (
      await c.query('SELECT * FROM app.create_collection($1,$2,$3,$4,$5,$6)', [
        s.siteB,
        'foreign-workshops',
        'Other site workshops',
        'other_workshops',
        JSON.stringify(fields),
        JSON.stringify(presentation),
      ])
    ).rows[0]!
    await c.query('SELECT * FROM app.publish_collection_schema($1,$2)', [foreign.collection_id, foreign.revision])
  })
  await expectSqlState(
    db.as('owner', c =>
      c.query('SELECT app.resolve_collection_repeat($1,$2,$3,$4)', [
        s.siteA,
        'other_workshops',
        JSON.stringify({ mode: 'automatic', limit: 125 }),
        JSON.stringify([{ type: 'text', field: 'title' }]),
      ]),
    ),
    'CMS04',
  )
  const value = (
    await db.as('owner', c =>
      c.query('SELECT app.resolve_initial_preview_repeat($1,$2,$3,$4) AS value', [
        s.siteA,
        'workshops',
        JSON.stringify({ mode: 'automatic', limit: 125 }),
        JSON.stringify([{ type: 'text', field: 'title' }]),
      ]),
    )
  ).rows[0]!.value
  expect(value.entries).toHaveLength(125)
})
it('uses the same200 cap for dynamic choices, not only the automatic path', async () => {
  const selected = (
    await db.as('owner', c =>
      c.query('SELECT app.normalize_list_selection($1,$2,$3,false) AS value', [
        s.siteA,
        'workshops',
        JSON.stringify({ mode: 'automatic', limit: 125, order: 'newest' }),
      ]),
    )
  ).rows[0]!.value
  expect(selected.mode).toBe('manual')
  expect(selected.stableKeys).toHaveLength(125)
  await expectSqlState(
    db.as('owner', c =>
      c.query('SELECT app.normalize_list_selection($1,$2,$3,false)', [
        s.siteA,
        'workshops',
        JSON.stringify({ mode: 'automatic', limit: 201, order: 'newest' }),
      ]),
    ),
    'CMS04',
  )
})
it('reapplies the list migrations without layering wrappers or changing126 published rows', async () => {
  await db.as('owner', async c => {
    for (let round = 0; round < 2; round++)
      for (const file of [
        '0139_bounded_event_lists.sql',
        '0140_original_template_lists.sql',
        '0141_bounded_filtered_lists.sql',
        '0142_template_list_field_metadata.sql',
      ])
        await c.query(readFileSync(new URL('../migrations/' + file, import.meta.url), 'utf8'))
  })
  expect((await manifest()).sections[0].instance.values.workshops.entries).toHaveLength(126)
  expect(
    (
      await db.as('owner', c =>
        c.query('SELECT app.build_render_manifest_core($1,false,false) AS manifest', [versionId]),
      )
    ).rows[0]!.manifest.sections[0].instance.values.workshops.entries,
  ).toHaveLength(126)
})
it('grants only rendered item sinks, refusing manual shadows, unused images and malformed envelopes', async () => {
  const imageSlots = [
      {
        id: 'logos',
        kind: 'repeat' as const,
        label: 'Sponsors',
        constraints: { collection: true, item: { fields: [{ id: 'photo', kind: 'image', label: 'Logo' }] } },
      },
    ],
    image = compileSection({
      sourceHtml: '<div>{{#logos}}<img src="{{photo}}" alt="{{photo}}">{{/logos}}</div>',
      slots: imageSlots,
    }),
    component = { definition_kind: 'legacy', compiled_ast: image.ast, slots: imageSlots },
    schema = '22222222-2222-4222-a222-222222222222',
    photo = { src: '/images/used.svg', alt: 'Sponsor', decorative: false },
    unused = { src: '/images/private.svg', alt: 'Unused', decorative: false },
    envelope = {
      kind: 'collection',
      collectionId: '11111111-1111-4111-a111-111111111111',
      readerKey: 'sponsors',
      publishedSchemaVersionId: schema,
      publishedSchemaRevision: '1',
      publishedEntryRevision: '1',
      schemas: [
        {
          id: schema,
          revision: '1',
          fields: [
            { key: 'name', label: 'Name', type: 'text', required: true },
            { key: 'photo', label: 'Logo', type: 'image', required: true },
            { key: 'unused', label: 'Unused', type: 'image', required: false },
          ],
        },
      ],
      entries: [
        {
          id: '33333333-3333-4333-a333-333333333333',
          stableKey: 'sponsor',
          schemaVersionId: schema,
          values: { name: 'Sponsor', photo, unused },
        },
      ],
    }
  const uses = (value: unknown, path: string) =>
    db.as(
      'owner',
      async c =>
        (
          await c.query('SELECT app.page_component_uses_url_pattern($1,$2,$3) AS allowed', [
            JSON.stringify(component),
            JSON.stringify(value),
            path,
          ])
        ).rows[0]!.allowed,
    )
  expect(await uses({ logos: envelope }, '/images/used.svg')).toBe(true)
  expect(await uses({ logos: envelope }, '/images/private.svg')).toBe(false)
  expect(await uses({ logos: { ...envelope, items: ['i1'] }, logos__i1__photo: unused }, '/images/private.svg')).toBe(
    false,
  )
  expect(await uses({ logos: { ...envelope, items: ['i1'] } }, '/images/used.svg')).toBe(false)
  const extra = structuredClone(envelope)
  Object.assign(extra.entries[0]!.values, { unknown: 'Extra' })
  expect(await uses({ logos: extra }, '/images/used.svg')).toBe(false)
  const later = structuredClone(envelope)
  later.entries.push({
    ...later.entries[0]!,
    id: '44444444-4444-4444-a444-444444444444',
    stableKey: 'invalid',
    values: { name: 'Bad', photo: { ...photo, alt: '' }, unused },
  })
  expect(await uses({ logos: later }, '/images/used.svg')).toBe(false)
})

it('refuses malformed nested metadata before it can grant an invisible image', async () => {
  const photo = { id: 'photo', kind: 'image', label: 'Logo' },
    base = [
      {
        id: 'logos',
        kind: 'repeat' as const,
        label: 'Sponsors',
        constraints: { collection: true, item: { fields: [photo] } },
      },
    ],
    compiled = compileSection({
      sourceHtml: '<div>{{#logos}}<img src="{{photo}}" alt="{{photo}}">{{/logos}}</div>',
      slots: base,
    })
  for (const patch of [{ label: '' }, { label: '\u00a0' }, { label: true }, { id: true }, { kind: true }]) {
    const component = {
      definition_kind: 'legacy',
      compiled_ast: compiled.ast,
      slots: [{ ...base[0], constraints: { collection: true, item: { fields: [{ ...photo, ...patch }] } } }],
    }
    const result = (
      await db.as('owner', c =>
        c.query('SELECT app.legacy_collection_repeat_descriptors($1) AS value', [JSON.stringify(component)]),
      )
    ).rows[0]!.value
    expect(result).toBeNull()
  }
})
