import { randomUUID } from 'node:crypto'
import { beforeAll, afterAll, it, expect } from 'vitest'
import { TestDatabase } from '@cms/schema/testing'
import { seedScenario, type Scenario } from '@cms/schema/fixtures'
import { emptyStoriesSettings, storyTagIds } from '@cms/schema'
import { STORIES_MODEL } from '@cms/seeds/sawso-stories'
import { mapErrors } from '@cms/domain'
import { ensureSawsoSite } from '../src/lib/sawso-site.ts'
import { changeStoriesTags, type StoriesTagOperation } from '../src/lib/stories-tags.ts'
import { withStoriesCatalog } from '../src/lib/stories-catalog.ts'
import { saveStoryDetails } from '../src/lib/stories-edit.ts'
let db: TestDatabase, s: Scenario
beforeAll(async () => {
  db = await TestDatabase.create('stories_tags')
  s = await seedScenario(db)
})
afterAll(async () => db.close())
async function setup() {
  return db.asUser(s.superAdmin, async c => {
    const site = await ensureSawsoSite(c, randomUUID(), 'sawso-' + randomUUID().slice(0, 8))
    const admin = (
      await c.query('SELECT app.provision_user($1,$2) AS id', [
        'tags-' + randomUUID().slice(0, 8) + '@example.test',
        '[Name]',
      ])
    ).rows[0]!.id
    await c.query("SELECT app.set_site_membership($1,$2,'site_admin')", [admin, site.siteId])
    const head = (await c.query('SELECT revision,entry_revision FROM collections WHERE id=$1', [site.collectionId]))
      .rows[0]!
    return { ...site, admin, revision: String(head.revision), entryRevision: String(head.entry_revision) }
  })
}
const rows = (collectionId: string) =>
  db.asUser(
    s.superAdmin,
    async c =>
      (
        await c.query(
          'SELECT e.id,e.stable_key,v.values,e.published_version_id FROM collection_entries e JOIN collection_entry_versions v ON v.id=e.draft_version_id WHERE e.collection_id=$1 ORDER BY e.sort_index,e.created_at,e.id',
          [collectionId],
        )
      ).rows,
  )
