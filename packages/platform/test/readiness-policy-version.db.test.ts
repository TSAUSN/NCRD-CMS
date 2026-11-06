// What a readiness policy bump does to the releases somebody already scheduled.
//
// A schedule pins the readiness policy version it will be judged by, the same
// way it pins the version it will publish, and `app.execute_scheduled_action`
// raises CMS04 when the version the worker checked against is not the one the
// schedule pinned. That check is right — it is what stops a release agreed
// under one policy from being judged by a policy nobody agreed to — but it
// means a bump is not a code change on its own. The moment the worker starts
// reporting version 2, every schedule pinned to 1 fails; and the worker
// classifies CMS04 as permanent, so it fails once, terminally, on the date the
// release was supposed to go out.
//
// The decision, and what this file holds it to: every not-yet-run schedule has
// its pin carried forward, and each carry writes an audit row naming both
// versions and the reason. That is defensible only because version 2 adds a
// rule and relaxes none — @cms/domain's readiness.test.ts is where that
// property is pinned down — and only because it is visible: a pin that moved
// with nothing recorded is precisely the silent reinterpretation being avoided.
//
// The SQL under test is `../schema/migrations/0023_readiness_policy_2.sql`, applied
// here rather than run as a migration because migrations are landed by the lead
// and this branch does not own one. It is the exact text intended for
// `packages/schema/migrations/0023_readiness_policy_2.sql`; once it lands, this
// file should read it from there instead.
import { readFileSync } from 'node:fs'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Pool, PoolClient } from 'pg'
import { READINESS_POLICY_VERSION } from '@cms/domain'
import { ScratchDatabase } from './database.ts'

const ROOT = '11111111-1111-1111-1111-111111111111'
/** The policy version every existing schedule was created under. */
const OLD_POLICY = 1
const REASON = 'readiness policy 2 adds refused_canonical and relaxes none'

const MIGRATION = readFileSync(
  new URL('./../../schema/migrations/0023_readiness_policy_2.sql', import.meta.url),
  'utf8',
)

let db: ScratchDatabase
let pool: Pool
let siteId: string

beforeAll(async () => {
  db = await ScratchDatabase.create('readypolicy')
  pool = db.pool()
  await pool.query(`INSERT INTO app_users (id, email, display_name) VALUES ($1, 'root@example.test', 'Root')`, [ROOT])
  await pool.query(`INSERT INTO global_roles (user_id, role) VALUES ($1, 'super_admin')`, [ROOT])

  const client = await pool.connect()
  try {
    await client.query('SELECT set_config($1,$2,false)', ['app.user_id', ROOT])
    siteId = (
      await client.query<{ id: string }>('SELECT app.create_site($1,$2,$3,$4,$5,$6) AS id', [
        'sched',
        'Scheduled',
        'resource',
        'sched.staging.test',
        '{}',
        '[]',
      ])
    ).rows[0]!.id
  } finally {
    client.release()
  }

  // The migration as it will be landed, including its own call to carry the
  // pins forward — which finds nothing here, because no schedule exists yet.
  await pool.query(MIGRATION)
}, 60_000)

afterAll(async () => {
  await db?.close()
})

/**
 * One schedule pinned to a policy version.
 *
 * `item_id` and `version_id` are free-standing uuids: neither carries a foreign
 * key, and every path this file exercises — the pin check and the blocked
 * branch — refuses or settles before any page is looked at. Seeding a page to
 * satisfy code that never reads it would only make the setup harder to read.
 */
