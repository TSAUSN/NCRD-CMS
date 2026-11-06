import { beforeAll, afterAll, expect, it } from 'vitest'
import { CHECKED_CLEAN, TestDatabase } from '@cms/schema/testing'
import { seedScenario, type Scenario } from '@cms/schema/fixtures'
import { savePageIdentity } from '../src/lib/page-identity.ts'
import { resetFromLive } from '../src/lib/live-reset.ts'
let db: TestDatabase, s: Scenario
beforeAll(async () => {
  db = await TestDatabase.create('live_reset')
  s = await seedScenario(db)
})
afterAll(async () => {
  await db?.close()
})
async function prepared() {
  return db.asUser(s.editorA, async client => {
    const pageId = (
      await client.query('SELECT app.create_page($1,$2,$3) AS id', [
        s.siteA,
        'reset-' + crypto.randomUUID(),
        'Reset example',
      ])
    ).rows[0]!.id
    const section = (heading: string) => ({
      section_def_id: s.heroDefId,
      section_def_version: 1,
      values: { heading, intro: 'A meaningful introduction' },
    })
    const live = [section('First live section'), section('Second live section')]
    const saved = (
      await client.query('SELECT * FROM app.save_page_draft($1,0,$2,$3)', [
        pageId,
        JSON.stringify(live),
        '{"description":"Live description"}',
      ])
    ).rows[0]!
    await client.query('SELECT * FROM app.publish_page($1,$2,$3,$4,$5)', [pageId, saved.revision, ...CHECKED_CLEAN])
    const page = (await client.query('SELECT * FROM pages WHERE id=$1', [pageId])).rows[0]!
    const draft = [section('First unpublished section'), section('Second unpublished section')]
    const changed = (
      await client.query('SELECT * FROM app.save_page_draft($1,$2,$3,$4)', [
        pageId,
        page.revision,
        JSON.stringify(draft),
        '{"description":"Draft description"}',
      ])
    ).rows[0]!
    return {
      pageId,
      expectedRevision: Number(changed.revision),
      expectedLiveVersionId: saved.version_id as string,
      draft,
      live,
      previous: changed.version_id,
    }
  })
}
it('resets the explicitly selected source only, preserving adjacent content, metadata, live pointer and earlier history', async () => {
  const input = await prepared()
  const result = await db.asUser(s.editorA, client =>
    resetFromLive(client, { ...input, sectionIndex: 0, liveSectionIndex: 1 }),
  )
  expect(result.document.sections).toEqual([input.live[1], input.draft[1]])
  expect(result.document.meta.description).toBe('Draft description')
  expect(result.revision).toBeGreaterThan(input.expectedRevision)
  const kept = await db.asUser(s.editorA, client =>
    client.query(
      'SELECT p.published_version_id,v.id FROM pages p JOIN page_versions v ON v.page_id=p.id WHERE p.id=$1 AND v.id=$2',
      [input.pageId, input.previous],
    ),
  )
  expect(kept.rows).toEqual([{ published_version_id: input.expectedLiveVersionId, id: input.previous }])
})
it('creates a checkpoint of the whole live document without rewriting old versions', async () => {
  const input = await prepared()
  const result = await db.asUser(s.contributorA, client => resetFromLive(client, input))
  expect(result.wholePage).toBe(true)
  expect(result.document.sections).toEqual(input.live)
  expect(result.document.meta.description).toBe('Live description')
  expect(result.versionId).not.toBe(input.expectedLiveVersionId)
  const row = (
    await db.asUser(s.editorA, client =>
      client.query('SELECT kind,note FROM page_versions WHERE id=$1', [result.versionId]),
    )
  ).rows[0]!
  expect(row).toEqual({ kind: 'checkpoint', note: 'Discarded unpublished changes; restored live page' })
})
it('refuses stale page heads and stale published sources without changing the draft', async () => {
  const input = await prepared()
  for (const invalid of [
    { ...input, expectedRevision: input.expectedRevision - 1 },
    { ...input, expectedLiveVersionId: crypto.randomUUID() },
  ])
    await expect(db.asUser(s.editorA, client => resetFromLive(client, invalid))).rejects.toThrow('The page changed')
  const row = (
    await db.asUser(s.editorA, client =>
      client.query('SELECT draft_version_id,revision FROM pages WHERE id=$1', [input.pageId]),
    )
  ).rows[0]!
  expect(row.draft_version_id).toBe(input.previous)
  expect(Number(row.revision)).toBe(input.expectedRevision)
})
it('refuses missing sources, malformed indices, another tenant and disabled people', async () => {
  const input = await prepared()
  for (const pair of [
    [-1, 0],
    [0, -1],
    [0, 9],
    [0, undefined],
    [0.5, 0],
  ])
    await expect(
      db.asUser(s.editorA, client =>
        resetFromLive(client, { ...input, sectionIndex: pair[0], liveSectionIndex: pair[1] }),
      ),
    ).rejects.toThrow('Choose the live section')
  for (const actor of [s.editorB, s.disabled])
    await expect(db.asUser(actor, client => resetFromLive(client, input))).rejects.toThrow()
})

