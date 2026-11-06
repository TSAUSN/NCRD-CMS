import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { CHECKED_CLEAN, TestDatabase } from '@cms/schema/testing'
import { heroContent, seedScenario, type Scenario } from '@cms/schema/fixtures'
import { LINK_TARGETS_SQL } from '../src/lib/link-targets.ts'

type Target = { id: string; title: string; path: string }

let db: TestDatabase
let s: Scenario

async function publishPage(userId: string, pageId: string): Promise<void> {
  await db.asUser(userId, client =>
    client.query('SELECT app.save_page_draft($1,$2,$3,$4)', [pageId, 0, heroContent(s.heroDefId), '{}']),
  )
  await db.asUser(userId, client =>
    client.query('SELECT app.publish_page($1,$2,$3,$4,$5)', [pageId, 1, ...CHECKED_CLEAN]),
  )
}

beforeAll(async () => {
  db = await TestDatabase.create('admin_link_targets')
  s = await seedScenario(db)
  await publishPage(s.editorA, s.pageA)

  const about = await db.asUser(
    s.editorA,
    async client =>
      (await client.query<{ id: string }>('SELECT app.create_page($1,$2,$3) AS id', [s.siteA, 'about', 'About us']))
        .rows[0]!.id,
  )
  await publishPage(s.editorA, about)

  await db.asUser(s.editorA, client =>
    client.query('SELECT app.create_page($1,$2,$3)', [s.siteA, 'draft', 'Draft only']),
  )

  const foreign = await db.asUser(
    s.editorB,
    async client =>
      (await client.query<{ id: string }>('SELECT app.create_page($1,$2,$3) AS id', [s.siteB, '', 'Private home']))
        .rows[0]!.id,
  )
  await publishPage(s.editorB, foreign)
})

afterAll(async () => {
  await db?.close()
})

describe('the internal-page link target query', () => {
  it('offers only published pages and turns the home slug into the root path', async () => {
    const { rows } = await db.asUser(s.editorA, client => client.query<Target>(LINK_TARGETS_SQL, [s.siteA]))
    expect(rows.map(({ title, path }) => ({ title, path }))).toEqual([
      { title: 'Home', path: '/' },
      { title: 'About us', path: '/about' },
    ])
  })

  it('cannot reveal targets from a site the reader cannot access', async () => {
    const { rows } = await db.asUser(s.editorA, client => client.query<Target>(LINK_TARGETS_SQL, [s.siteB]))
    expect(rows).toEqual([])
  })

  it('keeps each site separate even for a super admin', async () => {
    const { rows } = await db.asUser(s.superAdmin, client => client.query<Target>(LINK_TARGETS_SQL, [s.siteB]))
    expect(rows.map(({ title, path }) => ({ title, path }))).toEqual([{ title: 'Private home', path: '/' }])
  })

  it('offers the live address and name while a renamed draft waits for publication', async () => {
    await db.asUser(s.editorA, client =>
      client.query('SELECT app.rename_page($1,$2,$3,$4)', [s.pageA, 2, 'Private new name', 'private-new-address']),
    )
    const { rows } = await db.asUser(s.editorA, client => client.query<Target>(LINK_TARGETS_SQL, [s.siteA]))
    expect(rows.find(row => row.id === s.pageA)).toMatchObject({ title: 'Home', path: '/' })
  })
})
