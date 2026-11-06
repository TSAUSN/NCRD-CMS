// The boundaries that are supposed to hold even when something upstream is
// wrong: public-renderer reach, worker privilege, audit immutability, and the
// structural constraints that make a cross-tenant row unrepresentable.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { CHECKED_CLEAN, TestDatabase, expectSqlState } from './harness.ts'
import { heroContent, seedScenario, type Scenario } from './fixtures.ts'

let db: TestDatabase
let s: Scenario

beforeAll(async () => {
  db = await TestDatabase.create('isolation')
  s = await seedScenario(db)
  await db.asUser(s.editorA, c =>
    c.query('SELECT app.save_page_draft($1,$2,$3,$4)', [s.pageA, 0, heroContent(s.heroDefId, 'Live heading'), '{}']),
  )
  await db.asUser(s.editorA, c => c.query('SELECT app.publish_page($1,$2,$3,$4,$5)', [s.pageA, 1, ...CHECKED_CLEAN]))
})
afterAll(async () => {
  await db?.close()
})

describe('the public renderer can reach published projections and nothing else', () => {
  it('is an unprivileged role', async () => {
    const { rows } = await db.as('public', c =>
      c.query<{ rolsuper: boolean; rolbypassrls: boolean }>(
        'SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user',
      ),
    )
    expect(rows[0]).toEqual({ rolsuper: false, rolbypassrls: false })
  })

  it('cannot name an authoring table at all — not denied rows, denied vocabulary', async () => {
    for (const table of ['pages', 'page_versions', 'app_users', 'site_memberships', 'audit_log', 'domains']) {
      await expectSqlState(
        db.as('public', c => c.query(`SELECT * FROM public.${table}`)),
        '42501',
        '42P01',
      )
    }
  })

  it('cannot read the projection tables directly either — only through the functions', async () => {
    await expectSqlState(
      db.as('public', c => c.query('SELECT * FROM public.published_routes')),
      '42501',
      '42P01',
    )
  })

  it('cannot call an authoring command', async () => {
    await expectSqlState(
      db.as('public', c => c.query('SELECT app.publish_page($1,$2,$3,$4,$5)', [s.pageA, 1, ...CHECKED_CLEAN])),
      '42501',
      '42883',
      '3F000',
    )
  })

  it('resolves a staging host to its site and returns the published page', async () => {
    const { rows } = await db.as('public', c =>
      c.query<{ site_id: string; is_staging: boolean; render_manifest: { page: { title: string } } }>(
        'SELECT * FROM public_api.resolve_route($1,$2)',
        ['site-a.staging.example.test', '/'],
      ),
    )
    expect(rows).toHaveLength(1)
    expect(rows[0]!.site_id).toBe(s.siteA)
    expect(rows[0]!.is_staging).toBe(true)
    expect(rows[0]!.render_manifest.page.title).toBe('Home')
  })

  it('returns nothing for an unknown host — never a fallback tenant', async () => {
    const { rows } = await db.as('public', c =>
      c.query('SELECT * FROM public_api.resolve_route($1,$2)', ['not-a-tenant.example.test', '/']),
    )
    expect(rows).toHaveLength(0)
  })

  it('returns nothing for a real host with an unpublished path', async () => {
    const { rows } = await db.as('public', c =>
      c.query('SELECT * FROM public_api.resolve_route($1,$2)', ['site-a.staging.example.test', '/nope']),
    )
    expect(rows).toHaveLength(0)
  })

  it('cannot see one tenant’s content through another tenant’s host', async () => {
    const { rows } = await db.as('public', c =>
      c.query('SELECT * FROM public_api.resolve_route($1,$2)', ['site-b.staging.example.test', '/']),
    )
    expect(rows).toHaveLength(0)
  })

  it('serves only the published version, never the newer draft', async () => {
    await db.asUser(s.editorA, c =>
      c.query('SELECT app.save_page_draft($1,$2,$3,$4)', [
        s.pageA,
        2,
        heroContent(s.heroDefId, 'UNPUBLISHED SECRET'),
        '{}',
      ]),
    )
    const { rows } = await db.as('public', c =>
      c.query<{ render_manifest: unknown }>('SELECT render_manifest FROM public_api.resolve_route($1,$2)', [
        'site-a.staging.example.test',
        '/',
      ]),
    )
    expect(JSON.stringify(rows[0]!.render_manifest)).toContain('Live heading')
    expect(JSON.stringify(rows[0]!.render_manifest)).not.toContain('UNPUBLISHED SECRET')
  })
})

