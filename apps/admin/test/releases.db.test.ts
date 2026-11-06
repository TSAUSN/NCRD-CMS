import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { CHECKED_CLEAN, TestDatabase } from '@cms/schema/testing'
import { heroContent, seedScenario, type Scenario } from '@cms/schema/fixtures'
import { DEFAULT_THEME_TOKENS } from '@cms/schema'
import { mapErrors } from '@cms/domain'
import { evaluateVersionReadiness } from '@cms/platform'

let db: TestDatabase
let s: Scenario
vi.mock('@cms/platform', async original => ({
  ...(await original<object>()),
  asUser: (identity: { userId: string }, run: Parameters<TestDatabase['asUser']>[1]) =>
    mapErrors(() => db.asUser(identity.userId, run)),
}))
import {
  executeSiteRelease,
  listReleaseCandidates,
  planSiteRelease,
  previewSiteReleasePage,
} from '../src/lib/releases.ts'

beforeAll(async () => {
  db = await TestDatabase.create('site_releases')
  s = await seedScenario(db)
  await db.asUser(s.editorA, async client => {
    await client.query('SELECT app.save_page_draft($1,0,$2,$3)', [
      s.pageA,
      heroContent(s.heroDefId, 'Live before release'),
      JSON.stringify({ description: 'A complete test page.' }),
    ])
    await client.query('SELECT app.publish_page($1,1,$2,$3,$4)', [s.pageA, ...CHECKED_CLEAN])
  })
})
afterAll(async () => {
  await db?.close()
})
async function savePage(heading: string, empty = false) {
  return db.asUser(s.superAdmin, async client => {
    const head = (await client.query('SELECT revision FROM pages WHERE id=$1', [s.pageA])).rows[0]!
    return (
      await client.query('SELECT * FROM app.save_page_draft($1,$2,$3,$4)', [
        s.pageA,
        head.revision,
        empty ? '[]' : heroContent(s.heroDefId, heading),
        JSON.stringify({ description: 'A complete test page.' }),
      ])
    ).rows[0]!
  })
}
async function saveTheme(primary: string) {
  await db.asUser(s.superAdmin, async client => {
    const head = (await client.query('SELECT revision FROM themes WHERE site_id=$1', [s.siteA])).rows[0]!
    await client.query('SELECT app.save_theme_draft($1,$2,$3)', [
      s.siteA,
      head.revision,
      JSON.stringify({
        ...DEFAULT_THEME_TOKENS,
        colors: { ...DEFAULT_THEME_TOKENS.colors, primary },
      }),
    ])
  })
}
async function liveState() {
  return db.asUser(s.superAdmin, async client => ({
    page: (
      await client.query('SELECT revision,draft_version_id,published_version_id FROM pages WHERE id=$1', [s.pageA])
    ).rows[0]!,
    theme: (
      await client.query('SELECT revision,draft_version_id,published_version_id FROM themes WHERE site_id=$1', [
        s.siteA,
      ])
    ).rows[0]!,
    publications: (
      await client.query(
        "SELECT count(*) AS count FROM audit_log WHERE site_id=$1 AND action IN ('page.publish','theme.publish')",
        [s.siteA],
      )
    ).rows[0]!.count,
  }))
}

