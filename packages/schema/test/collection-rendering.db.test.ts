import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { CHECKED_CLEAN, TestDatabase, expectSqlState } from './harness.ts'
import { seedScenario, type Scenario } from './fixtures.ts'

const SANITIZER_POLICY_VERSION = 4
const CSS_POLICY_VERSION = 6
const NO_TEMPLATE = JSON.stringify({
  nodes: [],
  policyVersion: SANITIZER_POLICY_VERSION,
  cssPolicyVersion: CSS_POLICY_VERSION,
})

const COLLECTION_FIELDS = [
  { key: 'name', label: 'Name', required: true, type: 'text' },
  { key: 'role', label: 'Role', required: true, type: 'text' },
  { key: 'bio', label: 'Biography', required: false, type: 'richtext' },
  { key: 'photo', label: 'Photo', required: false, type: 'image' },
]
const PRESENTATION = {
  schemaVersion: 1,
  titleField: 'name',
  subtitleField: 'role',
  imageField: null,
  groupField: null,
}
const REPEAT_DOC = {
  schemaVersion: 3,
  fields: [
    { name: 'heading', type: 'text', label: 'Heading' },
    { name: 'speakers', type: 'repeat', label: 'Speakers' },
  ],
  nodes: [
    {
      type: 'element',
      tag: 'section',
      attributes: { class: 'speakers' },
      children: [
        { type: 'element', tag: 'h2', children: [{ type: 'text', field: 'heading' }] },
        {
          type: 'repeat',
          field: 'speakers',
          empty: { behavior: 'message', text: 'No speakers yet.' },
          item: [
            {
              type: 'element',
              tag: 'article',
              attributes: { class: 'speaker' },
              children: [
                { type: 'element', tag: 'h3', children: [{ type: 'text', field: 'name' }] },
                { type: 'image', field: 'photo' },
                { type: 'element', tag: 'p', children: [{ type: 'text', field: 'role' }] },
                { type: 'element', tag: 'div', children: [{ type: 'richtext', field: 'bio' }] },
              ],
            },
          ],
        },
      ],
    },
  ],
}

type Collection = { collection_id: string; revision: string; entry_revision: string }
type Entry = { id: string; stable_key: string }
type Manifest = {
  dependency_revision: string
  page: { version_id: string }
  sections: Array<{ instance: { values: Record<string, unknown> } }>
}

