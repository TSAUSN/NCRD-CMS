// Scheduled publication: it must publish the version it pinned, exactly once,
// atomically, and attributably (SPEC §6.8, §6.13, §6.15).
//
// Each of these was a real defect. They are written against real Postgres as the
// real worker role because every property here — pinning, atomicity, audit
// attribution — is a database fact and cannot be inferred from a unit test.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { CHECKED_CLEAN, TestDatabase, expectSqlState } from '@cms/schema/testing'
import { heroContent, seedScenario, type Scenario } from '@cms/schema/fixtures'
import { runDueSchedules } from '../src/handlers.ts'
import { READINESS_POLICY_VERSION } from '@cms/domain'
import { evaluateVersionReadiness } from '@cms/platform'

let db: TestDatabase
let s: Scenario

beforeAll(async () => {
  db = await TestDatabase.create('sched')
  s = await seedScenario(db)

  // The published global header is part of every rendered page now, and its
  // brand link points home. Give these scheduler tests a real live home route
  // so readiness reaches the schedule property each test is meant to measure
  // instead of correctly stopping first at broken_internal_link.
  const homeVersion = await saveDraft(s.pageA, 'Home')
  const homeReport = await db.asUser(s.editorA, c => evaluateVersionReadiness(c, homeVersion, 'member'))
  const homeRevision = await revisionOf(s.pageA)
  await db.asUser(s.editorA, c =>
    c.query('SELECT app.publish_page($1,$2,$3,$4,$5)', [
      s.pageA,
      homeRevision,
      homeReport.policyVersion,
      null,
      JSON.stringify(homeReport.findings),
    ]),
  )
})
afterAll(async () => {
  await db?.close()
})

beforeEach(async () => {
  await db.as('owner', c => c.query('DELETE FROM scheduled_actions'))
})

async function newPage(slug: string): Promise<string> {
  return db.asUser(
    s.editorA,
    async c =>
      (await c.query<{ id: string }>('SELECT app.create_page($1,$2,$3) AS id', [s.siteA, slug, slug])).rows[0]!.id,
  )
}

async function revisionOf(pageId: string): Promise<number> {
  return db.as('owner', async c =>
    Number(
      (await c.query<{ revision: string }>('SELECT revision FROM pages WHERE id = $1', [pageId])).rows[0]!.revision,
    ),
  )
}

/** Save a draft and return the immutable version it created. */
async function saveDraft(pageId: string, heading: string): Promise<string> {
  const rev = await revisionOf(pageId)
  return db.asUser(
    s.editorA,
    async c =>
      (
        await c.query<{ version_id: string }>('SELECT version_id FROM app.save_page_draft($1,$2,$3,$4)', [
          pageId,
          rev,
          heroContent(s.heroDefId, heading),
          '{}',
        ])
      ).rows[0]!.version_id,
  )
}

async function schedule(pageId: string, versionId: string, createdBy = s.editorA): Promise<string> {
  return db.as(
    'owner',
    async c =>
      (
        await c.query<{ id: string }>(
          `INSERT INTO scheduled_actions (site_id, item_type, item_id, version_id, action, run_at, created_by, readiness_policy_version)
       VALUES ($1,'page',$2,$3,'publish', now() - interval '1 second', $4, $5) RETURNING id`,
          [s.siteA, pageId, versionId, createdBy, READINESS_POLICY_VERSION],
        )
      ).rows[0]!.id,
  )
}

async function publishedVersionOf(pageId: string): Promise<string | null> {
  return db.as(
    'owner',
    async c =>
      (await c.query<{ v: string | null }>('SELECT published_version_id AS v FROM pages WHERE id = $1', [pageId]))
        .rows[0]!.v,
  )
}

async function routeVersionOf(path: string): Promise<string | null> {
  return db.as(
    'owner',
    async c =>
      (
        await c.query<{ v: string }>(
          'SELECT page_version_id AS v FROM published_routes WHERE site_id = $1 AND path = $2',
          [s.siteA, path],
        )
      ).rows[0]?.v ?? null,
  )
}

// ---------------------------------------------------------------- pinning

