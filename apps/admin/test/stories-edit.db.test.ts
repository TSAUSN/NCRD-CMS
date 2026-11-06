import { randomUUID } from 'node:crypto'
import { beforeAll, afterAll, it, expect } from 'vitest'
import { TestDatabase } from '@cms/schema/testing'
import { seedScenario, type Scenario } from '@cms/schema/fixtures'
import { mapErrors } from '@cms/domain'
import { ensureSawsoSite } from '../src/lib/sawso-site.ts'
import { saveStoryDetails, type StoryEditInput } from '../src/lib/stories-edit.ts'
let db: TestDatabase, s: Scenario
beforeAll(async () => {
  db = await TestDatabase.create('stories_edit')
  s = await seedScenario(db)
})
afterAll(async () => {
  await db?.close()
})
it('edits only the owned record through normal CAS, preserves source addresses and sanitizes story text', async () => {
  const site = await db.asUser(s.superAdmin, c => ensureSawsoSite(c, randomUUID()))
  const original = await db.asUser(
    s.superAdmin,
    async c =>
      (
        await c.query(
          "SELECT e.id,c.entry_revision,v.values FROM collections c JOIN collection_entries e ON e.collection_id=c.id JOIN collection_entry_versions v ON v.id=e.draft_version_id WHERE c.id=$1 AND v.values->>'title'=$2",
          [site.collectionId, 'Primary Health Care to Support the Growing Chikankata Community'],
        )
      ).rows[0]!,
  )
  const values = original.values,
    input: StoryEditInput = {
      title: values.title,
      summary: values.summary,
      tags: ['health', 'education'],
      region: values.region,
      published_date: values.published_date,
      countries: values.countries ?? '',
      body: '<p>Sample content</p><script>alert(1)</script>',
      body_is_sample: true,
    }
  const saved = await db.asUser(s.superAdmin, c =>
    saveStoryDetails(c, site.siteId, site.collectionId, original.id, String(original.entry_revision), input),
  )
  expect(saved.values.tags).toBe('health,education')
  expect(saved.values.old_address).toBe(values.old_address)
  expect(saved.values.image_url).toBe(values.image_url)
  expect(saved.values.body).not.toContain('<script')
  await expect(
    mapErrors(() =>
      db.asUser(s.superAdmin, c =>
        saveStoryDetails(c, site.siteId, site.collectionId, original.id, String(original.entry_revision), input),
      ),
    ),
  ).rejects.toMatchObject({ kind: 'stale_revision' })
  await expect(
    db.asUser(s.editorB, c => saveStoryDetails(c, site.siteId, site.collectionId, original.id, saved.revision, input)),
  ).rejects.toMatchObject({ kind: 'not_found' })
  await expect(
    db.asUser(s.superAdmin, c => saveStoryDetails(c, s.siteB, site.collectionId, original.id, saved.revision, input)),
  ).rejects.toMatchObject({ kind: 'not_found' })
  const untagged = await db.asUser(s.superAdmin, c =>
    saveStoryDetails(c, site.siteId, site.collectionId, original.id, saved.revision, {
      ...input,
      tags: [],
      region: '',
      regions: [],
    }),
  )
  expect(untagged.values).toMatchObject({ tags: '', region: '', regions: '', body: saved.values.body })
  await expect(
    db.asUser(s.superAdmin, c =>
      saveStoryDetails(c, site.siteId, site.collectionId, original.id, untagged.revision, {
        ...input,
        tags: ['unknown-tag'],
      }),
    ),
  ).rejects.toMatchObject({ kind: 'invalid_state' })
  const article = await db.asUser(s.superAdmin, async c => {
    const id = (
      await c.query('SELECT app.create_page($1,$2,$3) AS id', [site.siteId, values.story_url.slice(1), values.title])
    ).rows[0]!.id
    await c.query('SELECT app.save_page_draft($1,0,$2,$3)', [
      id,
      '[]',
      JSON.stringify({ title: values.title, description: values.summary }),
    ])
    return id
  })
  const renamed = await db.asUser(s.superAdmin, c =>
    saveStoryDetails(c, site.siteId, site.collectionId, original.id, untagged.revision, {
      ...input,
      title: '[Updated story title]',
      summary: '[Updated story description]',
    }),
  )
  const page = await db.asUser(
    s.superAdmin,
    async c =>
      (
        await c.query(
          'SELECT v.content,v.meta,p.published_version_id FROM pages p JOIN page_versions v ON v.id=p.draft_version_id WHERE p.id=$1',
          [article],
        )
      ).rows[0]!,
  )
  expect(page.meta).toMatchObject({ title: renamed.values.title, description: renamed.values.summary })
  expect(page.content).toEqual([])
  expect(page.published_version_id).toBeNull()
  expect(
    (await db.as('public', c => c.query('SELECT * FROM public_api.site_routes($1)', [site.hostname]))).rows,
  ).toEqual([])
})

