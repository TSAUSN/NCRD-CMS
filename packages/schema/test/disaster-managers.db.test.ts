import { afterAll, beforeAll, expect, it } from 'vitest'
import { TestDatabase, expectSqlState } from './harness.ts'
import { seedScenario, type Scenario } from './fixtures.ts'

// Disaster Managers (migration 0213): a tool grant that lets a person use the
// Current Disasters tool, managed only by super admins and visible only to the
// person and super admins.
let db: TestDatabase
let s: Scenario
beforeAll(async () => {
  db = await TestDatabase.create('disaster_managers')
  s = await seedScenario(db)
})
afterAll(async () => {
  await db?.close()
})

const revision = async (id: string) =>
  (await db.as('owner', c => c.query<{ revision: string }>('SELECT revision FROM app_users WHERE id=$1', [id])))
    .rows[0]!.revision
const canUse = async (id: string) =>
  (await db.asUser(id, c => c.query<{ ok: boolean }>("SELECT app.can_use_tool('current_disasters') AS ok"))).rows[0]!.ok

it('adds a person whose only access is the tool, who may then sign in and use it', async () => {
  const id = await db.asUser(
    s.superAdmin,
    async c =>
      (
        await c.query<{ id: string }>('SELECT app.add_tool_person($1,$2,$3) AS id', [
          ' EDS.Manager@Example.Test ',
          ' EDS manager (sample) ',
          'current_disasters',
        ])
      ).rows[0]!.id,
  )
  const state = await db.as(
    'owner',
    async c =>
      (
        await c.query(
          `SELECT u.email,
             (SELECT count(*)::int FROM site_memberships WHERE user_id=u.id) AS sites,
             (SELECT count(*)::int FROM global_roles WHERE user_id=u.id) AS global_roles,
             (SELECT array_agg(tool) FROM tool_grants WHERE user_id=u.id) AS tools,
             (SELECT count(*)::int FROM outbox WHERE payload->>'user_id'=u.id::text) AS emails,
             (SELECT count(*)::int FROM audit_log WHERE item_id=u.id AND action='user.add') AS audited
           FROM app_users u WHERE u.id=$1`,
          [id],
        )
      ).rows[0],
  )
  expect(state).toEqual({
    email: 'eds.manager@example.test',
    sites: 0,
    global_roles: 0,
    tools: ['current_disasters'],
    emails: 0,
    audited: 1,
  })
  expect(
    (await db.asUser(null, c => c.query('SELECT app.is_invited_email($1) AS ok', ['eds.manager@example.test'])))
      .rows[0],
  ).toEqual({ ok: true })
  expect(await canUse(id)).toBe(true)
  expect((await db.asUser(id, c => c.query('SELECT app.current_tools() AS tools'))).rows[0]).toEqual({
    tools: ['current_disasters'],
  })
  // A tool grant is not a global role: it must not make anyone a super admin.
  expect((await db.asUser(id, c => c.query('SELECT app.is_super_admin() AS ok'))).rows[0]).toEqual({ ok: false })
})

it('grants and removes the tool on an existing person, guarded by revision and audit', async () => {
  expect(await canUse(s.editorA)).toBe(false)
  const before = await revision(s.editorA)
  const after = (
    await db.asUser(s.superAdmin, c =>
      c.query<{ r: string }>("SELECT app.set_tool_grant($1,$2,'current_disasters',true) AS r", [s.editorA, before]),
    )
  ).rows[0]!.r
  expect(BigInt(after)).toBeGreaterThan(BigInt(before))
  expect(await canUse(s.editorA)).toBe(true)
  // A stale form cannot overwrite a newer change.
  await expectSqlState(
    db.asUser(s.superAdmin, c =>
      c.query("SELECT app.set_tool_grant($1,$2,'current_disasters',false)", [s.editorA, before]),
    ),
    'CMS01',
  )
  await db.asUser(s.superAdmin, c =>
    c.query("SELECT app.set_tool_grant($1,$2,'current_disasters',false)", [s.editorA, after]),
  )
  expect(await canUse(s.editorA)).toBe(false)
  const audited = await db.as(
    'owner',
    async c =>
      (
        await c.query<{ n: number }>(
          "SELECT count(*)::int AS n FROM audit_log WHERE item_id=$1 AND action='tool_grant.set'",
          [s.editorA],
        )
      ).rows[0]!.n,
  )
  expect(audited).toBe(2)
})

it('lets only super admins manage grants and hides other people’s grants', async () => {
  await expectSqlState(
    db.asUser(s.editorA, async c =>
      c.query("SELECT app.set_tool_grant($1,$2,'current_disasters',true)", [s.editorA, await revision(s.editorA)]),
    ),
    'CMS02',
  )
  await expectSqlState(
    db.asUser(s.editorA, c => c.query("SELECT app.add_tool_person('x@example.test','X','current_disasters')")),
    'CMS02',
  )
  await expectSqlState(
    db.asUser(s.superAdmin, c => c.query("SELECT app.add_tool_person('y@example.test','Y','other_tool')")),
    'CMS04',
  )
  // Rows are written only through the commands.
  await expectSqlState(
    db.asUser(s.superAdmin, c =>
      c.query("INSERT INTO tool_grants(user_id,tool) VALUES($1,'current_disasters')", [s.editorB]),
    ),
    '42501',
  )
  const visibleToEditor = await db.asUser(
    s.editorA,
    async c => (await c.query<{ n: number }>('SELECT count(*)::int AS n FROM tool_grants')).rows[0]!.n,
  )
  expect(visibleToEditor).toBe(0)
  expect(await canUse(s.superAdmin)).toBe(true)
})
