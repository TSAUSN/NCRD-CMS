import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { seedScenario, type Scenario } from './fixtures.ts'
import { expectSqlState, TestDatabase } from './harness.ts'

const FIELDS = [
  { key: 'title', label: ' Title ', required: true, type: 'text' },
  { key: 'summary', label: 'Summary', required: false, help: ' Short copy ', type: 'richtext' },
  { key: 'count', label: 'Count', required: false, type: 'number' },
  { key: 'date', label: 'Date', required: false, type: 'date' },
  { key: 'link', label: 'Link', required: false, type: 'url' },
  { key: 'picture', label: 'Picture', required: false, type: 'image' },
  { key: 'featured', label: 'Featured', required: false, type: 'boolean' },
  { key: 'kind', label: 'Kind', required: true, type: 'select', options: [' News ', 'Event'] },
]
const PRESENTATION = {
  schemaVersion: 1,
  titleField: 'title',
  subtitleField: 'summary',
  imageField: 'picture',
  groupField: 'kind',
}

type Created = { collection_id: string; schema_version_id: string; revision: string; entry_revision: string }
let counter = 0

describe('collection schema and entry workspaces', () => {
  let db: TestDatabase
  let scenario: Scenario

  beforeAll(async () => {
    db = await TestDatabase.create('collections')
    scenario = await seedScenario(db)
  })
  afterAll(async () => db.close())

  async function create(fields: unknown = FIELDS, presentation: unknown = PRESENTATION): Promise<Created> {
    counter += 1
    return db.asUser(scenario.superAdmin, async client => {
      const result = await client.query<Created>(
        'SELECT * FROM app.create_collection($1,$2,$3,$4,$5::jsonb,$6::jsonb)',
        [
          scenario.siteA,
          `collection-${counter}`,
          `Collection ${counter}`,
          `collection_${counter}`,
          JSON.stringify(fields),
          JSON.stringify(presentation),
        ],
      )
      return result.rows[0]!
    })
  }

  async function publishSchema(collection: Created): Promise<number> {
    return db.asUser(scenario.superAdmin, async client => {
      const result = await client.query<{ revision: string }>('SELECT * FROM app.publish_collection_schema($1,$2)', [
        collection.collection_id,
        collection.revision,
      ])
      return Number(result.rows[0]!.revision)
    })
  }

  const entry = (
    stableKey: string,
    title = stableKey,
    id: string | null = null,
    extra: Record<string, unknown> = {},
  ) => ({
    id,
    stableKey,
    values: { title, kind: 'News', ...extra },
  })

  it('creates a private schema with normalized labels, help, and choices', async () => {
    const created = await create()
    expect(Number(created.revision)).toBe(1)
    expect(Number(created.entry_revision)).toBe(0)
    await db.asUser(scenario.superAdmin, async client => {
      const row = (
        await client.query<{ fields: typeof FIELDS; published_schema_version_id: string | null }>(
          `SELECT version.fields, collection.published_schema_version_id
           FROM collections collection JOIN collection_schema_versions version
             ON version.id=collection.draft_schema_version_id WHERE collection.id=$1`,
          [created.collection_id],
        )
      ).rows[0]!
      expect(row.fields[0]!.label).toBe('Title')
      expect(row.fields[1]!.help).toBe('Short copy')
      expect((row.fields[7] as { options: string[] }).options).toEqual(['News', 'Event'])
      expect(row.published_schema_version_id).toBeNull()
    })
  })

  it('requires site administrators for schema commands', async () => {
    await expectSqlState(
      db.asUser(scenario.editorA, async client => {
        await client.query('SELECT * FROM app.create_collection($1,$2,$3,$4,$5::jsonb,$6::jsonb)', [
          scenario.siteA,
          'forbidden',
          'Forbidden',
          'forbidden',
          JSON.stringify(FIELDS),
          JSON.stringify(PRESENTATION),
        ])
      }),
      'CMS02',
    )
    const created = await create()
    await expectSqlState(
      db.asUser(scenario.editorA, async client => {
        await client.query('SELECT * FROM app.save_collection_schema($1,$2,$3::jsonb,$4::jsonb)', [
          created.collection_id,
          1,
          JSON.stringify(FIELDS),
          JSON.stringify(PRESENTATION),
        ])
      }),
      'CMS02',
    )
  })

  it('lets contributors save entries but reserves publication for editors', async () => {
    const created = await create()
    await publishSchema(created)
    const saved = await db.asUser(scenario.contributorA, async client =>
      client.query<{ entry_revision: string }>('SELECT * FROM app.save_collection_entries($1,0,$2::jsonb)', [
        created.collection_id,
        JSON.stringify([entry('one')]),
      ]),
    )
    expect(Number(saved.rows[0]!.entry_revision)).toBe(1)
    await expectSqlState(
      db.asUser(scenario.contributorA, async client => {
        await client.query('SELECT * FROM app.publish_collection_entries($1,1)', [created.collection_id])
      }),
      'CMS02',
    )
    const published = await db.asUser(scenario.editorA, async client =>
      client.query<{ published_count: number }>('SELECT * FROM app.publish_collection_entries($1,1)', [
        created.collection_id,
      ]),
    )
    expect(published.rows[0]!.published_count).toBe(1)
  })

  it('does not leak or mutate collections across tenants', async () => {
    const created = await create()
    await expectSqlState(
      db.asUser(scenario.editorB, async client => {
        await client.query('SELECT * FROM app.save_collection_entries($1,0,$2::jsonb)', [
          created.collection_id,
          JSON.stringify([entry('cross-site')]),
        ])
      }),
      'CMS02',
    )
    await db.asUser(scenario.superAdmin, async client => {
      expect(
        (
          await client.query('SELECT count(*)::int AS count FROM collection_entries WHERE collection_id=$1', [
            created.collection_id,
          ])
        ).rows[0]!.count,
      ).toBe(0)
    })
  })

  it('refuses missing and disabled product identities', async () => {
    const created = await create()
    await expectSqlState(
      db.asUser(null, async client => {
        await client.query('SELECT * FROM app.save_collection_entries($1,0,$2::jsonb)', [
          created.collection_id,
          JSON.stringify([]),
        ])
      }),
      'CMS02',
    )
    await expectSqlState(
      db.asUser(scenario.disabled, async client => {
        await client.query('SELECT * FROM app.save_collection_entries($1,0,$2::jsonb)', [
          created.collection_id,
          JSON.stringify([]),
        ])
      }),
      'CMS02',
    )
  })

  it('uses independent stale-revision guards for schemas and entries', async () => {
    const created = await create()
    await expectSqlState(
      db.asUser(scenario.superAdmin, async client => {
        await client.query('SELECT * FROM app.save_collection_schema($1,0,$2::jsonb,$3::jsonb)', [
          created.collection_id,
          JSON.stringify(FIELDS),
          JSON.stringify(PRESENTATION),
        ])
      }),
      'CMS01',
    )
    await expectSqlState(
      db.asUser(scenario.contributorA, async client => {
        await client.query('SELECT * FROM app.save_collection_entries($1,9,$2::jsonb)', [
          created.collection_id,
          JSON.stringify([]),
        ])
      }),
      'CMS01',
    )
  })

  it.each([
    ['unknown field property', [{ ...FIELDS[0], mystery: true }], { ...PRESENTATION, titleField: 'title' }],
    ['duplicate keys', [FIELDS[0], { ...FIELDS[0], label: 'Again' }], { ...PRESENTATION, titleField: 'title' }],
    [
      'duplicate trimmed choices',
      [{ key: 'kind', label: 'Kind', required: true, type: 'select', options: ['A', ' A '] }],
      { schemaVersion: 1, titleField: 'kind', subtitleField: null, imageField: null, groupField: 'kind' },
    ],
    ['bad presentation role', FIELDS, { ...PRESENTATION, imageField: 'title' }],
  ])('refuses model shape drift: %s', async (_name, fields, presentation) => {
    await expectSqlState(
      db.asUser(scenario.superAdmin, async client => {
        counter += 1
        await client.query('SELECT * FROM app.create_collection($1,$2,$3,$4,$5::jsonb,$6::jsonb)', [
          scenario.siteA,
          `bad-${counter}`,
          'Bad',
          `bad_${counter}`,
          JSON.stringify(fields),
          JSON.stringify(presentation),
        ])
      }),
      'CMS04',
    )
  })

  it('validates and normalizes all eight field value types', async () => {
    const created = await create()
    await db.asUser(scenario.contributorA, async client => {
      await client.query('SELECT * FROM app.save_collection_entries($1,0,$2::jsonb)', [
        created.collection_id,
        JSON.stringify([
          entry('all-types', 'All types', null, {
            summary: '<p>Rich</p>',
            count: 12.5,
            date: '2026-08-24',
            link: 'https://example.test/path',
            picture: { src: '/images/photo.jpg', alt: 'A photo', decorative: false },
            featured: true,
          }),
        ]),
      ])
    })
    await db.asUser(scenario.superAdmin, async client => {
      const values = (
        await client.query<{ values: Record<string, unknown> }>(
          `SELECT version."values" FROM collection_entries entry
         JOIN collection_entry_versions version ON version.id=entry.draft_version_id
         WHERE entry.collection_id=$1`,
          [created.collection_id],
        )
      ).rows[0]!.values
      expect(values.featured).toBe(true)
      expect(values.summary).toBe('<p>Rich</p>')
      expect(values.picture).toEqual({ src: '/images/photo.jpg', alt: 'A photo', decorative: false })
    })
  })

  it.each([
    ['unknown key', { extra: 'lost' }],
    ['text type', { title: 3 }],
    ['number type', { count: '3' }],
    ['calendar date', { date: '2026-02-30' }],
    ['executable URL', { link: 'javascript:alert(1)' }],
    ['out-of-range URL port', { link: 'https://example.test:99999/path' }],
    ['image shape', { picture: { src: '/x', alt: '', decorative: false } }],
    ['boolean type', { featured: 'true' }],
    ['select choice', { kind: 'Unknown' }],
  ])('refuses invalid entry values: %s', async (_name, changed) => {
    const created = await create()
    const values = { title: 'Bad', kind: 'News', ...changed }
    await expectSqlState(
      db.asUser(scenario.contributorA, async client => {
        await client.query('SELECT * FROM app.save_collection_entries($1,0,$2::jsonb)', [
          created.collection_id,
          JSON.stringify([{ id: null, stableKey: 'bad', values }]),
        ])
      }),
      'CMS04',
    )
  })

  it('rolls the whole bulk save back when one entry is invalid', async () => {
    const created = await create()
    await expectSqlState(
      db.asUser(scenario.contributorA, async client => {
        await client.query('SELECT * FROM app.save_collection_entries($1,0,$2::jsonb)', [
          created.collection_id,
          JSON.stringify([entry('valid'), entry('invalid', '', null, { kind: 'not-an-option' })]),
        ])
      }),
      'CMS04',
    )
    await db.asUser(scenario.superAdmin, async client => {
      const state = (
        await client.query<{ entry_revision: string; count: number }>(
          `SELECT collection.entry_revision,
          (SELECT count(*)::int FROM collection_entries WHERE collection_id=collection.id) AS count
         FROM collections collection WHERE id=$1`,
          [created.collection_id],
        )
      ).rows[0]!
      expect(Number(state.entry_revision)).toBe(0)
      expect(state.count).toBe(0)
      expect(
        (
          await client.query(
            `SELECT count(*)::int AS count FROM audit_log
        WHERE item_id=$1 AND action='collection.entries.save'`,
            [created.collection_id],
          )
        ).rows[0]!.count,
      ).toBe(0)
    })
  })

  it.each([
    ['unknown entry property', [{ id: null, stableKey: 'one', values: { title: 'One', kind: 'News' }, extra: true }]],
    ['duplicate stable key', [entry('same'), entry('same')]],
    [
      'duplicate id',
      [
        entry('one', 'One', '11111111-1111-4111-8111-111111111111'),
        entry('two', 'Two', '11111111-1111-4111-8111-111111111111'),
      ],
    ],
  ])('refuses malformed bulk batches: %s', async (_name, entries) => {
    const created = await create()
    await expectSqlState(
      db.asUser(scenario.contributorA, async client => {
        await client.query('SELECT * FROM app.save_collection_entries($1,0,$2::jsonb)', [
          created.collection_id,
          JSON.stringify(entries),
        ])
      }),
      'CMS04',
    )
  })

  it('reorders and archives drafts without changing live state until one publish', async () => {
    const created = await create()
    await publishSchema(created)
    await db.asUser(scenario.contributorA, async client => {
      await client.query('SELECT * FROM app.save_collection_entries($1,0,$2::jsonb)', [
        created.collection_id,
        JSON.stringify([entry('first'), entry('second')]),
      ])
    })
    await db.asUser(scenario.editorA, async client => {
      await client.query('SELECT * FROM app.publish_collection_entries($1,1)', [created.collection_id])
    })
    const ids = await db.asUser(
      scenario.superAdmin,
      async client =>
        (
          await client.query<{ id: string; stable_key: string }>(
            'SELECT id,stable_key FROM collection_entries WHERE collection_id=$1 ORDER BY sort_index',
            [created.collection_id],
          )
        ).rows,
    )
    await db.asUser(scenario.contributorA, async client => {
      await client.query('SELECT * FROM app.save_collection_entries($1,2,$2::jsonb)', [
        created.collection_id,
        JSON.stringify([entry('second', 'Second revised', ids[1]!.id)]),
      ])
    })
    await db.asUser(scenario.superAdmin, async client => {
      const rows = (
        await client.query<{ stable_key: string; draft_archived: boolean; live_archived: boolean; live_order: number }>(
          `SELECT stable_key, archived_at IS NOT NULL AS draft_archived,
          published_archived_at IS NOT NULL AS live_archived,published_sort_index AS live_order
         FROM collection_entries WHERE collection_id=$1 ORDER BY published_sort_index`,
          [created.collection_id],
        )
      ).rows
      expect(rows.map(row => [row.stable_key, row.draft_archived, row.live_archived, row.live_order])).toEqual([
        ['first', true, false, 0],
        ['second', false, false, 1],
      ])
    })
    await db.asUser(scenario.editorA, async client => {
      const result = await client.query<{ published_count: number }>(
        'SELECT * FROM app.publish_collection_entries($1,3)',
        [created.collection_id],
      )
      expect(result.rows[0]!.published_count).toBe(1)
    })
  })

  it('publishes an empty batch as an authoritative empty live collection', async () => {
    const created = await create()
    await publishSchema(created)
    await db.asUser(scenario.contributorA, async client => {
      await client.query('SELECT * FROM app.save_collection_entries($1,0,$2::jsonb)', [
        created.collection_id,
        JSON.stringify([entry('gone')]),
      ])
    })
    await db.asUser(scenario.editorA, async client => {
      await client.query('SELECT * FROM app.publish_collection_entries($1,1)', [created.collection_id])
    })
    await db.asUser(scenario.contributorA, async client => {
      await client.query('SELECT * FROM app.save_collection_entries($1,2,$2::jsonb)', [created.collection_id, '[]'])
    })
    const result = await db.asUser(scenario.editorA, async client =>
      client.query<{ published_count: number }>('SELECT * FROM app.publish_collection_entries($1,3)', [
        created.collection_id,
      ]),
    )
    expect(result.rows[0]!.published_count).toBe(0)
  })

  it('pins every entry version to its schema and permits compatible additive evolution', async () => {
    const created = await create()
    const firstPublishedRevision = await publishSchema(created)
    await db.asUser(scenario.contributorA, async client => {
      await client.query('SELECT * FROM app.save_collection_entries($1,0,$2::jsonb)', [
        created.collection_id,
        JSON.stringify([entry('one')]),
      ])
    })
    await db.asUser(scenario.editorA, async client => {
      await client.query('SELECT * FROM app.publish_collection_entries($1,1)', [created.collection_id])
    })
    const extended = [...FIELDS, { key: 'note', label: 'Note', required: false, type: 'text' }]
    const saved = await db.asUser(scenario.superAdmin, async client =>
      client.query<{ schema_version_id: string; revision: string }>(
        'SELECT * FROM app.save_collection_schema($1,$2,$3::jsonb,$4::jsonb)',
        [created.collection_id, firstPublishedRevision, JSON.stringify(extended), JSON.stringify(PRESENTATION)],
      ),
    )
    await db.asUser(scenario.superAdmin, async client => {
      await client.query('SELECT * FROM app.publish_collection_schema($1,$2)', [
        created.collection_id,
        saved.rows[0]!.revision,
      ])
      const versions = await client.query<{ schema_version_id: string }>(
        'SELECT schema_version_id FROM collection_entry_versions version JOIN collection_entries entry ON entry.id=version.entry_id WHERE entry.collection_id=$1',
        [created.collection_id],
      )
      expect(versions.rows[0]!.schema_version_id).toBe(created.schema_version_id)
    })
  })

  it('blocks a schema publication that would reinterpret or discard live values', async () => {
    const created = await create()
    const revision = await publishSchema(created)
    await db.asUser(scenario.contributorA, async client => {
      await client.query('SELECT * FROM app.save_collection_entries($1,0,$2::jsonb)', [
        created.collection_id,
        JSON.stringify([entry('one')]),
      ])
    })
    await db.asUser(scenario.editorA, async client => {
      await client.query('SELECT * FROM app.publish_collection_entries($1,1)', [created.collection_id])
    })
    const withoutKind = FIELDS.filter(field => field.key !== 'kind')
    const presentation = { ...PRESENTATION, groupField: null }
    const saved = await db.asUser(scenario.superAdmin, async client =>
      client.query<{ revision: string }>('SELECT * FROM app.save_collection_schema($1,$2,$3::jsonb,$4::jsonb)', [
        created.collection_id,
        revision,
        JSON.stringify(withoutKind),
        JSON.stringify(presentation),
      ]),
    )
    await expectSqlState(
      db.asUser(scenario.superAdmin, async client => {
        await client.query('SELECT * FROM app.publish_collection_schema($1,$2)', [
          created.collection_id,
          saved.rows[0]!.revision,
        ])
      }),
      'CMS04',
    )
  })

  it('does not publish drafts authored against an unpublished schema', async () => {
    const created = await create()
    const revision = await publishSchema(created)
    const extended = [...FIELDS, { key: 'note', label: 'Note', required: false, type: 'text' }]
    await db.asUser(scenario.superAdmin, async client => {
      await client.query('SELECT * FROM app.save_collection_schema($1,$2,$3::jsonb,$4::jsonb)', [
        created.collection_id,
        revision,
        JSON.stringify(extended),
        JSON.stringify(PRESENTATION),
      ])
    })
    await db.asUser(scenario.contributorA, async client => {
      await client.query('SELECT * FROM app.save_collection_entries($1,0,$2::jsonb)', [
        created.collection_id,
        JSON.stringify([entry('new', 'New', null, { note: 'private schema' })]),
      ])
    })
    await expectSqlState(
      db.asUser(scenario.editorA, async client => {
        await client.query('SELECT * FROM app.publish_collection_entries($1,1)', [created.collection_id])
      }),
      'CMS04',
    )
  })

  it('enforces governed-media tenancy and records immutable usage', async () => {
    const created = await create()
    const own = randomUUID()
    const other = randomUUID()
    const shared = randomUUID()
    await db.as('owner', async client => {
      for (const [id, site, key, hash] of [
        [own, scenario.siteA, 'own', 'a'.repeat(64)],
        [other, scenario.siteB, 'other', 'b'.repeat(64)],
        [shared, null, 'shared', 'c'.repeat(64)],
      ] as const) {
        await client.query(
          `INSERT INTO media(id,site_id,object_key,content_hash,original_name,alt_text,mime_type,status,bytes,width,height)
          VALUES($1,$2,$3,$4,'x.png','described','image/png','ready',100,10,10)`,
          [id, site, `collection/${key}`, hash],
        )
        await client.query(`INSERT INTO media_variants(media_id,kind,object_key) VALUES($1,'card',$2)`, [
          id,
          `collection/${key}/card`,
        ])
      }
    })
    await expectSqlState(
      db.asUser(scenario.contributorA, async client => {
        await client.query('SELECT * FROM app.save_collection_entries($1,0,$2::jsonb)', [
          created.collection_id,
          JSON.stringify([
            entry('wrong-site', 'Wrong', null, {
              picture: { src: `/media/${other}/card`, alt: 'Other', decorative: false },
            }),
          ]),
        ])
      }),
      'CMS04',
    )
    await db.asUser(scenario.contributorA, async client => {
      await client.query('SELECT * FROM app.save_collection_entries($1,0,$2::jsonb)', [
        created.collection_id,
        JSON.stringify([
          entry('own-site', 'Own', null, { picture: { src: `/media/${own}/card`, alt: 'Own', decorative: false } }),
          entry('shared', 'Shared', null, {
            picture: { src: `/media/${shared}/card`, alt: 'Shared', decorative: false },
          }),
        ]),
      ])
    })
    await db.asUser(scenario.superAdmin, async client => {
      const usage = await client.query('SELECT * FROM media_usage WHERE media_id=ANY($1::uuid[]) AND item_type=$2', [
        [own, shared],
        'collection_entry',
      ])
      expect(usage.rowCount).toBe(2)
    })
  })

  it('writes audit and publication outbox records in the same command transactions', async () => {
    const created = await create()
    await publishSchema(created)
    await db.asUser(scenario.contributorA, async client => {
      await client.query('SELECT * FROM app.save_collection_entries($1,0,$2::jsonb)', [
        created.collection_id,
        JSON.stringify([entry('audited')]),
      ])
    })
    await db.asUser(scenario.editorA, async client => {
      await client.query('SELECT * FROM app.publish_collection_entries($1,1)', [created.collection_id])
    })
    await db.asUser(scenario.superAdmin, async client => {
      const actions = (
        await client.query<{ action: string }>('SELECT action FROM audit_log WHERE item_id=$1 ORDER BY id', [
          created.collection_id,
        ])
      ).rows.map(row => row.action)
      expect(actions).toEqual([
        'collection.create',
        'collection.schema.publish',
        'collection.entries.save',
        'collection.entries.publish',
      ])
      const events = (
        await client.query<{ event_type: string }>(
          "SELECT event_type FROM outbox WHERE payload->>'collection_id'=$1 ORDER BY id",
          [created.collection_id],
        )
      ).rows.map(row => row.event_type)
      expect(events).toEqual(['collection.schema.published', 'collection.entries.published'])
    })
  })
})
