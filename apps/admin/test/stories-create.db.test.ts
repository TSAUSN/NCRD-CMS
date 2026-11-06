import { randomUUID } from 'node:crypto'
import { beforeAll, afterAll, it, expect } from 'vitest'
import { TestDatabase } from '@cms/schema/testing'
import { createStoriesModel, emptyStoriesSettings } from '@cms/schema'
import { mapErrors } from '@cms/domain'
import { seedScenario, type Scenario } from '@cms/schema/fixtures'
import { ensureSawsoSite } from '../src/lib/sawso-site.ts'
import { storyReleaseSelection } from '../src/lib/story-release.ts'
import { createStoryDraft, type NewStoryInput } from '../src/lib/stories-create.ts'
let db: TestDatabase, s: Scenario
async function readyPhoto(siteId: string) {
  const photo = randomUUID()
  await db.as('owner', async c => {
    await c.query(
      "INSERT INTO media(id,site_id,object_key,content_hash,original_name,alt_text,width,height,bytes,mime_type,status) VALUES($1,$2,$4,$3,'[Photo].png','[Description]',10,10,99,'image/png','ready')",
      [photo, siteId, 'a'.repeat(64), photo],
    )
    await c.query(
      "INSERT INTO media_variants(media_id,kind,object_key,content_hash,width,height,bytes,mime_type) VALUES($1,'wide',$2,$3,10,10,99,'image/webp')",
      [photo, photo + '/wide', 'b'.repeat(64)],
    )
  })
  return photo
}
beforeAll(async () => {
  db = await TestDatabase.create('stories_create')
  s = await seedScenario(db)
})
afterAll(async () => {
  await db?.close()
})
it('creates an owned private story and shared-template page atomically, retaining page permissions, media isolation and list CAS', async () => {
  const site = await db.asUser(s.superAdmin, c => ensureSawsoSite(c, randomUUID())),
    photo = randomUUID()
  await db.asUser(s.superAdmin, async c => {
    const list = (
      await c.query(
        'SELECT c.revision,v.fields,v.sort FROM collections c JOIN collection_schema_versions v ON v.id=c.draft_schema_version_id WHERE c.id=$1',
        [site.collectionId],
      )
    ).rows[0]!
    const legacy = list.fields.map((field: { key: string }) =>
        field.key === 'old_address' ? { ...field, required: true } : field,
      ),
      saved = (
        await c.query('SELECT * FROM app.save_collection_schema($1,$2,$3,$4)', [
          site.collectionId,
          list.revision,
          JSON.stringify(legacy),
          JSON.stringify(list.sort),
        ])
      ).rows[0]!
    await c.query('SELECT * FROM app.publish_collection_schema($1,$2)', [site.collectionId, saved.revision])
    await ensureSawsoSite(c, randomUUID())
    const upgraded = (
      await c.query(
        'SELECT v.fields FROM collections c JOIN collection_schema_versions v ON v.id=c.draft_schema_version_id WHERE c.id=$1',
        [site.collectionId],
      )
    ).rows[0]!.fields
    expect(upgraded.find((field: { key: string }) => field.key === 'old_address').required).toBe(false)
  })
  await db.as('owner', async c => {
    await c.query(
      "INSERT INTO media(id,site_id,object_key,content_hash,original_name,alt_text,width,height,bytes,mime_type,status) VALUES($1,$2,$4,$3,'sample.png','Sample photo',10,10,99,'image/png','ready')",
      [photo, site.siteId, 'a'.repeat(64), photo],
    )
    await c.query(
      "INSERT INTO media_variants(media_id,kind,object_key,content_hash,width,height,bytes,mime_type) VALUES($1,'wide',$2,$3,10,10,99,'image/webp')",
      [photo, photo + '/wide', 'b'.repeat(64)],
    )
  })
  await db.asUser(s.superAdmin, async c => {
    await c.query('SELECT app.set_site_membership($1,$2,$3)', [s.editorA, site.siteId, 'site_admin'])
    await c.query('SELECT app.set_site_membership($1,$2,$3)', [s.contributorA, site.siteId, 'contributor'])
  })
  const revision = String(
    (
      await db.asUser(
        s.editorA,
        async c => (await c.query('SELECT entry_revision FROM collections WHERE id=$1', [site.collectionId])).rows[0]!,
      )
    ).entry_revision,
  )
  const input: NewStoryInput = {
    title: '[New story — sample content]',
    summary: '[New story summary — sample content]',
    tags: ['health'],
    region: 'africa',
    published_date: '2026-10-29',
    photoId: photo,
    photoAlt: 'Sample photo for this story',
    photoFocus: { x: 0.2, y: 0.8 },
  }
  const create = (actor: string, rev = revision, value = input) =>
    db.asUser(actor, c => createStoryDraft(c, site.siteId, site.collectionId, rev, value))
  await expect(
    db.asUser(s.contributorA, c =>
      c.query('SELECT app.create_page($1,$2,$3)', [site.siteId, 'not-a-story', '[Ordinary page]']),
    ),
  ).rejects.toBeTruthy()
  await expect(create(s.editorB)).rejects.toMatchObject({ kind: 'not_found' })
  const created = await create(s.editorA),
    row = await db.asUser(
      s.editorA,
      async c =>
        (
          await c.query(
            'SELECT e.stable_key,v.values,p.published_version_id,pv.content FROM collection_entries e JOIN collection_entry_versions v ON v.id=e.draft_version_id JOIN pages p ON p.id=$2 JOIN page_versions pv ON pv.id=p.draft_version_id WHERE e.id=$1',
            [created.entryId, created.pageId],
          )
        ).rows[0]!,
    )
  expect(row.published_version_id).toBeNull()
  expect(row.values.old_address ?? '').toBe('')
  expect(row.values.body_is_sample).toBe(false)
  expect(row.values.body).toBe('')
  expect(row.values.photo.focal).toEqual({ x: 0.2, y: 0.8 })
  expect(row.values.photo.src).toBe('/media/' + photo + '/wide')
  expect(row.content).toHaveLength(2)
  expect(row.content[0].values.story.selection.stableKeys).toEqual([row.stable_key])
  expect(row.content[1].values.stories.selection.filter.value).toBe('health')
  for (const focal of [
    { x: -1, y: 0.5 },
    { x: 0.5, y: 2 },
    { x: 'bad', y: 0.5 },
    { x: 0.5, y: 0.5, code: 'x' },
  ]) {
    await expect(
      create(s.editorA, created.revision, { ...input, photoFocus: focal } as NewStoryInput),
    ).rejects.toMatchObject({ kind: 'invalid_state' })
    expect(
      (
        await db.asUser(
          s.editorA,
          async c =>
            (
              await c.query('SELECT app.collection_entry_values_defect($1,$2,$3) AS defect', [
                site.siteId,
                JSON.stringify([{ key: 'photo', label: 'Photo', type: 'image', required: true }]),
                JSON.stringify({
                  photo: { src: '/media/' + photo + '/wide', alt: '[Photo]', decorative: false, focal },
                }),
              ])
            ).rows[0]!,
        )
      ).defect,
    ).toContain('focus point')
  }
  await expect(create(s.editorA)).rejects.toBeTruthy()
  await expect(create(s.editorA, created.revision, { ...input, photoId: randomUUID() })).rejects.toMatchObject({
    kind: 'invalid_state',
  })
  expect(
    (
      await db.asUser(
        s.editorA,
        async c => (await c.query('SELECT count(*)::int AS n FROM pages WHERE site_id=$1', [site.siteId])).rows[0]!,
      )
    ).n,
  ).toBe(2)
  const undated = await create(s.editorA, created.revision, {
    ...input,
    published_date: '',
    body: '<p>[Ready story text]</p>',
  })
  const draft = await db.asUser(
    s.editorA,
    async c =>
      (
        await c.query(
          'SELECT v.values,e.published_version_id FROM collection_entries e JOIN collection_entry_versions v ON v.id=e.draft_version_id WHERE e.id=$1',
          [undated.entryId],
        )
      ).rows[0]!,
  )
  await expect(db.asUser(s.editorA, c => storyReleaseSelection(c, site.siteId, undated.entryId))).rejects.toMatchObject(
    { kind: 'invalid_state' },
  )
  expect(draft.values.published_date).toBe('')
  expect(draft.values.body).toBe('<p>[Ready story text]</p>')
  expect(draft.published_version_id).toBeNull()
  await expect(
    mapErrors(() =>
      db.asUser(s.editorA, c =>
        c.query('SELECT app.publish_story_entries($1,$2,$3)', [site.collectionId, undated.revision, [undated.entryId]]),
      ),
    ),
  ).rejects.toMatchObject({ kind: 'invalid_state' })
  await expect(
    mapErrors(() =>
      db.asUser(s.editorA, c =>
        c.query('SELECT app.publish_collection_entries($1,$2)', [site.collectionId, undated.revision]),
      ),
    ),
  ).rejects.toMatchObject({ kind: 'invalid_state' })
  const creator = await create(s.contributorA, undated.revision, { ...input, title: '[Content creator story]' })
  expect(
    (
      await db.asUser(s.contributorA, c =>
        c.query('SELECT published_version_id FROM pages WHERE id=$1', [creator.pageId]),
      )
    ).rows[0]!.published_version_id,
  ).toBeNull()
  expect(
    (await db.as('public', c => c.query('SELECT * FROM public_api.site_routes($1)', [site.hostname]))).rows,
  ).toEqual([])
})