describe('a schedule publishes the version it pinned', () => {
  it('publishes A even though B is the current draft when it fires', async () => {
    const page = await newPage('pinned')
    const versionA = await saveDraft(page, 'Version A — the scheduled one')
    const id = await schedule(page, versionA)

    // The author keeps working after scheduling. B becomes the draft.
    const versionB = await saveDraft(page, 'Version B — still a draft')
    expect(versionB).not.toBe(versionA)

    // Manifest wrappers must retain the worker's current grant. 0075 recreated
    // the function without it, making real scheduled readiness fail before fire.
    const report = await db.asWorker('w1', c => evaluateVersionReadiness(c, versionA, 'worker'))
    expect(report.ok).toBe(true)
    const manifest = (
      await db.asWorker('w1', c => c.query('SELECT app.build_render_manifest_internal($1) AS manifest', [versionA]))
    ).rows[0]!.manifest
    expect(manifest.fonts).toEqual([])
    await expectSqlState(
      db.asWorker('w1', c => c.query('SELECT app.build_render_manifest_before_site_assets($1)', [versionA])),
      '42501',
    )
    await expectSqlState(
      db.asWorker('w1', c => c.query('SELECT app.build_render_manifest_before_appearance_0077($1)', [versionA])),
      '42501',
    )

    const summary = await runDueSchedules(db.pool('worker'), 'w1')
    expect(summary.ran).toBe(1)

    // The whole point of pinning: what goes live is what was scheduled.
    expect(await publishedVersionOf(page)).toBe(versionA)
    expect(await routeVersionOf('/pinned')).toBe(versionA)

    // And B is untouched — still the draft, not silently published.
    const head = await db.as('owner', c =>
      c.query<{ draft_version_id: string }>('SELECT draft_version_id FROM pages WHERE id = $1', [page]),
    )
    expect(head.rows[0]!.draft_version_id).toBe(versionB)

    const status = await db.as('owner', c =>
      c.query<{ status: string }>('SELECT status FROM scheduled_actions WHERE id = $1', [id]),
    )
    expect(status.rows[0]!.status).toBe('succeeded')
  })

  it('serves the pinned content publicly, not the newer draft', async () => {
    const { rows } = await db.as('public', c =>
      c.query<{ render_manifest: unknown }>('SELECT render_manifest FROM public_api.resolve_route($1,$2)', [
        'site-a.staging.example.test',
        '/pinned',
      ]),
    )
    const rendered = JSON.stringify(rows[0]!.render_manifest)
    expect(rendered).toContain('Version A — the scheduled one')
    expect(rendered).not.toContain('Version B')
  })

  it('skips an older schedule after a newer manual publication and records a reviewable failure', async () => {
    const page = await newPage('newer-manual-publication')
    const versionA = await saveDraft(page, 'Scheduled version A')
    const id = await schedule(page, versionA)
    const versionB = await saveDraft(page, 'Newer manually published version B')
    const report = await db.asUser(s.editorA, c => evaluateVersionReadiness(c, versionB, 'member'))
    expect(report.ok).toBe(true)
    await db.asUser(s.editorA, c =>
      c.query('SELECT app.publish_page($1,$2,$3,$4,$5)', [
        page,
        2,
        report.policyVersion,
        null,
        JSON.stringify(report.findings),
      ]),
    )
    const head = () =>
      db.as(
        'owner',
        async c =>
          (await c.query('SELECT revision,draft_version_id,published_version_id FROM pages WHERE id=$1', [page]))
            .rows[0],
      )
    const before = await head()
    const summary = await runDueSchedules(db.pool('worker'), 'w1')
    expect(summary).toMatchObject({ ran: 0, failed: 1, retrying: 0 })
    expect(await head()).toEqual(before)
    expect(await routeVersionOf('/newer-manual-publication')).toBe(versionB)
    const failure = await db.asUser(
      s.editorA,
      async c =>
        (await c.query('SELECT status,failure_kind,last_error FROM scheduled_actions WHERE id=$1', [id])).rows[0],
    )
    expect(failure).toMatchObject({ status: 'failed', failure_kind: 'permanent' })
    expect(failure.last_error).toMatch(/newer version is already live/i)
    expect((await runDueSchedules(db.pool('worker'), 'w1')).ran).toBe(0)
  })

  it('refuses a schedule whose pinned version belongs to another page', async () => {
    const page = await newPage('foreign-pin')
    await saveDraft(page, 'own content')
    const other = await newPage('other-page')
    const foreign = await saveDraft(other, 'someone else content')

    const id = await schedule(page, foreign)
    const summary = await runDueSchedules(db.pool('worker'), 'w1')
    expect(summary.ran).toBe(0)
    expect(summary.failed).toBe(1)

    const row = await db.as('owner', c =>
      c.query<{ failure_kind: string }>('SELECT failure_kind FROM scheduled_actions WHERE id = $1', [id]),
    )
    expect(row.rows[0]!.failure_kind).toBe('permanent')
    expect(await publishedVersionOf(page)).toBeNull()
  })
})

