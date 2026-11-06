import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { TestDatabase, expectSqlState } from './harness.ts'
import { seedScenario, type Scenario } from './fixtures.ts'

let db: TestDatabase
let s: Scenario
let count = 0
beforeAll(async () => {
  db = await TestDatabase.create('people')
  s = await seedScenario(db)
})
afterAll(async () => {
  await db?.close()
})
const assignments = () => JSON.stringify([{ siteId: s.siteA, role: 'contributor' }])
async function invite() {
  const email = `invited-${++count}@example.test`
  const id = await db.asUser(
    s.superAdmin,
    async c =>
      (
        await c.query<{ id: string }>('SELECT app.invite_user($1,$2,$3) AS id', [
          email,
          'Invited person',
          assignments(),
        ])
      ).rows[0]!.id,
  )
  return { id, email }
}
async function head(id: string) {
  return db.asUser(
    s.superAdmin,
    async c =>
      (
        await c.query<{ revision: string; status: string; auth_subject: string | null }>(
          'SELECT revision,status,auth_subject FROM app_users WHERE id=$1',
          [id],
        )
      ).rows[0]!,
  )
}

describe('people and invitation commands', () => {
  it('creates the product user, memberships, audit and notification before mail delivery', async () => {
    const person = await invite()
    expect((await head(person.id)).auth_subject).toBeNull()
    const memberships = await db.asUser(s.superAdmin, c =>
      c.query('SELECT site_id,role FROM site_memberships WHERE user_id=$1', [person.id]),
    )
    expect(memberships.rows).toEqual([{ site_id: s.siteA, role: 'contributor' }])
    const events = await db.as('owner', c =>
      c.query("SELECT status,payload FROM outbox WHERE event_type='user.invited' AND payload->>'user_id'=$1", [
        person.id,
      ]),
    )
    expect(events.rows).toEqual([{ status: 'pending', payload: { user_id: person.id, email: person.email } }])
    const audit = await db.asUser(s.superAdmin, c =>
      c.query("SELECT id FROM audit_log WHERE action='user.invite' AND item_id=$1", [person.id]),
    )
    expect(audit.rows).toHaveLength(1)
  })
  it.each(['editorA', 'contributorA', 'editorB'] as const)('does not let %s invite or manage users', async role => {
    await expectSqlState(
      db.asUser(s[role], c =>
        c.query('SELECT app.invite_user($1,$2,$3)', ['forged@example.test', 'Forged', assignments()]),
      ),
      'CMS02',
    )
    await expectSqlState(
      db.asUser(s[role], c =>
        c.query('SELECT app.update_person($1,$2,$3,$4,$5)', [s.editorA, 0, 'Forged', 'disabled', '[]']),
      ),
      'CMS02',
    )
  })
  it('rejects invalid assignments atomically without leaving a product user', async () => {
    await expectSqlState(
      db.asUser(s.superAdmin, c =>
        c.query('SELECT app.invite_user($1,$2,$3)', [
          'invalid-assignment@example.test',
          'Invalid',
          JSON.stringify([{ siteId: s.siteA, role: 'super_admin' }]),
        ]),
      ),
      'CMS04',
    )
    expect(
      (await db.as('owner', c => c.query("SELECT id FROM app_users WHERE email='invalid-assignment@example.test'")))
        .rows,
    ).toEqual([])
  })
  it('keeps concurrent account edits from overwriting newly assigned access', async () => {
    const person = await invite()
    const before = await head(person.id)
    await db.asUser(s.superAdmin, c =>
      c.query('SELECT app.update_person($1,$2,$3,$4,$5)', [
        person.id,
        before.revision,
        'New name',
        'active',
        JSON.stringify([{ siteId: s.siteB, role: 'editor' }]),
      ]),
    )
    await expectSqlState(
      db.asUser(s.superAdmin, c =>
        c.query('SELECT app.update_person($1,$2,$3,$4,$5)', [
          person.id,
          before.revision,
          'Stale',
          'disabled',
          assignments(),
        ]),
      ),
      'CMS01',
    )
    const roles = await db.asUser(s.superAdmin, c =>
      c.query('SELECT site_id,role FROM site_memberships WHERE user_id=$1', [person.id]),
    )
    expect(roles.rows).toEqual([{ site_id: s.siteB, role: 'editor' }])
  })
  it('requires a revision and prevents self-deactivation or loss of the last super admin', async () => {
    const person = await invite()
    await expectSqlState(
      db.asUser(s.superAdmin, c =>
        c.query('SELECT app.update_person($1,NULL,$2,$3,$4)', [person.id, 'Missing revision', 'active', assignments()]),
      ),
      'CMS01',
    )
    await expectSqlState(
      db.asUser(s.superAdmin, c => c.query("SELECT app.set_user_status($1,'disabled')", [s.superAdmin])),
      'CMS04',
    )
    await expectSqlState(
      db.asUser(s.superAdmin, c => c.query('SELECT app.set_global_role($1,NULL)', [s.superAdmin])),
      'CMS04',
    )
  })
  it('deactivates an already verified identity on its next session resolution', async () => {
    const person = await invite()
    await db.asUser(null, c => c.query('SELECT app.attach_auth_subject($1,$2)', [person.email, 'verified-person']))
    const before = await head(person.id)
    await db.asUser(s.superAdmin, c =>
      c.query('SELECT app.update_person($1,$2,$3,$4,$5)', [
        person.id,
        before.revision,
        'Invited person',
        'disabled',
        assignments(),
      ]),
    )
    expect(
      (
        await db.asUser(null, c =>
          c.query('SELECT * FROM app.resolve_session($1,$2)', ['verified-person', person.email]),
        )
      ).rows,
    ).toEqual([])
    expect(
      (await db.asUser(null, c => c.query('SELECT app.is_invited_email($1) AS invited', [person.email]))).rows[0]!
        .invited,
    ).toBe(false)
  })
  it('binds a verified subject once without repeatedly changing account revision or audit', async () => {
    const person = await invite()
    await db.asUser(null, c => c.query('SELECT app.attach_auth_subject($1,$2)', [person.email, 'verified-repeat']))
    const before = await head(person.id)
    await db.asUser(null, c => c.query('SELECT app.attach_auth_subject($1,$2)', [person.email, 'verified-repeat']))
    expect((await head(person.id)).revision).toBe(before.revision)
    const audit = await db.as('owner', c =>
      c.query("SELECT id FROM audit_log WHERE action='user.attach_auth_subject' AND item_id=$1", [person.id]),
    )
    expect(audit.rows).toHaveLength(1)
    await expectSqlState(
      db.asUser(null, c => c.query('SELECT app.attach_auth_subject($1,$2)', [person.email, 'different-subject'])),
      'CMS04',
    )
  })
  it('rate-limits invitation resends without changing account access', async () => {
    const person = await invite()
    const before = await head(person.id)
    await expectSqlState(
      db.asUser(s.superAdmin, c => c.query('SELECT app.resend_invitation($1,$2)', [person.id, before.revision])),
      'CMS04',
    )
    expect((await head(person.id)).revision).toBe(before.revision)
  })
})

