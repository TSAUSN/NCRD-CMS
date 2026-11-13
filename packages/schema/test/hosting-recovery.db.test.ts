import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { TestDatabase, expectSqlState } from './harness.ts'
import { seedScenario, type Scenario } from './fixtures.ts'

let db: TestDatabase, s: Scenario
beforeEach(async () => {
  db = await TestDatabase.create('hosting_retry')
  s = await seedScenario(db)
  await db.as('owner', async c => {
    await c.query("UPDATE sites SET staging_hostname='recovery-a.web.app' WHERE id=$1", [s.siteA])
    await c.query("UPDATE sites SET staging_hostname='recovery-b.web.app' WHERE id=$1", [s.siteB])
    await c.query("UPDATE outbox SET status='delivered',processed_at=now() WHERE status='pending'")
  })
})
afterEach(async () => {
  await db?.close()
})

async function domain(site = s.siteA, host = 'recovery.example.org') {
  const id = await db.asUser(
    s.superAdmin,
    async c => (await c.query('SELECT app.add_domain($1,$2,false) AS id', [site, host])).rows[0]!.id as string,
  )
  await db.as('owner', c => c.query("UPDATE outbox SET status='delivered',processed_at=now() WHERE status='pending'"))
  return id
}
async function failed(type: string, site: string | null, payload: object) {
  return db.as(
    'owner',
    async c =>
      (
        await c.query(
          "INSERT INTO outbox(site_id,event_type,payload,status,attempts,max_attempts,last_error,failed_at) VALUES($1,$2,$3,'dead',5,5,'Firebase Hosting returned HTTP 403',now()) RETURNING id",
          [site, type, JSON.stringify(payload)],
        )
      ).rows[0]!.id as string,
  )
}
async function failedDomain(id: string, site = s.siteA) {
  return failed('domain.sync', site, { domain_id: id, revision: 0 })
}
async function retry(id: string, user = s.superAdmin) {
  return db.asUser(
    user,
    async c =>
      (
        await c.query<{ retry_id: string; retry_status: string; linked_failures: string }>(
          'SELECT * FROM app.retry_hosting_delivery($1)',
          [id],
        )
      ).rows[0]!,
  )
}
async function active(id: string) {
  return db.as(
    'owner',
    async c => (await c.query('SELECT app.outbox_failure_is_active($1) AS active', [id])).rows[0]!.active,
  )
}
async function original(id: string) {
  return db.as(
    'owner',
    async c => (await c.query('SELECT to_jsonb(o) AS value FROM outbox o WHERE id=$1', [id])).rows[0]!.value,
  )
}
async function deadCount() {
  return db.asUser(s.superAdmin, async c =>
    Number((await c.query('SELECT outbox_dead FROM app.job_queue_health()')).rows[0]!.outbox_dead),
  )
}
async function finish(id: string, options: { ok?: boolean; record?: boolean; state?: string } = {}) {
  await db.as('owner', c => c.query("UPDATE outbox SET next_attempt_at='2000-01-01' WHERE id=$1", [id]))
  return db.asWorker('hosting-recovery-test', async c => {
    const job = (await c.query('SELECT * FROM app.claim_outbox(60)')).rows[0]!
    expect(job.id).toBe(id)
    if (options.ok !== false) {
      if (job.event_type === 'domain.sync') {
        const target = (await c.query('SELECT app.domain_job($1,$2) AS target', [id, job.lease_token])).rows[0]!.target
        expect(target).not.toBeNull()
        if (options.record !== false)
          await c.query('SELECT app.record_domain_result($1,$2,$3,$4,$5,$6,$7,$8)', [
            id,
            job.lease_token,
            target.revision,
            options.state ?? 'verifying',
            'firebase:recovery-a',
            JSON.stringify([
              { type: 'TXT', name: '_cms-verify.recovery.example.org', value: target.verification_token },
            ]),
            options.state === 'error' ? 'provider_validation_failed' : 'ownership_txt_missing',
            'Test provider receipt',
          ])
      } else {
        expect(
          (await c.query('SELECT app.site_hosting_job($1,$2) AS target', [id, job.lease_token])).rows[0]!.target,
        ).toEqual({ site_id: s.siteA, staging_hostname: 'recovery-a.web.app' })
      }
    }
    await c.query('SELECT app.settle_outbox($1,$2,$3,$4,true)', [
      id,
      job.lease_token,
      options.ok !== false,
      options.ok === false ? 'provider still refuses' : null,
    ])
  })
}
async function receipts() {
  return db.as(
    'owner',
    async c => (await c.query('SELECT * FROM app.hosting_retry_receipts ORDER BY failed_id,retry_id')).rows,
  )
}