// ------------------------------------------------------ execution-time checks

describe('every authorization question is re-asked at execution time', () => {
  it('fails closed when the creator was disabled after scheduling', async () => {
    const page = await newPage('creator-disabled')
    const version = await saveDraft(page, 'content')
    const doomed = await db.asUser(
      s.superAdmin,
      async c =>
        (await c.query<{ id: string }>('SELECT app.provision_user($1,$2) AS id', ['sched-gone@example.test', 'Gone']))
          .rows[0]!.id,
    )
    await db.asUser(s.superAdmin, c => c.query('SELECT app.set_site_membership($1,$2,$3)', [doomed, s.siteA, 'editor']))
    const id = await schedule(page, version, doomed)
    await db.asUser(s.superAdmin, c => c.query("SELECT app.set_user_status($1,'disabled')", [doomed]))

    const summary = await runDueSchedules(db.pool('worker'), 'w1')
    expect(summary.failed).toBe(1)
    expect(summary.retrying).toBe(0) // losing authorization is permanent
    expect(await publishedVersionOf(page)).toBeNull()

    const row = await db.as('owner', c =>
      c.query<{ failure_kind: string; attempt_count: number }>(
        'SELECT failure_kind, attempt_count FROM scheduled_actions WHERE id = $1',
        [id],
      ),
    )
    expect(row.rows[0]!.failure_kind).toBe('permanent')
    expect(row.rows[0]!.attempt_count).toBe(1)
  })

  it('fails closed when the creator lost the capability but kept the account', async () => {
    const page = await newPage('creator-demoted')
    const version = await saveDraft(page, 'content')
    const demoted = await db.asUser(
      s.superAdmin,
      async c =>
        (
          await c.query<{ id: string }>('SELECT app.provision_user($1,$2) AS id', [
            'sched-demoted@example.test',
            'Demoted',
          ])
        ).rows[0]!.id,
    )
    await db.asUser(s.superAdmin, c =>
      c.query('SELECT app.set_site_membership($1,$2,$3)', [demoted, s.siteA, 'editor']),
    )
    const id = await schedule(page, version, demoted)
    // Editor -> contributor: still a user, no longer allowed to publish.
    await db.asUser(s.superAdmin, c =>
      c.query('SELECT app.set_site_membership($1,$2,$3)', [demoted, s.siteA, 'contributor']),
    )

    expect((await runDueSchedules(db.pool('worker'), 'w1')).failed).toBe(1)
    expect(await publishedVersionOf(page)).toBeNull()
    const row = await db.as('owner', c =>
      c.query<{ last_error: string }>('SELECT last_error FROM scheduled_actions WHERE id = $1', [id]),
    )
    expect(row.rows[0]!.last_error).toMatch(/not permitted/)
  })

  /** A scheduled publish of a page whose section carries the given raw markup. */
  async function scheduledRawMarkup(name: string, rawHtml: string): Promise<string> {
    const page = await newPage(name)
    const raw = JSON.stringify([
      {
        section_def_id: s.heroDefId,
        section_def_version: 1,
        values: {},
        hidden: false,
        hidden_at: [],
        label: '',
        raw_html: rawHtml,
      },
    ])
    const rev = await revisionOf(page)
    const version = await db.asUser(
      s.superAdmin,
      async c =>
        (
          await c.query<{ version_id: string }>('SELECT version_id FROM app.save_page_draft($1,$2,$3,$4)', [
            page,
            rev,
            raw,
            '{}',
          ])
        ).rows[0]!.version_id,
    )
    await schedule(page, version)
    return page
  }

  it('fails closed when the pinned version carries unapproved raw markup', async () => {
    // Markup a reader would find unremarkable, *and* that the readiness policy
    // has nothing to say about — hence the heading, since raw markup replaces
    // the section's body and a page with no H1 is refused before any of this.
    // Both of those are the point: what stops this publish has to be the
    // *approval* gate rather than anything about what the markup contains. It
    // used to be asserted with `<script>alert(1)</script>`, which stopped being
    // a test of the gate the moment raw markup started reaching the renderer,
    // and would have gone on passing while measuring a different rule.
    const page = await scheduledRawMarkup('trusted-code', '<h1>An ordinary heading</h1><p>An ordinary paragraph.</p>')
    expect((await runDueSchedules(db.pool('worker'), 'w1')).failed).toBe(1)
    expect(await publishedVersionOf(page)).toBeNull()
  })

  it('stops a script in raw markup at readiness, before the approval gate is reached', () => {
    // The other half, kept separate so neither can quietly stand in for the
    // other. Both outcomes are terminal and neither publishes; what differs is
    // which layer said no, and an operator reading `failure_kind` needs that to
    // mean what it says.
    return (async () => {
      const page = await scheduledRawMarkup('trusted-script', '<script>alert(1)</script>')
      const outcome = await runDueSchedules(db.pool('worker'), 'w1')
      expect(outcome.blocked + outcome.failed).toBe(1)
      expect(await publishedVersionOf(page)).toBeNull()
    })()
  })

  it('fails closed when the site has been archived since scheduling', async () => {
    const page = await newPage('archived-site')
    const version = await saveDraft(page, 'content')
    await schedule(page, version)
    await db.as('owner', c => c.query("UPDATE sites SET status = 'archived' WHERE id = $1", [s.siteA]))

    expect((await runDueSchedules(db.pool('worker'), 'w1')).failed).toBe(1)
    expect(await publishedVersionOf(page)).toBeNull()

    await db.as('owner', c => c.query("UPDATE sites SET status = 'in_progress' WHERE id = $1", [s.siteA]))
  })
})

