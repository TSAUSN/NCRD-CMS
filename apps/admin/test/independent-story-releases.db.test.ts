import { randomUUID } from 'node:crypto'
import { beforeAll, afterAll, it, expect, vi } from 'vitest'
import { TestDatabase } from '@cms/schema/testing'
import { seedScenario, type Scenario } from '@cms/schema/fixtures'
import { DEFAULT_THEME_TOKENS, createStoriesModel, emptyStoriesSettings } from '@cms/schema'
import { mapErrors } from '@cms/domain'
import { installCoreLibrary } from '@cms/seeds/core-install'
import { corePageDefinitions } from '../src/lib/core-pages.ts'
import { sawsoFeed, sawsoSection } from '../src/lib/sawso-pages.ts'
let db: TestDatabase, s: Scenario
vi.mock('server-only', () => ({}))
vi.mock('@cms/platform', async original => ({
  ...(await original<object>()),
  asUser: (identity: { userId: string | null }, run: Parameters<TestDatabase['asUser']>[1]) =>
    mapErrors(() => db.asUser(identity.userId, run)),
}))
import {
  listReleaseCandidates,
  listSiteReleases,
  planSiteRelease,
  scheduleSiteRelease,
  executeSiteRelease,
  previewSiteReleasePage,
} from '../src/lib/releases.ts'
import { storyCalendarJobs } from '../src/lib/story-calendar-data.ts'
import { storyReleaseSelection } from '../src/lib/story-release.ts'
import { saveStoryDetails } from '../src/lib/stories-edit.ts'
import { executeLeasedRelease } from '../src/lib/scheduled-release.ts'
import { getReleaseRecoveryReview, prepareReleaseRecovery } from '../src/lib/release-recovery.ts'
beforeAll(async () => {
  db = await TestDatabase.create('independent_stories')
  s = await seedScenario(db)
  await db.asUser(s.superAdmin, c => installCoreLibrary(c))
})
afterAll(async () => {
  await db?.close()
})
async function setup() {
  const slug = 'queue-' + randomUUID().slice(0, 8),
    model = createStoriesModel(emptyStoriesSettings()),
    photo = randomUUID()
  const f = await db.asUser(s.superAdmin, async c => {
    const site = (
        await c.query('SELECT app.create_site($1,$2,$3,$4,$5,$6)', [
          slug,
          'Community news',
          'resource',
          slug + '.staging.example.test',
          JSON.stringify(DEFAULT_THEME_TOKENS),
          '[]',
        ])
      ).rows[0]!.create_site,
      defs = await corePageDefinitions(c),
      home = (await c.query('SELECT app.create_page($1,$2,$3)', [site, '', 'Community news'])).rows[0]!.create_page,
      collection = (
        await c.query('SELECT * FROM app.create_collection($1,$2,$3,$4,$5,$6)', [
          site,
          'stories',
          'Stories',
          'stories',
          JSON.stringify(model.fields),
          JSON.stringify(model.presentation),
        ])
      ).rows[0]!.collection_id
    await c.query('SELECT * FROM app.save_page_draft($1,0,$2,$3)', [
      home,
      JSON.stringify([sawsoFeed(defs, null, 6)]),
      JSON.stringify({ title: 'Community news', description: 'Updates from community projects.' }),
    ])
    return { site, home, collection, defs }
  })
  const initial = await planSiteRelease(
    s.superAdmin,
    randomUUID(),
    f.site,
    await listReleaseCandidates(s.superAdmin, f.site),
  )
  await executeSiteRelease(s.superAdmin, initial.id, 'Reviewed isolated fixture.', true)
  await db.as('owner', async c => {
    await c.query(
      "INSERT INTO media(id,site_id,object_key,content_hash,original_name,alt_text,width,height,bytes,mime_type,status) VALUES($1,$2,$3,$4,'photo.png','Community photograph',10,10,99,'image/png','ready')",
      [photo, f.site, 'fixture/' + photo, 'a'.repeat(64)],
    )
    await c.query(
      "INSERT INTO media_variants(media_id,kind,object_key,content_hash,width,height,bytes,mime_type) VALUES($1,'wide',$2,$3,10,10,99,'image/webp')",
      [photo, 'fixture/' + photo + '/wide', 'b'.repeat(64)],
    )
  })
  const entries = await db.asUser(s.superAdmin, async c => {
    const rows = ['one', 'two', 'unpublished'].map((key, index) => ({
      id: null,
      stableKey: key,
      values: {
        title: 'Community care ' + (index + 1),
        summary: 'Updates from community care.',
        body: '<p>Community services continue to grow.</p>',
        published_date: key === 'unpublished' ? '' : new Date().toISOString().slice(0, 10),
        story_url: '/stories/' + key,
        reviewed: true,
        photo: { src: '/media/' + photo + '/wide', alt: 'Community photograph', decorative: false },
      },
    }))
    await c.query('SELECT * FROM app.save_collection_entries($1,0,$2)', [f.collection, JSON.stringify(rows)])
    const entries = (
      await c.query('SELECT id,stable_key FROM collection_entries WHERE collection_id=$1 ORDER BY stable_key', [
        f.collection,
      ])
    ).rows
    for (const entry of entries) {
      const page = (
        await c.query('SELECT app.create_page($1,$2,$3)', [f.site, 'stories/' + entry.stable_key, 'Community care'])
      ).rows[0]!.create_page
      await c.query('SELECT * FROM app.save_page_draft($1,0,$2,$3)', [
        page,
        JSON.stringify([
          sawsoSection(f.defs, 'story-detail', 'Story', {
            story: { readerKey: 'stories', selection: { mode: 'manual', stableKeys: [entry.stable_key] } },
          }),
          sawsoFeed(f.defs, null, 3, entry.stable_key),
        ]),
        JSON.stringify({ description: 'Community care update.' }),
      ])
    }
    return entries.map(row => String(row.id))
  })
  return { ...f, entries }
}
type Fixture = Awaited<ReturnType<typeof setup>>
async function plan(f: Fixture, index: number, actor = s.superAdmin) {
  return planSiteRelease(
    actor,
    randomUUID(),
    f.site,
    await db.asUser(actor, c => storyReleaseSelection(c, f.site, f.entries[index]!)),
  )
}
async function heads(f: Fixture) {
  return db.asUser(
    s.superAdmin,
    async c =>
      (
        await c.query(
          'SELECT e.*,v.values,p.values AS live FROM collection_entries e JOIN collection_entry_versions v ON v.id=e.draft_version_id LEFT JOIN collection_entry_versions p ON p.id=e.published_version_id WHERE e.collection_id=$1 ORDER BY stable_key',
          [f.collection],
        )
      ).rows,
  )
}
async function change(f: Fixture, index: number) {
  const rows = await heads(f),
    row = rows[index]!,
    revision = await db.asUser(
      s.superAdmin,
      async c =>
        (await c.query('SELECT entry_revision FROM collections WHERE id=$1', [f.collection])).rows[0]!.entry_revision,
    )
  return db.asUser(s.superAdmin, c =>
    saveStoryDetails(c, f.site, f.collection, row.id, String(revision), {
      title: row.values.title,
      summary: 'A separately edited description.',
      tags: [],
      region: '',
      regions: [],
      published_date: row.values.published_date,
      countries: '',
      body: row.values.body,
      body_is_sample: false,
    }),
  )
}
async function queue(id: string, actor = s.superAdmin) {
  await db.asWorker('independent-fixture', c => c.query("SELECT app.worker_heartbeat('worker','test')"))
  return scheduleSiteRelease(
    actor,
    id,
    new Date(Date.now() + 3600000).toISOString(),
    'Reviewed isolated fixture.',
    true,
    randomUUID(),
  )
}
async function fire(jobId: string) {
  await db.as('owner', c =>
    c.query("UPDATE scheduled_actions SET run_at=now()-interval '1 second' WHERE id=$1", [jobId]),
  )
  const job = await db.asWorker(
    'independent-fixture',
    async c => (await c.query('SELECT * FROM app.claim_scheduled_action(60)')).rows[0]!,
  )
  expect(job.id).toBe(jobId)
  await executeLeasedRelease(jobId, job.lease_token)
}
for (const order of [
  [0, 1],
  [1, 0],
])
  it('keeps two exact queued Stories independent in firing order ' + order.join(' then '), async () => {
    const f = await setup(),
      first = await plan(f, 0)
    expect(first.scope_before_hash).toMatch(/^[0-9a-f]{64}$/)
    await change(f, 1)
    const retry = await planSiteRelease(
      s.superAdmin,
      first.id,
      f.site,
      await db.asUser(s.superAdmin, c => storyReleaseSelection(c, f.site, f.entries[0]!)),
    )
    expect(retry.id).toBe(first.id)
    expect(retry.snapshot).toEqual(first.snapshot)
    expect((await listSiteReleases(s.superAdmin, f.site)).find(r => r.id === first.id)!.stale).toBe(false)
    const second = await plan(f, 1),
      plans = [first, second],
      before = await heads(f),
      jobs = [await queue(first.id), await queue(second.id)]
    expect(first.snapshot[0]!.revision).not.toBe(second.snapshot[0]!.revision)
    await fire(jobs[order[0]!]!)
    const menu = await db.asUser(
      s.superAdmin,
      async c =>
        (
          await c.query(
            'SELECT v.tree FROM navigations n JOIN navigation_versions v ON v.id=n.published_version_id WHERE n.site_id=$1',
            [f.site],
          )
        ).rows[0]!.tree,
    )
    expect(JSON.stringify(menu)).not.toContain('Community care')
    const pending = plans[order[1]!]!
    expect((await listSiteReleases(s.superAdmin, f.site)).find(r => r.id === pending.id)!.stale).toBe(false)
    const preview = await previewSiteReleasePage(s.superAdmin, pending.id, f.home)
    expect(preview).toContain('Community care')
    await fire(jobs[order[1]!]!)
    const after = await heads(f)
    for (let i = 0; i < 2; i++) expect(after[i]!.published_version_id).toBe(before[i]!.draft_version_id)
    const snapshots = await db.asUser(
      s.superAdmin,
      async c =>
        (
          await c.query('SELECT id,snapshot FROM site_releases WHERE id=ANY($1::uuid[]) ORDER BY id', [
            [first.id, second.id],
          ])
        ).rows,
    )
    for (const receipt of snapshots)
      expect(receipt.snapshot).toEqual(plans.find(plan => plan.id === receipt.id)!.snapshot)
    const last = plans[order[1]!]!,
      review = await getReleaseRecoveryReview(s.superAdmin, last.id)
    expect(review.available).toBe(true)
    if (!review.available) throw new Error(review.reason)
    const recovery = await prepareReleaseRecovery(s.superAdmin, randomUUID(), last.id, review.expectedState),
      undo = await planSiteRelease(s.superAdmin, randomUUID(), f.site, recovery.items)
    await executeSiteRelease(s.superAdmin, undo.id, 'Reviewed recovery.', true)
    const restored = await heads(f)
    expect(restored[order[0]!]!.live).toEqual(after[order[0]!]!.live)
    expect(restored[order[0]!]!.published_archived_at).toBeNull()
    expect(
      restored[order[1]!]!.published_version_id === null || restored[order[1]!]!.published_archived_at !== null,
    ).toBe(true)
    expect(restored[2]!.published_version_id === null || restored[2]!.published_archived_at !== null).toBe(true)
    expect(restored[2]!.values).toEqual(before[2]!.values)
  })
