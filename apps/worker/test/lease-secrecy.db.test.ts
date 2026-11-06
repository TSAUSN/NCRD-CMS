// A lease token is only a capability if nobody else can read it.
//
// 0009 minted an unguessable token and asserted it was "returned only to the
// claimant". That was false, and the proof needed no cleverness:
//
//   has_column_privilege('cms_worker','outbox','lease_token','SELECT') = true
//
// 0002 granted cms_worker table-level SELECT on outbox with a USING (true)
// policy, and a table-level grant covers every column added afterwards — so the
// secret introduced in 0009 was readable by every worker the moment it existed.
// A non-claiming worker could SELECT the live token and settle, execute, or fail
// somebody else's row: the same impersonation 0009 set out to close, reached
// through a different door. The 0009 regression only ever offered an all-zero
// token, which proves tokens cannot be *guessed* and says nothing about whether
// they can be *read*.
//
// Migration 0010 closes it twice over. The column holds a SHA-256 digest, so
// there is no token in the table to read; and the table-level grants are gone,
// replaced by column lists that do not silently absorb the next column someone
// adds. These tests hold both halves.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { TestDatabase, expectSqlState } from '@cms/schema/testing'
import { heroContent, seedScenario, type Scenario } from '@cms/schema/fixtures'

let db: TestDatabase
let s: Scenario

beforeAll(async () => {
  db = await TestDatabase.create('secrecy')
  s = await seedScenario(db)
})
afterAll(async () => {
  await db?.close()
})

beforeEach(async () => {
  await db.as('owner', c => c.query('DELETE FROM outbox'))
  await db.as('owner', c => c.query('DELETE FROM scheduled_actions'))
})

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

async function enqueue(path = '/secret'): Promise<string> {
  return db.as(
    'owner',
    async c =>
      (
        await c.query<{ id: string }>(
          `INSERT INTO outbox (site_id, event_type, payload)
       VALUES ($1,'page.published',$2) RETURNING id`,
          [s.siteA, { path, revision: 1 }],
        )
      ).rows[0]!.id,
  )
}

async function scheduleSomething(): Promise<string> {
  const page = await db.asUser(
    s.editorA,
    async c =>
      (
        await c.query<{ id: string }>('SELECT app.create_page($1,$2,$3) AS id', [
          s.siteA,
          `secrecy-${Math.random().toString(36).slice(2, 8)}`,
          'Secrecy',
        ])
      ).rows[0]!.id,
  )
  await db.asUser(s.editorA, c =>
    c.query('SELECT app.save_page_draft($1,$2,$3,$4)', [page, 0, heroContent(s.heroDefId), '{}']),
  )
  const version = await db.as(
    'owner',
    async c =>
      (await c.query<{ v: string }>('SELECT draft_version_id AS v FROM pages WHERE id = $1', [page])).rows[0]!.v,
  )
  return db.as(
    'owner',
    async c =>
      (
        await c.query<{ id: string }>(
          `INSERT INTO scheduled_actions (site_id, item_type, item_id, version_id, action, run_at,
                                      created_by, readiness_policy_version)
       VALUES ($1,'page',$2,$3,'publish', now() - interval '1 second', $4, 1) RETURNING id`,
          [s.siteA, page, version, s.editorA],
        )
      ).rows[0]!.id,
  )
}