describe('the worker is server-side, not privileged', () => {
  it('is an unprivileged role', async () => {
    const { rows } = await db.as('worker', c =>
      c.query<{ rolsuper: boolean; rolbypassrls: boolean }>(
        'SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user',
      ),
    )
    expect(rows[0]).toEqual({ rolsuper: false, rolbypassrls: false })
  })

  it('records a heartbeat that an app user can see', async () => {
    // The worker id is the session's, not an argument (migration 0008).
    await db.asWorker('worker-1', c => c.query('SELECT app.worker_heartbeat($1,$2)', ['worker', 'test']))
    const { rows } = await db.asUser(s.editorA, c =>
      c.query<{ worker_id: string; version: string }>('SELECT worker_id, version FROM job_heartbeats'),
    )
    expect(rows).toEqual([{ worker_id: 'worker-1', version: 'test' }])
  })

  it('cannot write another worker’s heartbeat row', async () => {
    await expectSqlState(
      db.asWorker('worker-1', c =>
        c.query("INSERT INTO job_heartbeats (worker_id, version) VALUES ('worker-2','forged')"),
      ),
      '42501',
    )
  })

  it('cannot change memberships or grant itself a role', async () => {
    await expectSqlState(
      db.as('worker', c => c.query("INSERT INTO global_roles (user_id, role) VALUES ($1,'super_admin')", [s.editorA])),
      '42501',
    )
    await expectSqlState(
      db.as('worker', c =>
        c.query("INSERT INTO site_memberships (user_id, site_id, role) VALUES ($1,$2,'site_admin')", [
          s.editorA,
          s.siteB,
        ]),
      ),
      '42501',
    )
  })

  it('cannot mutate a published pointer directly', async () => {
    await expectSqlState(
      db.as('worker', c => c.query('UPDATE pages SET published_version_id = NULL WHERE id = $1', [s.pageA])),
      '42501',
    )
  })

  it('cannot execute a schedule without holding its lease', async () => {
    const scheduleId = await db.as('owner', async c => {
      const version = (
        await c.query<{ id: string }>('SELECT published_version_id AS id FROM pages WHERE id = $1', [s.pageA])
      ).rows[0]!.id
      return (
        await c.query<{ id: string }>(
          `INSERT INTO scheduled_actions (site_id, item_type, item_id, version_id, action, run_at, created_by, readiness_policy_version)
         VALUES ($1,'page',$2,$3,'publish', now() - interval '1 minute', $4, 1) RETURNING id`,
          [s.siteA, s.pageA, version, s.editorA],
        )
      ).rows[0]!.id
    })

    // Marking a schedule succeeded is no longer a separate step that could be
    // called on its own — publication and settlement are one transaction
    // (migration 0008). The only way in is app.execute_scheduled_action, and it
    // refuses anyone who does not hold the lease.
    const noToken = '00000000-0000-0000-0000-000000000000'
    const ready = JSON.stringify([])
    await expectSqlState(
      db.asWorker('worker-1', c =>
        c.query('SELECT app.execute_scheduled_action($1,$2,$3,$4)', [scheduleId, noToken, 1, ready]),
      ),
      'CMS04',
    )

    const claimed = await db.asWorker('worker-1', c =>
      c.query<{ id: string; lease_token: string }>('SELECT id, lease_token FROM app.claim_scheduled_action($1)', [60]),
    )
    expect(claimed.rows[0]!.id).toBe(scheduleId)
    const token = claimed.rows[0]!.lease_token

    // Another runner cannot execute it — not even by forging worker-1's id,
    // because the lease token is the authorization (migration 0009).
    await expectSqlState(
      db.asWorker('worker-2', c =>
        c.query('SELECT app.execute_scheduled_action($1,$2,$3,$4)', [scheduleId, noToken, 1, ready]),
      ),
      'CMS04',
    )
    await expectSqlState(
      db.asWorker('worker-1', c =>
        c.query('SELECT app.execute_scheduled_action($1,$2,$3,$4)', [scheduleId, noToken, 1, ready]),
      ),
      'CMS04',
    )

    await db.asWorker('worker-1', c =>
      c.query('SELECT app.execute_scheduled_action($1,$2,$3,$4)', [scheduleId, token, 1, ready]),
    )
    const { rows } = await db.as('owner', c =>
      c.query<{ status: string }>('SELECT status FROM scheduled_actions WHERE id = $1', [scheduleId]),
    )
    expect(rows[0]!.status).toBe('succeeded')
  })

  it('cannot publish directly — a scheduled publish must go through the lease', async () => {
    // The worker used to hold EXECUTE on app.publish_page and set app.user_id
    // to any uuid it liked, which meant it could publish as anyone. Both halves
    // are gone: the grant is revoked and the version is pinned by the schedule.
    await expectSqlState(
      db.asWorker('worker-1', c => c.query('SELECT app.publish_page($1,$2,$3,$4,$5)', [s.pageA, 0, ...CHECKED_CLEAN])),
      '42501',
      '42883',
    )
  })

  it('leases a due schedule to exactly one runner', async () => {
    const version = await db.as(
      'owner',
      async c =>
        (await c.query<{ id: string }>('SELECT published_version_id AS id FROM pages WHERE id = $1', [s.pageA]))
          .rows[0]!.id,
    )
    await db.as('owner', c =>
      c.query(
        `INSERT INTO scheduled_actions (site_id, item_type, item_id, version_id, action, run_at, created_by, readiness_policy_version)
               VALUES ($1,'page',$2,$3,'publish', now() - interval '1 minute', $4, 1)`,
        [s.siteA, s.pageA, version, s.editorA],
      ),
    )

    const [a, b] = await Promise.all([
      db.asWorker('runner-a', c => c.query('SELECT id FROM app.claim_scheduled_action($1)', [60])),
      db.asWorker('runner-b', c => c.query('SELECT id FROM app.claim_scheduled_action($1)', [60])),
    ])
    expect(a!.rows.length + b!.rows.length).toBe(1)
  })
})