it('stops a job when its own Story changes and preserves both public pointers', async () => {
  const f = await setup(),
    p = await plan(f, 0),
    job = await queue(p.id)
  await change(f, 0)
  expect((await listSiteReleases(s.superAdmin, f.site)).find(r => r.id === p.id)!.stale).toBe(true)
  const rows = await heads(f),
    calendar = await storyCalendarJobs(
      s.superAdmin,
      f.site,
      f.collection,
      rows.map(row => ({
        id: row.id,
        stableKey: row.stable_key,
        values: row.values,
        published: row.live,
        changed: true,
        hasText: true,
        photoPreview: null,
      })),
    )
  expect(calendar.find(event => event.id === job)!.status).toBe('needs_review')
  await expect(fire(job)).rejects.toMatchObject({ kind: 'stale_revision' })
  expect((await heads(f)).every(row => row.published_version_id === null)).toBe(true)
})
it('stops a job after publishing permission is revoked', async () => {
  const f = await setup(),
    actor = await db.asUser(s.superAdmin, async c => {
      const id = (await c.query('SELECT app.provision_user($1,$2)', [randomUUID() + '@example.test', '[Name]']))
        .rows[0]!.provision_user
      await c.query("SELECT app.set_site_membership($1,$2,'site_admin')", [id, f.site])
      return String(id)
    }),
    p = await plan(f, 0, actor),
    job = await queue(p.id, actor)
  await db.asUser(s.superAdmin, c => c.query("SELECT app.set_site_membership($1,$2,'contributor')", [actor, f.site]))
  await expect(fire(job)).rejects.toMatchObject({ kind: 'not_authorized' })
  expect((await heads(f)).every(row => row.published_version_id === null)).toBe(true)
})