describe('the token reaches the claimant and nobody else', () => {
  it('worker A claims and receives a raw token', async () => {
    await enqueue()
    const claimed = await db.asWorker('worker-a', c =>
      c.query<{ id: string; lease_token: string }>('SELECT id, lease_token FROM app.claim_outbox($1)', [60]),
    )
    expect(claimed.rows[0]!.lease_token).toMatch(UUID)
  })

  it('worker B cannot read the token column, because there is no token column', async () => {
    await enqueue()
    await db.asWorker('worker-a', c => c.query('SELECT * FROM app.claim_outbox($1)', [60]))

    // The name 0009 used is simply gone; only a digest is stored now.
    await expectSqlState(
      db.asWorker('worker-b', c => c.query('SELECT lease_token FROM outbox')),
      '42703',
    )
    // And the digest that replaced it is not readable either.
    await expectSqlState(
      db.asWorker('worker-b', c => c.query('SELECT lease_token_hash FROM outbox')),
      '42501',
    )
  })

  it('worker B cannot reach the digest through SELECT *', async () => {
    await enqueue()
    await db.asWorker('worker-a', c => c.query('SELECT * FROM app.claim_outbox($1)', [60]))

    // The obvious way around a column-level grant. It fails because the worker
    // now has no table-level SELECT at all: it reaches the queue exclusively
    // through the claim/settle functions.
    await expectSqlState(
      db.asWorker('worker-b', c => c.query('SELECT * FROM outbox')),
      '42501',
    )
    await expectSqlState(
      db.asWorker('worker-b', c => c.query('SELECT id FROM outbox')),
      '42501',
    )
    await expectSqlState(
      db.asWorker('worker-b', c => c.query('SELECT * FROM scheduled_actions')),
      '42501',
    )
  })

  it('an editor cannot read tokens for their own site’s rows', async () => {
    const id = await scheduleSomething()
    await db.asWorker('worker-a', c => c.query('SELECT * FROM app.claim_scheduled_action($1)', [60]))

    // Site membership is not the question. The editor legitimately reads their
    // own schedules — and still cannot read the capability on them.
    await expectSqlState(
      db.asUser(s.editorA, c => c.query('SELECT lease_token_hash FROM scheduled_actions')),
      '42501',
    )
    await expectSqlState(
      db.asUser(s.editorA, c => c.query('SELECT * FROM scheduled_actions')),
      '42501',
    )

    const visible = await db.asUser(s.editorA, c =>
      c.query<{ status: string; readiness_policy_version: number }>(
        'SELECT status, readiness_policy_version FROM scheduled_actions WHERE id = $1',
        [id],
      ),
    )
    expect(visible.rows[0]!.status).toBe('running')
    expect(visible.rows[0]!.readiness_policy_version).toBe(1)
  })

  it('stores a digest, so even a privileged read recovers nothing usable', async () => {
    const id = await enqueue()
    const claimed = await db.asWorker('worker-a', c =>
      c.query<{ lease_token: string }>('SELECT lease_token FROM app.claim_outbox($1)', [60]),
    )
    const token = claimed.rows[0]!.lease_token

    // As the owner — a superuser-equivalent read, standing in for a backup, a
    // replica, or a mistaken grant.
    const stored = await db.as('owner', c =>
      c.query<{ hash: Buffer; is_digest: boolean }>(
        'SELECT lease_token_hash AS hash, lease_token_hash = app.lease_digest($2) AS is_digest ' +
          'FROM outbox WHERE id = $1',
        [id, token],
      ),
    )
    expect(stored.rows[0]!.is_digest).toBe(true)
    // 32 bytes of SHA-256, and nothing that contains the token's text.
    expect(stored.rows[0]!.hash).toHaveLength(32)
    expect(stored.rows[0]!.hash.toString('utf8')).not.toContain(token)
  })
})

describe('holding the token is what authorizes, and only for as long as it holds', () => {
  it('the correct claimant settles', async () => {
    const id = await enqueue()
    const claimed = await db.asWorker('worker-a', c =>
      c.query<{ lease_token: string }>('SELECT lease_token FROM app.claim_outbox($1)', [60]),
    )
    const status = await db.asWorker('worker-a', c =>
      c.query<{ status: string }>('SELECT app.settle_outbox($1,$2,$3,$4,$5) AS status', [
        id,
        claimed.rows[0]!.lease_token,
        true,
        null,
        false,
      ]),
    )
    expect(status.rows[0]!.status).toBe('delivered')
  })

  it('the correct claimant executes a schedule', async () => {
    const id = await scheduleSomething()
    const claimed = await db.asWorker('worker-a', c =>
      c.query<{ lease_token: string }>('SELECT lease_token FROM app.claim_scheduled_action($1)', [60]),
    )
    const outcome = await db.asWorker('worker-a', c =>
      c.query<{ outcome: string }>('SELECT outcome FROM app.execute_scheduled_action($1,$2,$3,$4)', [
        id,
        claimed.rows[0]!.lease_token,
        1,
        '[]',
      ]),
    )
    expect(outcome.rows[0]!.outcome).toBe('published')
  })

  it('a wrong token is refused', async () => {
    const id = await enqueue()
    await db.asWorker('worker-a', c => c.query('SELECT * FROM app.claim_outbox($1)', [60]))
    await expectSqlState(
      db.asWorker('worker-b', c =>
        c.query('SELECT app.settle_outbox($1,$2,$3,$4,$5)', [
          id,
          '11111111-2222-3333-4444-555555555555',
          true,
          null,
          false,
        ]),
      ),
      'CMS04',
    )
  })

  it('an expired token is refused even by the worker that minted it', async () => {
    const id = await enqueue()
    const claimed = await db.asWorker('worker-a', c =>
      c.query<{ lease_token: string }>('SELECT lease_token FROM app.claim_outbox($1)', [60]),
    )
    await db.as('owner', c =>
      c.query("UPDATE outbox SET leased_until = now() - interval '1 second' WHERE id = $1", [id]),
    )

    // The row has been offered to whoever comes next; settling on a lapsed
    // lease would overwrite their result.
    await expectSqlState(
      db.asWorker('worker-a', c =>
        c.query('SELECT app.settle_outbox($1,$2,$3,$4,$5)', [id, claimed.rows[0]!.lease_token, true, null, false]),
      ),
      'CMS04',
    )
  })

  it('a re-claim rotates the capability: the old token dies, the new one works', async () => {
    const id = await enqueue()
    const first = await db.asWorker('worker-a', c =>
      c.query<{ lease_token: string }>('SELECT lease_token FROM app.claim_outbox($1)', [60]),
    )
    await db.as('owner', c =>
      c.query("UPDATE outbox SET leased_until = now() - interval '1 second' WHERE id = $1", [id]),
    )

    const second = await db.asWorker('worker-b', c =>
      c.query<{ id: string; lease_token: string }>('SELECT id, lease_token FROM app.claim_outbox($1)', [60]),
    )
    expect(second.rows[0]!.id).toBe(id)
    expect(second.rows[0]!.lease_token).not.toBe(first.rows[0]!.lease_token)

    await expectSqlState(
      db.asWorker('worker-a', c =>
        c.query('SELECT app.settle_outbox($1,$2,$3,$4,$5)', [id, first.rows[0]!.lease_token, true, null, false]),
      ),
      'CMS04',
    )

    const status = await db.asWorker('worker-b', c =>
      c.query<{ status: string }>('SELECT app.settle_outbox($1,$2,$3,$4,$5) AS status', [
        id,
        second.rows[0]!.lease_token,
        true,
        null,
        false,
      ]),
    )
    expect(status.rows[0]!.status).toBe('delivered')
  })

  it('a spent token cannot be replayed', async () => {
    const id = await enqueue()
    const claimed = await db.asWorker('worker-a', c =>
      c.query<{ lease_token: string }>('SELECT lease_token FROM app.claim_outbox($1)', [60]),
    )
    const token = claimed.rows[0]!.lease_token
    await db.asWorker('worker-a', c =>
      c.query('SELECT app.settle_outbox($1,$2,$3,$4,$5)', [id, token, true, null, false]),
    )

    // Settling cleared the digest, so the token matches nothing.
    await expectSqlState(
      db.asWorker('worker-a', c => c.query('SELECT app.settle_outbox($1,$2,$3,$4,$5)', [id, token, true, null, false])),
      'CMS04',
    )
    const left = await db.as('owner', c =>
      c.query<{ hash: Buffer | null }>('SELECT lease_token_hash AS hash FROM outbox WHERE id = $1', [id]),
    )
    expect(left.rows[0]!.hash).toBeNull()
  })
})