async function schedulePinnedTo(policyVersion: number): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO scheduled_actions
       (site_id, item_type, item_id, version_id, action, run_at, created_by, readiness_policy_version)
     VALUES ($1, 'page', gen_random_uuid(), gen_random_uuid(), 'publish',
             now() - interval '1 second', $2, $3)
     RETURNING id`,
    [siteId, ROOT, policyVersion],
  )
  return rows[0]!.id
}

/** The lease the worker would be holding, without racing another test for it. */
async function lease(id: string): Promise<string> {
  const token = (await pool.query<{ token: string }>('SELECT gen_random_uuid() AS token')).rows[0]!.token
  await pool.query(
    `UPDATE scheduled_actions
        SET status = 'running', leased_by = 'test-worker',
            lease_token_hash = app.lease_digest($2), leased_until = now() + interval '5 minutes'
      WHERE id = $1`,
    [id, token],
  )
  return token
}

/** Executing a schedule the way the worker does, with its own identity. */
async function executeAs(id: string, token: string, policyVersion: number, readiness: string): Promise<string> {
  const client = await pool.connect()
  try {
    await client.query('SELECT set_config($1,$2,false)', ['app.worker_id', 'test-worker'])
    return (
      await client.query<{ outcome: string }>('SELECT outcome FROM app.execute_scheduled_action($1,$2,$3,$4)', [
        id,
        token,
        policyVersion,
        readiness,
      ])
    ).rows[0]!.outcome
  } finally {
    client.release()
  }
}

async function scheduleRow(id: string) {
  const { rows } = await pool.query<{
    status: string
    readiness_policy_version: number
    failure_kind: string | null
    last_error: string | null
  }>(
    `SELECT status, readiness_policy_version, failure_kind, last_error
        FROM scheduled_actions WHERE id = $1`,
    [id],
  )
  return rows[0]!
}

async function carryForward(from: number, to: number, reason = REASON): Promise<number> {
  const { rows } = await pool.query<{ moved: number }>('SELECT app.carry_forward_readiness_policy($1,$2,$3) AS moved', [
    from,
    to,
    reason,
  ])
  return rows[0]!.moved
}

async function expectSqlState(work: Promise<unknown>, code: string): Promise<void> {
  await expect(work).rejects.toMatchObject({ code })
}

describe('the bump is what breaks an already-pinned schedule', () => {
  it('refuses a schedule pinned to the old version once the worker reports the new one', async () => {
    // Not a hypothetical: this is what every pending schedule would do on its
    // own run date if the pins were left alone, and CMS04 is permanent in the
    // worker, so it would do it exactly once.
    const id = await schedulePinnedTo(OLD_POLICY)
    const token = await lease(id)

    await expectSqlState(executeAs(id, token, READINESS_POLICY_VERSION, '[]'), 'CMS04')
    expect((await scheduleRow(id)).readiness_policy_version).toBe(OLD_POLICY)
  })
})

describe('carrying a pinned schedule forward', () => {
  it('moves a schedule that has not run yet onto the new policy', async () => {
    const id = await schedulePinnedTo(OLD_POLICY)

    expect(await carryForward(OLD_POLICY, READINESS_POLICY_VERSION)).toBeGreaterThan(0)
    expect((await scheduleRow(id)).readiness_policy_version).toBe(READINESS_POLICY_VERSION)
  })

  it('lets that schedule run again, under the policy the worker is actually using', async () => {
    const id = await schedulePinnedTo(OLD_POLICY)
    await carryForward(OLD_POLICY, READINESS_POLICY_VERSION)
    const token = await lease(id)

    // A blocking report rather than a clean one, so the schedule settles here
    // instead of continuing into a publication this file has not set a page up
    // for. Getting this far is the assertion: the pin check let it through.
    const outcome = await executeAs(
      id,
      token,
      READINESS_POLICY_VERSION,
      JSON.stringify([
        {
          rule: 'refused_canonical',
          severity: 'blocking',
          message:
            'The canonical link set on this page cannot be used, so this page would tell ' +
            'search engines it lives at its own address instead.',
        },
      ]),
    )
    expect(outcome).toBe('blocked')
  })

  it('stops a scheduled release whose canonical was refused, with the reason on the row', async () => {
    // End to end, and the point of the whole policy version: before this rule
    // existed, this schedule published a page that silently dropped the
    // author's canonical. It now fails closed and says which rule refused it.
    const id = await schedulePinnedTo(OLD_POLICY)
    await carryForward(OLD_POLICY, READINESS_POLICY_VERSION)
    const token = await lease(id)

    await executeAs(
      id,
      token,
      READINESS_POLICY_VERSION,
      JSON.stringify([
        {
          rule: 'refused_canonical',
          severity: 'blocking',
          message: 'The canonical link set on this page cannot be used.',
        },
      ]),
    )

    const row = await scheduleRow(id)
    expect(row.status).toBe('failed')
    expect(row.failure_kind).toBe('readiness')
    expect(row.last_error).toContain('refused_canonical')
  })

  it('records one audit row per schedule, naming both versions and the reason', async () => {
    const id = await schedulePinnedTo(OLD_POLICY)
    await carryForward(OLD_POLICY, READINESS_POLICY_VERSION)

    const { rows } = await pool.query<{
      actor_type: string
      actor_id: string | null
      site_id: string
      detail: Record<string, unknown>
    }>(
      `SELECT actor_type, actor_id, site_id, detail FROM audit_log
          WHERE action = 'schedule.readiness_policy_superseded' AND item_id = $1`,
      [id],
    )

    expect(rows).toHaveLength(1)
    // 'migration', not 'user' or 'scheduler': the deployer did this, nobody in
    // the product asked for it, and audit_log only lets a 'user' row name an
    // actor at all.
    expect(rows[0]!.actor_type).toBe('migration')
    expect(rows[0]!.actor_id).toBeNull()
    // Named site, so the row lands in that site's own feed next to the schedule.
    expect(rows[0]!.site_id).toBe(siteId)
    expect(rows[0]!.detail['from_readiness_policy_version']).toBe(OLD_POLICY)
    expect(rows[0]!.detail['to_readiness_policy_version']).toBe(READINESS_POLICY_VERSION)
    expect(rows[0]!.detail['reason']).toBe(REASON)
    expect(rows[0]!.detail['authorized_by']).toBe(ROOT)
  })

  it('leaves a schedule that has already run exactly as it was judged', async () => {
    // Rewriting the policy version of a finished schedule would falsify the
    // record of what it was actually checked against.
    const id = await schedulePinnedTo(OLD_POLICY)
    await pool.query(`UPDATE scheduled_actions SET status = 'succeeded', finished_at = now() WHERE id = $1`, [id])

    await carryForward(OLD_POLICY, READINESS_POLICY_VERSION)

    expect((await scheduleRow(id)).readiness_policy_version).toBe(OLD_POLICY)
    const audit = await pool.query(
      `SELECT id FROM audit_log
        WHERE action = 'schedule.readiness_policy_superseded' AND item_id = $1`,
      [id],
    )
    expect(audit.rows).toHaveLength(0)
  })

  it('moves nothing the second time it is run', async () => {
    await schedulePinnedTo(OLD_POLICY)
    await carryForward(OLD_POLICY, READINESS_POLICY_VERSION)

    expect(await carryForward(OLD_POLICY, READINESS_POLICY_VERSION)).toBe(0)
  })
})

describe('a pin may only ever be carried forward, and only on the record', () => {
  it('refuses to move a pin backwards onto a more permissive policy', async () => {
    // The one direction that could let something through that the policy in
    // force refuses, so it is refused rather than documented.
    await expectSqlState(carryForward(READINESS_POLICY_VERSION, OLD_POLICY), 'CMS04')
  })

  it('refuses to move a pin onto itself, which would only write noise into the audit', async () => {
    await expectSqlState(carryForward(OLD_POLICY, OLD_POLICY), 'CMS04')
  })

  it('refuses to move a pin with no stated reason', async () => {
    await expectSqlState(carryForward(OLD_POLICY, READINESS_POLICY_VERSION, '   '), 'CMS04')
  })

  it('leaves the schedules alone when it refuses', async () => {
    const id = await schedulePinnedTo(OLD_POLICY)
    await expectSqlState(carryForward(OLD_POLICY, READINESS_POLICY_VERSION, ''), 'CMS04')

    expect((await scheduleRow(id)).readiness_policy_version).toBe(OLD_POLICY)
  })
})

describe('the sample-content migration', () => {
  it('carries policy 2 forward once, audits it, and preserves completed schedules', async () => {
    const migration = readFileSync(
      new URL('./../../schema/migrations/0119_sample_readiness_policy.sql', import.meta.url),
      'utf8',
    )
    const pending = await schedulePinnedTo(2),
      completed = await schedulePinnedTo(2)
    await pool.query("UPDATE scheduled_actions SET status='succeeded',finished_at=now() WHERE id=$1", [completed])
    await pool.query(migration)
    expect((await scheduleRow(pending)).readiness_policy_version).toBe(3)
    expect((await scheduleRow(completed)).readiness_policy_version).toBe(2)
    await pool.query(migration)
    const audit = await pool.query<{ detail: Record<string, unknown> }>(
      "SELECT detail FROM audit_log WHERE action='schedule.readiness_policy_superseded' AND item_id=$1",
      [pending],
    )
    expect(audit.rows).toHaveLength(1)
    expect(audit.rows[0]!.detail['from_readiness_policy_version']).toBe(2)
    expect(audit.rows[0]!.detail['to_readiness_policy_version']).toBe(3)
    expect(audit.rows[0]!.detail['reason']).toContain('sample_content')
  })
})