describe('combined site releases', () => {
  it('judges the exact published projection with the same rules and refuses an unpublished or foreign version', async () => {
    const live = await db.asUser(s.editorA, client =>
      client.query('SELECT published_version_id FROM pages WHERE id=$1', [s.pageA]),
    )
    const id = live.rows[0]!.published_version_id
    await db.asUser(s.editorA, async client => {
      expect(await evaluateVersionReadiness(client, id, 'published')).toEqual(
        await evaluateVersionReadiness(client, id, 'member'),
      )
    })
    const draft = await savePage('Private projection check')
    await db.asUser(s.editorA, async client => {
      expect((await evaluateVersionReadiness(client, draft.version_id, 'published')).blocking).toEqual([
        expect.objectContaining({ rule: 'empty_page' }),
      ])
      expect((await evaluateVersionReadiness(client, id, 'published')).ok).toBe(true)
    })
    await expect(
      db.asUser(s.editorB, client => evaluateVersionReadiness(client, id, 'published')),
    ).rejects.toMatchObject({ kind: 'not_found' })
  })
  it('does not advertise an identical restored theme as a design change', async () => {
    await saveTheme('#003087')
    await db.asUser(s.superAdmin, async client => {
      const head = (await client.query('SELECT revision FROM themes WHERE site_id=$1', [s.siteA])).rows[0]!
      await client.query('SELECT app.publish_theme($1,$2)', [s.siteA, head.revision])
      const live = (await client.query('SELECT revision FROM themes WHERE site_id=$1', [s.siteA])).rows[0]!
      await client.query('SELECT app.revert_theme_to_live($1,$2)', [s.siteA, live.revision])
    })
    expect((await listReleaseCandidates(s.superAdmin, s.siteA)).some(item => item.type === 'theme')).toBe(false)
    await saveTheme('#165b43')
    expect((await listReleaseCandidates(s.superAdmin, s.siteA)).some(item => item.type === 'theme')).toBe(true)
  })
  it('previews by rollback, then publishes the selected page and theme exactly once', async () => {
    const draft = await savePage('Released together')
    await saveTheme('#165b43')
    const before = await liveState()
    const candidates = await listReleaseCandidates(s.superAdmin, s.siteA)
    const plan = await planSiteRelease(s.superAdmin, randomUUID(), s.siteA, candidates)
    expect(plan.preview_report.every(check => check.report.ok)).toBe(true)
    expect(await liveState()).toEqual(before)
    const preview = await previewSiteReleasePage(s.superAdmin, plan.id, s.pageA)
    expect(preview).toContain('Released together')
    expect(preview).toContain('#165b43')
    expect(await liveState()).toEqual(before)
    await executeSiteRelease(s.superAdmin, plan.id, '')
    const after = await liveState()
    expect(after.page.published_version_id).toBe(draft.version_id)
    expect(after.theme.published_version_id).not.toBe(before.theme.published_version_id)
    await executeSiteRelease(s.superAdmin, plan.id, '')
    expect(await liveState()).toEqual(after)
  })
  it('refuses a stale plan without publishing any of its changes', async () => {
    await savePage('Planned draft')
    const plan = await planSiteRelease(
      s.superAdmin,
      randomUUID(),
      s.siteA,
      await listReleaseCandidates(s.superAdmin, s.siteA),
    )
    await savePage('Newer private draft')
    const before = await liveState()
    await expect(previewSiteReleasePage(s.superAdmin, plan.id, s.pageA)).rejects.toMatchObject({
      kind: 'stale_revision',
    })
    await expect(executeSiteRelease(s.superAdmin, plan.id, '')).rejects.toMatchObject({ kind: 'stale_revision' })
    expect(await liveState()).toEqual(before)
  })
  it('keeps unselected page drafts private when releasing shared design', async () => {
    await saveTheme('#34475a')
    const before = await liveState()
    const candidates = (await listReleaseCandidates(s.superAdmin, s.siteA)).filter(item => item.type === 'theme')
    const plan = await planSiteRelease(s.superAdmin, randomUUID(), s.siteA, candidates)
    await executeSiteRelease(s.superAdmin, plan.id, '')
    expect((await liveState()).page).toEqual(before.page)
  })
  it('rolls back a blocked release including its otherwise-valid theme change', async () => {
    await savePage('Not ready', true)
    await saveTheme('#003087')
    const plan = await planSiteRelease(
      s.superAdmin,
      randomUUID(),
      s.siteA,
      await listReleaseCandidates(s.superAdmin, s.siteA),
    )
    expect(plan.preview_report.some(check => !check.report.ok)).toBe(true)
    const before = await liveState()
    await expect(executeSiteRelease(s.superAdmin, plan.id, '')).rejects.toMatchObject({ kind: 'invalid_state' })
    expect(await liveState()).toEqual(before)
  })
  it('does not let contributors execute a release', async () => {
    const plan = (
      await db.asUser(s.superAdmin, client =>
        client.query('SELECT id FROM site_releases WHERE site_id=$1 ORDER BY created_at DESC LIMIT 1', [s.siteA]),
      )
    ).rows[0]!
    await expect(executeSiteRelease(s.contributorA, plan.id, '')).rejects.toMatchObject({ kind: 'not_authorized' })
  })
})