it('recovers one private story/page after a lost creation response without replaying versions, accepting changed intentions or leaking the receipt', async () => {
  const site = await db.asUser(s.superAdmin, c => ensureSawsoSite(c, randomUUID())),
    photo = await readyPhoto(site.siteId),
    request = randomUUID(),
    revision = String(
      (
        await db.asUser(
          s.superAdmin,
          async c =>
            (await c.query('SELECT entry_revision FROM collections WHERE id=$1', [site.collectionId])).rows[0]!,
        )
      ).entry_revision,
    )
  await db.asUser(s.superAdmin, c =>
    c.query('SELECT app.set_site_membership($1,$2,$3)', [s.editorA, site.siteId, 'site_admin']),
  )
  const input: NewStoryInput = {
    title: '[Retry-safe story]',
    summary: '[Retry-safe description]',
    tags: ['health'],
    region: 'africa',
    published_date: '',
    photoId: photo,
    photoAlt: '[Photo description]',
    countries: '[Country]',
    body: '<p>[Real words]</p>',
  }
  const first = await db.asUser(s.superAdmin, c =>
      createStoryDraft(c, site.siteId, site.collectionId, revision, input, request),
    ),
    before = await db.as('owner', async c => ({
      pages: (
        await c.query(
          'SELECT id,revision,draft_version_id,published_version_id FROM pages WHERE site_id=$1 ORDER BY id',
          [site.siteId],
        )
      ).rows,
      entries: (
        await c.query(
          'SELECT id,draft_version_id,published_version_id FROM collection_entries WHERE collection_id=$1 ORDER BY id',
          [site.collectionId],
        )
      ).rows,
      heads: (await c.query('SELECT entry_revision FROM collections WHERE id=$1', [site.collectionId])).rows,
    }))
  const replay = await db.asUser(s.superAdmin, c =>
    createStoryDraft(c, site.siteId, site.collectionId, revision, input, request),
  )
  expect(replay).toEqual({ ...first, replayed: true })
  const after = await db.as('owner', async c => ({
    pages: (
      await c.query(
        'SELECT id,revision,draft_version_id,published_version_id FROM pages WHERE site_id=$1 ORDER BY id',
        [site.siteId],
      )
    ).rows,
    entries: (
      await c.query(
        'SELECT id,draft_version_id,published_version_id FROM collection_entries WHERE collection_id=$1 ORDER BY id',
        [site.collectionId],
      )
    ).rows,
    heads: (await c.query('SELECT entry_revision FROM collections WHERE id=$1', [site.collectionId])).rows,
  }))
  expect(after).toEqual(before)
  await expect(
    mapErrors(() =>
      db.asUser(s.superAdmin, c =>
        createStoryDraft(
          c,
          site.siteId,
          site.collectionId,
          first.revision,
          { ...input, title: '[Different intention]' },
          request,
        ),
      ),
    ),
  ).rejects.toMatchObject({ kind: 'invalid_state' })
  expect(
    (await db.asUser(s.editorA, c => c.query('SELECT * FROM story_draft_receipts WHERE request_id=$1', [request])))
      .rows,
  ).toEqual([])
  await expect(
    db.asUser(s.superAdmin, c =>
      c.query('UPDATE story_draft_receipts SET fingerprint=$2 WHERE request_id=$1', [request, 'b'.repeat(64)]),
    ),
  ).rejects.toMatchObject({ code: '42501' })
  await expect(db.as('public', c => c.query('SELECT * FROM public.story_draft_receipts'))).rejects.toMatchObject({
    code: '42501',
  })
  await expect(
    mapErrors(() =>
      db.asUser(s.editorB, c =>
        c.query('SELECT app.read_story_draft_receipt($1,$2,$3,$4)', [
          site.siteId,
          site.collectionId,
          request,
          'a'.repeat(64),
        ]),
      ),
    ),
  ).rejects.toMatchObject({ kind: 'not_found' })
  const failed = randomUUID()
  await expect(
    mapErrors(() =>
      db.asUser(s.superAdmin, c =>
        createStoryDraft(c, site.siteId, site.collectionId, revision, { ...input, title: '[Stale creation]' }, failed),
      ),
    ),
  ).rejects.toMatchObject({ kind: 'stale_revision' })
  expect(
    (await db.as('owner', c => c.query('SELECT * FROM story_draft_receipts WHERE request_id=$1', [failed]))).rows,
  ).toEqual([])
  const saved = (
    await db.asUser(
      s.superAdmin,
      async c =>
        (
          await c.query(
            'SELECT v.values FROM collection_entries e JOIN collection_entry_versions v ON v.id=e.draft_version_id WHERE e.id=$1',
            [first.entryId],
          )
        ).rows[0]!,
    )
  ).values
  expect(saved.countries).toBe('[Country]')
  expect(saved.body).toBe('<p>[Real words]</p>')
})

