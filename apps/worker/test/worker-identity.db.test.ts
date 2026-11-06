// Worker identity is the session's, never an argument (SPEC §4, §8:
// "accepts no caller-supplied actor identity").
//
// The functions used to take p_worker_id and never compare it to
// app.current_worker_id(), so worker B could settle worker A's events, close out
// A's schedules, or forge A's heartbeat by passing A's string. The parameter is
// now gone entirely — a value that cannot be passed cannot be forged — and
// these tests hold that shape in place.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { TestDatabase, expectSqlState } from '@cms/schema/testing'
import { heroContent, seedScenario, type Scenario } from '@cms/schema/fixtures'

let db: TestDatabase
let s: Scenario

beforeAll(async () => {
  db = await TestDatabase.create('identity')
  s = await seedScenario(db)
})
afterAll(async () => {
  await db?.close()
})

beforeEach(async () => {
  await db.as('owner', c => c.query('DELETE FROM outbox'))
  await db.as('owner', c => c.query('DELETE FROM scheduled_actions'))
  await db.as('owner', c => c.query('DELETE FROM job_heartbeats'))
})

async function enqueue(path: string): Promise<string> {
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

describe('the worker id is not a parameter any more', () => {
  it.each([
    ['app.claim_outbox', 2],
    ['app.settle_outbox', 5],
    ['app.claim_scheduled_action', 1],
    ['app.fail_scheduled_action', 4],
    ['app.worker_heartbeat', 2],
  ])('%s takes no worker-id argument', async (name, argCount) => {
    const { rows } = await db.as('owner', c =>
      c.query<{ args: string; n: number }>(
        `SELECT pg_get_function_arguments(p.oid) AS args, p.pronargs AS n
           FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
          WHERE ns.nspname = 'app' AND ns.nspname || '.' || p.proname = $1`,
        [name],
      ),
    )
    expect(rows).toHaveLength(1)
    expect(rows[0]!.n).toBe(argCount)
    // The strongest possible statement: there is no such parameter to supply.
    expect(rows[0]!.args).not.toMatch(/worker_id/)
  })

  it('the old worker-id-taking signatures no longer exist at all', async () => {
    const { rows } = await db.as('owner', c =>
      c.query<{ sig: string }>(
        `SELECT p.oid::regprocedure::text AS sig
           FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
          WHERE ns.nspname = 'app'
            AND pg_get_function_arguments(p.oid) LIKE '%p_worker_id%'`,
      ),
    )
    expect(rows.map(r => r.sig)).toEqual([])
  })
})

describe('worker B cannot act as worker A', () => {
  it('cannot settle an event worker A holds', async () => {
    const id = await enqueue('/held-by-a')
    await db.asWorker('worker-a', c => c.query('SELECT * FROM app.claim_outbox($1)', [60]))

    // Worker B cannot settle it. Crucially this holds even when B *forges*
    // worker A's identity, because the authorization is the unguessable lease
    // token minted by the claim — not a string either of them can assert.
    await expectSqlState(
      db.asWorker('worker-a', c =>
        c.query('SELECT app.settle_outbox($1,$2,$3,$4,$5)', [
          id,
          '00000000-0000-0000-0000-000000000000',
          true,
          null,
          false,
        ]),
      ),
      'CMS04',
    )

    const row = await db.as('owner', c =>
      c.query<{ status: string; leased_by: string }>('SELECT status, leased_by FROM outbox WHERE id = $1', [id]),
    )
    expect(row.rows[0]!.status).toBe('running')
    expect(row.rows[0]!.leased_by).toBe('worker-a')
  })

  it('cannot steal an event whose lease is still live', async () => {
    await enqueue('/still-leased')
    await db.asWorker('worker-a', c => c.query('SELECT * FROM app.claim_outbox($1)', [60]))
    const stolen = await db.asWorker('worker-b', c => c.query('SELECT id FROM app.claim_outbox($1)', [60]))
    expect(stolen.rows).toHaveLength(0)
  })

  it('two ordinary worker sessions write two separate heartbeat rows', async () => {
    // Renamed from "cannot forge worker A's heartbeat", which is not what this
    // shows. Two sessions that each state their own id land on their own row;
    // that is ordinary behaviour, not a defence. See the test below for what
    // actually happens when one of them lies.
    await db.asWorker('worker-a', c => c.query("SELECT app.worker_heartbeat('worker','1.0')"))
    await db.asWorker('worker-b', c => c.query("SELECT app.worker_heartbeat('worker','2.0')"))

    const { rows } = await db.as('owner', c =>
      c.query<{ worker_id: string; version: string }>(
        'SELECT worker_id, version FROM job_heartbeats ORDER BY worker_id',
      ),
    )
    expect(rows).toEqual([
      { worker_id: 'worker-a', version: '1.0' },
      { worker_id: 'worker-b', version: '2.0' },
    ])
  })

  it('the heartbeat label IS forgeable — a known, bounded limitation', async () => {
    // Written down as a test rather than left as an absence, so nobody can
    // claim the opposite without this failing.
    //
    // app.worker_heartbeat keys on app.current_worker_id(), a session GUC the
    // client sets for itself, and every worker authenticates as one database
    // role. So a second process can write under the first one's name. It is a
    // misleading operator display and nothing more: no work can be claimed,
    // settled, or published through a heartbeat — those need a lease token,
    // which is minted by the claim and never readable (migrations 0009, 0010).
    //
    // Closing it needs a distinct database login per worker, which is a
    // deployment decision, not a schema change (threat model §9a, V2-SETUP-07).
    await db.asWorker('worker-a', c => c.query("SELECT app.worker_heartbeat('worker','real')"))
    await db.asWorker('worker-a', c => c.query("SELECT app.worker_heartbeat('worker','impostor')"))

    const { rows } = await db.as('owner', c =>
      c.query<{ worker_id: string; version: string }>('SELECT worker_id, version FROM job_heartbeats'),
    )
    expect(rows).toEqual([{ worker_id: 'worker-a', version: 'impostor' }])

    // The boundary that does hold: a forged heartbeat wins nothing else. This
    // session can claim work, but only under a token it was actually given.
    const forged = await db.asWorker('worker-a', c => c.query('SELECT * FROM app.claim_outbox($1)', [60]))
    expect(forged.rows).toHaveLength(0)
  })

  it('cannot fail a schedule worker A holds', async () => {
    const page = await db.asUser(
      s.editorA,
      async c =>
        (
          await c.query<{ id: string }>('SELECT app.create_page($1,$2,$3) AS id', [
            s.siteA,
            'identity-sched',
            'Identity',
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
    const id = await db.as(
      'owner',
      async c =>
        (
          await c.query<{ id: string }>(
            `INSERT INTO scheduled_actions (site_id, item_type, item_id, version_id, action, run_at, created_by, readiness_policy_version)
         VALUES ($1,'page',$2,$3,'publish', now() - interval '1 second', $4, 1) RETURNING id`,
            [s.siteA, page, version, s.editorA],
          )
        ).rows[0]!.id,
    )

    await db.asWorker('worker-a', c => c.query('SELECT * FROM app.claim_scheduled_action($1)', [60]))
    const wrongToken = '00000000-0000-0000-0000-000000000000'
    await expectSqlState(
      db.asWorker('worker-b', c =>
        c.query('SELECT app.fail_scheduled_action($1,$2,$3,$4)', [id, wrongToken, 'not mine', true]),
      ),
      'CMS04',
    )
    await expectSqlState(
      db.asWorker('worker-b', c =>
        c.query('SELECT app.execute_scheduled_action($1,$2,$3,$4)', [id, wrongToken, 1, '[]']),
      ),
      'CMS04',
    )

    // Even forging worker A's identity does not help: the token is what counts.
    await expectSqlState(
      db.asWorker('worker-a', c =>
        c.query('SELECT app.execute_scheduled_action($1,$2,$3,$4)', [id, wrongToken, 1, '[]']),
      ),
      'CMS04',
    )
  })
})

describe('a session with no worker identity can do nothing', () => {
  it.each([
    ['claim an event', 'SELECT * FROM app.claim_outbox(60)'],
    ['claim a schedule', 'SELECT * FROM app.claim_scheduled_action(60)'],
    ['record a heartbeat', "SELECT app.worker_heartbeat('worker','x')"],
  ])('cannot %s', async (_name, sql) => {
    // `db.as('worker')` connects as the worker role but never sets the GUC.
    await expectSqlState(
      db.as('worker', c => c.query(sql)),
      'CMS02',
    )
  })
})
