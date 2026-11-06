import { randomUUID } from 'node:crypto'
import { beforeAll, afterAll, it, expect, vi } from 'vitest'
import { TestDatabase, CHECKED_CLEAN } from '@cms/schema/testing'
import { seedScenario, heroContent, type Scenario } from '@cms/schema/fixtures'
import { createStoriesModel, emptyStoriesSettings } from '@cms/schema'
import { mapErrors } from '@cms/domain'
import { installCoreLibrary } from '@cms/seeds/core-install'
import { corePageDefinitions } from '../src/lib/core-pages.ts'
import { sawsoFeed } from '../src/lib/sawso-pages.ts'
let db: TestDatabase,
  s: Scenario,
  collectionId: string,
  ids: string[],
  actionActor: string | null = null
vi.mock('server-only', () => ({}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('../src/lib/session.ts', () => ({
  currentSession: async () => (actionActor ? { principal: { userId: actionActor } } : null),
}))
vi.mock('@cms/platform', async original => ({
  ...(await original<object>()),
  asUser: (identity: { userId: string | null }, run: Parameters<TestDatabase['asUser']>[1]) =>
    mapErrors(() => db.asUser(identity.userId, run)),
}))
import {
  planSiteRelease,
  executeSiteRelease,
  scheduleSiteRelease,
  previewSiteReleasePage,
} from '../src/lib/releases.ts'
import { executeLeasedRelease } from '../src/lib/scheduled-release.ts'
import { storyReleaseSelection } from '../src/lib/story-release.ts'
import { prepareStoryPublication } from '../src/app/sites/[siteId]/stories/actions.ts'
import { createSiteFromSetupInTransaction } from '../src/lib/site-creation.ts'
import { enableSiteStories } from '../src/lib/stories-enable.ts'
import { SiteSetup } from '@cms/schema'
import { starterSiteSetup } from '@cms/seeds/archetypes'
import { releasePresentations } from '../src/lib/release-presentation.ts'
beforeAll(async () => {
  db = await TestDatabase.create('story_release')
  s = await seedScenario(db)
  await db.asUser(s.superAdmin, async c => {
    await c.query('SELECT app.save_page_draft($1,0,$2,$3)', [s.pageA, heroContent(s.heroDefId, '[Page]'), '{}'])
    await c.query('SELECT app.publish_page($1,1,$2,$3,$4)', [s.pageA, ...CHECKED_CLEAN])
    const m = createStoriesModel(emptyStoriesSettings()),
      created = (
        await c.query('SELECT * FROM app.create_collection($1,$2,$3,$4,$5,$6)', [
          s.siteA,
          'stories',
          'Stories',
          'stories',
          JSON.stringify(m.fields),
          JSON.stringify(m.presentation),
        ])
      ).rows[0]!
    collectionId = created.collection_id
    await c.query('SELECT app.publish_collection_schema($1,$2)', [collectionId, created.revision])
    const entries = [1, 2].map(n => ({
      id: null,
      stableKey: 'story-' + n,
      values: {
        title: '[Story ' + n + ']',
        summary: '[Description ' + n + ']',
        published_date: '2026-10-31',
        story_url: '/stories/story-' + n,
        body: '<p>[Story text ' + n + ']</p>',
      },
    }))
    const saved = (
      await c.query('SELECT * FROM app.save_collection_entries($1,0,$2)', [collectionId, JSON.stringify(entries)])
    ).rows[0]!
    await c.query('SELECT app.publish_collection_entries($1,$2)', [collectionId, saved.entry_revision])
    ids = (
      await c.query('SELECT id FROM collection_entries WHERE collection_id=$1 ORDER BY stable_key', [collectionId])
    ).rows.map(r => r.id)
    await installCoreLibrary(c)
    const feed = sawsoFeed(await corePageDefinitions(c), null, 6)
    await c.query('SELECT app.save_page_draft($1,2,$2,$3)', [
      s.pageA,
      JSON.stringify([feed]),
      JSON.stringify({ description: '[Page description]' }),
    ])
    await c.query('SELECT app.publish_page($1,3,$2,$3,$4)', [s.pageA, ...CHECKED_CLEAN])
  })
})
afterAll(async () => {
  await db?.close()
})
async function state() {
  return db.asUser(s.superAdmin, async c => ({
    head: (await c.query('SELECT * FROM collections WHERE id=$1', [collectionId])).rows[0]!,
    rows: (
      await c.query(
        'SELECT e.*,v.values,p.values AS live FROM collection_entries e JOIN collection_entry_versions v ON v.id=e.draft_version_id LEFT JOIN collection_entry_versions p ON p.id=e.published_version_id WHERE e.collection_id=$1 ORDER BY e.stable_key',
        [collectionId],
      )
    ).rows,
  }))
}
async function edit() {
  await db.asUser(s.superAdmin, async c => {
    const x = await state()
    await c.query('SELECT app.save_collection_entries($1,$2,$3)', [
      collectionId,
      x.head.entry_revision,
      JSON.stringify(
        x.rows.map((r, i) => ({
          id: r.id,
          stableKey: r.stable_key,
          values: { ...r.values, summary: '[Changed description ' + (i + 1) + ' ' + randomUUID() + ']' },
        })),
      ),
    ])
  })
}
it('reviews and publishes exactly one Story, preserving every other private/public pointer and leaving its changes visible', async () => {
  await edit()
  const before = await state(),
    selection = await db.asUser(s.superAdmin, c => storyReleaseSelection(c, s.siteA, ids[0]!))
  expect(selection).toHaveLength(1)
  expect(selection[0]!.entryIds).toEqual([ids[0]])
  const plan = await planSiteRelease(s.superAdmin, randomUUID(), s.siteA, selection)
  const preview = await previewSiteReleasePage(s.superAdmin, plan.id, s.pageA)
  expect(preview).toContain(before.rows[0]!.values.summary)
  expect(preview).not.toContain(before.rows[1]!.values.summary)
  expect(plan.snapshot[0]!.entryIds).toEqual([ids[0]])
  expect(plan.snapshot[0]!.label).toBe('Story: [Story 1]')
  expect(await state()).toEqual(before)
  const copy = await releasePresentations(s.superAdmin, s.siteA, plan.snapshot, true),
    presentation = copy[plan.snapshot[0]!.key]!
  expect(presentation.summary).toContain('[Story 1]: Description changed')
  expect(presentation.cells.every(cell => !cell.label.includes('[Story 2]'))).toBe(true)
  await executeSiteRelease(s.superAdmin, plan.id, 'Reviewed isolated local fixture.', true)
  const after = await state()
  const route = await db.as(
    'public',
    async c =>
      (
        await c.query('SELECT render_manifest FROM public_api.resolve_route($1,$2)', [
          'site-a.staging.example.test',
          '/',
        ])
      ).rows[0]!,
  )
  expect(JSON.stringify(route.render_manifest)).toContain(before.rows[0]!.values.summary)
  expect(JSON.stringify(route.render_manifest)).not.toContain(before.rows[1]!.values.summary)
  expect(after.rows[0]!.published_version_id).toBe(before.rows[0]!.draft_version_id)
  expect(after.rows[1]).toEqual(before.rows[1])
  expect(after.head.entry_revision).not.toBe(after.head.published_entry_revision)
  await executeSiteRelease(s.superAdmin, plan.id, 'Reviewed isolated local fixture.', true)
  expect(await state()).toEqual(after)
  await expect(
    planSiteRelease(s.superAdmin, plan.id, s.siteA, [{ ...selection[0]!, entryIds: [ids[1]!] }]),
  ).rejects.toMatchObject({ kind: 'invalid_state' })
})
it('keeps cross-site, contributor, duplicate, foreign and stale revision checks on the scoped command and release path', async () => {
  const x = await state()
  for (const actor of [s.contributorA, s.editorB])
    await expect(
      mapErrors(() =>
        db.asUser(actor, c =>
          c.query('SELECT app.publish_story_entries($1,$2,$3)', [collectionId, x.head.entry_revision, [ids[1]]]),
        ),
      ),
    ).rejects.toBeTruthy()
  for (const scope of [[], [ids[1], ids[1]], [randomUUID()]])
    await expect(
      mapErrors(() =>
        db.asUser(s.superAdmin, c =>
          c.query('SELECT app.publish_story_entries($1,$2,$3)', [collectionId, x.head.entry_revision, scope]),
        ),
      ),
    ).rejects.toBeTruthy()
  await expect(
    mapErrors(() =>
      db.asUser(s.superAdmin, c => c.query('SELECT app.publish_story_entries($1,NULL,$2)', [collectionId, [ids[1]]])),
    ),
  ).rejects.toMatchObject({ kind: 'stale_revision' })
  const selection = await db.asUser(s.superAdmin, c => storyReleaseSelection(c, s.siteA, ids[1]!))
  await expect(
    planSiteRelease(s.superAdmin, randomUUID(), s.siteA, [{ ...selection[0]!, entryIds: [randomUUID()] }]),
  ).rejects.toMatchObject({ kind: 'not_found' })
  await expect(db.asUser(s.editorB, c => storyReleaseSelection(c, s.siteA, ids[1]!))).rejects.toMatchObject({
    kind: 'not_found',
  })
  const plan = await planSiteRelease(s.superAdmin, randomUUID(), s.siteA, selection)
  await edit()
  await expect(
    executeSiteRelease(s.superAdmin, plan.id, 'Reviewed isolated local fixture.', true),
  ).rejects.toMatchObject({ kind: 'stale_revision' })
})
it('uses the existing reviewed release timer and lease, publishing one saved Story and preserving the other draft', async () => {
  const selection = await db.asUser(s.superAdmin, c => storyReleaseSelection(c, s.siteA, ids[1]!)),
    plan = await planSiteRelease(s.superAdmin, randomUUID(), s.siteA, selection),
    before = await state()
  await db.asWorker('story-fixture', c => c.query("SELECT app.worker_heartbeat('worker','test')"))
  const id = await scheduleSiteRelease(
    s.superAdmin,
    plan.id,
    new Date(Date.now() + 3600000).toISOString(),
    'Reviewed isolated local fixture.',
    true,
    randomUUID(),
  )
  await db.as('owner', c => c.query("UPDATE scheduled_actions SET run_at=now()-interval '1 second' WHERE id=$1", [id]))
  const job = await db.asWorker(
    'story-fixture',
    async c => (await c.query('SELECT * FROM app.claim_scheduled_action(60)')).rows[0]!,
  )
  await executeLeasedRelease(id, job.lease_token)
  const after = await state()
  expect(after.rows[0]).toEqual(before.rows[0])
  expect(after.rows[1]!.published_version_id).toBe(before.rows[1]!.draft_version_id)
  expect(
    (
      await db.asUser(
        s.superAdmin,
        async c => (await c.query('SELECT status FROM scheduled_actions WHERE id=$1', [id])).rows[0]!,
      )
    ).status,
  ).toBe('succeeded')
})
it('does not bypass a pending collection approval', async () => {
  const x = await state()
  await db.asUser(s.superAdmin, c =>
    c.query('SELECT app.submit_collection_for_review($1,$2,$3,$4)', [
      collectionId,
      x.head.revision,
      x.head.entry_revision,
      '[Review note]',
    ]),
  )
  await expect(
    mapErrors(() =>
      db.asUser(s.superAdmin, c =>
        c.query('SELECT app.publish_story_entries($1,$2,$3)', [collectionId, x.head.entry_revision, [ids[0]]]),
      ),
    ),
  ).rejects.toMatchObject({ kind: 'invalid_state' })
})

it('marks a first partial publication as published but dirty, then becomes clean only when the remaining Story is published', async () => {
  await db.asUser(s.superAdmin, async c => {
    const m = createStoriesModel(emptyStoriesSettings()),
      created = (
        await c.query('SELECT * FROM app.create_collection($1,$2,$3,$4,$5,$6)', [
          s.siteB,
          'stories',
          'Stories',
          'stories',
          JSON.stringify(m.fields),
          JSON.stringify(m.presentation),
        ])
      ).rows[0]!
    await c.query('SELECT app.publish_collection_schema($1,$2)', [created.collection_id, created.revision])
    const saved = (
        await c.query('SELECT * FROM app.save_collection_entries($1,0,$2)', [
          created.collection_id,
          JSON.stringify(
            [1, 2].map(n => ({
              id: null,
              stableKey: 'new-' + n,
              values: {
                title: '[New ' + n + ']',
                summary: '[Description]',
                published_date: '2026-10-31',
                story_url: '/stories/new-' + n,
              },
            })),
          ),
        ])
      ).rows[0]!,
      targets = (
        await c.query('SELECT id FROM collection_entries WHERE collection_id=$1 ORDER BY stable_key', [
          created.collection_id,
        ])
      ).rows.map(r => r.id)
    const partial = (
      await c.query('SELECT * FROM app.publish_story_entries($1,$2,$3)', [
        created.collection_id,
        saved.entry_revision,
        [targets[0]],
      ])
    ).rows[0]!
    expect(Number(partial.published_entry_revision)).toBeGreaterThan(0)
    expect(partial.entry_revision).not.toBe(partial.published_entry_revision)
    expect(partial.published_count).toBe(1)
    const all = (
      await c.query('SELECT * FROM app.publish_story_entries($1,$2,$3)', [
        created.collection_id,
        partial.entry_revision,
        [targets[1]],
      ])
    ).rows[0]!
    expect(all.entry_revision).toBe(all.published_entry_revision)
    expect(all.published_count).toBe(2)
  })
})

it('includes only the Story’s own saved article page, excluding other page drafts', async () => {
  await db.asUser(s.superAdmin, async c => {
    const pages: string[] = []
    for (const n of [1, 2]) {
      const id = (
        await c.query('SELECT app.create_page($1,$2,$3) AS id', [s.siteA, 'stories/story-' + n, '[Article ' + n + ']'])
      ).rows[0]!.id
      await c.query('SELECT app.save_page_draft($1,0,$2,$3)', [
        id,
        heroContent(s.heroDefId, '[Article ' + n + ']'),
        '{}',
      ])
      pages.push(id)
    }
    const selection = await storyReleaseSelection(c, s.siteA, ids[0]!)
    expect(selection.filter(item => item.type === 'page').map(item => item.id)).toEqual([pages[0]])
    expect(selection.some(item => item.id === pages[1])).toBe(false)
  })
})

it('authenticates the Story review action, keeps other drafts private and makes first-site publication an explicit separate step', async () => {
  actionActor = null
  expect((await prepareStoryPublication(s.siteA, ids[0]!, randomUUID())).ok).toBe(false)
  for (const actor of [s.contributorA, s.editorB]) {
    actionActor = actor
    expect((await prepareStoryPublication(s.siteA, ids[0]!, randomUUID())).ok).toBe(false)
  }
  actionActor = s.superAdmin
  const target = await db.asUser(s.superAdmin, async c => {
    const list = (
        await c.query("SELECT id,entry_revision FROM collections WHERE site_id=$1 AND reader_key='stories'", [s.siteB])
      ).rows[0]!,
      rows = (
        await c.query(
          'SELECT e.id,e.stable_key,v.values FROM collection_entries e JOIN collection_entry_versions v ON v.id=e.draft_version_id WHERE e.collection_id=$1 ORDER BY stable_key',
          [list.id],
        )
      ).rows
    await c.query('SELECT app.save_collection_entries($1,$2,$3)', [
      list.id,
      list.entry_revision,
      JSON.stringify(
        rows.map((r, i) => ({
          id: r.id,
          stableKey: r.stable_key,
          values: { ...r.values, summary: i === 0 ? '[Changed for review]' : r.values.summary },
        })),
      ),
    ])
    return {
      entryId: rows[0]!.id,
      other: rows[1]!.id,
      head: (await c.query('SELECT published_version_id FROM collection_entries WHERE id=$1', [rows[0]!.id])).rows[0]!
        .published_version_id,
    }
  })
  const result = await prepareStoryPublication(s.siteB, target.entryId, randomUUID())
  expect(result.ok).toBe(true)
  if (!result.ok) throw Error(result.message)
  const receipt = await db.asUser(
    s.superAdmin,
    async c => (await c.query('SELECT status,snapshot FROM site_releases WHERE id=$1', [result.releaseId])).rows[0]!,
  )
  expect(receipt.status).toBe('planned')
  expect(receipt.snapshot).toHaveLength(1)
  expect(receipt.snapshot[0].entryIds).toEqual([target.entryId])
  expect(
    (
      await db.asUser(
        s.superAdmin,
        async c =>
          (await c.query('SELECT published_version_id FROM collection_entries WHERE id=$1', [target.entryId])).rows[0]!,
      )
    ).published_version_id,
  ).toBe(target.head)
  const privateSite = await db.asUser(s.superAdmin, async c => {
    const site = await createSiteFromSetupInTransaction(
        c,
        randomUUID(),
        SiteSetup.parse({ ...starterSiteSetup('resource'), name: '[Private site]', slug: 'private-story-review' }),
        'private-story-review.staging.example.test',
      ),
      stories = await enableSiteStories(c, site.siteId, {
        mainLabel: 'Main tags',
        secondaryLabel: 'Secondary tags',
        publishUnreviewed: true,
      })
    await c.query('SELECT app.save_collection_entries($1,0,$2)', [
      stories.collectionId,
      JSON.stringify([
        {
          id: null,
          stableKey: 'private-story',
          values: {
            title: '[Private story]',
            summary: '[Description]',
            published_date: '2026-10-31',
            story_url: '/stories/private-story',
          },
        },
      ]),
    ])
    return {
      siteId: site.siteId,
      entryId: (await c.query('SELECT id FROM collection_entries WHERE collection_id=$1', [stories.collectionId]))
        .rows[0]!.id,
    }
  })
  const first = await prepareStoryPublication(privateSite.siteId, privateSite.entryId, randomUUID())
  expect(first).toMatchObject({ ok: false, firstSiteReview: true })
  expect(
    (
      await db.asUser(
        s.superAdmin,
        async c =>
          (await c.query('SELECT count(*)::int AS count FROM site_releases WHERE site_id=$1', [privateSite.siteId]))
            .rows[0]!,
      )
    ).count,
  ).toBe(0)
  actionActor = null
})