describe('the grants themselves, not just the behaviour they produce', () => {
  it.each([
    ['cms_worker', 'outbox'],
    ['cms_worker', 'scheduled_actions'],
    ['cms_authenticated_user', 'outbox'],
    ['cms_authenticated_user', 'scheduled_actions'],
    ['cms_public_renderer', 'outbox'],
    ['cms_public_renderer', 'scheduled_actions'],
  ])('%s has no SELECT on %s.lease_token_hash', async (role, table) => {
    const { rows } = await db.as('owner', c =>
      c.query<{ granted: boolean }>('SELECT has_column_privilege($1,$2,$3,$4) AS granted', [
        role,
        table,
        'lease_token_hash',
        'SELECT',
      ]),
    )
    expect(rows[0]!.granted).toBe(false)
  })

  it.each([
    ['cms_worker', 'outbox'],
    ['cms_worker', 'scheduled_actions'],
    ['cms_authenticated_user', 'outbox'],
    ['cms_authenticated_user', 'scheduled_actions'],
  ])('%s has no table-level SELECT on %s', async (role, table) => {
    // This is the property that failed in 0009. A table-level grant covers
    // columns added later; without one, a new column is unreadable until
    // someone names it, and forgetting is a visible permission error rather
    // than a silent disclosure.
    const { rows } = await db.as('owner', c =>
      c.query<{ granted: boolean }>('SELECT has_table_privilege($1,$2,$3) AS granted', [role, table, 'SELECT']),
    )
    expect(rows[0]!.granted).toBe(false)
  })

  it('no application role holds any privilege on a lease digest', async () => {
    // Written as a sweep rather than a list so a third table with a lease
    // cannot be added without this failing.
    const { rows } = await db.as('owner', c =>
      c.query<{ leak: string }>(
        `SELECT r.rolname || ' -> ' || c.table_name || '.' || c.column_name || ' (' || p.priv || ')' AS leak
           FROM information_schema.columns c
           CROSS JOIN (VALUES ('cms_worker'),('cms_authenticated_user'),('cms_public_renderer')) r(rolname)
           CROSS JOIN (VALUES ('SELECT'),('INSERT'),('UPDATE'),('REFERENCES')) p(priv)
          WHERE c.table_schema = 'public' AND c.column_name LIKE '%lease_token%'
            AND has_column_privilege(r.rolname, c.table_name, c.column_name, p.priv)`,
      ),
    )
    expect(rows.map(r => r.leak)).toEqual([])
  })
})
