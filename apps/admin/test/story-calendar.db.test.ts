import { beforeAll, afterAll, it, expect } from 'vitest'
import { TestDatabase } from '@cms/schema/testing'
import { seedScenario, type Scenario } from '@cms/schema/fixtures'
import { createStoriesModel, emptyStoriesSettings } from '@cms/schema'
import { saveStoryCalendarDay } from '../src/lib/story-calendar-commands.ts'
let db: TestDatabase, s: Scenario, list: string, ids: string[]
beforeAll(async () => {
  db = await TestDatabase.create('story_calendar')
  s = await seedScenario(db)
  await db.asUser(s.superAdmin, async c => {
    const m = createStoriesModel(emptyStoriesSettings())
    list = (
      await c.query('SELECT * FROM app.create_collection($1,$2,$3,$4,$5,$6)', [
        s.siteA,
        'stories',
        'Stories',
        'stories',
        JSON.stringify(m.fields),
        JSON.stringify(m.presentation),
      ])
    ).rows[0]!.collection_id
    await c.query('SELECT * FROM app.save_collection_entries($1,0,$2)', [
      list,
      JSON.stringify(
        [1, 2].map(n => ({
          id: null,
          stableKey: 'story-' + n,
          values: {
            title: '[Story ' + n + ']',
            summary: '[Description]',
            published_date: '',
            story_url: '/stories/story-' + n,
            body: '<p>[Text]</p>',
          },
        })),
      ),
    ])
    ids = (
      await c.query('SELECT id FROM collection_entries WHERE collection_id=$1 ORDER BY stable_key', [list])
    ).rows.map(r => r.id)
  })
})
afterAll(async () => {
  await db?.close()
})
async function rows() {
  return db.asUser(s.superAdmin, async c => ({
    head: (await c.query('SELECT * FROM collections WHERE id=$1', [list])).rows[0]!,
    entries: (
      await c.query(
        'SELECT e.*,v.values FROM collection_entries e JOIN collection_entry_versions v ON v.id=e.draft_version_id WHERE e.collection_id=$1 ORDER BY e.stable_key',
        [list],
      )
    ).rows,
  }))
}
it('rejects invalid days, foreign sites, stale choices and unauthorized writes without changing records', async () => {
  const before = await rows()
  for (const day of ['bad', '2026-02-30'])
    await expect(
      db.asUser(s.superAdmin, c =>
        saveStoryCalendarDay(c, s.siteA, list, ids[0]!, String(before.head.entry_revision), day),
      ),
    ).rejects.toBeTruthy()
  await expect(
    db.asUser(s.superAdmin, c =>
      saveStoryCalendarDay(c, s.siteB, list, ids[0]!, String(before.head.entry_revision), '2026-11-02'),
    ),
  ).rejects.toBeTruthy()
  await expect(
    db.asUser(s.superAdmin, c => saveStoryCalendarDay(c, s.siteA, list, ids[0]!, '999', '2026-11-02')),
  ).rejects.toBeTruthy()
  await expect(
    db.asUser(s.contributorA, c =>
      saveStoryCalendarDay(c, s.siteA, list, ids[0]!, String(before.head.entry_revision), '2026-11-02'),
    ),
  ).rejects.toBeTruthy()
  expect(await rows()).toEqual(before)
})
it('saves only the selected private date, preserves another draft and retries the same choice without an extra version', async () => {
  const before = await rows(),
    revision = String(before.head.entry_revision),
    saved = await db.asUser(s.superAdmin, c => saveStoryCalendarDay(c, s.siteA, list, ids[0]!, revision, '2026-11-02')),
    after = await rows()
  expect(saved.values).toEqual({ ...before.entries[0]!.values, published_date: '2026-11-02' })
  expect(after.entries[1]).toEqual(before.entries[1])
  expect(after.entries[0]!.published_version_id).toBeNull()
  expect(after.head.published_entry_revision).toBe(before.head.published_entry_revision)
  await db.asUser(s.superAdmin, c => saveStoryCalendarDay(c, s.siteA, list, ids[0]!, revision, '2026-11-02'))
  expect(await rows()).toEqual(after)
  await expect(
    db.asUser(s.superAdmin, c => saveStoryCalendarDay(c, s.siteA, list, ids[0]!, saved.revision, '2026-11-03')),
  ).rejects.toBeTruthy()
})