it('lets a Site admin add/rename/reorder stable tags as private drafts, preserving body, photo and addresses', async () => {
  const f = await setup(),
    before = await rows(f.collectionId)
  let result = await db.asUser(f.admin, c =>
    changeStoriesTags(c, f.siteId, f.collectionId, f.revision, f.entryRevision, {
      action: 'add',
      group: 'main',
      label: 'Anniversary',
      keywords: ['anniversary'],
      areas: [],
    }),
  )
  const added = result.settings.mainTags.find(t => t.label === 'Anniversary')!
  result = await db.asUser(f.admin, c =>
    changeStoriesTags(c, f.siteId, f.collectionId, result.revision, result.entryRevision, {
      action: 'edit',
      group: 'main',
      id: added.id,
      label: 'Fifty years',
      keywords: ['fifty years'],
      areas: [],
    }),
  )
  expect(result.settings.mainTags.find(t => t.id === added.id)?.label).toBe('Fifty years')
  result = await db.asUser(f.admin, c =>
    changeStoriesTags(c, f.siteId, f.collectionId, result.revision, result.entryRevision, {
      action: 'move',
      group: 'main',
      id: added.id,
      before: result.settings.mainTags[0]!.id,
    }),
  )
  expect(result.settings.mainTags[0]!.id).toBe(added.id)
  const unchanged = await db.asUser(f.admin, c =>
    changeStoriesTags(c, f.siteId, f.collectionId, result.revision, result.entryRevision, {
      action: 'rename-group',
      group: 'main',
      label: result.settings.mainLabel,
    }),
  )
  expect(unchanged).toMatchObject({ changed: false, revision: result.revision, entryRevision: result.entryRevision })
  const after = await rows(f.collectionId)
  expect(
    after.map(e => [
      e.id,
      e.values.body,
      e.values.photo,
      e.values.old_address,
      e.values.story_url,
      e.published_version_id,
    ]),
  ).toEqual(
    before.map(e => [
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
      db.asUser(f.admin, c =>
        changeStoriesTags(c, f.siteId, f.collectionId, f.revision, f.entryRevision, {
          action: 'rename-group',
          group: 'main',
          label: 'Outdated',
        }),
      ),
    ),
  ).rejects.toMatchObject({ kind: 'stale_revision' })
})
it('moves stories on delete and accepts renamed/custom main and multiple secondary tags in the existing editor', async () => {
  const f = await setup()
  let result = await db.asUser(f.admin, c =>
    changeStoriesTags(c, f.siteId, f.collectionId, f.revision, f.entryRevision, {
      action: 'add',
      group: 'main',
      label: 'Campaign',
      keywords: [],
      areas: [],
    }),
  )
  const newTag = result.settings.mainTags.find(t => t.label === 'Campaign')!
  result = await db.asUser(f.admin, c =>
    changeStoriesTags(c, f.siteId, f.collectionId, result.revision, result.entryRevision, {
      action: 'delete',
      group: 'main',
      id: 'health',
      replacement: newTag.id,
    }),
  )
  expect(result.entries.some(e => storyTagIds(e.values, 'main').includes('health'))).toBe(false)
  const target = result.entries.find(e => storyTagIds(e.values, 'main').includes(newTag.id))!,
    v = target.values
  const saved = await db.asUser(f.admin, c =>
    saveStoryDetails(c, f.siteId, f.collectionId, target.id, result.entryRevision, {
      title: String(v.title),
      summary: String(v.summary),
      tags: [newTag.id],
      region: 'africa',
      regions: ['africa', 'asia'],
      published_date: String(v.published_date),
      countries: String(v.countries ?? ''),
      body: String(v.body ?? ''),
      body_is_sample: v.body_is_sample === true,
    }),
  )
  expect(storyTagIds(saved.values, 'secondary')).toEqual(['africa', 'asia'])
  expect(saved.values.tags).toBe(newTag.id)
})
it('re-suggests only unreviewed stories and rolls back invalid or unauthorized changes', async () => {
  const f = await setup(),
    before = await rows(f.collectionId),
    first = before[0]!
  const marked = await db.asUser(f.admin, async c => {
    const initialized = await changeStoriesTags(c, f.siteId, f.collectionId, f.revision, f.entryRevision, {
      action: 'rename-group',
      group: 'secondary',
      label: 'Regions',
    })
    const current = await c.query(
      'SELECT e.id,e.stable_key,v.values FROM collection_entries e JOIN collection_entry_versions v ON v.id=e.draft_version_id WHERE e.collection_id=$1 ORDER BY e.sort_index,e.created_at,e.id',
      [f.collectionId],
    )
    const saved = (
      await c.query('SELECT * FROM app.save_collection_entries($1,$2,$3)', [
        f.collectionId,
        initialized.entryRevision,
        JSON.stringify(
          current.rows.map(row => ({
            id: row.id,
            stableKey: row.stable_key,
            values:
              row.id === first.id
                ? { ...row.values, reviewed: true, tags: 'family-care', regions: 'europe', region: 'europe' }
                : row.values,
          })),
        ),
      ])
    ).rows[0]!
    return { ...initialized, entryRevision: String(saved.entry_revision) }
  })
  const result = await db.asUser(f.admin, c =>
    changeStoriesTags(c, f.siteId, f.collectionId, marked.revision, marked.entryRevision, { action: 'resuggest' }),
  )
  expect(result.entries.find(e => e.id === first.id)!.values).toMatchObject({
    reviewed: true,
    tags: 'family-care',
    region: 'europe',
    regions: 'europe',
  })
  expect(result.entries.map(e => [e.id, e.values.body, e.values.photo, e.values.old_address])).toEqual(
    before.map(e => [e.id, e.values.body, e.values.photo, e.values.old_address]),
  )
  for (const actor of [s.editorA, s.contributorA, s.editorB])
    await expect(
      db.asUser(actor, c =>
        changeStoriesTags(c, f.siteId, f.collectionId, result.revision, result.entryRevision, {
          action: 'rename-group',
          group: 'main',
          label: 'Unauthorized',
        }),
      ),
    ).rejects.toBeTruthy()
  await expect(
    db.asUser(f.admin, c =>
      changeStoriesTags(c, f.siteId, f.collectionId, result.revision, result.entryRevision, {
        action: 'delete',
        group: 'main',
        id: 'education',
        replacement: 'africa',
      }),
    ),
  ).rejects.toThrow('same group')
  await expect(
    db.asUser(f.admin, c =>
      changeStoriesTags(c, s.siteB, f.collectionId, result.revision, result.entryRevision, { action: 'resuggest' }),
    ),
  ).rejects.toMatchObject({ kind: 'not_found' })
})
it('uses independent names, tags and region areas on another site without SAWSO defaults', async () => {
  const model = withStoriesCatalog(STORIES_MODEL, {
    ...emptyStoriesSettings(),
    mainLabel: 'Topics',
    secondaryLabel: 'Divisions',
  })
  const collection = await db.asUser(
    s.superAdmin,
    async c =>
      (
        await c.query('SELECT * FROM app.create_collection($1,$2,$3,$4,$5,$6)', [
          s.siteB,
          'stories',
          'Stories',
          'stories',
          JSON.stringify(model.fields),
          JSON.stringify(model.presentation),
        ])
      ).rows[0]!,
  )
  const operation: StoriesTagOperation = {
    action: 'add',
    group: 'secondary',
    label: 'Division one',
    keywords: ['gathering'],
    areas: ['north-america'],
  }
  const result = await db.asUser(s.superAdmin, c =>
    changeStoriesTags(
      c,
      s.siteB,
      collection.collection_id,
      String(collection.revision),
      String(collection.entry_revision),
      operation,
    ),
  )
  expect(result.settings).toMatchObject({
    mainLabel: 'Topics',
    secondaryLabel: 'Divisions',
    mainTags: [],
    source: 'none',
    secondaryTags: [{ id: 'division-one', label: 'Division one', keywords: ['gathering'], areas: ['north-america'] }],
  })
})