// ------------------------------------------------------------- atomicity

describe('publication and settlement commit together', () => {
  it('a crash before commit publishes nothing and leaves the schedule runnable', async () => {
    const page = await newPage('atomic')
    const version = await saveDraft(page, 'Atomic content')
    const id = await schedule(page, version)

    // Claim it, run the execution, then die before committing.
    const client = await db.pool('worker').connect()
    try {
      await client.query('BEGIN')
      await client.query('SELECT set_config($1,$2,true)', ['app.worker_id', 'crash-worker'])
      const claim = await client.query<{ lease_token: string }>(
        'SELECT lease_token FROM app.claim_scheduled_action($1)',
        [60],
      )
      await client.query('COMMIT') // the claim itself commits, as it does in production

      await client.query('BEGIN')
      await client.query('SELECT set_config($1,$2,true)', ['app.worker_id', 'crash-worker'])
      await client.query('SELECT app.execute_scheduled_action($1,$2,$3,$4)', [
        id,
        claim.rows[0]!.lease_token,
        READINESS_POLICY_VERSION,
        '[]',
      ])
      // The process dies here. Nothing is committed.
      await client.query('ROLLBACK')
    } finally {
      client.release()
    }

    // Publication rolled back with the settlement it could not reach.
    expect(await publishedVersionOf(page)).toBeNull()
    expect(await routeVersionOf('/atomic')).toBeNull()

    const outbox = await db.as('owner', c => c.query("SELECT id FROM outbox WHERE payload->>'path' = '/atomic'"))
    expect(outbox.rows).toHaveLength(0)

    // Once the lease lapses, another worker picks it up and finishes the job.
    await db.as('owner', c =>
      c.query("UPDATE scheduled_actions SET leased_until = now() - interval '1 second' WHERE id = $1", [id]),
    )
    expect((await runDueSchedules(db.pool('worker'), 'w2')).ran).toBe(1)

    expect(await publishedVersionOf(page)).toBe(version)
  })

  it('publishes exactly once, advancing the revision exactly once', async () => {
    const page = await newPage('exactly-once')
    const version = await saveDraft(page, 'Once')
    const before = await revisionOf(page)
    const id = await schedule(page, version)

    expect((await runDueSchedules(db.pool('worker'), 'w1')).ran).toBe(1)
    const after = await revisionOf(page)
    expect(after).toBe(before + 1)

    // A second pass must find nothing: the schedule is terminal.
    expect((await runDueSchedules(db.pool('worker'), 'w1')).ran).toBe(0)
    expect(await revisionOf(page)).toBe(after)

    // Even forcing the row back to a claimable shape must not double-publish,
    // because a terminal schedule is not re-runnable.
    const status = await db.as('owner', c =>
      c.query<{ status: string; finished_at: Date }>(
        'SELECT status, finished_at FROM scheduled_actions WHERE id = $1',
        [id],
      ),
    )
    expect(status.rows[0]!.status).toBe('succeeded')
    expect(status.rows[0]!.finished_at).not.toBeNull()

    const events = await db.as('owner', c => c.query("SELECT id FROM outbox WHERE payload->>'path' = '/exactly-once'"))
    expect(events.rows).toHaveLength(1)

    const audits = await db.as('owner', c =>
      c.query("SELECT id FROM audit_log WHERE action = 'page.publish' AND item_id = $1", [page]),
    )
    expect(audits.rows).toHaveLength(1)
  })
})

