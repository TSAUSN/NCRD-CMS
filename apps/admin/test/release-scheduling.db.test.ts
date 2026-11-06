import { randomUUID } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CHECKED_CLEAN, TestDatabase, expectSqlState } from '@cms/schema/testing'
import { heroContent, seedScenario, type Scenario } from '@cms/schema/fixtures'
import { DEFAULT_THEME_TOKENS } from '@cms/schema'
import { mapErrors } from '@cms/domain'
let db: TestDatabase, s: Scenario
vi.mock('@cms/platform', async original => ({
  ...(await original<object>()),
  asUser: (identity: { userId: string | null }, run: Parameters<TestDatabase['asUser']>[1]) =>
    mapErrors(() => db.asUser(identity.userId, run)),
}))
import { executeLeasedRelease } from '../src/lib/scheduled-release.ts'
import {
  executeSiteReleaseInTransaction,
  listSiteReleases,
  listReleaseCandidates,
  planSiteRelease,
  scheduleSiteRelease,
} from '../src/lib/releases.ts'

beforeEach(async () => {
  db = await TestDatabase.create('release_schedule')
  s = await seedScenario(db)
  await db.asUser(s.superAdmin, async client => {
    await client.query("SELECT app.set_site_membership($1,$2,'site_admin')", [s.editorA, s.siteA])
    await client.query('SELECT app.save_page_draft($1,0,$2,$3)', [
      s.pageA,
      heroContent(s.heroDefId, 'Before timer'),
      JSON.stringify({ description: 'Complete local scheduling fixture.' }),
    ])
    await client.query('SELECT app.publish_page($1,1,$2,$3,$4)', [s.pageA, ...CHECKED_CLEAN])
    await client.query('SELECT app.save_page_draft($1,2,$2,$3)', [
      s.pageA,
      heroContent(s.heroDefId, 'After timer'),
      JSON.stringify({ description: 'Complete local scheduling fixture.' }),
    ])
    const head = (await client.query('SELECT revision FROM themes WHERE site_id=$1', [s.siteA])).rows[0]!
    await client.query('SELECT app.save_theme_draft($1,$2,$3)', [
      s.siteA,
      head.revision,
      JSON.stringify({ ...DEFAULT_THEME_TOKENS, colors: { ...DEFAULT_THEME_TOKENS.colors, primary: '#165b43' } }),
    ])
  })
  await db.asWorker('release-fixture', client => client.query("SELECT app.worker_heartbeat('worker','test')"))
})
afterEach(async () => {
  await db?.close()
})
async function prepare() {
  return planSiteRelease(s.editorA, randomUUID(), s.siteA, await listReleaseCandidates(s.editorA, s.siteA))
}
async function scheduled() {
  const plan = await prepare(),
    at = new Date(Date.now() + 3_600_000).toISOString(),
    request = randomUUID()
  const id = await scheduleSiteRelease(s.editorA, plan.id, at, '', false, request)
  return { plan, at, request, id }
}
async function claim(id: string) {
  await db.as('owner', client =>
    client.query("UPDATE scheduled_actions SET run_at=now()-interval '1 second' WHERE id=$1", [id]),
  )
  return db.asWorker(
    'release-fixture',
    async client => (await client.query('SELECT * FROM app.claim_scheduled_action(60)')).rows[0]!,
  )
}
async function state() {
  return db.asUser(s.superAdmin, async client => ({
    page: (
      await client.query('SELECT revision,draft_version_id,published_version_id FROM pages WHERE id=$1', [s.pageA])
    ).rows[0],
    theme: (
      await client.query(
        'SELECT h.revision,h.draft_version_id,h.published_version_id,d.tokens AS draft_tokens,l.tokens AS live_tokens FROM themes h JOIN theme_versions d ON d.id=h.draft_version_id LEFT JOIN theme_versions l ON l.id=h.published_version_id WHERE h.site_id=$1',
        [s.siteA],
      )
    ).rows[0],
    audit: (
      await client.query(
        "SELECT count(*) FROM audit_log WHERE site_id=$1 AND action IN ('page.publish','theme.publish')",
        [s.siteA],
      )
    ).rows[0],
  }))
}

