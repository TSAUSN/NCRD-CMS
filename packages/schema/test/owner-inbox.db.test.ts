import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { TestDatabase, expectSqlState } from './harness.ts'
import { seedScenario, type Scenario } from './fixtures.ts'

let db: TestDatabase
let s: Scenario
beforeAll(async () => {
  db = await TestDatabase.create('owner_inbox')
  s = await seedScenario(db)
})
afterAll(async () => {
  await db?.close()
})
const request = (userId: string, siteId: string, id = randomUUID()) =>
  db.asUser(userId, client =>
    client.query('SELECT app.request_custom_section($1,$2,$3,$4) AS id', [
      id,
      siteId,
      'Speaker spotlight',
      'A portrait, biography and session link.',
    ]),
  )
const snapshot = (userId: string) =>
  db.asUser(userId, async client => (await client.query('SELECT app.inbox_snapshot() AS value')).rows[0]!.value)

describe('custom requests and the unified inbox', () => {
  it('allows contributor requests with retry receipts, but no foreign-site writes', async () => {
    const id = randomUUID()
    expect((await request(s.contributorA, s.siteA, id)).rows[0]!.id).toBe(id)
    expect((await request(s.contributorA, s.siteA, id)).rows[0]!.id).toBe(id)
    const audits = await db.asUser(s.editorA, client =>
      client.query("SELECT id FROM audit_log WHERE item_id=$1 AND action='section_request.create'", [id]),
    )
    expect(audits.rows).toHaveLength(1)
    await expectSqlState(request(s.contributorA, s.siteB), 'CMS02')
    await expectSqlState(request(s.disabled, s.siteA), 'CMS02')
    const visible = await db.asUser(s.contributorA, client =>
      client.query('SELECT * FROM app.section_request_feed(NULL)'),
    )
    expect(visible.rows.find(row => row.id === id)?.requested_by_name).toBe('Contributor A')
    expect(visible.rows.every(row => row.site_id === s.siteA && !row.can_manage)).toBe(true)
    expect((await snapshot(s.editorA)).requests).toBe(1)
  })
  it('requires administrator authority, a current version, and a reply on closure', async () => {
    const id = (await request(s.editorA, s.siteA)).rows[0]!.id
    const respond = (user: string, revision: number, status: string, response: string) =>
      db.asUser(user, client =>
        client.query('SELECT app.respond_section_request($1,$2,$3,$4) AS revision', [id, revision, status, response]),
      )
    await expectSqlState(respond(s.contributorA, 0, 'completed', 'Done'), 'CMS02')
    await expectSqlState(respond(s.editorA, 0, 'in_progress', 'Working on it'), 'CMS02')
    await expectSqlState(respond(s.superAdmin, 0, 'completed', ''), 'CMS04')
    expect((await respond(s.superAdmin, 0, 'in_progress', 'Creating a reusable spotlight.')).rows[0]!.revision).toBe(
      '1',
    )
    await expectSqlState(respond(s.superAdmin, 0, 'declined', 'A competing stale response.'), 'CMS01')
    expect((await respond(s.superAdmin, 1, 'completed', 'Available in the section library.')).rows[0]!.revision).toBe(
      '2',
    )
    expect((await respond(s.superAdmin, 1, 'completed', 'Available in the section library.')).rows[0]!.revision).toBe(
      '2',
    )
    const audits = await db.asUser(s.editorA, client =>
      client.query("SELECT id FROM audit_log WHERE item_id=$1 AND action='section_request.respond'", [id]),
    )
    expect(audits.rows).toHaveLength(2)
    await expectSqlState(
      db.asUser(s.superAdmin, client => client.query("UPDATE section_requests SET status='open' WHERE id=$1", [id])),
      '42501',
    )
  })
  it('reopens a closed request with a note, keeps it private to its site, and notifies nobody (LIB-09)', async () => {
    const outboxBefore = await db.as('owner', async client =>
      Number((await client.query('SELECT count(*) AS n FROM outbox')).rows[0]!.n),
    )
    const id = (await request(s.contributorA, s.siteA)).rows[0]!.id
    const respond = (revision: number, status: string, response: string) =>
      db.asUser(s.superAdmin, client =>
        client.query('SELECT app.respond_section_request($1,$2,$3,$4) AS revision', [id, revision, status, response]),
      )
    await respond(0, 'declined', 'Use the existing speakers grid instead.')
    // Reopened with a note: the earlier answer is replaced, and both are in the audit history.
    expect((await respond(1, 'open', 'Reopened: the grid cannot show session links.')).rows[0]!.revision).toBe('2')
    const mine = await db.asUser(s.contributorA, async client =>
      (await client.query('SELECT * FROM app.section_request_feed(NULL)')).rows.find(row => row.id === id),
    )
    expect(mine).toMatchObject({ status: 'open', response: 'Reopened: the grid cannot show session links.' })
    const history = await db.asUser(s.editorA, async client =>
      (
        await client.query(
          "SELECT detail FROM audit_log WHERE item_id=$1 AND action='section_request.respond' ORDER BY id",
          [id],
        )
      ).rows.map(row => [row.detail.from_status, row.detail.status]),
    )
    expect(history).toEqual([
      ['open', 'declined'],
      ['declined', 'open'],
    ])
    // Another site's members never see it.
    const foreign = await db.asUser(
      s.editorB,
      async client => (await client.query('SELECT id FROM app.section_request_feed(NULL)')).rows,
    )
    expect(foreign.some(row => row.id === id)).toBe(false)
    // Asking and answering send nothing: no message or delivery is queued.
    expect(
      await db.as('owner', async client => Number((await client.query('SELECT count(*) AS n FROM outbox')).rows[0]!.n)),
    ).toBe(outboxBefore)
  })
  it('exposes operational errors only to the relevant managers without lease data', async () => {
    await db.as('owner', async client => {
      await client.query(
        "INSERT INTO domains(site_id,hostname_normalized,status,error_code) VALUES($1,'broken.example.test','error','dns_missing')",
        [s.siteA],
      )
      await client.query(
        "INSERT INTO outbox(site_id,event_type,payload,status,last_error,failed_at) VALUES($1,'test.delivery','{}','dead','Bearer abc.def.xyz failed',now())",
        [s.siteB],
      )
      await client.query(
        "INSERT INTO outbox(site_id,event_type,payload,status,last_error,failed_at) VALUES(NULL,'user.invited','{}','dead','mail unavailable',now())",
      )
    })
    expect((await snapshot(s.contributorA)).items).toEqual([])
    expect((await snapshot(s.editorA)).items).toEqual([])
    const owner = await snapshot(s.superAdmin)
    expect(owner.operations).toBe(3)
    expect(owner.items.map((item: { kind: string }) => item.kind).sort()).toEqual(['delivery', 'delivery', 'domain'])
    expect(JSON.stringify(owner)).not.toMatch(/abc.def.xyz|lease_token|provider_ref|verify_token/)
    await db.asUser(s.superAdmin, client =>
      client.query("SELECT app.set_site_membership($1,$2,'site_admin')", [s.editorA, s.siteA]),
    )
    expect((await snapshot(s.editorA)).items.map((item: { kind: string }) => item.kind)).toEqual(['domain'])
  })
})