it('stops after required site settings change', async () => {
  const f = await setup(),
    p = await plan(f, 0)
  await db.asUser(s.superAdmin, async c => {
    const head = (
      await c.query(
        'SELECT t.revision,v.tokens FROM themes t JOIN theme_versions v ON v.id=t.draft_version_id WHERE t.site_id=$1',
        [f.site],
      )
    ).rows[0]!
    await c.query('SELECT app.save_theme_draft($1,$2,$3)', [
      f.site,
      head.revision,
      JSON.stringify({ ...head.tokens, colors: { ...head.tokens.colors, primary: '#254c99' } }),
    ])
  })
  expect((await listSiteReleases(s.superAdmin, f.site)).find(r => r.id === p.id)!.stale).toBe(true)
  await expect(executeSiteRelease(s.superAdmin, p.id, 'Reviewed fixture.', true)).rejects.toMatchObject({
    kind: 'stale_revision',
  })
})
it('pins its existing article even when only the Story record needed publication', async () => {
  const f = await setup(),
    initial = await plan(f, 0)
  await executeSiteRelease(s.superAdmin, initial.id, 'Reviewed fixture.', true)
  await db.asUser(s.superAdmin, async c => {
    const rows = await heads(f),
      revision = (await c.query('SELECT entry_revision FROM collections WHERE id=$1', [f.collection])).rows[0]!
        .entry_revision
    await c.query('SELECT * FROM app.save_collection_entries($1,$2,$3)', [
      f.collection,
      revision,
      JSON.stringify(
        rows.map((row, i) => ({
          id: row.id,
          stableKey: row.stable_key,
          values: i === 0 ? { ...row.values, body: '<p>Updated community services.</p>' } : row.values,
        })),
      ),
    ])
  })
  const p = await plan(f, 0)
  expect(p.snapshot.every(item => item.type !== 'page')).toBe(true)
  await db.asUser(s.superAdmin, async c => {
    const page = (
      await c.query(
        "SELECT p.id,p.revision,v.content,v.meta FROM pages p JOIN page_versions v ON v.id=p.draft_version_id WHERE p.site_id=$1 AND p.slug='stories/one'",
        [f.site],
      )
    ).rows[0]!
    await c.query('SELECT * FROM app.save_page_draft($1,$2,$3,$4)', [
      page.id,
      page.revision,
      JSON.stringify(page.content),
      JSON.stringify({ ...page.meta, description: 'Changed article metadata.' }),
    ])
  })
  await expect(executeSiteRelease(s.superAdmin, p.id, 'Reviewed fixture.', true)).rejects.toMatchObject({
    kind: 'stale_revision',
  })
})
it('does not treat an ordinary page as a Story article merely because an editable URL names it', async () => {
  const f = await setup()
  await db.asUser(s.superAdmin, async c => {
    const revision = (await c.query('SELECT entry_revision FROM collections WHERE id=$1', [f.collection])).rows[0]!
        .entry_revision,
      rows = await heads(f)
    await c.query('SELECT * FROM app.save_collection_entries($1,$2,$3)', [
      f.collection,
      revision,
      JSON.stringify(
        rows.map((row, i) => ({
          id: row.id,
          stableKey: row.stable_key,
          values: i === 1 ? { ...row.values, story_url: '/' } : row.values,
        })),
      ),
    ])
  })
  const p = await plan(f, 0)
  await db.asUser(s.superAdmin, async c => {
    const page = (
      await c.query(
        'SELECT p.revision,v.content,v.meta FROM pages p JOIN page_versions v ON v.id=p.draft_version_id WHERE p.id=$1',
        [f.home],
      )
    ).rows[0]!
    await c.query('SELECT * FROM app.save_page_draft($1,$2,$3,$4)', [
      f.home,
      page.revision,
      JSON.stringify(page.content),
      JSON.stringify({ ...page.meta, description: 'Changed home page.' }),
    ])
  })
  await expect(executeSiteRelease(s.superAdmin, p.id, 'Reviewed fixture.', true)).rejects.toMatchObject({
    kind: 'stale_revision',
  })
})
it('can publish a clean reviewed Story without re-approving unchanged already-public sample findings, while another bad draft stays private', async () => {
  const f = await setup(),
    p = await plan(f, 0)
  await db.asUser(s.superAdmin, async c => {
    const rows = await heads(f),
      revision = (await c.query('SELECT entry_revision FROM collections WHERE id=$1', [f.collection])).rows[0]!
        .entry_revision
    await c.query('SELECT * FROM app.save_collection_entries($1,$2,$3)', [
      f.collection,
      revision,
      JSON.stringify(
        rows.map((row, i) => ({
          id: row.id,
          stableKey: row.stable_key,
          values:
            i === 0
              ? row.values
              : { ...row.values, published_date: new Date().toISOString().slice(0, 10), body_is_sample: true },
        })),
      ),
    ])
  })
  const other = await plan(f, 2)
  await executeSiteRelease(s.superAdmin, other.id, 'Reviewed that Story sample explicitly.', true)
  expect((await listSiteReleases(s.superAdmin, f.site)).find(r => r.id === p.id)!.stale).toBe(false)
  await executeSiteRelease(s.superAdmin, p.id, 'Reviewed original fixture findings.', false)
  const after = await heads(f)
  expect(after[0]!.published_version_id).not.toBeNull()
  expect(after[1]!.published_version_id).toBeNull()
  expect(after[1]!.values.body_is_sample).toBe(true)
  expect(after[2]!.published_version_id).not.toBeNull()
})
