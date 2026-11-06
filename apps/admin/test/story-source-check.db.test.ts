import { randomUUID } from 'node:crypto'
import { beforeAll, afterAll, it, expect, vi } from 'vitest'
import { TestDatabase } from '@cms/schema/testing'
import { seedScenario, type Scenario } from '@cms/schema/fixtures'
import { createStoriesModel, emptyStoriesSettings } from '@cms/schema'
import { installCoreLibrary } from '@cms/seeds/core-install'
import { checkStorySource, readStorySourceStatus, type StorySourceRunner } from '../src/lib/story-source-check.ts'
let db: TestDatabase, s: Scenario, collection: string
const row = (id = 'local-source-1') => ({
  id,
  title: 'Source health story',
  description: 'Health in Zambia',
  publishDate: '2026-10-30',
  urlAlias: id,
  published: 1,
  hideInMenu: 0,
  headerImage: 'https://example.test/source.jpg',
})
const wire = (rows: unknown[]) => encodeURIComponent(JSON.stringify({ objects: rows }))
const run: StorySourceRunner = fn => db.asUser(s.superAdmin, fn)
const check = (readFeed: () => Promise<string>, id = randomUUID(), runner = run) =>
  checkStorySource({ run: runner, readFeed }, s.siteA, collection, id)
const entries = () =>
  run(
    async c =>
      (
        await c.query(
          'SELECT e.id,e.stable_key,v.values,e.published_version_id FROM collection_entries e JOIN collection_entry_versions v ON v.id=e.draft_version_id WHERE e.collection_id=$1 AND e.archived_at IS NULL ORDER BY e.sort_index',
          [collection],
        )
      ).rows,
  )