describe('reviewed release schedules over real RLS and lease commands', () => {
  it('pins a combined review, is idempotent and refuses a changed intention', async () => {
    const { plan, at, request, id } = await scheduled()
    expect(await scheduleSiteRelease(s.editorA, plan.id, at, '', false, request)).toBe(id)
    await expect(
      scheduleSiteRelease(s.editorA, plan.id, new Date(Date.parse(at) + 60_000).toISOString(), '', false, request),
    ).rejects.toMatchObject({ kind: 'invalid_state' })
    const row = await db.asUser(
      s.editorA,
      async client =>
        (await client.query('SELECT item_type,item_id,version_id,status FROM scheduled_actions WHERE id=$1', [id]))
          .rows[0],
    )
    expect(row).toEqual({ item_type: 'release', item_id: plan.id, version_id: plan.id, status: 'pending' })
    expect((await listSiteReleases(s.editorA, s.siteA)).find(release => release.id === plan.id)?.stale).toBe(false)
    expect(
      await db.asWorker(
        'release-fixture',
        async client => (await client.query('SELECT * FROM app.claim_scheduled_action(60)')).rows,
      ),
    ).toEqual([])
  })
  it('resolves only the exact live release capability before restoring its stored actor', async () => {
    const { id, plan } = await scheduled(),
      job = await claim(id)
    const resolve = (target: string, token: string) =>
      db.as(
        'authenticated',
        async client =>
          (await client.query('SELECT * FROM app.release_schedule_capability($1,$2)', [target, token])).rows,
      )
    expect(await resolve(id, job.lease_token)).toEqual([{ actor_id: s.editorA, release_id: plan.id }])
    expect(await resolve(id, randomUUID())).toEqual([])
    expect(await resolve(randomUUID(), job.lease_token)).toEqual([])
    await db.as('owner', client =>
      client.query("UPDATE scheduled_actions SET leased_until=now()-interval '1 second' WHERE id=$1", [id]),
    )
    expect(await resolve(id, job.lease_token)).toEqual([])
  })
  it('refuses contributors, other sites, missing worker health and invalid dates', async () => {
    const plan = await prepare(),
      at = new Date(Date.now() + 3_600_000).toISOString()
    for (const actor of [s.contributorA, s.editorB, s.disabled])
      await expect(scheduleSiteRelease(actor, plan.id, at, '', false, randomUUID())).rejects.toBeTruthy()
    await expect(
      scheduleSiteRelease(s.editorA, plan.id, new Date().toISOString(), '', false, randomUUID()),
    ).rejects.toMatchObject({ kind: 'invalid_state' })
    await db.as('owner', client => client.query('DELETE FROM job_heartbeats'))
    await expect(scheduleSiteRelease(s.editorA, plan.id, at, '', false, randomUUID())).rejects.toMatchObject({
      kind: 'invalid_state',
    })
    expect(
      await db.asUser(s.editorB, async client => (await client.query('SELECT id FROM scheduled_actions')).rows),
    ).toEqual([])
  })
  it('publishes and settles together, clears the capability and does not republish a receipt', async () => {
    const { id, plan } = await scheduled(),
      before = await state(),
      job = await claim(id)
    await executeLeasedRelease(id, job.lease_token)
    const after = await state()
    expect(after.page.published_version_id).toBe(before.page.draft_version_id)
    expect(after.theme.live_tokens).toEqual(before.theme.draft_tokens)
    expect(after.theme.published_version_id).not.toBe(before.theme.published_version_id)
    const row = await db.as(
      'owner',
      async client =>
        (await client.query('SELECT status,finished_at,lease_token_hash FROM scheduled_actions WHERE id=$1', [id]))
          .rows[0],
    )
    expect(row.status).toBe('succeeded')
    expect(row.finished_at).toBeInstanceOf(Date)
    expect(row.lease_token_hash).toBeNull()
    await expect(executeLeasedRelease(id, job.lease_token)).rejects.toMatchObject({ kind: 'not_authorized' })
    await db.asUser(s.editorA, client => executeSiteReleaseInTransaction(client, plan.id, ''))
    expect(await state()).toEqual(after)
    await expectSqlState(
      db.asWorker('release-fixture', client =>
        client.query("SELECT app.fail_scheduled_action($1,$2,'lost acknowledgement',false)", [id, job.lease_token]),
      ),
      'CMS04',
    )
    expect(await state()).toEqual(after)
  })
  it('refuses wrong, cross-job and expired leases without publication', async () => {
    const { id } = await scheduled(),
      before = await state(),
      job = await claim(id)
    for (const [target, token] of [
      [id, randomUUID()],
      [randomUUID(), job.lease_token],
    ])
      await expect(executeLeasedRelease(target!, token!)).rejects.toMatchObject({ kind: 'not_authorized' })
    await expectSqlState(
      db.asUser(s.contributorA, client =>
        client.query('SELECT app.lock_release_schedule($1,$2)', [id, job.lease_token]),
      ),
      'CMS04',
    )
    await db.as('owner', client =>
      client.query("UPDATE scheduled_actions SET leased_until=now()-interval '1 second' WHERE id=$1", [id]),
    )
    await expect(executeLeasedRelease(id, job.lease_token)).rejects.toMatchObject({ kind: 'not_authorized' })
    expect(await state()).toEqual(before)
  })
  it('rechecks the creator’s current role and account', async () => {
    const { id } = await scheduled(),
      job = await claim(id),
      before = await state()
    await db.asUser(s.superAdmin, client =>
      client.query("SELECT app.set_site_membership($1,$2,'editor')", [s.editorA, s.siteA]),
    )
    await expect(executeLeasedRelease(id, job.lease_token)).rejects.toMatchObject({ kind: 'not_authorized' })
    expect(await state()).toEqual(before)
    await db.asUser(s.superAdmin, client => client.query("SELECT app.set_user_status($1,'disabled')", [s.editorA]))
    await expect(executeLeasedRelease(id, job.lease_token)).rejects.toMatchObject({ kind: 'not_authorized' })
    expect(await state()).toEqual(before)
  })
  it('refuses moved draft heads and preserves both live content and the newer draft', async () => {
    const { id, plan } = await scheduled(),
      job = await claim(id)
    await db.asUser(s.editorA, client =>
      client.query('SELECT app.save_page_draft($1,3,$2,$3)', [
        s.pageA,
        heroContent(s.heroDefId, 'Newer private work'),
        '{}',
      ]),
    )
    const before = await state()
    expect((await listSiteReleases(s.editorA, s.siteA)).find(release => release.id === plan.id)?.stale).toBe(true)
    await expect(executeLeasedRelease(id, job.lease_token)).rejects.toMatchObject({ kind: 'stale_revision' })
    expect(await state()).toEqual(before)
    expect(
      await db.as(
        'owner',
        async client => (await client.query('SELECT status FROM scheduled_actions WHERE id=$1', [id])).rows[0].status,
      ),
    ).toBe('running')
  })
  it('rolls publication back if settlement fails, then succeeds once with the same lease', async () => {
    const { id } = await scheduled(),
      job = await claim(id),
      before = await state()
    await db.as('owner', client =>
      client.query(`CREATE FUNCTION public.reject_fixture_settlement() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.status='succeeded' THEN RAISE EXCEPTION 'fixture settlement failure'; END IF; RETURN NEW; END $$;
      CREATE TRIGGER reject_fixture_settlement BEFORE UPDATE ON scheduled_actions FOR EACH ROW EXECUTE FUNCTION public.reject_fixture_settlement()`),
    )
    await expect(executeLeasedRelease(id, job.lease_token)).rejects.toThrow('fixture settlement failure')
    expect(await state()).toEqual(before)
    await db.as('owner', client => client.query('DROP TRIGGER reject_fixture_settlement ON scheduled_actions'))
    await executeLeasedRelease(id, job.lease_token)
    expect((await state()).page.published_version_id).toBe(before.page.draft_version_id)
  })
  it('requires explicit sample consent before scheduling and retains it through execution', async () => {
    await db.asUser(s.editorA, client =>
      client.query('SELECT app.save_page_draft($1,3,$2,$3)', [
        s.pageA,
        JSON.stringify([
          {
            section_def_id: s.heroDefId,
            section_def_version: 1,
            values: { heading: 'Illustrative heading', intro: 'A complete example.', __cms_sample_fields: ['heading'] },
            label: 'Hero',
            hidden: false,
            hidden_at: [],
          },
        ]),
        JSON.stringify({ description: 'Complete local scheduling fixture.' }),
      ]),
    )
    const plan = await prepare(),
      at = new Date(Date.now() + 3_600_000).toISOString()
    expect(
      plan.preview_report.some(check => check.report.blocking.some(finding => finding.rule === 'sample_content')),
    ).toBe(true)
    await expect(scheduleSiteRelease(s.editorA, plan.id, at, '', false, randomUUID())).rejects.toMatchObject({
      kind: 'invalid_state',
    })
    expect(
      await db.asUser(s.editorA, async client => (await client.query('SELECT id FROM scheduled_actions')).rows),
    ).toEqual([])
    const id = await scheduleSiteRelease(s.editorA, plan.id, at, '', true, randomUUID()),
      job = await claim(id)
    await executeLeasedRelease(id, job.lease_token)
    const row = await db.as(
      'owner',
      async client =>
        (
          await client.query('SELECT status,samples_confirmed,readiness_report FROM scheduled_actions WHERE id=$1', [
            id,
          ])
        ).rows[0],
    )
    expect(row.status).toBe('succeeded')
    expect(row.samples_confirmed).toBe(true)
    expect(row.readiness_report.rules.sample_content.blocking).toBeGreaterThan(0)
    const report = await db.as(
      'owner',
      async client =>
        (await client.query('SELECT preview_report FROM site_releases WHERE id=$1', [plan.id])).rows[0].preview_report,
    )
    expect(
      report.some((check: { report: { blocking: { rule: string }[] } }) =>
        check.report.blocking.some(finding => finding.rule === 'sample_content'),
      ),
    ).toBe(true)
  })
  it('lets only one worker claim a release and serializes simultaneous execution', async () => {
    const { id } = await scheduled()
    await db.as('owner', client =>
      client.query("UPDATE scheduled_actions SET run_at=now()-interval '1 second' WHERE id=$1", [id]),
    )
    const claims = await Promise.all(
      ['first', 'second'].map(worker =>
        db.asWorker(worker, async client => (await client.query('SELECT * FROM app.claim_scheduled_action(60)')).rows),
      ),
    )
    expect(claims.flat()).toHaveLength(1)
    const job = claims.flat()[0]!
    const outcomes = await Promise.allSettled([
      executeLeasedRelease(id, job.lease_token),
      executeLeasedRelease(id, job.lease_token),
    ])
    expect(outcomes.filter(outcome => outcome.status === 'fulfilled')).toHaveLength(1)
    expect(
      await db.as(
        'owner',
        async client =>
          (
            await client.query(
              "SELECT count(*)::int AS count FROM audit_log WHERE item_id=$1 AND action='release.publish'",
              [job.item_id],
            )
          ).rows[0].count,
      ),
    ).toBe(1)
  })
  it('refuses a schedule evaluated under a different readiness policy', async () => {
    const { id } = await scheduled(),
      job = await claim(id),
      before = await state()
    await db.as('owner', client =>
      client.query('UPDATE scheduled_actions SET readiness_policy_version=2 WHERE id=$1', [id]),
    )
    await expect(executeLeasedRelease(id, job.lease_token)).rejects.toMatchObject({
      kind: 'invalid_state',
      message: expect.stringContaining('publishing checks changed'),
    })
    expect(await state()).toEqual(before)
  })
  it('does not let the legacy page executor or public role execute release jobs', async () => {
    const { id } = await scheduled(),
      job = await claim(id),
      before = await state()
    await expectSqlState(
      db.asWorker('release-fixture', client =>
        client.query("SELECT * FROM app.execute_scheduled_action($1,$2,3,'[]')", [id, job.lease_token]),
      ),
      'CMS04',
    )
    for (const role of ['public', 'worker'] as const)
      await expectSqlState(
        db.as(role, client =>
          client.query('SELECT * FROM app.release_schedule_capability($1,$2)', [id, job.lease_token]),
        ),
        '42501',
      )
    expect(await state()).toEqual(before)
  })
  it('cancels safely and prevents a cancelled lease from executing', async () => {
    const { id } = await scheduled(),
      job = await claim(id),
      before = await state()
    await db.asUser(s.editorA, client => client.query('SELECT app.cancel_page_schedule($1)', [id]))
    await expect(executeLeasedRelease(id, job.lease_token)).rejects.toMatchObject({ kind: 'not_authorized' })
    expect(await state()).toEqual(before)
  })
})