describe('governed Hosting recovery', () => {
  it('requires an active Super admin and keeps receipt writes private to the command', async () => {
    const id = await failedDomain(await domain())
    await db.asUser(s.superAdmin, c =>
      c.query("SELECT app.set_site_membership($1,$2,'site_admin')", [s.editorA, s.siteA]),
    )
    for (const user of [s.editorA, s.editorB, s.contributorA, s.disabled])
      await expectSqlState(retry(id, user), 'CMS01', 'CMS02')
    await expectSqlState(
      db.as('worker', c => c.query('SELECT * FROM app.retry_hosting_delivery($1)', [id])),
      '42501',
    )
    for (const role of ['authenticated', 'worker', 'public'] as const)
      await expectSqlState(
        db.as(role, c => c.query('SELECT * FROM app.hosting_retry_receipts')),
        '42501',
      )
    await expectSqlState(
      db.asUser(s.superAdmin, c =>
        c.query('INSERT INTO app.hosting_retry_receipts(failed_id,retry_id,requested_by,target) VALUES($1,$1,$2,$3)', [
          id,
          s.superAdmin,
          '{}',
        ]),
      ),
      '42501',
    )
    expect(await receipts()).toEqual([])
  })

  it('links matching failures once, preserves every original byte, and clears health only after recorded success', async () => {
    const d = await domain()
    const ids = [await failedDomain(d), await failedDomain(d), await failedDomain(d)]
    const other = await failedDomain(await domain(s.siteB, 'other.example.org'), s.siteB)
    const mail = await failed('user.invited', s.siteA, { invitation_id: 'unrelated' })
    const before = await Promise.all(ids.map(original))
    const first = await retry(ids[0]!)
    expect(first).toMatchObject({ retry_status: 'pending', linked_failures: '3' })
    expect(await retry(ids[1]!)).toEqual(first)
    expect(await deadCount()).toBe(5)
    expect(await Promise.all(ids.map(active))).toEqual([true, true, true])
    expect(await Promise.all(ids.map(original))).toEqual(before)
    expect(await receipts()).toHaveLength(3)
    await finish(first.retry_id)
    expect(await Promise.all(ids.map(active))).toEqual([false, false, false])
    expect(await deadCount()).toBe(2)
    expect(await active(other)).toBe(true)
    expect(await active(mail)).toBe(true)
    expect(await Promise.all(ids.map(original))).toEqual(before)
    const inbox = await db.asUser(
      s.superAdmin,
      async c => (await c.query('SELECT app.inbox_snapshot() AS value')).rows[0]!.value,
    )
    expect(inbox.items.map((x: { id: string }) => x.id)).not.toEqual(expect.arrayContaining(ids))
    const audits = await db.as('owner', c =>
      c.query("SELECT detail FROM audit_log WHERE action='hosting.retry_requested'"),
    )
    expect(audits.rows).toHaveLength(1)
    expect(audits.rows[0]!.detail).toMatchObject({ linked_failures: 3, retry_delivery_id: Number(first.retry_id) })
    expect(await retry(ids[0]!)).toEqual({ ...first, retry_status: 'delivered' })
    expect(await receipts()).toHaveLength(3)
    await expectSqlState(
      db.as('owner', c => c.query('TRUNCATE app.hosting_retry_receipts')),
      '42501',
    )
    await expectSqlState(
      db.as('owner', c => c.query('DELETE FROM app.hosting_retry_receipts')),
      '42501',
    )
    await expectSqlState(
      db.as('owner', c => c.query('UPDATE app.hosting_retry_receipts SET created_at=now()')),
      '42501',
    )
  })

  it('keeps failed retries unresolved and records a new generation without losing earlier receipts', async () => {
    const d = await domain(),
      id = await failedDomain(d),
      before = await original(id)
    const first = await retry(id)
    await finish(first.retry_id, { ok: false })
    expect(await active(id)).toBe(true)
    expect(await active(first.retry_id)).toBe(true)
    const second = await retry(id)
    expect(second.retry_id).not.toBe(first.retry_id)
    expect(second.linked_failures).toBe('2')
    expect(await retry(first.retry_id)).toEqual(second)
    expect(await deadCount()).toBe(2)
    await finish(second.retry_id)
    expect(await deadCount()).toBe(0)
    expect(await original(id)).toEqual(before)
    expect(await receipts()).toHaveLength(3)
    expect((await original(first.retry_id)).status).toBe('dead')
  })

  it('does not use an earlier success to resolve a newer failure', async () => {
    const d = await domain(),
      old = await failedDomain(d),
      first = await retry(old)
    await finish(first.retry_id)
    const fresh = await failedDomain(d)
    expect(await active(fresh)).toBe(true)
    const second = await retry(fresh)
    expect(BigInt(second.retry_id)).toBeGreaterThan(BigInt(fresh))
    expect(second.retry_id).not.toBe(first.retry_id)
    expect(await active(fresh)).toBe(true)
    await finish(second.retry_id)
    expect(await deadCount()).toBe(0)
  })

  it('deduplicates simultaneous requests for different failed deliveries on the same target', async () => {
    const d = await domain(),
      a = await failedDomain(d),
      b = await failedDomain(d)
    const results = await Promise.all([retry(a), retry(b)])
    expect(results[0]).toEqual(results[1])
    expect(await receipts()).toHaveLength(2)
    const work = await db.as('owner', c => c.query("SELECT id FROM outbox WHERE payload ? 'hosting_recovery_target'"))
    expect(work.rows).toHaveLength(1)
  })

  it('refuses unrelated job types, nonfailed deliveries, missing references and corrupt cross-site payloads', async () => {
    for (const type of ['user.invited', 'page.published', 'media.upload_received', 'section_def.thumbnail_requested'])
      await expectSqlState(retry(await failed(type, s.siteA, {})), 'CMS04')
    await expectSqlState(retry('9223372036854775807'), 'CMS03')
    const foreign = await domain(s.siteB, 'foreign.example.org')
    await expectSqlState(retry(await failedDomain(foreign)), 'CMS04')
    await expectSqlState(retry(await failed('site.hosting_requested', s.siteA, { site_id: s.siteB })), 'CMS04')
    await expectSqlState(retry(await failed('domain.sync', null, { domain_id: foreign, revision: 0 })), 'CMS04')
    const id = await failedDomain(await domain())
    await db.as('owner', c =>
      c.query("UPDATE outbox SET status='delivered',processed_at=now(),failed_at=NULL WHERE id=$1", [id]),
    )
    await expectSqlState(retry(id), 'CMS04')
    expect(await receipts()).toEqual([])
  })

  it('refuses stale domain revisions, removed domains and archived sites before enqueuing', async () => {
    const d = await domain(),
      id = await failedDomain(d)
    await db.as('owner', c => c.query('UPDATE domains SET revision=1 WHERE id=$1', [d]))
    await expectSqlState(retry(id), 'CMS04')
    await db.as('owner', c => c.query('UPDATE domains SET revision=0,removed_at=now() WHERE id=$1', [d]))
    await expectSqlState(retry(id), 'CMS04')
    await db.as('owner', async c => {
      await c.query('UPDATE domains SET removed_at=NULL WHERE id=$1', [d])
      await c.query('UPDATE sites SET archived_at=now() WHERE id=$1', [s.siteA])
    })
    await expectSqlState(retry(id), 'CMS04')
    expect(await receipts()).toEqual([])
  })

  it('does not clear a delivered no-op without a fresh provider result', async () => {
    const id = await failedDomain(await domain()),
      work = await retry(id)
    await finish(work.retry_id, { record: false })
    expect(await active(id)).toBe(true)
    expect(await deadCount()).toBe(1)
  })

  it('does not treat a recorded provider error as successful recovery', async () => {
    const id = await failedDomain(await domain()),
      work = await retry(id)
    await finish(work.retry_id, { state: 'error' })
    expect(await active(id)).toBe(true)
  })

  it('rejects a domain target that changed between request and worker execution', async () => {
    const d = await domain(),
      id = await failedDomain(d),
      work = await retry(id)
    await db.as('owner', c => c.query('UPDATE domains SET revision=1 WHERE id=$1', [d]))
    await expectSqlState(
      db.asWorker('changed-domain', async c => {
        const job = (await c.query('SELECT * FROM app.claim_outbox(60)')).rows[0]!
        expect(job.id).toBe(work.retry_id)
        await c.query('SELECT app.domain_job($1,$2)', [job.id, job.lease_token])
      }),
      'CMS04',
    )
    expect(await active(id)).toBe(true)
  })

  it('requires the receipt target to remain current after a successful check', async () => {
    const d = await domain(),
      id = await failedDomain(d),
      work = await retry(id)
    await finish(work.retry_id)
    expect(await active(id)).toBe(false)
    await db.as('owner', c => c.query('UPDATE domains SET revision=1 WHERE id=$1', [d]))
    expect(await active(id)).toBe(true)
  })

  it('recovers native hosting through its normal worker command and retains other sites’ failures', async () => {
    const id = await failed('site.hosting_requested', s.siteA, { site_id: s.siteA })
    const other = await failed('site.hosting_requested', s.siteB, { site_id: s.siteB })
    const before = await original(id),
      work = await retry(id)
    expect(
      (await db.asUser(s.superAdmin, c => c.query('SELECT app.site_hosting_status($1) AS status', [s.siteA]))).rows[0]!
        .status,
    ).toBe('preparing')
    await finish(work.retry_id)
    expect(
      (await db.asUser(s.superAdmin, c => c.query('SELECT app.site_hosting_status($1) AS status', [s.siteA]))).rows[0]!
        .status,
    ).toBe('ready')
    expect(await active(id)).toBe(false)
    expect(await active(other)).toBe(true)
    expect(await original(id)).toEqual(before)
  })

  it('rejects a native hosting address changed after recovery was requested', async () => {
    const id = await failed('site.hosting_requested', s.siteA, { site_id: s.siteA }),
      work = await retry(id)
    await db.as('owner', c => c.query("UPDATE sites SET staging_hostname='changed.web.app' WHERE id=$1", [s.siteA]))
    await expectSqlState(
      db.asWorker('changed-hosting', async c => {
        const job = (await c.query('SELECT * FROM app.claim_outbox(60)')).rows[0]!
        expect(job.id).toBe(work.retry_id)
        await c.query('SELECT app.site_hosting_job($1,$2)', [job.id, job.lease_token])
      }),
      'CMS04',
    )
    expect(await active(id)).toBe(true)
  })

  it('refuses an oversized recovery group without any partial receipt or new work', async () => {
    const d = await domain()
    const id = await db.as(
      'owner',
      async c =>
        (
          await c.query(
            "INSERT INTO outbox(site_id,event_type,payload,status,attempts,last_error,failed_at) SELECT $1,'domain.sync',jsonb_build_object('domain_id',$2::text,'revision',0),'dead',5,'test',now() FROM generate_series(1,501) RETURNING id",
            [s.siteA, d],
          )
        ).rows[0]!.id as string,
    )
    await expectSqlState(retry(id), 'CMS04')
    expect(await receipts()).toEqual([])
    expect(
      (await db.as('owner', c => c.query("SELECT id FROM outbox WHERE payload ? 'hosting_recovery_target'"))).rows,
    ).toEqual([])
  })
})
