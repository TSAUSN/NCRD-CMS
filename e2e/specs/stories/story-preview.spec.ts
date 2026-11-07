import { test, expect, type Page } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { storyDateInFeed, storyMatchesTags } from '@cms/schema'
import { sawsoFixture } from '../fixtures/sawso.ts'
import { signIn } from '../helpers.ts'
test('Stories Preview carries every filter into private actual cards, links read-only drafts and pages without JavaScript', async ({
  page,
  browser,
}, info) => {
  test.setTimeout(180000)
  const f = await sawsoFixture(true, true),
    folder = resolve('../.r8-progress/round3/story-preview/' + info.project.name)
  await mkdir(folder, { recursive: true })
  let popup: Page | undefined
  const before = async () => ({
    pages: (
      await f.pool.query(
        'SELECT id,revision,draft_version_id,published_version_id FROM pages WHERE site_id=$1 ORDER BY id',
        [f.siteId],
      )
    ).rows,
    collections: (
      await f.pool.query(
        'SELECT id,revision,entry_revision,published_schema_version_id,published_entry_revision FROM collections WHERE site_id=$1 ORDER BY id',
        [f.siteId],
      )
    ).rows,
    routes: (await f.pool.query('SELECT count(*)::int AS count FROM published_routes WHERE site_id=$1', [f.siteId]))
      .rows,
  })
  try {
    const baseline = await before()
    await signIn(page, 'root@example.test')
    await page.goto('/sites/' + f.siteId + '/stories')
    await page.getByRole('searchbox', { name: 'Search titles and descriptions' }).fill('Chikankata')
    await page.getByRole('combobox', { name: 'Story status', exact: true }).selectOption('review')
    await page.getByRole('combobox', { name: 'Project Sectors', exact: true }).selectOption('health')
    await page.getByRole('combobox', { name: 'Regions', exact: true }).selectOption('africa')
    const rows = (
        await f.pool.query(
          'SELECT v.values FROM collection_entries e JOIN collection_entry_versions v ON v.id=e.draft_version_id WHERE e.collection_id=$1',
          [f.collectionId],
        )
      ).rows,
      expected = rows.filter(
        ({ values: v }) =>
          storyDateInFeed(v.published_date) &&
          storyMatchesTags(v, ['health'], ['africa']) &&
          [v.title, v.summary].some(value => String(value).toLowerCase().includes('chikankata')),
      ).length
    expect(expected).toBeGreaterThan(0)
    for (const width of [1440, 1024]) {
      await page.setViewportSize({ width, height: 900 })
      await page.screenshot({ path: resolve(folder, 'list-' + width + '.png') })
    }
    const opened = page.waitForEvent('popup')
    await page.getByRole('link', { name: 'Preview', exact: true }).click()
    popup = await opened
    await popup.waitForLoadState()
    const url = new URL(popup.url())
    expect(url.searchParams.get('q')).toBe('Chikankata')
    expect(url.searchParams.get('status')).toBe('review')
    expect(url.searchParams.get('main')).toBe('health')
    expect(url.searchParams.get('secondary')).toBe('africa')
    await expect(popup.locator('.core-story-card')).toHaveCount(expected)
    const gaps = await popup.locator('.core-story-sectors').evaluateAll(nodes =>
      nodes.flatMap(node => {
        const links = Array.from(node.querySelectorAll('a')).map(a => a.getBoundingClientRect())
        return links
          .slice(1)
          .flatMap((rect, i) => (Math.abs(rect.top - links[i]!.top) < 1 ? [rect.left - links[i]!.right] : []))
      }),
    )
    expect(gaps.length).toBeGreaterThan(0)
    expect(gaps.every(gap => gap >= 3)).toBe(true)
    const response = await popup.request.get(popup.url())
    expect(response.status()).toBe(200)
    expect(response.headers()['cache-control']).toBe('no-store, private')
    expect(response.headers()['content-security-policy']).toContain("script-src 'none'")
    expect(response.headers()['x-robots-tag']).toBe('noindex, nofollow')
    expect(await response.text()).not.toContain('<script')
    await expect(popup.locator('[data-cms-section],[data-cms-entry]')).toHaveCount(0)
    for (const width of [1440, 1024, 390]) {
      await popup.setViewportSize({ width, height: 900 })
      expect(await popup.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      await popup.screenshot({ path: resolve(folder, 'filtered-' + width + '.png'), fullPage: true })
    }
    const title = await popup.locator('.core-story-card h3 a').first().innerText()
    await popup.locator('.core-story-card h3 a').first().click()
    await expect(popup).toHaveURL(/\/preview\/[0-9a-f-]+\?visit=1/)
    await expect(popup.getByRole('heading', { level: 1, name: title, exact: true })).toBeVisible()
    await expect(popup.locator('[data-cms-section]')).toHaveCount(0)
    await popup.goBack()
    await popup.getByRole('link', { name: 'Back to Stories', exact: true }).click()
    await expect(popup.getByRole('searchbox', { name: 'Search titles and descriptions' })).toHaveValue('Chikankata')
    await expect(popup.getByRole('combobox', { name: 'Project Sectors', exact: true })).toHaveValue('health')
    await popup.close()
    popup = undefined
    const noJs = await browser.newContext({
      baseURL: new URL(page.url()).origin,
      javaScriptEnabled: false,
      storageState: await page.context().storageState(),
    })
    try {
      const view = await noJs.newPage()
      await view.goto('/preview/stories/' + f.siteId)
      await expect(view.locator('.core-story-card')).toHaveCount(24)
      await view.getByRole('link', { name: 'More stories', exact: true }).click()
      await expect(view).toHaveURL(/page=2/)
      expect(await view.locator('.core-story-card').count()).toBeGreaterThan(0)
      await expect(view.getByRole('link', { name: 'Previous stories', exact: true })).toBeVisible()
      await view.setViewportSize({ width: 390, height: 900 })
      expect(await view.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      await view.screenshot({ path: resolve(folder, 'next-page-no-js-390.png') })
      await view.goto('/preview/stories/' + f.siteId + '?q=NoMatchingPhrase')
      await expect(view.locator('.core-story-card')).toHaveCount(0)
      await expect(view.locator('[data-cms-story-grid]')).toBeHidden()
      await expect(view.getByText('No feed stories match these filters.', { exact: true })).toBeVisible()
      await view.screenshot({ path: resolve(folder, 'empty-no-js-390.png') })
    } finally {
      await noJs.close()
    }
    const outsider = await browser.newContext({ baseURL: new URL(page.url()).origin })
    try {
      const denied = await outsider.request.get('/preview/stories/' + f.siteId)
      expect(denied.status()).toBe(404)
      expect(await denied.text()).toContain('Sign in')
      const foreign = await outsider.newPage()
      await signIn(foreign, 'contributor@example.test')
      expect((await foreign.request.get('/preview/stories/' + f.siteId)).status()).toBe(404)
      await foreign.goto('/preview/stories/' + f.siteId)
      await foreign.screenshot({ path: resolve(folder, 'no-access-1440.png') })
    } finally {
      await outsider.close()
    }
    expect(await before()).toEqual(baseline)
  } finally {
    await popup?.close()
    await f.pool.query('UPDATE sites SET archived_at=now() WHERE id=$1', [f.siteId])
    f.client.release()
    await f.pool.end()
  }
})
