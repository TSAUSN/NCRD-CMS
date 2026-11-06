import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { CHECKED_CLEAN, TestDatabase, expectSqlState } from './harness.ts'
import { heroContent, seedScenario, type Scenario } from './fixtures.ts'

let db: TestDatabase
let s: Scenario
let counter = 0
beforeAll(async () => {
  db = await TestDatabase.create('page_lifecycle')
  s = await seedScenario(db)
})
afterAll(async () => {
  await db?.close()
})

async function page(published = false) {
  const slug = `lifecycle-${++counter}`
  const created = await db.asUser(s.editorA, async c => {
    const id = (
      await c.query<{ id: string }>('SELECT app.create_page($1,$2,$3) AS id', [s.siteA, slug, 'Original name'])
    ).rows[0]!.id
    const draft = (
      await c.query<{ version_id: string; revision: string }>('SELECT * FROM app.save_page_draft($1,$2,$3,$4)', [
        id,
        0,
        heroContent(s.heroDefId),
        '{}',
      ])
    ).rows[0]!
    return { id, slug, draft: draft.version_id, revision: Number(draft.revision) }
  })
  if (published) created.revision = await publish(created.id, created.revision)
  return created
}

async function publish(id: string, revision: number): Promise<number> {
  return db.asUser(s.editorA, async c =>
    Number(
      (
        await c.query<{ revision: string }>('SELECT * FROM app.publish_page($1,$2,$3,$4,$5)', [
          id,
          revision,
          ...CHECKED_CLEAN,
        ])
      ).rows[0]!.revision,
    ),
  )
}

async function rename(id: string, revision: number | null, title: string, slug: string, user = s.editorA) {
  return db.asUser(
    user,
    async c =>
      (
        await c.query<{ revision: string; draft_version_id: string }>('SELECT * FROM app.rename_page($1,$2,$3,$4)', [
          id,
          revision,
          title,
          slug,
        ])
      ).rows[0]!,
  )
}

async function routes(id: string) {
  return db.as(
    'owner',
    async c =>
      (
        await c.query<{
          path: string
          render_manifest: { page: { title: string; path: string } }
        }>('SELECT path, render_manifest FROM published_routes WHERE page_id = $1', [id])
      ).rows,
  )
}

