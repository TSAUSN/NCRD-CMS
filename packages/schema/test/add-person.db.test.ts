import { afterAll, beforeAll, expect, it } from 'vitest'
import { TestDatabase, expectSqlState } from './harness.ts'
import { seedScenario, type Scenario } from './fixtures.ts'
let db: TestDatabase
let s: Scenario
beforeAll(async () => {
  db = await TestDatabase.create('add_person')
  s = await seedScenario(db)
})
afterAll(async () => {
  await db?.close()
})
const assignments = () => JSON.stringify([{ siteId: s.siteA, role: 'editor' }])

it('adds only scoped product access and audit, without email or an authentication identity', async () => {
  const id = await db.asUser(
    s.superAdmin,
    async c =>
      (
        await c.query<{ id: string }>('SELECT app.add_person($1,$2,$3) AS id', [
          '  New.Editor@Example.Test  ',
          ' New editor ',
          assignments(),
        ])
      ).rows[0]!.id,
  )
  const state = await db.as(
    'owner',
    async c =>
      (
        await c.query(
          `SELECT u.email,u.display_name,u.auth_subject,u.status,
    (SELECT jsonb_agg(jsonb_build_object('site',site_id,'role',role)) FROM site_memberships WHERE user_id=u.id) AS memberships,
    (SELECT count(*)::int FROM outbox WHERE payload->>'user_id'=u.id::text) AS emails,
    (SELECT count(*)::int FROM global_roles WHERE user_id=u.id) AS global_roles,
    (SELECT count(*)::int FROM audit_log WHERE item_id=u.id AND action='user.add' AND actor_id=$2) AS audited
    FROM app_users u WHERE u.id=$1`,
          [id, s.superAdmin],
        )
      ).rows[0],
  )
  expect(state).toEqual({
    email: 'new.editor@example.test',
    display_name: 'New editor',
    auth_subject: null,
    status: 'active',
    memberships: [{ site: s.siteA, role: 'editor' }],
    emails: 0,
    global_roles: 0,
    audited: 1,
  })
  expect(
    (await db.asUser(null, c => c.query('SELECT app.is_invited_email($1) AS allowed', ['new.editor@example.test'])))
      .rows[0],
  ).toEqual({ allowed: true })
  await db.asUser(null, c =>
    c.query('SELECT app.attach_auth_subject($1,$2)', ['new.editor@example.test', 'verified-new-editor']),
  )
  expect(
    (
      await db.asUser(id, c =>
        c.query('SELECT app.can_publish($1) AS assigned, app.has_site_access($2) AS foreign_access', [
          s.siteA,
          s.siteB,
        ]),
      )
    ).rows[0],
  ).toEqual({ assigned: true, foreign_access: false })
  await expectSqlState(
    db.asUser(null, c =>
      c.query('SELECT app.attach_auth_subject($1,$2)', ['new.editor@example.test', 'different-identity']),
    ),
    'CMS04',
  )
})

it.each(['editorA', 'contributorA', 'editorB'] as const)(
  'refuses %s and anonymous callers without creating access',
  async role => {
    await expectSqlState(
      db.asUser(s[role], c =>
        c.query('SELECT app.add_person($1,$2,$3)', ['forbidden@example.test', 'Forbidden', assignments()]),
      ),
      'CMS02',
    )
    expect(
      (await db.as('owner', c => c.query("SELECT id FROM app_users WHERE email='forbidden@example.test'"))).rows,
    ).toEqual([])
  },
)

it('rejects empty, foreign-role, duplicate and malformed input atomically', async () => {
  for (const [email, name, memberships] of [
    ['empty@example.test', 'Empty', '[]'],
    ['role@example.test', 'Role', JSON.stringify([{ siteId: s.siteA, role: 'super_admin' }])],
    [
      'sites@example.test',
      'Duplicate sites',
      JSON.stringify([
        { siteId: s.siteA, role: 'editor' },
        { siteId: s.siteA, role: 'contributor' },
      ]),
    ],
    ['invalid-email', 'Name', assignments()],
    ['name@example.test', ' ', assignments()],
    ['new.editor@example.test', 'Already added', assignments()],
  ])
    await expectSqlState(
      db.asUser(s.superAdmin, c => c.query('SELECT app.add_person($1,$2,$3)', [email, name, memberships])),
      'CMS04',
    )
  expect(
    (
      await db.as('owner', c =>
        c.query(
          "SELECT email FROM app_users WHERE email IN ('empty@example.test','role@example.test','sites@example.test','invalid-email','name@example.test')",
        ),
      )
    ).rows,
  ).toEqual([])
})

it('requires an authenticated actor and keeps the command unavailable to public renderers', async () => {
  await expectSqlState(
    db.asUser(null, c =>
      c.query('SELECT app.add_person($1,$2,$3)', ['anonymous@example.test', 'Anonymous', assignments()]),
    ),
    'CMS02',
  )
  await expectSqlState(
    db.as('public', c => c.query('SELECT app.add_person($1,$2,$3)', ['public@example.test', 'Public', assignments()])),
    '42501',
  )
})