describe('audit history cannot be rewritten', () => {
  it('an application role holds no INSERT — only commands write it', async () => {
    await expectSqlState(
      db.asUser(s.editorA, c =>
        c.query("INSERT INTO audit_log (site_id, actor_type, actor_id, action) VALUES ($1,'user',$2,'forged')", [
          s.siteA,
          s.editorA,
        ]),
      ),
      '42501',
    )
  })

  it('an application role cannot update or delete an entry', async () => {
    await expectSqlState(
      db.asUser(s.editorA, c => c.query("UPDATE audit_log SET action = 'rewritten'")),
      '42501',
    )
    await expectSqlState(
      db.asUser(s.editorA, c => c.query('DELETE FROM audit_log')),
      '42501',
    )
  })

  it('the append-only trigger refuses even a privileged session', async () => {
    await expectSqlState(
      db.as('owner', c => c.query("UPDATE audit_log SET action = 'rewritten'")),
      '42501',
    )
    await expectSqlState(
      db.as('owner', c => c.query('DELETE FROM audit_log')),
      '42501',
    )
  })

  it('refuses a system-actor row that also names a user — actors cannot be forged into', async () => {
    await expectSqlState(
      db.as('owner', c =>
        c.query("INSERT INTO audit_log (site_id, actor_type, actor_id, action) VALUES ($1,'system',$2,'x')", [
          s.siteA,
          s.editorA,
        ]),
      ),
      '23514',
    )
  })
})

