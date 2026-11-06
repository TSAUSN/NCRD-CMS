import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { CHECKED_CLEAN, TestDatabase } from '@cms/schema/testing'
import { heroContent, seedScenario, type Scenario } from '@cms/schema/fixtures'
import { PAGE_HISTORY_SQL, PAGE_HISTORY_VERSION_SQL } from '../src/lib/page-history.ts'

type Row = {
  id: string
  revision: string
  kind: string
  authored_by_me: boolean
  is_current_draft: boolean
  is_live_now: boolean
  was_published: boolean
  was_restored: boolean
}

let db: TestDatabase
let s: Scenario
let firstAutosave: string
let publishedCheckpoint: string
let currentAutosave: string

beforeAll(async () => {
  db = await TestDatabase.create('admin_page_history')
  s = await seedScenario(db)

  firstAutosave = (
    await db.asUser(s.editorA, client =>
      client.query<{ version_id: string }>('SELECT * FROM app.save_page_draft($1,$2,$3,$4,$5)', [
        s.pageA,
        0,
        heroContent(s.heroDefId, 'First automatic save'),
        '{}',
        'autosave',
      ]),
    )
  ).rows[0]!.version_id
  publishedCheckpoint = (
    await db.asUser(s.editorA, client =>
      client.query<{ version_id: string }>('SELECT * FROM app.save_page_draft($1,$2,$3,$4,$5)', [
        s.pageA,
        1,
        heroContent(s.heroDefId, 'Published checkpoint'),
        '{}',
        'checkpoint',
      ]),
    )
  ).rows[0]!.version_id
  await db.asUser(s.editorA, client =>
    client.query('SELECT app.publish_page($1,$2,$3,$4,$5)', [s.pageA, 2, ...CHECKED_CLEAN]),
  )
  currentAutosave = (
    await db.asUser(s.editorA, client =>
      client.query<{ version_id: string }>('SELECT * FROM app.save_page_draft($1,$2,$3,$4,$5)', [
        s.pageA,
        3,
        heroContent(s.heroDefId, 'Current automatic save'),
        '{}',
        'autosave',
      ]),
    )
  ).rows[0]!.version_id
})

afterAll(async () => {
  await db?.close()
})

describe('the page history query', () => {
  it('hides routine autosaves but always keeps the current draft and live version', async () => {
    const { rows } = await db.asUser(s.editorA, client =>
      client.query<Row>(PAGE_HISTORY_SQL, [s.pageA, false, null, 31]),
    )
    expect(rows.map(row => row.id)).toEqual([currentAutosave, publishedCheckpoint])
    expect(rows[0]).toMatchObject({
      kind: 'autosave',
      authored_by_me: true,
      is_current_draft: true,
      is_live_now: false,
      was_published: false,
      was_restored: false,
    })
    expect(rows[1]).toMatchObject({
      kind: 'checkpoint',
      authored_by_me: true,
      is_current_draft: false,
      is_live_now: true,
      was_published: true,
      was_restored: false,
    })
  })

  it('can show automatic saves and paginates without repeating the boundary', async () => {
    const all = await db.asUser(s.editorA, client => client.query<Row>(PAGE_HISTORY_SQL, [s.pageA, true, null, 31]))
    expect(all.rows.map(row => row.id)).toEqual([currentAutosave, publishedCheckpoint, firstAutosave])

    const first = await db.asUser(s.editorA, client => client.query<Row>(PAGE_HISTORY_SQL, [s.pageA, true, null, 1]))
    const second = await db.asUser(s.editorA, client =>
      client.query<Row>(PAGE_HISTORY_SQL, [s.pageA, true, first.rows[0]!.revision, 1]),
    )
    expect(first.rows[0]!.id).toBe(currentAutosave)
    expect(second.rows[0]!.id).toBe(publishedCheckpoint)
  })

  it('scopes the selected-version query to both the page and the reader', async () => {
    const own = await db.asUser(s.editorA, client =>
      client.query<Row>(PAGE_HISTORY_VERSION_SQL, [s.pageA, publishedCheckpoint]),
    )
    expect(own.rows).toHaveLength(1)

    const wrongPage = await db.asUser(s.editorA, client =>
      client.query<Row>(PAGE_HISTORY_VERSION_SQL, [s.pageA, '00000000-0000-0000-0000-000000000000']),
    )
    expect(wrongPage.rows).toHaveLength(0)

    const hidden = await db.asUser(s.editorB, client => client.query<Row>(PAGE_HISTORY_SQL, [s.pageA, true, null, 31]))
    expect(hidden.rows).toHaveLength(0)
  })

  it('does not turn a pre-hardening forged kind into a claimed restore operation', async () => {
    const { rows: forged } = await db.as('owner', client =>
      client.query<{ id: string }>(
        `
      INSERT INTO page_versions (
        site_id, page_id, revision, content, meta, carries_trusted_code,
        kind, note, author_id
      )
      SELECT site_id, page_id, 999, content, meta, carries_trusted_code,
             'restore'::version_kind, 'legacy forged label', author_id
        FROM page_versions
       WHERE id = $1
      RETURNING id
    `,
        [publishedCheckpoint],
      ),
    )

    const row = await db.asUser(s.editorA, client =>
      client.query<Row>(PAGE_HISTORY_VERSION_SQL, [s.pageA, forged[0]!.id]),
    )
    expect(row.rows[0]).toMatchObject({ kind: 'restore', was_restored: false })
  })
})
