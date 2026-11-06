// The publication command and the revision CAS it is built on (SPEC §5, §6.8).
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { CHECKED_CLEAN, TestDatabase, expectSqlState } from './harness.ts'
import { heroContent, seedScenario, type Scenario } from './fixtures.ts'

let db: TestDatabase
let s: Scenario

beforeAll(async () => {
  db = await TestDatabase.create('publication')
  s = await seedScenario(db)
})
afterAll(async () => {
  await db?.close()
})

async function revisionOf(pageId: string): Promise<number> {
  const { rows } = await db.asUser(s.superAdmin, c =>
    c.query<{ revision: string }>('SELECT revision FROM pages WHERE id = $1', [pageId]),
  )
  return Number(rows[0]!.revision)
}

async function saveDraft(user: string, pageId: string, rev: number, heading?: string) {
  return db.asUser(user, c =>
    c.query<{ version_id: string; revision: string }>('SELECT * FROM app.save_page_draft($1,$2,$3,$4)', [
      pageId,
      rev,
      heroContent(s.heroDefId, heading),
      '{}',
    ]),
  )
}

describe('publication cannot happen by omission (migration 0011)', () => {
  it('the legacy two-argument publish_page no longer resolves', async () => {
    // It used to, via DEFAULT 1 / DEFAULT NULL / DEFAULT '[]' — so this call
    // published a page *and* wrote "the checks found nothing" into the audit,
    // an assertion nobody made. There is no default that honestly means "nobody
    // checked", so there is no default.
    const code = await expectSqlState(
      db.asUser(s.editorA, c => c.query('SELECT app.publish_page($1,$2)', [s.pageA, 1])),
      '42883',
    )
    expect(code).toBe('42883')

    const head = await db.as('owner', c =>
      c.query<{ v: string | null }>('SELECT published_version_id AS v FROM pages WHERE id = $1', [s.pageA]),
    )
    expect(head.rows[0]!.v).toBeNull()
  })

  it('no overload of publish_page carries a readiness default', async () => {
    // Written against the catalogue rather than by trying calls, so a
    // reintroduced default is caught even if every callsite happens to pass one.
    const { rows } = await db.as('owner', c =>
      c.query<{ sig: string; defaults: string | null }>(
        `SELECT p.oid::regprocedure::text AS sig, pg_get_expr(p.proargdefaults, 0) AS defaults
           FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
          WHERE n.nspname = 'app' AND p.proname = 'publish_page'`,
      ),
    )
    expect(rows).toHaveLength(1)
    expect(rows[0]!.sig).toBe('app.publish_page(uuid,bigint,integer,text,jsonb)')
    expect(rows[0]!.defaults).toBeNull()
  })

  it('every readiness argument is required, one at a time', async () => {
    const rev = await db.as('owner', async c =>
      Number(
        (await c.query<{ revision: string }>('SELECT revision FROM pages WHERE id = $1', [s.pageA])).rows[0]!.revision,
      ),
    )

    // A NULL policy version or a NULL report is refused as loudly as a missing
    // argument: "unknown" is not a passing verdict.
    await expectSqlState(
      db.asUser(s.editorA, c => c.query('SELECT app.publish_page($1,$2,$3,$4,$5)', [s.pageA, rev, null, null, '[]'])),
      'CMS04',
    )
    await expectSqlState(
      db.asUser(s.editorA, c => c.query('SELECT app.publish_page($1,$2,$3,$4,$5)', [s.pageA, rev, 1, null, null])),
      'CMS04',
    )
    await expectSqlState(
      db.asUser(s.editorA, c => c.query('SELECT app.publish_page($1,$2,$3,$4,$5)', [s.pageA, rev, 0, null, '[]'])),
      'CMS04',
    )
  })
})