describe('published collections resolve into immutable page manifests', () => {
  let db: TestDatabase
  let s: Scenario
  let defId: string

  beforeAll(async () => {
    db = await TestDatabase.create('collection_render')
    s = await seedScenario(db)
    defId = await db.asUser(
      s.superAdmin,
      async client =>
        (
          await client.query<{ section_def_id: string }>(
            'SELECT section_def_id FROM app.upsert_section_def_version' +
              '($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)',
            [
              'speakers-listing',
              'Speakers listing',
              'Collections',
              '',
              '.speakers{display:grid}',
              '.cms-section--speakers-listing .speakers{display:grid}',
              NO_TEMPLATE,
              JSON.stringify(
                REPEAT_DOC.fields.map(field => ({
                  id: field.name,
                  kind: field.type,
                  label: field.label,
                  constraints: {},
                })),
              ),
              'speakers-hash',
              SANITIZER_POLICY_VERSION,
              CSS_POLICY_VERSION,
              'collection rendering test',
              false,
              'structured',
              JSON.stringify(REPEAT_DOC),
              3,
            ],
          )
        ).rows[0]!.section_def_id,
    )
  })
  afterAll(async () => db.close())

  async function collection(readerKey = 'speakers'): Promise<Collection> {
    return db.asUser(s.superAdmin, async client => {
      const created = (
        await client.query<Collection>('SELECT * FROM app.create_collection($1,$2,$3,$4,$5::jsonb,$6::jsonb)', [
          s.siteA,
          `speakers-${readerKey.replaceAll('_', '-')}`,
          'Speakers',
          readerKey,
          JSON.stringify(COLLECTION_FIELDS),
          JSON.stringify(PRESENTATION),
        ])
      ).rows[0]!
      await client.query('SELECT * FROM app.publish_collection_schema($1,$2)', [
        created.collection_id,
        created.revision,
      ])
      return created
    })
  }

  const entry = (id: string | null, stableKey: string, name: string) => ({
    id,
    stableKey,
    values: { name, role: 'Speaker', bio: `<p>${name} biography.</p>` },
  })

  async function saveEntries(collectionId: string, revision: number, entries: unknown[]): Promise<number> {
    return db.asUser(s.contributorA, async client =>
      Number(
        (
          await client.query<{ entry_revision: string }>('SELECT * FROM app.save_collection_entries($1,$2,$3::jsonb)', [
            collectionId,
            revision,
            JSON.stringify(entries),
          ])
        ).rows[0]!.entry_revision,
      ),
    )
  }

  async function publishEntries(collectionId: string, revision: number): Promise<number> {
    return db.asUser(s.editorA, async client =>
      Number(
        (
          await client.query<{ entry_revision: string }>('SELECT * FROM app.publish_collection_entries($1,$2)', [
            collectionId,
            revision,
          ])
        ).rows[0]!.entry_revision,
      ),
    )
  }

  async function entries(collectionId: string): Promise<Entry[]> {
    return db.asUser(
      s.superAdmin,
      async client =>
        (
          await client.query<Entry>(
            'SELECT id,stable_key FROM collection_entries WHERE collection_id=$1 ORDER BY sort_index',
            [collectionId],
          )
        ).rows,
    )
  }

  async function page(
    readerKey: string,
    slug: string,
    selection: unknown = { mode: 'automatic', limit: 10 },
  ): Promise<{ pageId: string; versionId: string }> {
    return db.asUser(s.editorA, async client => {
      const pageId = (
        await client.query<{ id: string }>('SELECT app.create_page($1,$2,$3) AS id', [s.siteA, slug, 'Speakers'])
      ).rows[0]!.id
      const content = [
        {
          section_def_id: defId,
          section_def_version: 1,
          label: 'Speakers',
          hidden: false,
          hidden_at: [],
          values: {
            heading: 'Featured speakers',
            speakers: { readerKey, selection },
          },
        },
      ]
      const saved = (
        await client.query<{ version_id: string; revision: string }>('SELECT * FROM app.save_page_draft($1,0,$2,$3)', [
          pageId,
          JSON.stringify(content),
          '{}',
        ])
      ).rows[0]!
      await client.query('SELECT app.publish_page($1,$2,$3,$4,$5)', [pageId, Number(saved.revision), ...CHECKED_CLEAN])
      return { pageId, versionId: saved.version_id }
    })
  }

  async function route(pageId: string): Promise<Manifest> {
    return db.as(
      'owner',
      async client =>
        (
          await client.query<{ manifest: Manifest }>(
            'SELECT render_manifest AS manifest FROM published_routes WHERE page_id=$1',
            [pageId],
          )
        ).rows[0]!.manifest,
    )
  }

  function resolved(manifest: Manifest) {
    return manifest.sections[0]!.instance.values['speakers'] as {
      collectionId: string
      publishedEntryRevision: string
      entries: Array<{ stableKey: string; values: { name: string } }>
    }
  }

  it('pins published schema and entry identities and rebuilds only dependent live routes', async () => {
    const created = await collection('event_speakers')
    let revision = await saveEntries(created.collection_id, 0, [
      entry(null, 'ada', 'Ada'),
      entry(null, 'grace', 'Grace'),
    ])
    revision = await publishEntries(created.collection_id, revision)
    const dependent = await page('event_speakers', 'speakers')
    const unrelated = await db.asUser(s.editorA, async client => {
      const pageId = (
        await client.query<{ id: string }>('SELECT app.create_page($1,$2,$3) AS id', [
          s.siteA,
          'unrelated',
          'Unrelated',
        ])
      ).rows[0]!.id
      const saved = (
        await client.query<{ revision: string }>('SELECT * FROM app.save_page_draft($1,0,$2,$3)', [
          pageId,
          JSON.stringify([]),
          '{}',
        ])
      ).rows[0]!
      await client.query('SELECT app.publish_page($1,$2,$3,$4,$5)', [pageId, Number(saved.revision), ...CHECKED_CLEAN])
      return pageId
    })
    const before = await route(dependent.pageId)
    const unrelatedBefore = await route(unrelated)
    expect(resolved(before).entries.map(item => item.values.name)).toEqual(['Ada', 'Grace'])
    expect(resolved(before).publishedEntryRevision).toBe('2')
    expect(before.page.version_id).toBe(dependent.versionId)

    const ids = await entries(created.collection_id)
    revision = await saveEntries(created.collection_id, revision, [
      entry(ids[1]!.id, 'grace', 'Grace'),
      entry(ids[0]!.id, 'ada', 'Ada'),
    ])
    expect((await route(dependent.pageId)).dependency_revision).toBe(before.dependency_revision)
    await publishEntries(created.collection_id, revision)

    const after = await route(dependent.pageId)
    expect(resolved(after).entries.map(item => item.values.name)).toEqual(['Grace', 'Ada'])
    expect(after.page.version_id).toBe(dependent.versionId)
    expect(after.dependency_revision).not.toBe(before.dependency_revision)
    expect((await route(unrelated)).dependency_revision).toBe(unrelatedBefore.dependency_revision)
    const events = await db.as('owner', client =>
      client.query<{ payload: { paths?: string[] } }>(
        `SELECT payload FROM outbox
        WHERE event_type='collection.entries.published'
          AND payload->>'collection_id'=$1 ORDER BY created_at`,
        [created.collection_id],
      ),
    )
    expect(events.rows).toHaveLength(2)
    expect(events.rows.every(row => Array.isArray(row.payload.paths))).toBe(true)
    expect(events.rows.at(-1)!.payload.paths).toEqual(['/speakers'])
  })

  it('publishing zero entries authoritatively empties an already-live listing', async () => {
    const created = await collection('emptyable_speakers')
    let revision = await saveEntries(created.collection_id, 0, [entry(null, 'one', 'One')])
    revision = await publishEntries(created.collection_id, revision)
    const published = await page('emptyable_speakers', 'emptyable-speakers')
    expect(resolved(await route(published.pageId)).entries).toHaveLength(1)
    revision = await saveEntries(created.collection_id, revision, [])
    await publishEntries(created.collection_id, revision)
    expect(resolved(await route(published.pageId)).entries).toEqual([])
  })

  it('refuses missing and cross-site bindings rather than publishing an empty-looking page', async () => {
    await expectSqlState(page('missing_collection', 'missing-collection'), 'CMS04')
    const other = await db.asUser(
      s.superAdmin,
      async client =>
        (
          await client.query<Collection>('SELECT * FROM app.create_collection($1,$2,$3,$4,$5::jsonb,$6::jsonb)', [
            s.siteB,
            'private-speakers',
            'Private speakers',
            'private_speakers',
            JSON.stringify(COLLECTION_FIELDS),
            JSON.stringify(PRESENTATION),
          ])
        ).rows[0]!,
    )
    await db.asUser(s.superAdmin, client =>
      client.query('SELECT * FROM app.publish_collection_schema($1,$2)', [other.collection_id, other.revision]),
    )
    await expectSqlState(page('private_speakers', 'cross-site-collection'), 'CMS04')
  })

  it('refuses an item subtree whose field type is incompatible with the collection schema', async () => {
    const created = await collection('incompatible_speakers')
    const badDoc = structuredClone(REPEAT_DOC)
    const item = badDoc.nodes[0]!.children[1]!.item![0]!
    item.children[0]!.children = [{ type: 'richtext', field: 'name' }]
    await db.asUser(s.superAdmin, async client => {
      const stored = await client.query<{ section_def_id: string }>(
        'SELECT section_def_id FROM app.upsert_section_def_version' +
          '($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)',
        [
          'bad-speakers-listing',
          'Bad listing',
          'Collections',
          '',
          '',
          '',
          NO_TEMPLATE,
          JSON.stringify(
            REPEAT_DOC.fields.map(field => ({ id: field.name, kind: field.type, label: field.label, constraints: {} })),
          ),
          'bad-speakers-hash',
          SANITIZER_POLICY_VERSION,
          CSS_POLICY_VERSION,
          'incompatible collection test',
          false,
          'structured',
          JSON.stringify(badDoc),
          3,
        ],
      )
      const pageId = (
        await client.query<{ id: string }>('SELECT app.create_page($1,$2,$3) AS id', [
          s.siteA,
          'bad-speakers',
          'Bad speakers',
        ])
      ).rows[0]!.id
      const content = [
        {
          section_def_id: stored.rows[0]!.section_def_id,
          section_def_version: 1,
          label: 'Bad',
          hidden: false,
          hidden_at: [],
          values: {
            heading: 'Bad',
            speakers: {
              readerKey: 'incompatible_speakers',
              selection: { mode: 'automatic', limit: 10 },
            },
          },
        },
      ]
      const version = (
        await client.query<{ version_id: string }>('SELECT * FROM app.save_page_draft($1,0,$2,$3)', [
          pageId,
          JSON.stringify(content),
          '{}',
        ])
      ).rows[0]!.version_id
      await expectSqlState(client.query('SELECT app.build_render_manifest($1)', [version]), 'CMS04')
    })
    expect(created.collection_id).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('serves shared media only when the exact published entry is selected in a live manifest', async () => {
    const readyMedia = async (label: string) =>
      db.as('owner', async client => {
        const id = (
          await client.query<{ id: string }>(
            `INSERT INTO media(site_id,object_key,content_hash,original_name,alt_text,decorative,
          width,height,bytes,mime_type,status,uploaded_by)
         VALUES(NULL,$1,$2,$3,$4,false,1600,900,240000,'image/jpeg','ready',$5) RETURNING id`,
            [
              `media/repeat/${randomUUID()}/original.jpg`,
              randomUUID().replaceAll('-', '').padEnd(64, 'a'),
              `${label}.jpg`,
              label,
              s.superAdmin,
            ],
          )
        ).rows[0]!.id
        await client.query(
          `INSERT INTO media_variants(media_id,kind,object_key,width,height,bytes,mime_type,content_hash)
         VALUES($1,'wide',$2,1600,900,220000,'image/webp',$3)`,
          [id, `media/repeat/${id}/wide.webp`, randomUUID().replaceAll('-', '').padEnd(64, 'b')],
        )
        return id
      })
    const selectedMedia = await readyMedia('Selected speaker')
    const unselectedMedia = await readyMedia('Unselected speaker')
    const created = await collection('manual_speakers')
    let revision = await saveEntries(created.collection_id, 0, [
      {
        ...entry(null, 'selected', 'Selected'),
        values: {
          name: 'Selected',
          role: 'Speaker',
          bio: '',
          photo: { src: `/media/${selectedMedia}/wide`, alt: 'Selected speaker', decorative: false },
        },
      },
      {
        ...entry(null, 'unselected', 'Unselected'),
        values: {
          name: 'Unselected',
          role: 'Speaker',
          bio: '',
          photo: { src: `/media/${unselectedMedia}/wide`, alt: 'Unselected speaker', decorative: false },
        },
      },
    ])
    revision = await publishEntries(created.collection_id, revision)
    await page('manual_speakers', 'manual-speakers', { mode: 'manual', stableKeys: ['selected'] })
    const resolve = (mediaId: string) =>
      db.as('public', client =>
        client.query("SELECT media_id FROM public_api.resolve_media($1,$2,'wide')", [
          'site-a.staging.example.test',
          mediaId,
        ]),
      )
    expect((await resolve(selectedMedia)).rows).toEqual([{ media_id: selectedMedia }])
    expect((await resolve(unselectedMedia)).rows).toEqual([])
    expect(revision).toBeGreaterThan(0)
  })
})