describe('cross-tenant rows are structurally unrepresentable', () => {
  it('refuses a page version filed under the wrong site', async () => {
    await expectSqlState(
      db.as('owner', c =>
        c.query(
          `INSERT INTO page_versions (site_id, page_id, revision, content, kind)
                 VALUES ($1,$2,999,'[]'::jsonb,'autosave')`,
          [s.siteB, s.pageA],
        ),
      ),
      '23503',
    )
  })

  it('refuses a head pointing at another head’s version', async () => {
    const otherPage = await db.asUser(
      s.superAdmin,
      async c =>
        (await c.query<{ id: string }>('SELECT app.create_page($1,$2,$3) AS id', [s.siteA, 'other-head', 'Other']))
          .rows[0]!.id,
    )
    const foreign = await db.asUser(s.superAdmin, c =>
      c.query<{ version_id: string }>('SELECT * FROM app.save_page_draft($1,$2,$3,$4)', [
        otherPage,
        0,
        heroContent(s.heroDefId),
        '{}',
      ]),
    )
    await expectSqlState(
      db.as('owner', c =>
        c.query('UPDATE pages SET draft_version_id = $1 WHERE id = $2', [foreign.rows[0]!.version_id, s.pageA]),
      ),
      '23503',
    )
  })

  it('refuses a duplicate revision on one page', async () => {
    await expectSqlState(
      db.as('owner', c =>
        c.query(
          `INSERT INTO page_versions (site_id, page_id, revision, content, kind)
                 VALUES ($1,$2,1,'[]'::jsonb,'autosave')`,
          [s.siteA, s.pageA],
        ),
      ),
      '23505',
    )
  })

  it('refuses a second site claiming the same hostname', async () => {
    await expectSqlState(
      db.asUser(s.superAdmin, c =>
        c.query('SELECT app.create_site($1,$2,$3,$4,$5,$6)', [
          'dupe',
          'Dupe',
          'general',
          'site-a.staging.example.test',
          '{}',
          '[]',
        ]),
      ),
      '23505',
    )
  })

  it('refuses a duplicate page slug within one site but allows it across sites', async () => {
    await expectSqlState(
      db.asUser(s.superAdmin, c => c.query('SELECT app.create_page($1,$2,$3)', [s.siteA, '', 'Duplicate root'])),
      '23505',
    )
    const ok = await db.asUser(s.superAdmin, c =>
      c.query('SELECT app.create_page($1,$2,$3)', [s.siteB, '', 'Site B root']),
    )
    expect(ok.rows).toHaveLength(1)
  })

  it('refuses an un-normalized hostname', async () => {
    await expectSqlState(
      db.as('owner', c =>
        c.query("INSERT INTO domains (site_id, hostname_normalized) VALUES ($1,'Example.COM:8080')", [s.siteA]),
      ),
      '23514',
    )
  })

  it('refuses a JSON payload past the size bound', async () => {
    const huge = JSON.stringify([
      { section_def_id: s.heroDefId, section_def_version: 1, values: { heading: 'x'.repeat(1_100_000) } },
    ])
    // Read the head rather than assuming a revision: an earlier test in this
    // file publishes, and a stale-revision refusal would pass this assertion
    // for entirely the wrong reason.
    const revision = await db.as('owner', async c =>
      Number(
        (await c.query<{ revision: string }>('SELECT revision FROM pages WHERE id = $1', [s.pageA])).rows[0]!.revision,
      ),
    )
    await expectSqlState(
      db.asUser(s.superAdmin, c => c.query('SELECT app.save_page_draft($1,$2,$3,$4)', [s.pageA, revision, huge, '{}'])),
      '23514',
    )
  })
})
