import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { TestDatabase, expectSqlState } from './harness.ts'
import { seedScenario, type Scenario } from './fixtures.ts'

let db: TestDatabase
let s: Scenario
beforeAll(async () => {
  db = await TestDatabase.create('activity')
  s = await seedScenario(db)
})
afterAll(async () => {
  await db?.close()
})
const feed = (actor: string, site: string | null = null, action: string | null = null) =>
  db.asUser(actor, client =>
    client.query('SELECT * FROM app.activity_feed($1,NULL,NULL,$2,NULL,NULL,NULL,NULL,100)', [site, action]),
  )

describe('read-only activity history', () => {
  it('exposes only authorized site rows, actor names and action choices', async () => {
    await db.as('owner', async client => {
      await client.query("SELECT app.write_audit($1,'user',$2,'test.visible','page',$3,NULL,NULL,'{}')", [
        s.siteA,
        s.editorA,
        s.pageA,
      ])
      await client.query("SELECT app.write_audit($1,'user',$2,'test.foreign','site',$1,NULL,NULL,'{}')", [
        s.siteB,
        s.editorB,
      ])
      await client.query("SELECT app.write_audit(NULL,'system',NULL,'test.global','system',NULL,NULL,NULL,'{}')")
    })
    const own = await feed(s.contributorA)
    expect(own.rows.some(row => row.action === 'test.visible' && row.actor_id === s.editorA)).toBe(true)
    expect(own.rows.every(row => row.site_id === s.siteA)).toBe(true)
    expect((await feed(s.editorA, s.siteB)).rows).toEqual([])
    expect((await feed(s.superAdmin, null, 'test.global')).rows).toHaveLength(1)
    const options = (await db.asUser(s.editorA, client => client.query('SELECT app.activity_options(NULL) AS value')))
      .rows[0]!.value
    expect(options.actions).not.toContain('test.foreign')
    expect(options.actors.map((actor: { id: string }) => actor.id)).not.toContain(s.editorB)
  })
  it('pages without losing records within the same millisecond or exact timestamp', async () => {
    await db.as('owner', async client => {
      for (const time of [
        '2026-09-05T10:00:00.123400Z',
        '2026-09-05T10:00:00.123500Z',
        '2026-09-05T10:00:00.123500Z',
      ]) {
        await client.query(
          "INSERT INTO audit_log(site_id,actor_type,actor_id,action,created_at) VALUES($1,'user',$2,'test.pagination',$3)",
          [s.siteA, s.editorA, time],
        )
      }
    })
    await db.asUser(s.editorA, async client => {
      const sql = "SELECT * FROM app.activity_feed($1,NULL,'user','test.pagination','2026-09-05','2026-09-06',$2,$3,2)"
      const first = (await client.query(sql, [s.siteA, null, null])).rows
      const second = (await client.query(sql, [s.siteA, first[1]!.cursor_time, first[1]!.id])).rows
      expect(first).toHaveLength(2)
      expect(second).toHaveLength(1)
      expect(new Set([...first, ...second].map(row => row.id)).size).toBe(3)
    })
  })
  it('redacts nested credentials before recording them and when reading legacy detail', async () => {
    const sensitive = {
      password: 'do-not-record',
      nested: [{ accessToken: 'hidden', API_KEY: 'hidden', safe: 'keep' }],
      message: 'Bearer abc.def.xyz postgres://name:password@db.example/data sb_secret_abc123',
    }
    const id = (
      await db.as('owner', client =>
        client.query("SELECT app.write_audit($1,'user',$2,'test.redaction','site',$1,NULL,NULL,$3) AS id", [
          s.siteA,
          s.editorA,
          JSON.stringify(sensitive),
        ]),
      )
    ).rows[0]!.id
    const stored = (
      await db.asUser(s.editorA, client => client.query('SELECT detail FROM audit_log WHERE id=$1', [id]))
    ).rows[0]!.detail
    expect(stored.password).toBe('[redacted]')
    expect(stored.nested).toEqual([{ accessToken: '[redacted]', API_KEY: '[redacted]', safe: 'keep' }])
    expect(JSON.stringify(stored)).not.toMatch(/abc.def.xyz|name:password|sb_secret_abc123/)
    await db.as('owner', client =>
      client.query(
        "INSERT INTO audit_log(site_id,actor_type,actor_id,action,detail) VALUES($1,'user',$2,'test.legacy',$3)",
        [s.siteA, s.editorA, JSON.stringify(sensitive)],
      ),
    )
    expect((await feed(s.editorA, s.siteA, 'test.legacy')).rows[0]!.detail).toEqual(stored)
  })
  it('retains append-only enforcement and rejects unauthenticated reads', async () => {
    await expectSqlState(
      db.asUser(s.superAdmin, client => client.query("UPDATE audit_log SET action='tampered'")),
      '42501',
    )
    await expectSqlState(
      db.asUser(s.superAdmin, client => client.query('DELETE FROM audit_log')),
      '42501',
    )
    await expectSqlState(
      db.as('authenticated', client => client.query('SELECT app.activity_options(NULL)')),
      'CMS02',
    )
  })
})