describe('versioned page identity and route ownership', () => {
  it('keeps a rename private, preserves history, and retires the previous URL only at publication', async () => {
    const p = await page(true)
    const renamed = await rename(p.id, p.revision, 'New name', `${p.slug}-new`)
    expect(renamed.draft_version_id).not.toBe(p.draft)
    expect(await routes(p.id)).toEqual([
      expect.objectContaining({
        path: `/${p.slug}`,
        render_manifest: expect.objectContaining({
          page: expect.objectContaining({ title: 'Original name', path: `/${p.slug}` }),
        }),
      }),
    ])
    // A collection refresh rebuilds this exact pinned manifest, not the head.
    const rebuilt = await db.as(
      'owner',
      async c =>
        (
          await c.query<{ manifest: { page: { title: string; path: string } } }>(
            'SELECT app.build_render_manifest_internal($1) AS manifest',
            [p.draft],
          )
        ).rows[0]!.manifest,
    )
    expect(rebuilt.page).toMatchObject({ title: 'Original name', path: `/${p.slug}` })
    const publishedRevision = await publish(p.id, Number(renamed.revision))
    expect(await routes(p.id)).toEqual([
      expect.objectContaining({
        path: `/${p.slug}-new`,
        render_manifest: expect.objectContaining({
          page: expect.objectContaining({ title: 'New name', path: `/${p.slug}-new` }),
        }),
      }),
    ])
    const retired = await db.as('owner', c =>
      c.query(
        `SELECT payload FROM outbox WHERE event_type = 'page.unpublished'
        AND payload->>'page_id' = $1 AND payload->>'path' = $2`,
        [p.id, `/${p.slug}`],
      ),
    )
    expect(retired.rows).toHaveLength(1)
    expect(retired.rows[0]!.payload.revision).toBe(publishedRevision)
    const audit = await db.as('owner', c =>
      c.query("SELECT id FROM audit_log WHERE action = 'page.rename' AND item_id = $1", [p.id]),
    )
    expect(audit.rows).toHaveLength(1)
  })

  it('reserves the live address while its owner has a different draft address', async () => {
    const p = await page(true)
    await rename(p.id, p.revision, 'Renamed', `${p.slug}-new`)
    await expectSqlState(
      db.asUser(s.editorA, c =>
        c.query('SELECT app.create_page($1,$2,$3)', [s.siteA, p.slug, 'Would replace live page']),
      ),
      '23505',
    )
    const other = await page()
    await expectSqlState(rename(other.id, other.revision, 'Would replace live page', p.slug), '23505')
    expect((await routes(p.id))[0]!.path).toBe(`/${p.slug}`)
  })

  it('publishes a pinned historical version with its own name and address', async () => {
    const p = await page()
    await rename(p.id, p.revision, 'Later draft', `${p.slug}-later`)
    const result = await db.as('owner', c =>
      c.query<{ path: string }>(`SELECT * FROM app.publish_page_version($1,NULL,$2,'scheduler',$3,$4,$5,$6,'{}')`, [
        p.id,
        p.draft,
        s.editorA,
        ...CHECKED_CLEAN,
      ]),
    )
    expect(result.rows[0]!.path).toBe(`/${p.slug}`)
    expect((await routes(p.id))[0]!.render_manifest.page.title).toBe('Original name')
  })

  it('lets the worker evaluate the versioned manifest, but not the old mutable-head helper', async () => {
    const p = await page()
    await rename(p.id, p.revision, 'Later private name', `${p.slug}-private`)
    const result = await db.asWorker('readiness-worker', c =>
      c.query('SELECT app.build_render_manifest_internal($1) AS manifest', [p.draft]),
    )
    expect(result.rows[0]!.manifest.page.title).toBe('Original name')
    await expectSqlState(
      db.asWorker('readiness-worker', c => c.query('SELECT app.build_render_manifest_before_identity($1)', [p.draft])),
      '42501',
    )
  })

  it('refuses a historical publication if another page now owns that address', async () => {
    const p = await page()
    await rename(p.id, p.revision, 'Later draft', `${p.slug}-later`)
    await db.asUser(s.editorA, c => c.query('SELECT app.create_page($1,$2,$3)', [s.siteA, p.slug, 'New owner']))
    await expectSqlState(
      db.as('owner', c =>
        c.query(`SELECT * FROM app.publish_page_version($1,NULL,$2,'scheduler',$3,$4,$5,$6,'{}')`, [
          p.id,
          p.draft,
          s.editorA,
          ...CHECKED_CLEAN,
        ]),
      ),
      '23505',
    )
    expect(await routes(p.id)).toEqual([])
  })

  it('unpublishes the actual live URL even after a private rename', async () => {
    const p = await page(true)
    const renamed = await rename(p.id, p.revision, 'New draft', `${p.slug}-draft`)
    await db.asUser(s.editorA, c => c.query('SELECT app.unpublish_page($1,$2)', [p.id, renamed.revision]))
    expect(await routes(p.id)).toEqual([])
    const events = await db.as('owner', c =>
      c.query("SELECT payload FROM outbox WHERE event_type = 'page.unpublished' AND payload->>'page_id' = $1", [p.id]),
    )
    expect(events.rows.map(r => r.payload.path)).toContain(`/${p.slug}`)
  })

  it('creates no redundant checkpoint when the details are unchanged', async () => {
    const p = await page()
    const unchanged = await rename(p.id, p.revision, 'Original name', p.slug)
    expect(Number(unchanged.revision)).toBe(p.revision)
    expect(unchanged.draft_version_id).toBe(p.draft)
  })

  it('uses the published name when automatic navigation fills in a missing page', async () => {
    const p = await page(true)
    await rename(p.id, p.revision, 'Do not expose this draft name', `${p.slug}-private`)
    await db.asUser(s.editorA, async c => {
      const head = (
        await c.query<{ revision: string }>('SELECT revision FROM navigations WHERE site_id = $1', [s.siteA])
      ).rows[0]!
      const saved = (
        await c.query<{ revision: string }>('SELECT * FROM app.save_navigation_draft($1,$2,$3,$4)', [
          s.siteA,
          head.revision,
          '[]',
          'auto',
        ])
      ).rows[0]!
      await c.query('SELECT app.publish_navigation($1,$2)', [s.siteA, saved.revision])
      const menu = (
        await c.query<{ tree: { label: string; target: { page_id: string } }[] }>(
          `SELECT v.tree FROM navigations n JOIN navigation_versions v ON v.id = n.published_version_id
          WHERE n.site_id = $1`,
          [s.siteA],
        )
      ).rows[0]!.tree
      expect(menu.find(item => item.target.page_id === p.id)?.label).toBe('Original name')
    })
  })
})

