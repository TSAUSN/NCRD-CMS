import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { CHECKED_CLEAN, TestDatabase } from '@cms/schema/testing'
import { heroContent, seedScenario, type Scenario } from '@cms/schema/fixtures'
import { SITE_CHOICE_SQL, SITE_DIRECTORY_SQL, SITE_SUMMARY_SQL } from '../src/lib/site-summary.ts'

type Summary = {
  id: string
  preview_image: string | null
  story_count: string
  page_count: string
  published_count: string
  draft_only_count: string
  changed_count: string
}

let db: TestDatabase
let s: Scenario

beforeAll(async () => {
  db = await TestDatabase.create('admin_summary')
  s = await seedScenario(db)

  // One published page with a newer saved draft.
  await db.asUser(s.editorA, client =>
    client.query('SELECT app.save_page_draft($1,$2,$3,$4)', [s.pageA, 0, heroContent(s.heroDefId, 'Published'), '{}']),
  )
  await db.asUser(s.editorA, client =>
    client.query('SELECT app.publish_page($1,$2,$3,$4,$5)', [s.pageA, 1, ...CHECKED_CLEAN]),
  )
  await db.asUser(s.editorA, client =>
    client.query('SELECT app.save_page_draft($1,$2,$3,$4)', [
      s.pageA,
      2,
      heroContent(s.heroDefId, 'Newer draft'),
      '{}',
    ]),
  )

  // One ordinary draft-only page and one archived page that must disappear
  // from every editorial total.
  const { draftOnly, archived } = await db.asUser(s.editorA, async client => ({
    draftOnly: (
      await client.query<{ id: string }>('SELECT app.create_page($1,$2,$3) AS id', [s.siteA, 'draft', 'Draft only'])
    ).rows[0]!.id,
    archived: (
      await client.query<{ id: string }>('SELECT app.create_page($1,$2,$3) AS id', [s.siteA, 'archived', 'Archived'])
    ).rows[0]!.id,
  }))
  await db.asUser(s.editorA, client =>
    client.query('SELECT app.save_page_draft($1,$2,$3,$4)', [
      draftOnly,
      0,
      heroContent(s.heroDefId, 'Draft only'),
      '{}',
    ]),
  )
  await db.as('owner', client => client.query('UPDATE pages SET archived_at = now() WHERE id = $1', [archived]))

  // A foreign site's page proves the aggregate cannot become a count oracle.
  await db.asUser(s.editorB, client => client.query('SELECT app.create_page($1,$2,$3)', [s.siteB, '', 'Private home']))
})

afterAll(async () => {
  await db?.close()
})

describe('the editorial site summary query', () => {
  it('counts visible, non-archived work and treats every draft-only page as not live', async () => {
    const { rows } = await db.asUser(s.editorA, client => client.query<Summary>(SITE_SUMMARY_SQL))
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      id: s.siteA,
      page_count: '2',
      published_count: '1',
      draft_only_count: '1',
      changed_count: '2',
    })
  })

  it('cannot reveal another tenant through either site rows or joined page counts', async () => {
    const editorA = await db.asUser(s.editorA, client => client.query<Summary>(SITE_SUMMARY_SQL))
    const editorB = await db.asUser(s.editorB, client => client.query<Summary>(SITE_SUMMARY_SQL))
    expect(editorA.rows.map(row => row.id)).toEqual([s.siteA])
    expect(editorB.rows).toHaveLength(1)
    expect(editorB.rows[0]).toMatchObject({
      id: s.siteB,
      page_count: '1',
      published_count: '0',
      draft_only_count: '1',
      changed_count: '1',
    })
  })

  it('lets a super admin see the same per-site facts without merging tenants', async () => {
    const { rows } = await db.asUser(s.superAdmin, client => client.query<Summary>(SITE_SUMMARY_SQL))
    expect(rows.map(row => [row.id, row.page_count, row.changed_count])).toEqual([
      [s.siteA, '2', '2'],
      [s.siteB, '1', '1'],
    ])
  })
})

it('separates Story article routes from ordinary pages in the shared summary', async () => {
  await db.asUser(s.editorA, c =>
    c.query('SELECT app.create_page($1,$2,$3)', [s.siteA, 'stories/summary-proof', 'Story article']),
  )
  const row = (await db.asUser(s.editorA, c => c.query<Summary>(SITE_SUMMARY_SQL))).rows[0]!
  expect(row.page_count).toBe('2')
  expect(row.story_count).toBe('0')
})
it('selects only a ready site-owned saved picture without building a page preview', async () => {
  const picture = randomUUID(),
    foreign = randomUUID()
  await db.as('owner', async c => {
    for (const [id, site] of [
      [picture, s.siteA],
      [foreign, s.siteB],
    ])
      await c.query(
        "INSERT INTO media(id,site_id,object_key,content_hash,alt_text,mime_type,status) VALUES($1,$2,$4,$3,'Saved picture','image/png','ready')",
        [id, site, 'a'.repeat(64), id],
      )
  })
  await db.asUser(s.editorA, async c => {
    const head = (
      await c.query(
        'SELECT p.revision,v.content,v.meta FROM pages p JOIN page_versions v ON v.id=p.draft_version_id WHERE p.id=$1',
        [s.pageA],
      )
    ).rows[0]!
    const content = head.content.map((section: { values: Record<string, unknown> }) => ({
      ...section,
      values: {
        ...section.values,
        unavailable: { src: '/images/missing.png' },

        photo: { media_id: picture, variant: 'original' },
      },
    }))
    await c.query('SELECT app.save_page_draft($1,$2,$3,$4)', [
      s.pageA,
      head.revision,
      JSON.stringify(content),
      JSON.stringify(head.meta),
    ])
  })
  const row = (await db.asUser(s.editorA, c => c.query<Summary>(SITE_SUMMARY_SQL))).rows[0]!
  expect(row.preview_image).toBe('/media/' + picture + '/original')
  const other = (await db.asUser(s.editorB, c => c.query<Summary>(SITE_SUMMARY_SQL))).rows[0]!
  expect(other.preview_image).toBeNull()
})

it('keeps the picker scoped, orders identical names consistently, and excludes archived sites', async () => {
  await db.as('owner', c =>
    c.query("UPDATE sites SET name='Shared label' WHERE id=ANY($1::uuid[])", [[s.siteA, s.siteB]]),
  )
  const choices = async (user: string) =>
    (await db.asUser(user, c => c.query<{ id: string; name: string }>(SITE_CHOICE_SQL))).rows
  const siteA = { id: s.siteA, name: 'Shared label' }
  const siteB = { id: s.siteB, name: 'Shared label' }
  expect(await choices(s.superAdmin)).toEqual([siteA, siteB])
  expect(await choices(s.editorA)).toEqual([siteA])
  expect(await choices(s.editorB)).toEqual([siteB])
  expect(await choices(s.disabled)).toEqual([])
  await db.as('owner', c => c.query('UPDATE sites SET archived_at=now() WHERE id=$1', [s.siteB]))
  for (const query of [SITE_SUMMARY_SQL, SITE_DIRECTORY_SQL]) {
    const rows = (await db.asUser(s.superAdmin, client => client.query<{ id: string; status: string }>(query))).rows
    expect(rows.find(row => row.id === s.siteB)?.status).toBe('archived')
  }
  expect(await choices(s.superAdmin)).toEqual([siteA])
  expect(await choices(s.editorB)).toEqual([])
})
