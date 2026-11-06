import { E2E_PORTS } from '../test-ports.ts'
import { test, expect, type BrowserContext } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { sawsoFixture } from './fixtures/sawso.ts'
import { signIn } from './helpers.ts'
import { storyDateInFeed, storyTagIds } from '@cms/schema'
import { SAWSO_NEWSROOM_INTRO } from '../../apps/admin/src/lib/sawso-pages.ts'
test('SAWSO Newsroom uses the shared Split section with approved words, working old links and ordinary public navigation', async ({
  page,
  browser,
}, info) => {
  test.setTimeout(180000)
  const f = await sawsoFixture(true, true),
    folder = resolve('../.r8-progress/round3/newsroom/' + info.project.name)
  await mkdir(folder, { recursive: true })
  let plainContext: BrowserContext | undefined,
    visitor: BrowserContext | undefined,
    sourceReads = 0
  try {
    const stored = (
      await f.pool.query(
        "SELECT v.content FROM pages p JOIN page_versions v ON v.id=p.draft_version_id WHERE p.site_id=$1 AND p.slug='newsroom'",
        [f.siteId],
      )
    ).rows[0]!.content
    expect(stored).toHaveLength(1)
    expect(stored[0].values).toMatchObject({
      heading: 'News and Stories',
      introduction: SAWSO_NEWSROOM_INTRO,
      start_view: 'recent',
      page_size: '12',
    })
    await signIn(page, 'root@example.test')
    await page.goto('/sites/' + f.siteId + '/publishing')
    const publish = page.getByRole('button', { name: /^Publish selected \(\d+\)$/ })
    await publish.click()
    const sample = page.getByRole('checkbox', { name: /Publish with sample content/ })
    await expect(sample.or(page.getByRole('alertdialog'))).toBeVisible({ timeout: 60000 })
    if (await sample.isVisible()) {
      await sample.check()
      const reason = page.getByRole('textbox', { name: 'Reason for publishing despite these findings' })
      if (await reason.isVisible())
        await reason.fill('Reviewing isolated Newsroom compatibility and approved public words.')
      await publish.click()
    }
    await page.getByRole('alertdialog').getByRole('button', { name: 'Publish selected', exact: true }).click()
    await expect(page.getByRole('status').filter({ hasText: 'Release applied.' })).toBeVisible({ timeout: 60000 })
    const values = (
        await f.pool.query(
          'SELECT v.values FROM collection_entries e JOIN collection_entry_versions v ON v.id=e.published_version_id WHERE e.collection_id=$1 AND e.published_archived_at IS NULL',
          [f.collectionId],
        )
      ).rows
        .map(row => row.values)
        .filter(v => storyDateInFeed(v.published_date) && !v.hidden && !v.feed_removed),
      count = (main: string, region = '') =>
        values.filter(
          v =>
            (!main || storyTagIds(v, 'main').includes(main)) &&
            (!region || storyTagIds(v, 'secondary').includes(region)),
        ).length,
      url = 'http://' + f.hostname + `:${E2E_PORTS.site}/newsroom`
    plainContext = await browser.newContext({ javaScriptEnabled: false })
    const plain = await plainContext.newPage()
    await plain.route('https://sawso.org/**', async route => {
      sourceReads++
      await route.abort()
    })
    await plain.goto(url)
    await expect(plain.getByRole('heading', { level: 1 })).toHaveText('News and Stories')
    await expect(plain.getByText(SAWSO_NEWSROOM_INTRO, { exact: true })).toBeVisible()
    await expect(plain.locator('.core-story-card')).toHaveCount(12)
    const capture = async (name: string) => {
      for (const width of [1440, 1024, 390]) {
        await plain.setViewportSize({ width, height: 900 })
        expect(await plain.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
        await plain.evaluate(() => scrollTo(0, 0))
        await plain.screenshot({ path: resolve(folder, name + '-' + width + '.png') })
      }
    }
    await capture('recent')
    await plain.goto(url + '?sector=health')
    await expect(plain.locator('[data-cms-story-kind=split]')).toHaveAttribute('data-cms-story-view', 'sectors')
    await expect(plain.locator('.core-story-card')).toHaveCount(count('health'))
    await expect(plain.getByRole('heading', { name: 'Our Stories in Health', exact: true })).toBeVisible()
    await capture('old-sector')
    await plain.getByRole('link', { name: 'Recently Published', exact: true }).click()
    await expect(plain.locator('.core-story-card')).toHaveCount(12)
    await plain.goto(url + '?region=africa')
    await expect(plain.locator('.core-story-card')).toHaveCount(count('', 'africa'))
    await plain.goto(url + '?sector=health&region=africa')
    await expect(plain.locator('.core-story-card')).toHaveCount(count('health', 'africa'))
    await expect(plain.getByText('Stories in Health and Africa.', { exact: false })).toBeVisible()
    await capture('combined')
    await plain.getByRole('link', { name: 'Show all stories', exact: true }).click()
    await expect(plain.locator('.core-story-card')).toHaveCount(12)
    const search = 'Ebola',
      matches = values.filter(v =>
        [v.title, v.summary].some(value => String(value).toLowerCase().includes(search.toLowerCase())),
      ).length
    await plain.goto(url + '?q=' + search)
    await expect(plain.locator('.core-story-card')).toHaveCount(matches)
    await expect(plain.getByText('Stories matching “Ebola”.', { exact: false })).toBeVisible()
    await plain.getByRole('link', { name: 'Show all stories', exact: true }).click()
    await expect(plain.locator('.core-story-card')).toHaveCount(12)
    await plainContext.close()
    plainContext = undefined
    visitor = await browser.newContext({ reducedMotion: 'reduce' })
    const live = await visitor.newPage()
    await live.route('https://sawso.org/**', async route => {
      sourceReads++
      await route.abort()
    })
    await live.goto(url + '#stories-sectors-health')
    const root = live.locator('[data-cms-story-kind=split]')
    await expect(root).toHaveAttribute('data-cms-story-view', 'sectors')
    await expect(root.locator('.core-story-card')).toHaveCount(count('health'))
    await expect(live).toHaveURL(/story0_view=sectors.*story0_sector=health#s0/)
    await live.goto(url + '#stories-map-africa')
    await live.reload()
    await expect(root).toHaveAttribute('data-cms-story-view', 'map')
    await expect(root.locator('.core-story-card')).toHaveCount(count('', 'africa'))
    await expect(live).toHaveURL(/story0_view=map.*story0_region=africa#s0/)
    expect(sourceReads).toBe(0)
  } finally {
    await visitor?.close()
    await plainContext?.close()
    await f.client.query('ROLLBACK').catch(() => {})
    await f.pool.query('UPDATE sites SET archived_at=now() WHERE id=$1', [f.siteId])
    f.client.release()
    await f.pool.end()
  }
})
