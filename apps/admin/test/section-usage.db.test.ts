import { afterAll, beforeAll, expect, it } from 'vitest'
import { CHECKED_CLEAN, TestDatabase } from '@cms/schema/testing'
import { heroContent, seedScenario, type Scenario } from '@cms/schema/fixtures'
import { CURRENT_SECTION_USES_SQL, SECTION_USAGE_SQL, type SectionUsageRow } from '../src/lib/section-usage.ts'

let db: TestDatabase
let s: Scenario
let draftPage: string
let foreignPage: string

beforeAll(async () => {
  db = await TestDatabase.create('admin_section_usage')
  s = await seedScenario(db)
  await db.asUser(s.editorA, async client => {
    await client.query('SELECT app.save_page_draft($1,$2,$3,$4)', [s.pageA, 0, heroContent(s.heroDefId), '{}'])
    await client.query('SELECT app.publish_page($1,$2,$3,$4,$5)', [s.pageA, 1, ...CHECKED_CLEAN])
    // Removing it from the draft does not erase the still-published placement.
    await client.query('SELECT app.save_page_draft($1,$2,$3,$4)', [s.pageA, 2, '[]', '{}'])
    draftPage = (
      await client.query<{ id: string }>('SELECT app.create_page($1,$2,$3) AS id', [
        s.siteA,
        'draft-usage',
        'Draft placement',
      ])
    ).rows[0]!.id
    const section = JSON.parse(heroContent(s.heroDefId))[0]
    await client.query('SELECT app.save_page_draft($1,$2,$3,$4)', [
      draftPage,
      0,
      JSON.stringify([section, { ...section, hidden: true }]),
      '{}',
    ])
  })
  await db.asUser(s.editorB, async client => {
    foreignPage = (
      await client.query<{ id: string }>('SELECT app.create_page($1,$2,$3) AS id', [
        s.siteB,
        'foreign-usage',
        'Other tenant',
      ])
    ).rows[0]!.id
    await client.query('SELECT app.save_page_draft($1,$2,$3,$4)', [foreignPage, 0, heroContent(s.heroDefId), '{}'])
  })
})

afterAll(async () => {
  await db?.close()
})

const usage = (userId: string, after: string | null = null) =>
  db.asUser(userId, async client => (await client.query<SectionUsageRow>(SECTION_USAGE_SQL, [s.heroDefId, after])).rows)

it('distinguishes a still-live removal from unpublished additions and hidden placements', async () => {
  const rows = await usage(s.editorA)
  expect(rows).toHaveLength(2)
  expect(rows.find(row => row.page_id === s.pageA)).toMatchObject({
    draft_instances: 0,
    live_instances: 1,
    draft_versions: null,
    live_versions: ['1'],
  })
  expect(rows.find(row => row.page_id === draftPage)).toMatchObject({
    draft_instances: 2,
    live_instances: 0,
    hidden_draft_instances: 1,
    first_draft_index: 0,
  })
})

it('keeps usage counts consistent without counting duplicate placements as extra pages', async () => {
  const rows = await db.asUser(
    s.editorA,
    async client =>
      (
        await client.query<{ count: number }>(
          `WITH current_uses AS (${CURRENT_SECTION_USES_SQL}) SELECT count(DISTINCT page_id)::int AS count FROM current_uses WHERE section_def_id = $1`,
          [s.heroDefId],
        )
      ).rows,
  )
  expect(rows[0]!.count).toBe(2)
})

it('applies real reader roles across sites, including disabled accounts', async () => {
  expect((await usage(s.contributorA)).map(row => row.site_id)).toEqual([s.siteA, s.siteA])
  expect((await usage(s.editorB)).map(row => row.page_id)).toEqual([foreignPage])
  expect(await usage(s.disabled)).toEqual([])
  expect(await usage(s.superAdmin)).toHaveLength(3)
})

it('paginates by stable page identity without repeating rows', async () => {
  const rows = await usage(s.superAdmin)
  expect((await usage(s.superAdmin, rows[0]!.page_id)).map(row => row.page_id)).toEqual(
    rows.slice(1).map(row => row.page_id),
  )
})

it('excludes archived pages while their immutable history remains stored', async () => {
  await db.asUser(s.editorA, client => client.query('SELECT app.archive_page($1,$2)', [draftPage, 1]))
  expect((await usage(s.editorA)).map(row => row.page_id)).toEqual([s.pageA])
})