it('serializes concurrent creation retries and keeps one complete private result', async () => {
  const site = await db.asUser(s.superAdmin, c => ensureSawsoSite(c, randomUUID())),
    photo = await readyPhoto(site.siteId),
    request = randomUUID(),
    revision = String(
      (
        await db.asUser(
          s.superAdmin,
          async c =>
            (await c.query('SELECT entry_revision FROM collections WHERE id=$1', [site.collectionId])).rows[0]!,
        )
      ).entry_revision,
    ),
    input: NewStoryInput = {
      title: '[Concurrent story]',
      summary: '[Concurrent description]',
      tags: [],
      region: '',
      published_date: '',
      photoId: photo,
      photoAlt: '[Description]',
    }
  const before = (
    await db.as('owner', c => c.query('SELECT count(*)::int AS count FROM pages WHERE site_id=$1', [site.siteId]))
  ).rows[0]!.count
  const results = await Promise.all(
    [1, 2].map(() =>
      db.asUser(s.superAdmin, c => createStoryDraft(c, site.siteId, site.collectionId, revision, input, request)),
    ),
  )
  expect(results[0]!.entryId).toBe(results[1]!.entryId)
  expect(results[0]!.pageId).toBe(results[1]!.pageId)
  expect(results.map(row => row.replayed).sort()).toEqual([false, true])
  expect(
    (await db.as('owner', c => c.query('SELECT count(*)::int AS count FROM pages WHERE site_id=$1', [site.siteId])))
      .rows[0]!.count,
  ).toBe(before + 1)
  const state = await db.as('owner', async c => ({
    receipts: (await c.query('SELECT * FROM story_draft_receipts WHERE request_id=$1', [request])).rows,
    entry: (
      await c.query(
        'SELECT e.published_version_id,v.values FROM collection_entries e JOIN collection_entry_versions v ON v.id=e.draft_version_id WHERE e.id=$1',
        [results[0]!.entryId],
      )
    ).rows[0]!,
    page: (
      await c.query(
        'SELECT p.published_version_id,v.content FROM pages p JOIN page_versions v ON v.id=p.draft_version_id WHERE p.id=$1',
        [results[0]!.pageId],
      )
    ).rows[0]!,
  }))
  expect(state.receipts).toHaveLength(1)
  expect(state.entry.published_version_id).toBeNull()
  expect(state.page.published_version_id).toBeNull()
  expect(state.entry.values.tags).toBe('')
  expect(JSON.stringify(state.page.content)).not.toContain('[sector]')
  expect(state.page.content[1].values.stories.selection).not.toHaveProperty('filter')
})

