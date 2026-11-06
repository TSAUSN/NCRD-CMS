import { createHash } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { TestDatabase, expectSqlState } from './harness.ts'
import { seedScenario, type Scenario } from './fixtures.ts'

let db: TestDatabase,
  s: Scenario,
  serial = 0
const hash = 'b'.repeat(64)
const query = (actor: string | null, sql: string, args: unknown[] = []) => db.asUser(actor, c => c.query(sql, args))
async function upload(site = s.siteA) {
  const name = `library-${++serial}.pdf`,
    value = createHash('sha256').update(`cms-site-document:1:${site}:${hash}:${name}`).digest('hex')
  const id = `${value.slice(0, 8)}-${value.slice(8, 12)}-4${value.slice(13, 16)}-a${value.slice(17, 20)}-${value.slice(20, 32)}`
  await query(s.superAdmin, 'SELECT app.upload_site_document($1,$2,99,$3,$4)', [site, id, hash, name])
  return id
}
const organize = (
  id: string,
  revision: number | null,
  category: string | null,
  archived: boolean | null,
  actor: string | null = s.contributorA,
  site = s.siteA,
) =>
  query(actor, 'SELECT app.organize_site_document($1,$2,$3,$4,$5) AS revision', [
    site,
    id,
    revision,
    category,
    archived,
  ])
beforeAll(async () => {
  db = await TestDatabase.create('documentlibrary')
  s = await seedScenario(db)
})
afterAll(async () => {
  await db?.close()
})
describe('PDF library metadata never rewrites immutable receipts', () => {
  it('initializes metadata for uploads and permits bounded organization by contributors', async () => {
    const id = await upload()
    expect(
      (
        await query(s.contributorA, 'SELECT category,archived,revision FROM site_document_metadata WHERE asset_id=$1', [
          id,
        ])
      ).rows,
    ).toEqual([{ category: '', archived: false, revision: '0' }])
    await organize(id, 0, 'Annual reports', false)
    expect(
      (await query(s.editorA, 'SELECT category,revision FROM site_document_metadata WHERE asset_id=$1', [id])).rows,
    ).toEqual([{ category: 'Annual reports', revision: '1' }])
  })
  it('archives/restores with idempotent retries and leaves bytes and immutable usage alone', async () => {
    const id = await upload()
    const before = (await db.as('owner', c => c.query('SELECT * FROM site_assets WHERE id=$1', [id]))).rows
    expect((await organize(id, 0, '', true)).rows[0]!.revision).toBe('1')
    expect((await organize(id, 0, '', true)).rows[0]!.revision).toBe('1')
    expect(
      (
        await query(
          s.editorA,
          "SELECT count(*)::int AS n FROM audit_log WHERE item_id=$1 AND action='document.organize'",
          [id],
        )
      ).rows[0]!.n,
    ).toBe(1)
    expect((await organize(id, 1, '', false)).rows[0]!.revision).toBe('2')
    expect((await db.as('owner', c => c.query('SELECT * FROM site_assets WHERE id=$1', [id]))).rows).toEqual(before)
  })
  it('refuses stale updates and concurrent changes lose no metadata', async () => {
    const id = await upload()
    const results = await Promise.allSettled([organize(id, 0, 'A', false), organize(id, 0, 'B', true)])
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1)
    const rejected = results.find(r => r.status === 'rejected') as PromiseRejectedResult
    expect(rejected.reason.code).toBe('CMS01')
    await expectSqlState(organize(id, null, 'C', false), 'CMS04')
  })
  it('enforces membership, active user, PDF/site association and no direct mutation grants', async () => {
    const id = await upload(),
      foreign = await upload(s.siteB)
    for (const actor of [s.editorB, s.disabled, null]) await expectSqlState(organize(id, 0, '', true, actor), 'CMS02')
    await expectSqlState(organize(foreign, 0, '', true), 'CMS03')
    expect((await query(s.editorB, 'SELECT * FROM site_document_metadata WHERE asset_id=$1', [id])).rows).toEqual([])
    await expectSqlState(
      query(s.editorA, 'UPDATE site_document_metadata SET archived=true WHERE asset_id=$1', [id]),
      '42501',
    )
    for (const role of ['public', 'worker'] as const)
      await expectSqlState(
        db.as(role, c => c.query('SELECT * FROM public.site_document_metadata')),
        '42501',
      )
  })
  it('rejects malformed category/state without changing current metadata', async () => {
    const id = await upload()
    for (const category of [null, 'x'.repeat(81), ' padded', 'line\nbreak'])
      await expectSqlState(organize(id, 0, category, false), 'CMS04')
    await expectSqlState(organize(id, 0, '', null), 'CMS04')
    expect(
      (await query(s.editorA, 'SELECT revision FROM site_document_metadata WHERE asset_id=$1', [id])).rows[0]!.revision,
    ).toBe('0')
  })
})