it('requires an owned ready Story photo and description, preserves other heads and never publishes a photo edit', async () => {
  const site = await db.asUser(s.superAdmin, c => ensureSawsoSite(c, randomUUID())),
    own = randomUUID(),
    foreign = randomUUID(),
    shared = randomUUID(),
    processing = randomUUID(),
    missingWide = randomUUID(),
    deleted = randomUUID()
  await db.as('owner', async c => {
    for (const [id, siteId, status, wide, deletedAt] of [
      [own, site.siteId, 'ready', true, null],
      [foreign, s.siteB, 'ready', true, null],
      [shared, null, 'ready', true, null],
      [processing, site.siteId, 'processing', true, null],
      [missingWide, site.siteId, 'ready', false, null],
      [deleted, site.siteId, 'deleted', true, new Date().toISOString()],
    ] as const) {
      await c.query(
        "INSERT INTO media(id,site_id,object_key,content_hash,original_name,alt_text,width,height,bytes,mime_type,status,deleted_at) VALUES($1,$2,$6,$3,'[Photo].png','[Photo description]',10,10,99,'image/png',$4,$5)",
        [id, siteId, 'a'.repeat(64), status, deletedAt, id],
      )
      if (wide)
        await c.query(
          "INSERT INTO media_variants(media_id,kind,object_key,content_hash,width,height,bytes,mime_type) VALUES($1,'wide',$2,$3,10,10,99,'image/webp')",
          [id, id + '/wide', 'b'.repeat(64)],
        )
    }
  })
  await db.asUser(s.superAdmin, c =>
    c.query('SELECT app.set_site_membership($1,$2,$3)', [s.editorA, site.siteId, 'site_admin']),
  )
  const before = await db.asUser(
      s.editorA,
      async c =>
        (
          await c.query(
            'SELECT e.id,e.draft_version_id,e.published_version_id,c.entry_revision,v.values FROM collection_entries e JOIN collections c ON c.id=e.collection_id JOIN collection_entry_versions v ON v.id=e.draft_version_id WHERE c.id=$1 AND e.archived_at IS NULL ORDER BY e.sort_index,e.id',
            [site.collectionId],
          )
        ).rows,
    ),
    target = before[0]!,
    value = target.values
  const input: StoryEditInput = {
    title: value.title,
    summary: value.summary,
    tags: String(value.tags ?? '')
      .split(',')
      .filter(Boolean),
    region: value.region,
    published_date: value.published_date,
    countries: value.countries ?? '',
    body: value.body ?? '',
    body_is_sample: value.body_is_sample === true,
    photo: { id: own, description: '[Story-specific photo description]', focus: { x: 0.25, y: 0.75 } },
  }
  const save = (revision: string, photo: unknown = input.photo, actor = s.editorA) =>
    mapErrors(() =>
      db.asUser(actor, c =>
        saveStoryDetails(c, site.siteId, site.collectionId, target.id, revision, { ...input, photo } as StoryEditInput),
      ),
    )
  for (const photo of [
    { ...input.photo, id: foreign },
    { ...input.photo, id: processing },
    { ...input.photo, id: missingWide },
    { ...input.photo, id: deleted },
    { ...input.photo, id: randomUUID() },
    { ...input.photo, description: ' ' },
    { ...input.photo, description: 'a'.repeat(1001) },
    { ...input.photo, focus: { x: 2, y: 0.5 } },
    { ...input.photo, focus: { x: 0.5, y: 0.5, code: 'bad' } },
    { ...input.photo, focus: undefined },
  ])
    await expect(save(String(target.entry_revision), photo)).rejects.toMatchObject({ kind: 'invalid_state' })
  await expect(save(String(target.entry_revision), input.photo, s.editorB)).rejects.toMatchObject({ kind: 'not_found' })
  const saved = await save(String(target.entry_revision))
  expect(saved.values.photo).toEqual({
    src: '/media/' + own + '/wide',
    alt: '[Story-specific photo description]',
    decorative: false,
    focal: { x: 0.25, y: 0.75 },
  })
  expect(saved.values.photo_is_sample).toBe(false)
  expect(saved.values.photo_note).toBe('')
  expect(saved.values.old_address).toBe(value.old_address)
  const after = await db.asUser(
    s.editorA,
    async c =>
      (
        await c.query(
          'SELECT id,draft_version_id,published_version_id FROM collection_entries WHERE collection_id=$1 AND archived_at IS NULL ORDER BY sort_index,id',
          [site.collectionId],
        )
      ).rows,
  )
  expect(after.map(row => row.published_version_id)).toEqual(before.map(row => row.published_version_id))
  expect(after.slice(1)).toEqual(
    before
      .slice(1)
      .map(({ id, draft_version_id, published_version_id }) => ({ id, draft_version_id, published_version_id })),
  )
  await expect(save(String(target.entry_revision))).rejects.toMatchObject({ kind: 'stale_revision' })
  const recropped = await save(saved.revision, { ...input.photo, focus: null })
  expect(recropped.values.photo).not.toHaveProperty('focal')
  const reused = await save(recropped.revision, { ...input.photo, id: shared })
  expect(reused.values.photo).toMatchObject({ src: '/media/' + shared + '/wide' })
})