it('creates a story on an ordinary site without borrowed sector placeholders or a broken newsroom link', async () => {
  const photo = await readyPhoto(s.siteA),
    model = createStoriesModel({
      ...emptyStoriesSettings(),
      mainTags: [{ id: 'food', label: 'Food', keywords: [] }],
      secondaryTags: [{ id: 'east', label: 'East', keywords: [], areas: ['asia'] }],
    }),
    collection = await db.asUser(
      s.superAdmin,
      async c =>
        (
          await c.query("SELECT * FROM app.create_collection($1,'stories','Stories','stories',$2,$3)", [
            s.siteA,
            JSON.stringify(model.fields),
            JSON.stringify(model.presentation),
          ])
        ).rows[0]!.collection_id,
    ),
    created = await db.asUser(s.editorA, c =>
      createStoryDraft(c, s.siteA, collection, '0', {
        title: '[Ordinary site story]',
        summary: '[Ordinary description]',
        tags: ['food'],
        region: 'east',
        published_date: '',
        photoId: photo,
        photoAlt: '[Photo description]',
      }),
    )
  const state = await db.asUser(
    s.editorA,
    async c =>
      (
        await c.query(
          'SELECT v.content,p.published_version_id FROM pages p JOIN page_versions v ON v.id=p.draft_version_id WHERE p.id=$1',
          [created.pageId],
        )
      ).rows[0]!,
  )
  expect(state.published_version_id).toBeNull()
  expect(JSON.stringify(state.content)).not.toContain('[sector]')
  expect(JSON.stringify(state.content)).not.toContain('/newsroom')
  expect(state.content[1].values.more.url).toBe('')
  expect(state.content[1].values.stories.selection.filter).toEqual({ field: 'tags', value: 'food' })
})
