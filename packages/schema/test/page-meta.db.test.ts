// The database's own guard on page metadata (migration 0022).
//
// TypeScript validates at the save boundary, but `app.save_page_draft` is
// EXECUTE to cms_authenticated_user and the column is an ordinary jsonb column,
// so a caller that never heard of `parsePageMeta` can still write it — which is
// exactly how finding S-02 happened: a schema everyone believed was running.
// A CHECK constraint is every caller, including a hand-run UPDATE and a
// restore, rather than one command that a future caller can go around.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { TestDatabase } from './harness.ts'
import { seedScenario, type Scenario } from './fixtures.ts'

let db: TestDatabase
let s: Scenario

beforeAll(async () => {
  db = await TestDatabase.create('pagemeta')
  s = await seedScenario(db)
})
afterAll(async () => {
  await db?.close()
})

const defect = async (meta: unknown): Promise<string | null> => {
  const { rows } = await db.as('owner', c =>
    c.query<{ d: string | null }>('SELECT app.page_meta_defect($1::jsonb) AS d', [
      meta === undefined ? null : JSON.stringify(meta),
    ]),
  )
  return rows[0]!.d
}

async function saveWithMeta(meta: unknown): Promise<{ ok: boolean; message: string }> {
  const page = await db.asUser(
    s.editorA,
    async c =>
      (
        await c.query<{ id: string }>('SELECT app.create_page($1,$2,$3) AS id', [
          s.siteA,
          `meta-${Math.random().toString(36).slice(2, 8)}`,
          'Meta',
        ])
      ).rows[0]!.id,
  )
  try {
    await db.asUser(s.editorA, c =>
      c.query('SELECT app.save_page_draft($1,$2,$3,$4,$5,$6)', [
        page,
        0,
        '[]',
        JSON.stringify(meta),
        'checkpoint',
        'meta test',
      ]),
    )
    return { ok: true, message: '' }
  } catch (error) {
    return { ok: false, message: (error as Error).message }
  }
}

describe('the shape a page’s metadata has to have', () => {
  it.each([
    ['nothing at all', undefined],
    ['an empty object', {}],
    ['every field it knows', { title: 'T', description: 'D', canonical: '/p', social_image: '/i.png', noindex: true }],
    ['a canonical at exactly the limit', { canonical: `/${'x'.repeat(2047)}` }],
  ])('accepts %s', async (_label, meta) => {
    expect(await defect(meta)).toBeNull()
  })

  it.each([
    ['a key it does not know', { og_locale: 'en_GB' }, 'not a metadata field'],
    ['a canonical one over the limit', { canonical: `/${'x'.repeat(2048)}` }, 'longer than 2048'],
    ['a title that is not text', { title: 7 }, 'not text'],
    ['a nested title', { title: { text: 'T' } }, 'not text'],
    ['a description that is not text', { description: [] }, 'not text'],
    ['a noindex that is not a flag', { noindex: 'yes' }, 'true or false'],
    ['metadata that is not an object', ['title'], 'not an object'],
    ['a title longer than the limit', { title: 'x'.repeat(513) }, 'longer than 512'],
    ['a description longer than the limit', { description: 'x'.repeat(2049) }, 'longer than 2048'],
  ])('refuses %s', async (_label, meta, expected) => {
    expect(await defect(meta)).toContain(expected)
  })
})

describe('every writer meets the guard, not just the ones that remembered', () => {
  it('refuses a draft saved through the command', async () => {
    const result = await saveWithMeta({ og_locale: 'en_GB' })
    expect(result.ok).toBe(false)
    expect(result.message).toContain('page_versions_meta_shape')
  })

  it('accepts a draft whose metadata is well formed', async () => {
    expect((await saveWithMeta({ title: 'Fine', noindex: false })).ok).toBe(true)
  })

  it('refuses a direct UPDATE by the table owner, which no command mediates', async () => {
    // The reason this is a constraint rather than a check inside the command.
    await expect(
      db.as('owner', c =>
        c.query(`UPDATE page_versions SET meta = '{"evil":1}'::jsonb
                WHERE id = (SELECT id FROM page_versions LIMIT 1)`),
      ),
    ).rejects.toThrow(/page_versions_meta_shape/)
  })

  it('leaves the canonical ownership question to the renderer', async () => {
    // Shape and size here; whether the URL names this site is a question this
    // layer cannot answer, because it does not know which host is verified.
    expect(await defect({ canonical: 'https://evil.test/x' })).toBeNull()
  })
})
