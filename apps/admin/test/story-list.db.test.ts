import { randomUUID } from 'node:crypto'
import { beforeAll, afterAll, it, expect } from 'vitest'
import { TestDatabase } from '@cms/schema/testing'
import { seedScenario, type Scenario } from '@cms/schema/fixtures'
import { storyDateInFeed } from '@cms/schema'
import { mapErrors } from '@cms/domain'
import { ensureSawsoSite } from '../src/lib/sawso-site.ts'
import { patchStoryList } from '../src/lib/story-list-commands.ts'
import { changeStoriesTags } from '../src/lib/stories-tags.ts'
let db: TestDatabase, s: Scenario
beforeAll(async () => {
  db = await TestDatabase.create('story_list')
  s = await seedScenario(db)
})
afterAll(async () => db.close())
async function setup() {
  return db.asUser(s.superAdmin, async c => {
    const f = await ensureSawsoSite(c, randomUUID(), 'sawso-' + randomUUID().slice(0, 8))
    await c.query("SELECT app.set_site_membership($1,$2,'editor')", [s.editorA, f.siteId])
    await c.query("SELECT app.set_site_membership($1,$2,'contributor')", [s.contributorA, f.siteId])
    return f
  })
}
async function state(id: string) {
  return db.asUser(s.superAdmin, async c => {
    const head = (await c.query('SELECT revision,entry_revision FROM collections WHERE id=$1', [id])).rows[0]!
    const rows = (
      await c.query(
        'SELECT e.id,e.stable_key,v.values,e.published_version_id FROM collection_entries e JOIN collection_entry_versions v ON v.id=e.draft_version_id WHERE e.collection_id=$1 ORDER BY e.sort_index,e.id',
        [id],
      )
    ).rows
    return { revision: String(head.revision), entryRevision: String(head.entry_revision), rows }
  })
}
it('saves only tag/review/hide metadata, marks reviewed, preserves article content and enforces CAS and roles', async () => {
  const f = await setup(),
    before = await state(f.collectionId),
    first = before.rows[0]!
  const saved = await db.asUser(s.editorA, c =>
    patchStoryList(c, f.siteId, f.collectionId, first.id, before.revision, before.entryRevision, {
      action: 'tag',
      group: 'main',
      id: 'family-care',
      selected: true,
    }),
  )
  const same = await db.asUser(s.editorA, c =>
    patchStoryList(c, f.siteId, f.collectionId, first.id, saved.catalogRevision, saved.entryRevision, {
      action: 'tag',
      group: 'main',
      id: 'family-care',
      selected: true,
    }),
  )
  expect(same.entryRevision).toBe(saved.entryRevision)
  expect(saved.values).toMatchObject({ reviewed: true })
  expect(String(saved.values.tags).split(',')).toContain('family-care')
  expect(saved.values.body).toBeUndefined()
  const after = await state(f.collectionId)
  expect(
    after.rows.map(e => [
      e.id,
      e.values.body,
      e.values.photo,
      e.values.old_address,
      e.values.story_url,
      e.published_version_id,
    ]),
  ).toEqual(
    before.rows.map(e => [
      e.id,
      e.values.body,
      e.values.photo,
      e.values.old_address,
      e.values.story_url,
      e.published_version_id,
    ]),
  )
  await expect(
    mapErrors(() =>
      db.asUser(s.editorA, c =>
        patchStoryList(c, f.siteId, f.collectionId, first.id, before.revision, before.entryRevision, {
          action: 'hidden',
          value: true,
        }),
      ),
    ),
  ).rejects.toMatchObject({ kind: 'stale_revision' })
  await expect(
    db.asUser(s.editorB, c =>
      patchStoryList(c, f.siteId, f.collectionId, first.id, after.revision, after.entryRevision, {
        action: 'hidden',
        value: true,
      }),
    ),
  ).rejects.toMatchObject({ kind: 'not_found' })
  const hidden = await db.asUser(s.contributorA, c =>
    patchStoryList(c, f.siteId, f.collectionId, first.id, after.revision, after.entryRevision, {
      action: 'hidden',
      value: true,
    }),
  )
  expect(hidden.values.hidden).toBe(true)
  await expect(
    db.asUser(s.editorA, c =>
      patchStoryList(c, f.siteId, f.collectionId, first.id, hidden.catalogRevision, hidden.entryRevision, {
        action: 'hidden',
        value: true,
        body: 'Overwritten',
      }),
    ),
  ).rejects.toMatchObject({ kind: 'invalid_state' })
})
it('filters hidden/removed/unreviewed feeds while preserving private drafts, records and visible manual selections', async () => {
  const f = await setup(),
    before = await state(f.collectionId),
    eligible = before.rows.filter(row => storyDateInFeed(row.values.published_date)),
    first = eligible[0]!
  expect(before.rows).toHaveLength(34)
  expect(eligible.length).toBeGreaterThan(0)
  await db.asUser(s.superAdmin, async c => {
    await c.query('SELECT * FROM app.publish_collection_schema($1,$2)', [f.collectionId, before.revision])
    await c.query('SELECT * FROM app.publish_collection_entries($1,$2)', [f.collectionId, before.entryRevision])
  })
  const count = (draft = false) =>
    db.as(
      'owner',
      async c =>
        (
          await c.query("SELECT app.normalize_list_selection($1,'stories',$2,$3) AS selected", [
            f.siteId,
            JSON.stringify({ mode: 'automatic', limit: 200, order: 'newest' }),
            draft,
          ])
        ).rows[0]!.selected.stableKeys as string[],
    )
  expect(await count()).toHaveLength(eligible.length)
  expect(await count()).toEqual(expect.arrayContaining(eligible.map(row => row.stable_key)))
  const live = await state(f.collectionId),
    hidden = await db.asUser(s.superAdmin, c =>
      patchStoryList(c, f.siteId, f.collectionId, first.id, live.revision, live.entryRevision, {
        action: 'hidden',
        value: true,
      }),
    )
  expect(await count()).toContain(first.stable_key)
  expect(await count(true)).not.toContain(first.stable_key)
  await db.asUser(s.superAdmin, c =>
    c.query('SELECT * FROM app.publish_collection_entries($1,$2)', [f.collectionId, hidden.entryRevision]),
  )
  expect(await count()).not.toContain(first.stable_key)
  const manual = { mode: 'manual', stableKeys: [first.stable_key] },
    visibleManual = { mode: 'manual', stableKeys: [before.rows.find(row => row.id !== first.id)!.stable_key] }
  const selected = (value: unknown) =>
    db.as(
      'owner',
      async c =>
        (
          await c.query("SELECT app.normalize_list_selection($1,'stories',$2,false) AS selected", [
            f.siteId,
            JSON.stringify(value),
          ])
        ).rows[0]!.selected,
    )
  expect(await selected(manual)).toEqual({ mode: 'manual', stableKeys: [] })
  expect(await selected(visibleManual)).toEqual(visibleManual)
  expect((await state(f.collectionId)).rows.map(row => row.id)).toEqual(before.rows.map(row => row.id))
  const current = await state(f.collectionId),
    policy = await db.asUser(s.superAdmin, c =>
      changeStoriesTags(c, f.siteId, f.collectionId, current.revision, current.entryRevision, {
        action: 'review-policy',
        publishUnreviewed: false,
      }),
    )
  expect(await count()).toHaveLength(eligible.length - 1)
  expect(await count(true)).toHaveLength(0)
  await db.asUser(s.superAdmin, c =>
    c.query('SELECT * FROM app.publish_collection_schema($1,$2)', [f.collectionId, policy.revision]),
  )
  expect(await count()).toHaveLength(0)
})