describe('invitation delivery journal', () => {
  async function claimedInvitation() {
    const person = await invite()
    const row = (
      await db.as('owner', c =>
        c.query<{ id: string }>("SELECT id FROM outbox WHERE event_type='user.invited' AND payload->>'user_id'=$1", [
          person.id,
        ]),
      )
    ).rows[0]!
    const excluded = (
      await db.as('owner', c => c.query<{ id: string }>('SELECT id FROM outbox WHERE id<>$1', [row.id]))
    ).rows.map(x => x.id)
    const claimed = (
      await db.asWorker('mail-worker', c =>
        c.query<{ id: string; lease_token: string }>('SELECT * FROM app.claim_outbox($1,$2::bigint[])', [60, excluded]),
      )
    ).rows[0]!
    return { ...person, eventId: claimed.id, lease: claimed.lease_token }
  }
  it('requires the current lease and freezes the provider payload across retries', async () => {
    const p = await claimedInvitation()
    await expectSqlState(
      db.asWorker('other', c =>
        c.query('SELECT * FROM app.prepare_invitation_email($1,$2,$3,$4,$5)', [
          p.eventId,
          '00000000-0000-0000-0000-000000000000',
          'Subject',
          'Body',
          'cms/test/forged',
        ]),
      ),
      'CMS04',
    )
    const prepare = (subject: string) =>
      db.asWorker('mail-worker', c =>
        c.query('SELECT * FROM app.prepare_invitation_email($1,$2,$3,$4,$5)', [
          p.eventId,
          p.lease,
          subject,
          'Original body',
          `cms/test/${p.eventId}`,
        ]),
      )
    const first = (await prepare('Original subject')).rows[0]!
    const retry = (await prepare('Changed configuration')).rows[0]!
    expect(retry).toEqual(first)
    await db.asWorker('mail-worker', c =>
      c.query('SELECT app.record_invitation_delivery($1,$2,$3)', [p.eventId, p.lease, 'provider-receipt']),
    )
    expect((await prepare('Third attempt')).rows[0]!.provider_id).toBe('provider-receipt')
  })
  it('does not deliver a queued invitation after the account is disabled', async () => {
    const p = await claimedInvitation()
    await db.asUser(s.superAdmin, c => c.query("SELECT app.set_user_status($1,'disabled')", [p.id]))
    const prepared = await db.asWorker('mail-worker', c =>
      c.query('SELECT * FROM app.prepare_invitation_email($1,$2,$3,$4,$5)', [
        p.eventId,
        p.lease,
        'Subject',
        'Body',
        `cms/test/${p.eventId}`,
      ]),
    )
    expect(prepared.rows[0]!.cancelled).toBe(true)
  })
})