describe('compare-and-set saves', () => {
  it('accepts only autosave and checkpoint through the ordinary save command', async () => {
    const revision = await revisionOf(s.pageA)
    for (const forged of ['restore', 'publish', 'submission']) {
      await expectSqlState(
        db.asUser(s.editorA, c =>
          c.query('SELECT * FROM app.save_page_draft($1,$2,$3,$4,$5,$6)', [
            s.pageA,
            revision,
            heroContent(s.heroDefId),
            '{}',
            forged,
            'forged label',
          ]),
        ),
        'CMS04',
      )
    }
  })

  it('advances the revision and points the draft at the new immutable version', async () => {
    const rev = await revisionOf(s.pageA)
    const { rows } = await saveDraft(s.editorA, s.pageA, rev, 'First draft')
    expect(Number(rows[0]!.revision)).toBe(rev + 1)

    const head = await db.asUser(s.editorA, c =>
      c.query<{ draft_version_id: string }>('SELECT draft_version_id FROM pages WHERE id = $1', [s.pageA]),
    )
    expect(head.rows[0]!.draft_version_id).toBe(rows[0]!.version_id)
  })

  it('refuses a save that echoes a revision the head has moved past', async () => {
    const stale = (await revisionOf(s.pageA)) - 1
    await expectSqlState(saveDraft(s.editorA, s.pageA, stale), 'CMS01')
  })

  it('reports the current revision in the conflict so the editor can offer a diff', async () => {
    const current = await revisionOf(s.pageA)
    try {
      await saveDraft(s.editorA, s.pageA, 0)
      throw new Error('expected a conflict')
    } catch (error) {
      expect((error as { code?: string }).code).toBe('CMS01')
      expect((error as { detail?: string }).detail).toBe(String(current))
    }
  })

  it('keeps every version — a save never overwrites its predecessor', async () => {
    const before = await db.asUser(s.editorA, c =>
      c.query('SELECT id FROM page_versions WHERE page_id = $1', [s.pageA]),
    )
    await saveDraft(s.editorA, s.pageA, await revisionOf(s.pageA), 'Another')
    const after = await db.asUser(s.editorA, c => c.query('SELECT id FROM page_versions WHERE page_id = $1', [s.pageA]))
    expect(after.rows.length).toBe(before.rows.length + 1)
  })
})

describe('publishing writes the public projection in the same transaction', () => {
  it('creates the route, the shell, an audit row, and an outbox event together', async () => {
    const rev = await revisionOf(s.pageA)
    const { rows } = await db.asUser(s.editorA, c =>
      c.query<{ path: string; revision: string }>('SELECT * FROM app.publish_page($1,$2,$3,$4,$5)', [
        s.pageA,
        rev,
        ...CHECKED_CLEAN,
      ]),
    )
    expect(rows[0]!.path).toBe('/')

    const route = await db.asUser(s.editorA, c =>
      c.query<{ render_manifest: { sections: unknown[]; page: { title: string } } }>(
        'SELECT render_manifest FROM published_routes WHERE site_id = $1 AND path = $2',
        [s.siteA, '/'],
      ),
    )
    expect(route.rows[0]!.render_manifest.sections).toHaveLength(1)

    const shell = await db.asUser(s.editorA, c =>
      c.query<{ payload: { theme: { colors: Record<string, string> } } }>(
        'SELECT payload FROM published_site_shells WHERE site_id = $1',
        [s.siteA],
      ),
    )
    expect(shell.rows[0]!.payload.theme.colors['primary']).toBe('#003087')

    const audit = await db.asUser(s.editorA, c =>
      c.query('SELECT id FROM audit_log WHERE action = $1 AND item_id = $2', ['page.publish', s.pageA]),
    )
    expect(audit.rows.length).toBeGreaterThan(0)

    const outbox = await db.as('owner', c =>
      c.query('SELECT id FROM outbox WHERE event_type = $1 AND site_id = $2', ['page.published', s.siteA]),
    )
    expect(outbox.rows.length).toBeGreaterThan(0)
  })

  it('resolves each section against the exact pinned definition version', async () => {
    const { rows } = await db.asUser(s.editorA, c =>
      c.query<{ manifest: { sections: { def: { version: number; css: string } }[] } }>(
        'SELECT render_manifest AS manifest FROM published_routes WHERE site_id = $1 AND path = $2',
        [s.siteA, '/'],
      ),
    )
    expect(rows[0]!.manifest.sections[0]!.def.version).toBe(1)
    expect(rows[0]!.manifest.sections[0]!.def.css).toContain('.hero')
  })

  it('refuses to publish a page pinned to a definition version that does not exist', async () => {
    const page = await db.asUser(
      s.editorA,
      async c =>
        (await c.query<{ id: string }>('SELECT app.create_page($1,$2,$3) AS id', [s.siteA, 'broken', 'Broken']))
          .rows[0]!.id,
    )
    const bad = JSON.stringify([
      { section_def_id: s.heroDefId, section_def_version: 99, values: {}, hidden: false, hidden_at: [], label: '' },
    ])
    await db.asUser(s.editorA, c => c.query('SELECT app.save_page_draft($1,$2,$3,$4)', [page, 0, bad, '{}']))
    await expectSqlState(
      db.asUser(s.editorA, c => c.query('SELECT app.publish_page($1,$2,$3,$4,$5)', [page, 1, ...CHECKED_CLEAN])),
      'CMS04',
    )
  })
})