it('accepts safe unique anchors and refuses duplicates, reserved names and non-text values in the database', async () => {
  const input = await prepared()
  for (const values of [
    ['speakers', 'speakers'],
    ['s0', 'team'],
    ['cms-main', 'team'],
    [42, 'team'],
  ]) {
    const content = structuredClone(input.draft)
    content.forEach((section, index) => Object.assign(section.values, { __cms_anchor: values[index] }))
    await expect(
      db.asUser(s.editorA, client =>
        client.query('SELECT * FROM app.save_page_draft($1,$2,$3,$4)', [
          input.pageId,
          input.expectedRevision,
          JSON.stringify(content),
          '{}',
        ]),
      ),
    ).rejects.toMatchObject({ code: 'CMS04' })
  }
  const content = structuredClone(input.draft)
  content.forEach((section, index) => Object.assign(section.values, { __cms_anchor: index ? 'team' : 'speakers' }))
  await expect(
    db.asUser(s.editorA, client =>
      client.query('SELECT * FROM app.save_page_draft($1,$2,$3,$4)', [
        input.pageId,
        input.expectedRevision,
        JSON.stringify(content),
        '{}',
      ]),
    ),
  ).resolves.toBeDefined()
})

it('whole-page Discard restores the live name and address, preserves the published route, and remains undoable through the same narrow command', async () => {
  const input = await prepared()
  const original = (
    await db.asUser(s.editorA, client => client.query('SELECT title,slug FROM pages WHERE id=$1', [input.pageId]))
  ).rows[0]!
  const renamed = await db.asUser(s.editorA, client =>
    client.query('SELECT * FROM app.rename_page($1,$2,$3,$4)', [
      input.pageId,
      input.expectedRevision,
      'An unpublished name',
      original.slug + '-draft',
    ]),
  )
  const request = { ...input, expectedRevision: Number(renamed.rows[0]!.revision) }
  // Contributors may reset their content, but cannot reverse another role's administrative change.
  await expect(db.asUser(s.contributorA, client => resetFromLive(client, request))).rejects.toThrow(
    'not permitted to manage pages',
  )
  const reset = await db.asUser(s.editorA, client => resetFromLive(client, request))
  expect(reset.document.identity).toEqual({ title: original.title, address: original.slug })
  const restored = (
    await db.asUser(s.editorA, client =>
      client.query('SELECT title,slug,published_version_id FROM pages WHERE id=$1', [input.pageId]),
    )
  ).rows[0]!
  expect(restored).toEqual({ ...original, published_version_id: input.expectedLiveVersionId })
  const undo = await db.asUser(s.editorA, async client => {
    const revision = await savePageIdentity(client, input.pageId, reset.revision, {
      title: 'An unpublished name',
      address: original.slug + '-draft',
    })
    return client.query('SELECT * FROM app.save_page_draft($1,$2,$3,$4)', [
      input.pageId,
      revision,
      JSON.stringify(input.draft),
      '{}',
    ])
  })
  expect(Number(undo.rows[0]!.revision)).toBeGreaterThan(reset.revision)
  const kept = (
    await db.asUser(s.editorA, client =>
      client.query('SELECT title,slug,published_version_id FROM pages WHERE id=$1', [input.pageId]),
    )
  ).rows[0]!
  expect(kept).toEqual({
    title: 'An unpublished name',
    slug: original.slug + '-draft',
    published_version_id: input.expectedLiveVersionId,
  })
})
