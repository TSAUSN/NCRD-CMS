import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest'
import { TestDatabase, expectSqlState } from '@cms/schema/testing'
import { heroContent, seedScenario, type Scenario } from '@cms/schema/fixtures'
import { READINESS_POLICY_VERSION } from '@cms/domain'
import { queueHealth } from '../src/handlers.ts'

let db: TestDatabase
let scenario: Scenario
let version: string

beforeAll(async () => {
  db = await TestDatabase.create('crash_exhaustion')
  scenario = await seedScenario(db)
  version = await db.asUser(
    scenario.editorA,
    async client =>
      (
        await client.query('SELECT version_id FROM app.save_page_draft($1,0,$2,$3)', [
          scenario.pageA,
          heroContent(scenario.heroDefId),
          '{}',
        ])
      ).rows[0]!.version_id,
  )
})
afterAll(async () => {
  await db?.close()
})
beforeEach(async () => {
  await db.as('owner', async client => {
    await client.query('DELETE FROM scheduled_actions')
    await client.query('DELETE FROM outbox')
  })
})

for (const kind of ['outbox', 'schedule'] as const) {
  const table = kind === 'outbox' ? 'outbox' : 'scheduled_actions'
  const claimFunction = kind === 'outbox' ? 'app.claim_outbox' : 'app.claim_scheduled_action'
  const attemptsColumn = kind === 'outbox' ? 'attempts' : 'attempt_count'
  const terminalStatus = kind === 'outbox' ? 'dead' : 'failed'
  const create = () =>
    db.as('owner', async client => {
      const result =
        kind === 'outbox'
          ? await client.query(
              `INSERT INTO outbox(site_id,event_type,payload,max_attempts)
          VALUES($1,'page.published','{}',2) RETURNING id`,
              [scenario.siteA],
            )
          : await client.query(
              `INSERT INTO scheduled_actions
          (site_id,item_type,item_id,version_id,action,run_at,created_by,readiness_policy_version,max_attempts)
          VALUES($1,'page',$2,$3,'publish',now()-interval '1 second',$4,$5,2) RETURNING id`,
              [scenario.siteA, scenario.pageA, version, scenario.editorA, READINESS_POLICY_VERSION],
            )
      return String(result.rows[0]!.id)
    })
  const claim = () =>
    db.asWorker('crash-test', async client => (await client.query(`SELECT * FROM ${claimFunction}(60)`)).rows[0])
  const expire = (id: string) =>
    db.as('owner', client =>
      client.query(`UPDATE ${table} SET leased_until=now()-interval '1 second' WHERE id=$1`, [id]),
    )
  const read = (id: string) =>
    db.as('owner', async client => (await client.query(`SELECT * FROM ${table} WHERE id=$1`, [id])).rows[0]!)

  it(`${kind}: stops repeated process crashes at the limit and continues other work`, async () => {
    const id = await create()
    expect(String((await claim()).id)).toBe(id)
    await expire(id)
    const last = await claim()
    expect(String(last.id)).toBe(id)
    expect(last[attemptsColumn]).toBe(2)
    await expire(id)
    const next = await create()
    expect(String((await claim()).id)).toBe(next)
    const failed = await read(id)
    expect(failed.status).toBe(terminalStatus)
    expect(failed[attemptsColumn]).toBe(2)
    expect(failed.last_error).toMatch(/repeated interruptions.*review/i)
    expect(failed.leased_by).toBeNull()
    expect(failed.leased_until).toBeNull()
    expect(failed.lease_token_hash).toBeNull()
    expect(failed[kind === 'outbox' ? 'failed_at' : 'finished_at']).toBeInstanceOf(Date)
    if (kind === 'schedule') expect(failed.failure_kind).toBe('attempts_exhausted')
    const health = await queueHealth(db.pool('worker'))
    expect(Number(health[kind === 'outbox' ? 'outbox_dead' : 'schedules_failed'])).toBe(1)
    await expectSqlState(
      db.asWorker('crash-test', client =>
        kind === 'outbox'
          ? client.query('SELECT app.settle_outbox($1,$2,true,NULL,false)', [id, last.lease_token])
          : client.query('SELECT app.fail_scheduled_action($1,$2,$3,false)', [id, last.lease_token, 'late failure']),
      ),
      'CMS04',
    )
    expect(
      (
        await db.as('owner', client =>
          client.query('SELECT published_version_id FROM pages WHERE id=$1', [scenario.pageA]),
        )
      ).rows[0]!.published_version_id,
    ).toBeNull()
  })

  it(`${kind}: preserves a still-active final lease and skips a locked expired row`, async () => {
    const id = await create()
    await claim()
    await expire(id)
    await claim()
    expect(await claim()).toBeUndefined()
    expect((await read(id)).status).toBe('running')
    await expire(id)
    const locker = await db.pool('owner').connect()
    try {
      await locker.query('BEGIN')
      await locker.query(`SELECT id FROM ${table} WHERE id=$1 FOR UPDATE`, [id])
      const next = await create()
      expect(String((await claim()).id)).toBe(next)
      expect((await read(id)).status).toBe('running')
    } finally {
      await locker.query('ROLLBACK')
      locker.release()
    }
    expect(await claim()).toBeUndefined()
    expect((await read(id)).status).toBe(terminalStatus)
  })
}