describe('recoverable archive and restore', () => {
  it('removes the live route, retains every version, and restores only a private draft', async () => {
    const p = await page(true)
    const renamed = await rename(p.id, p.revision, 'Private name', `${p.slug}-draft`)
    const archived = await db.asUser(
      s.editorA,
      async c =>
        (await c.query<{ revision: string }>('SELECT app.archive_page($1,$2) AS revision', [p.id, renamed.revision]))
          .rows[0]!,
    )
    expect(await routes(p.id)).toEqual([])
    await expectSqlState(publish(p.id, Number(archived.revision)), 'CMS04')
    await expectSqlState(
      db.asUser(s.editorA, c => c.query('SELECT app.unpublish_page($1,$2)', [p.id, archived.revision])),
      'CMS04',
    )
    await db.asUser(s.editorA, c => c.query('SELECT app.restore_archived_page($1,$2)', [p.id, archived.revision]))
    const head = await db.asUser(
      s.editorA,
      async c =>
        (
          await c.query('SELECT status, archived_at, published_version_id, draft_version_id FROM pages WHERE id = $1', [
            p.id,
          ])
        ).rows[0],
    )
    expect(head).toMatchObject({
      status: 'draft',
      archived_at: null,
      published_version_id: null,
      draft_version_id: renamed.draft_version_id,
    })
    const versions = await db.asUser(s.editorA, c => c.query('SELECT id FROM page_versions WHERE page_id = $1', [p.id]))
    expect(versions.rows.map(v => v.id).sort()).toEqual([p.draft, renamed.draft_version_id].sort())
    expect(await routes(p.id)).toEqual([])
  })

  it('restores saved names and addresses along with the content without altering the live version', async () => {
    const p = await page(true)
    const renamed = await rename(p.id, p.revision, 'Later', `${p.slug}-later`)
    const restored = await db.asUser(
      s.editorA,
      async c =>
        (
          await c.query<{ version_id: string }>('SELECT * FROM app.restore_version_as_draft($1,$2,$3)', [
            p.id,
            renamed.revision,
            p.draft,
          ])
        ).rows[0]!,
    )
    const head = await db.asUser(
      s.editorA,
      async c => (await c.query('SELECT title, slug, published_version_id FROM pages WHERE id = $1', [p.id])).rows[0],
    )
    expect(head).toMatchObject({ title: 'Original name', slug: p.slug, published_version_id: p.draft })
    expect(restored.version_id).not.toBe(p.draft)
    expect((await routes(p.id))[0]!.path).toBe(`/${p.slug}`)
  })
})

describe('authorization and conflict protection', () => {
  it.each(['editorB', 'contributorA', 'disabled'] as const)('refuses lifecycle changes from %s', async role => {
    const p = await page()
    await expectSqlState(rename(p.id, p.revision, 'Unauthorized', `${p.slug}-bad`, s[role]), 'CMS02')
    await expectSqlState(
      db.asUser(s[role], c => c.query('SELECT app.archive_page($1,$2)', [p.id, p.revision])),
      'CMS02',
    )
    await db.asUser(s.editorA, c => c.query('SELECT app.archive_page($1,$2)', [p.id, p.revision]))
    await expectSqlState(
      db.asUser(s[role], c => c.query('SELECT app.restore_archived_page($1,$2)', [p.id, p.revision + 1])),
      'CMS02',
    )
  })

  it('requires the loaded revision for rename, archive and restore', async () => {
    const p = await page()
    await expectSqlState(rename(p.id, null, 'Missing revision', p.slug), 'CMS01')
    await expectSqlState(rename(p.id, p.revision - 1, 'Stale revision', p.slug), 'CMS01')
    await expectSqlState(
      db.asUser(s.editorA, c => c.query('SELECT app.archive_page($1,NULL)', [p.id])),
      'CMS01',
    )
    await db.asUser(s.editorA, c => c.query('SELECT app.archive_page($1,$2)', [p.id, p.revision]))
    await expectSqlState(
      db.asUser(s.editorA, c => c.query('SELECT app.restore_archived_page($1,NULL)', [p.id])),
      'CMS01',
    )
  })
})