beforeAll(async () => {
  db = await TestDatabase.create('source_orchestration')
  s = await seedScenario(db)
  await run(async c => {
    await installCoreLibrary(c)
    const model = createStoriesModel({
      ...emptyStoriesSettings(),
      source: 'sawso',
      mainTags: [{ id: 'health', label: 'Health', keywords: ['health'] }],
      secondaryTags: [{ id: 'africa', label: 'Africa', keywords: ['zambia'], areas: ['africa'] }],
    })
    collection = (
      await c.query("SELECT * FROM app.create_collection($1,'stories','Stories','stories',$2,$3)", [
        s.siteA,
        JSON.stringify(model.fields),
        JSON.stringify(model.presentation),
      ])
    ).rows[0]!.collection_id
  })
})
afterAll(async () => db.close())
it('reads once on explicit start, creates suggested private ordinary drafts and saves a last-check result without publishing', async () => {
  const id = randomUUID(),
    read = vi.fn(async () => wire([row()])),
    result = await check(read, id)
  expect(result).toMatchObject({ status: 'ok', result: { added: 1, updated: 0, removed: 0, total: 1, preserved: 0 } })
  expect(await check(read, id)).toEqual(result)
  expect(read).toHaveBeenCalledTimes(1)
  const saved = await entries()
  expect(saved).toHaveLength(1)
  expect(saved[0]!.published_version_id).toBeNull()
  expect(saved[0]!.values).toMatchObject({
    tags: 'health',
    regions: 'africa',
    reviewed: false,
    body: '',
    body_is_sample: false,
    photo_is_sample: false,
    story_url: '/stories/local-source-1',
  })
  expect(saved[0]!.values.photo).toBe('')
  const state = await run(
    async c =>
      (
        await c.query(
          "SELECT p.published_version_id,v.content FROM pages p JOIN page_versions v ON v.id=p.draft_version_id WHERE p.site_id=$1 AND p.slug='stories/local-source-1'",
          [s.siteA],
        )
      ).rows[0]!,
  )
  expect(state.published_version_id).toBeNull()
  expect(state.content[0].values.story.selection.stableKeys).toEqual([saved[0]!.stable_key])
  const status = await run(c => readStorySourceStatus(c, collection))
  expect(status.latest?.id).toBe(id)
  expect(status.lastSuccessAt).toBeTruthy()
})
it('merges the latest saved edits after the read, preserves CMS fields, and keeps source-only changes idempotent', async () => {
  const changed = { ...row(), title: 'New source title', description: 'Updated source description' }
  const result = await check(async () => {
    const saved = await entries()
    await run(async c => {
      const revision = (await c.query('SELECT entry_revision FROM collections WHERE id=$1', [collection])).rows[0]!
        .entry_revision
      await c.query('SELECT app.save_collection_entries($1,$2,$3)', [
        collection,
        revision,
        JSON.stringify(
          saved.map(e => ({
            id: e.id,
            stableKey: e.stable_key,
            values: {
              ...e.values,
              title: 'CMS edited title',
              body: '<p>CMS article</p>',
              reviewed: true,
              hidden: true,
              tags: '',
            },
          })),
        ),
      ])
    })
    return wire([changed])
  })
  expect(result.result).toMatchObject({ updated: 1, preserved: 1 })
  expect((await entries())[0]!.values).toMatchObject({
    title: 'CMS edited title',
    summary: 'Updated source description',
    body: '<p>CMS article</p>',
    reviewed: true,
    hidden: true,
    tags: '',
  })
  expect((await check(async () => wire([changed]))).result).toMatchObject({ added: 0, updated: 0, removed: 0 })
})
it('marks a removed source story without deleting it and restores only its source-presence flag', async () => {
  expect((await check(async () => wire([]))).result.removed).toBe(1)
  expect((await entries())[0]!.values.feed_removed).toBe(true)
  await check(async () => wire([row()]))
  expect((await entries())[0]!.values).toMatchObject({
    feed_removed: false,
    title: 'CMS edited title',
    body: '<p>CMS article</p>',
    reviewed: true,
    hidden: true,
  })
})
it('records bounded read/format failures and does not fetch again for a retried failed request', async () => {
  const before = await entries(),
    id = randomUUID(),
    read = vi.fn(async () => {
      throw new Error('remote private body')
    })
  const failed = await check(read, id)
  expect(failed).toMatchObject({ status: 'error', result: { error: 'network' } })
  expect(JSON.stringify(failed)).not.toContain('remote private body')
  await check(read, id)
  expect(read).toHaveBeenCalledTimes(1)
  expect((await check(async () => '{broken')).result.error).toBe('format')
  expect(await entries()).toEqual(before)
})
it('rolls entries, pages and source baselines back on a failed transaction and keeps the last successful check', async () => {
  const before = await entries(),
    pages = await run(async c => (await c.query('SELECT id FROM pages WHERE site_id=$1 ORDER BY id', [s.siteA])).rows),
    status = await run(c => readStorySourceStatus(c, collection))
  let fail = true
  const runner: StorySourceRunner = fn =>
    db.asUser(s.superAdmin, async c => {
      const result = await fn(c)
      if (fail && (result as { status?: string })?.status === 'ok') {
        fail = false
        throw new Error('transaction failed')
      }
      return result
    })
  await expect(check(async () => wire([row(), row('local-source-2')]), randomUUID(), runner)).rejects.toThrow(
    'transaction failed',
  )
  expect(await entries()).toEqual(before)
  expect(
    await run(async c => (await c.query('SELECT id FROM pages WHERE site_id=$1 ORDER BY id', [s.siteA])).rows),
  ).toEqual(pages)
  const after = await run(c => readStorySourceStatus(c, collection))
  expect(after.latest?.result.error).toBe('save')
  expect(after.lastSuccessAt).toBe(status.lastSuccessAt)
})
it('refuses unauthorized checks before the reader is invoked', async () => {
  const read = vi.fn(async () => wire([])),
    runner: StorySourceRunner = fn => db.asUser(s.editorA, fn)
  await expect(check(read, randomUUID(), runner)).rejects.toMatchObject({ code: 'CMS02' })
  expect(read).not.toHaveBeenCalled()
})