// ----------------------------------------------------------------- audit

describe('audit attributes a scheduled fire to the scheduler (SPEC §6.13, §6.15)', () => {
  it('writes one publication row, actor_type=scheduler, naming who authorized it', async () => {
    const page = await newPage('audit-shape')
    const version = await saveDraft(page, 'Audited')
    const id = await schedule(page, version)
    await runDueSchedules(db.pool('worker'), 'w1')

    const { rows } = await db.as('owner', c =>
      c.query<{ actor_type: string; actor_id: string | null; detail: Record<string, unknown> }>(
        `SELECT actor_type, actor_id, detail FROM audit_log
          WHERE action = 'page.publish' AND item_id = $1`,
        [page],
      ),
    )

    // Exactly one entry for the publication — not one 'user' row from the
    // publish command plus a second 'scheduler' row from settlement.
    expect(rows).toHaveLength(1)
    const entry = rows[0]!
    expect(entry.actor_type).toBe('scheduler')
    // The CHECK constraint forbids actor_id on a non-user row, so the
    // authorizing person is recorded in detail rather than pretended to be
    // the actor.
    expect(entry.actor_id).toBeNull()
    expect(entry.detail['authorized_by']).toBe(s.editorA)
    expect(entry.detail['scheduled_action_id']).toBe(id)
  })

  it('an editor publish is still attributed to that user', async () => {
    const page = await newPage('editor-audit')
    await saveDraft(page, 'By hand')
    const rev = await revisionOf(page)
    await db.asUser(s.editorA, c => c.query('SELECT app.publish_page($1,$2,$3,$4,$5)', [page, rev, ...CHECKED_CLEAN]))

    const { rows } = await db.as('owner', c =>
      c.query<{ actor_type: string; actor_id: string }>(
        "SELECT actor_type, actor_id FROM audit_log WHERE action = 'page.publish' AND item_id = $1",
        [page],
      ),
    )
    expect(rows).toHaveLength(1)
    expect(rows[0]!.actor_type).toBe('user')
    expect(rows[0]!.actor_id).toBe(s.editorA)
  })

  it('a failed schedule is recorded once, as the scheduler', async () => {
    const page = await newPage('audit-failure')
    const version = await saveDraft(page, 'content')
    const id = await schedule(page, version)
    await db.as('owner', c => c.query('DELETE FROM pages WHERE id = $1', [page]))

    await runDueSchedules(db.pool('worker'), 'w1')
    const { rows } = await db.as('owner', c =>
      c.query<{ actor_type: string; actor_id: string | null }>(
        "SELECT actor_type, actor_id FROM audit_log WHERE action = 'schedule.failed' AND item_id = $1",
        [id],
      ),
    )
    expect(rows).toHaveLength(1)
    expect(rows[0]!.actor_type).toBe('scheduler')
    expect(rows[0]!.actor_id).toBeNull()
  })
})

// ------------------------------------------------------- privilege boundary

describe('the publication core is not reachable by an application role', () => {
  it('the worker cannot call app.publish_page directly — it goes through the schedule', async () => {
    const page = await newPage('worker-direct')
    await saveDraft(page, 'content')
    const rev = await revisionOf(page)
    await expect(
      db.asWorker('w1', c => c.query('SELECT app.publish_page($1,$2,$3,$4,$5)', [page, rev, ...CHECKED_CLEAN])),
    ).rejects.toMatchObject({ code: expect.stringMatching(/42501|42883/) })
  })

  it('an authenticated user cannot call the internal publication core', async () => {
    const page = await newPage('core-direct')
    const version = await saveDraft(page, 'content')
    const rev = await revisionOf(page)
    await expect(
      db.asUser(s.editorA, c =>
        c.query('SELECT app.publish_page_version($1,$2,$3,$4,$5,$6,$7,$8)', [
          page,
          rev,
          version,
          'scheduler',
          null,
          1,
          null,
          '{}',
        ]),
      ),
    ).rejects.toMatchObject({ code: expect.stringMatching(/42501|42883/) })
  })

  it('an authenticated user cannot execute a scheduled action', async () => {
    const page = await newPage('exec-direct')
    const version = await saveDraft(page, 'content')
    const id = await schedule(page, version)
    await expect(
      db.asUser(s.editorA, c => c.query('SELECT app.execute_scheduled_action($1)', [id])),
    ).rejects.toMatchObject({ code: expect.stringMatching(/42501|42883/) })
  })
})