describe('concurrent publishes produce one winner and one typed conflict', () => {
  it('serializes on the head row', async () => {
    const page = await db.asUser(
      s.editorA,
      async c =>
        (await c.query<{ id: string }>('SELECT app.create_page($1,$2,$3) AS id', [s.siteA, 'race', 'Race'])).rows[0]!
          .id,
    )
    await db.asUser(s.editorA, c =>
      c.query('SELECT app.save_page_draft($1,$2,$3,$4)', [page, 0, heroContent(s.heroDefId), '{}']),
    )

    const rev = 1
    const results = await Promise.allSettled([
      db.asUser(s.editorA, c =>
        c.query('SELECT * FROM app.publish_page($1,$2,$3,$4,$5)', [page, rev, ...CHECKED_CLEAN]),
      ),
      db.asUser(s.editorA, c =>
        c.query('SELECT * FROM app.publish_page($1,$2,$3,$4,$5)', [page, rev, ...CHECKED_CLEAN]),
      ),
    ])

    const won = results.filter(r => r.status === 'fulfilled')
    const lost = results.filter(r => r.status === 'rejected')
    expect(won).toHaveLength(1)
    expect(lost).toHaveLength(1)
    expect(((lost[0] as PromiseRejectedResult).reason as { code: string }).code).toBe('CMS01')

    // The loser left nothing behind: one route, one publish audit row.
    const audit = await db.asUser(s.editorA, c =>
      c.query('SELECT id FROM audit_log WHERE action = $1 AND item_id = $2', ['page.publish', page]),
    )
    expect(audit.rows).toHaveLength(1)
  })
})

describe('raw markup cannot reach the public projection unapproved', () => {
  const rawContent = JSON.stringify([
    {
      section_def_id: '',
      section_def_version: 1,
      values: {},
      hidden: false,
      hidden_at: [],
      label: '',
      raw_html: '<script>alert(1)</script>',
    },
  ])

  it('marks the version from the payload, not from a client-supplied flag', async () => {
    const page = await db.asUser(
      s.editorA,
      async c =>
        (await c.query<{ id: string }>('SELECT app.create_page($1,$2,$3) AS id', [s.siteA, 'raw', 'Raw'])).rows[0]!.id,
    )
    const content = rawContent.replace('"section_def_id":""', `"section_def_id":"${s.heroDefId}"`)
    const { rows } = await db.asUser(s.superAdmin, c =>
      c.query<{ carries_trusted_code: boolean }>('SELECT * FROM app.save_page_draft($1,$2,$3,$4)', [
        page,
        0,
        content,
        '{}',
      ]),
    )
    expect(rows[0]!.carries_trusted_code).toBe(true)
    return page
  })

  it('refuses publication of unapproved raw markup, then allows it after super-admin approval', async () => {
    const page = await db.asUser(
      s.editorA,
      async c =>
        (await c.query<{ id: string }>('SELECT app.create_page($1,$2,$3) AS id', [s.siteA, 'raw2', 'Raw 2'])).rows[0]!
          .id,
    )
    const content = rawContent.replace('"section_def_id":""', `"section_def_id":"${s.heroDefId}"`)
    const saved = await db.asUser(s.superAdmin, c =>
      c.query<{ version_id: string }>('SELECT * FROM app.save_page_draft($1,$2,$3,$4)', [page, 0, content, '{}']),
    )

    await expectSqlState(
      db.asUser(s.editorA, c => c.query('SELECT app.publish_page($1,$2,$3,$4,$5)', [page, 1, ...CHECKED_CLEAN])),
      'CMS05',
    )

    // An editor cannot lift the gate themselves.
    await expectSqlState(
      db.asUser(s.editorA, c => c.query('SELECT app.approve_trusted_code($1)', [saved.rows[0]!.version_id])),
      'CMS02',
    )

    await db.asUser(s.superAdmin, c => c.query('SELECT app.approve_trusted_code($1)', [saved.rows[0]!.version_id]))
    const published = await db.asUser(s.editorA, c =>
      c.query('SELECT * FROM app.publish_page($1,$2,$3,$4,$5)', [page, 1, ...CHECKED_CLEAN]),
    )
    expect(published.rows).toHaveLength(1)
  })

  it('the database refuses a published pointer to unapproved raw markup even from the owner', async () => {
    const page = await db.asUser(
      s.editorA,
      async c =>
        (await c.query<{ id: string }>('SELECT app.create_page($1,$2,$3) AS id', [s.siteA, 'raw3', 'Raw 3'])).rows[0]!
          .id,
    )
    const content = rawContent.replace('"section_def_id":""', `"section_def_id":"${s.heroDefId}"`)
    const saved = await db.asUser(s.superAdmin, c =>
      c.query<{ version_id: string }>('SELECT * FROM app.save_page_draft($1,$2,$3,$4)', [page, 0, content, '{}']),
    )

    // Break-glass superuser included: the trigger is the last line, not the command.
    await expectSqlState(
      db.as('owner', c =>
        c.query('UPDATE pages SET published_version_id = $1 WHERE id = $2', [saved.rows[0]!.version_id, page]),
      ),
      '42501',
    )
  })
})

describe('restore keeps v1’s semantics', () => {
  it('creates a new draft from an old version instead of republishing it', async () => {
    const startRev = await revisionOf(s.pageA)
    const first = await db.asUser(s.editorA, c =>
      c.query<{ version_id: string }>('SELECT * FROM app.save_page_draft($1,$2,$3,$4)', [
        s.pageA,
        startRev,
        heroContent(s.heroDefId, 'Version to restore'),
        '{}',
      ]),
    )
    await saveDraft(s.editorA, s.pageA, await revisionOf(s.pageA), 'Newer content')

    const publishedBefore = await db.asUser(s.editorA, c =>
      c.query<{ published_version_id: string }>('SELECT published_version_id FROM pages WHERE id = $1', [s.pageA]),
    )

    const restoreRev = await revisionOf(s.pageA)
    const restored = await db.asUser(s.editorA, c =>
      c.query<{ version_id: string }>('SELECT * FROM app.restore_version_as_draft($1,$2,$3,$4)', [
        s.pageA,
        restoreRev,
        first.rows[0]!.version_id,
        'restore test',
      ]),
    )

    const head = await db.asUser(s.editorA, c =>
      c.query<{ draft_version_id: string; published_version_id: string }>(
        'SELECT draft_version_id, published_version_id FROM pages WHERE id = $1',
        [s.pageA],
      ),
    )
    expect(head.rows[0]!.draft_version_id).toBe(restored.rows[0]!.version_id)
    expect(head.rows[0]!.published_version_id).toBe(publishedBefore.rows[0]!.published_version_id)
  })

  it('refuses to restore a version belonging to another page', async () => {
    const other = await db.asUser(
      s.editorA,
      async c =>
        (await c.query<{ id: string }>('SELECT app.create_page($1,$2,$3) AS id', [s.siteA, 'elsewhere', 'Elsewhere']))
          .rows[0]!.id,
    )
    const foreign = await db.asUser(s.editorA, c =>
      c.query<{ version_id: string }>('SELECT * FROM app.save_page_draft($1,$2,$3,$4)', [
        other,
        0,
        heroContent(s.heroDefId),
        '{}',
      ]),
    )
    const rev = await revisionOf(s.pageA)
    await expectSqlState(
      db.asUser(s.editorA, c =>
        c.query('SELECT app.restore_version_as_draft($1,$2,$3,$4)', [s.pageA, rev, foreign.rows[0]!.version_id, '']),
      ),
      'CMS03',
    )
  })

  it('is authorized by the database and lets a contributor create a draft', async () => {
    const page = await db.asUser(
      s.editorA,
      async c =>
        (
          await c.query<{ id: string }>('SELECT app.create_page($1,$2,$3) AS id', [
            s.siteA,
            'restore-rights',
            'Restore rights',
          ])
        ).rows[0]!.id,
    )
    const source = await saveDraft(s.editorA, page, 0, 'Source')

    await expectSqlState(
      db.asUser(null, c =>
        c.query('SELECT * FROM app.restore_version_as_draft($1,$2,$3,$4)', [page, 1, source.rows[0]!.version_id, '']),
      ),
      'CMS02',
    )
    await expectSqlState(
      db.asUser(s.editorB, c =>
        c.query('SELECT * FROM app.restore_version_as_draft($1,$2,$3,$4)', [page, 1, source.rows[0]!.version_id, '']),
      ),
      'CMS02',
    )
    await expectSqlState(
      db.asUser(s.disabled, c =>
        c.query('SELECT * FROM app.restore_version_as_draft($1,$2,$3,$4)', [page, 1, source.rows[0]!.version_id, '']),
      ),
      'CMS02',
    )

    const restored = await db.asUser(s.contributorA, c =>
      c.query<{ version_id: string; revision: string }>('SELECT * FROM app.restore_version_as_draft($1,$2,$3,$4)', [
        page,
        1,
        source.rows[0]!.version_id,
        'Restored from page history',
      ]),
    )
    expect(Number(restored.rows[0]!.revision)).toBe(2)

    const audit = await db.asUser(s.contributorA, c =>
      c.query<{ before_ref: string; after_ref: string }>(
        "SELECT before_ref, after_ref FROM audit_log WHERE action = 'page.restore' AND item_id = $1",
        [page],
      ),
    )
    expect(audit.rows[0]).toEqual({
      before_ref: source.rows[0]!.version_id,
      after_ref: restored.rows[0]!.version_id,
    })

    try {
      await db.asUser(s.editorA, c =>
        c.query('SELECT * FROM app.restore_version_as_draft($1,$2,$3,$4)', [
          page,
          1,
          source.rows[0]!.version_id,
          'stale',
        ]),
      )
      throw new Error('expected a stale restore')
    } catch (error) {
      expect((error as { code?: string }).code).toBe('CMS01')
      expect((error as { detail?: string }).detail).toBe('2')
    }
  })

  it('does not copy trusted-code approval onto the new immutable draft', async () => {
    const page = await db.asUser(
      s.editorA,
      async c =>
        (
          await c.query<{ id: string }>('SELECT app.create_page($1,$2,$3) AS id', [
            s.siteA,
            'restore-approval',
            'Restore approval',
          ])
        ).rows[0]!.id,
    )
    const raw = JSON.stringify([
      {
        section_def_id: s.heroDefId,
        section_def_version: 1,
        values: {},
        hidden: false,
        hidden_at: [],
        label: '',
        raw_html: '<p>Reviewed custom markup</p>',
      },
    ])
    const source = await db.asUser(s.superAdmin, c =>
      c.query<{ version_id: string }>('SELECT * FROM app.save_page_draft($1,$2,$3,$4)', [page, 0, raw, '{}']),
    )
    await db.asUser(s.superAdmin, c => c.query('SELECT app.approve_trusted_code($1)', [source.rows[0]!.version_id]))

    const restored = await db.asUser(s.editorA, c =>
      c.query<{ version_id: string }>('SELECT * FROM app.restore_version_as_draft($1,$2,$3,$4)', [
        page,
        1,
        source.rows[0]!.version_id,
        '',
      ]),
    )
    const { rows } = await db.asUser(s.editorA, c =>
      c.query<{ carries_trusted_code: boolean; trusted_code_approved_by: string | null }>(
        'SELECT carries_trusted_code, trusted_code_approved_by FROM page_versions WHERE id = $1',
        [restored.rows[0]!.version_id],
      ),
    )
    expect(rows[0]).toEqual({ carries_trusted_code: true, trusted_code_approved_by: null })
  })

  it('refuses to create a new draft on an archived page', async () => {
    const page = await db.asUser(
      s.editorA,
      async c =>
        (
          await c.query<{ id: string }>('SELECT app.create_page($1,$2,$3) AS id', [
            s.siteA,
            'restore-archived',
            'Archived restore',
          ])
        ).rows[0]!.id,
    )
    const source = await saveDraft(s.editorA, page, 0, 'Before archive')
    await db.as('owner', c =>
      c.query("UPDATE pages SET archived_at = now(), status = 'archived' WHERE id = $1", [page]),
    )
    await expectSqlState(
      db.asUser(s.editorA, c =>
        c.query('SELECT * FROM app.restore_version_as_draft($1,$2,$3,$4)', [page, 1, source.rows[0]!.version_id, '']),
      ),
      'CMS04',
    )
  })
})

describe('unpublishing revokes routing first', () => {
  it('removes the published route and the pointer together', async () => {
    const page = await db.asUser(
      s.editorA,
      async c =>
        (await c.query<{ id: string }>('SELECT app.create_page($1,$2,$3) AS id', [s.siteA, 'temporary', 'Temporary']))
          .rows[0]!.id,
    )
    await db.asUser(s.editorA, c =>
      c.query('SELECT app.save_page_draft($1,$2,$3,$4)', [page, 0, heroContent(s.heroDefId), '{}']),
    )
    await db.asUser(s.editorA, c => c.query('SELECT app.publish_page($1,$2,$3,$4,$5)', [page, 1, ...CHECKED_CLEAN]))

    const rev = await revisionOf(page)
    await db.asUser(s.editorA, c => c.query('SELECT app.unpublish_page($1,$2)', [page, rev]))

    const route = await db.asUser(s.editorA, c =>
      c.query('SELECT path FROM published_routes WHERE site_id = $1 AND path = $2', [s.siteA, '/temporary']),
    )
    expect(route.rows).toHaveLength(0)
  })
})
