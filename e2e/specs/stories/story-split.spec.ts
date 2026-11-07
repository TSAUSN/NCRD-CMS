import { E2E_PORTS } from '../../test-ports.ts'
import { test, expect, type BrowserContext } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { storyDateInFeed, storyTagIds } from '@cms/schema'
import { sawsoFixture } from '../fixtures/sawso.ts'
import { signIn, saveDraft } from '../helpers.ts'
test('Split View saves native settings and publishes real recent, sector and map browsing with no-JS links and scoped motion', async ({
  page,
  browser,
}, info) => {
  test.setTimeout(180000)
  const f = await sawsoFixture(true, true),
    folder = resolve('../.r8-progress/round3/story-split/' + info.project.name)
  await mkdir(folder, { recursive: true })
  let plainContext: BrowserContext | undefined,
    visitor: BrowserContext | undefined,
    pageId = '',
    sourceReads = 0
  try {
    await f.client.query('BEGIN')
    await f.client.query("SELECT set_config('app.user_id',$1,true)", [f.actor])
    const def = (
      await f.client.query(
        "SELECT d.id,v.version FROM section_defs d JOIN LATERAL(SELECT version FROM section_def_versions WHERE section_def_id=d.id ORDER BY version DESC LIMIT 1)v ON true WHERE d.scope='global' AND d.slug='core-story-split'",
      )
    ).rows[0]!
    pageId = (await f.client.query("SELECT app.create_page($1,'split-news','Split View') AS id", [f.siteId])).rows[0]!
      .id
    await f.client.query('SELECT * FROM app.save_page_draft($1,0,$2,$3)', [
      pageId,
      JSON.stringify([
        {
          section_def_id: def.id,
          section_def_version: def.version,
          label: 'Split View',
          hidden: false,
          hidden_at: [],
          values: {
            heading: 'News and Stories',
            introduction: '[Introduction]',
            start_view: 'recent',
            page_size: '6',
            stories: {
              readerKey: 'stories',
              selection: {
                mode: 'automatic',
                order: 'newest',
                dateField: 'published_date',
                maxAgeMonths: 13,
                limit: 200,
              },
            },
          },
        },
      ]),
      '{}',
    ])
    await f.client.query('COMMIT')
    const rows = (
        await f.pool.query(
          'SELECT v.values FROM collection_entries e JOIN collection_entry_versions v ON v.id=e.draft_version_id WHERE e.collection_id=$1 AND e.archived_at IS NULL',
          [f.collectionId],
        )
      ).rows
        .map(row => row.values)
        .filter(v => storyDateInFeed(v.published_date) && !v.hidden && !v.feed_removed),
      health = rows.filter(v => storyTagIds(v, 'main').includes('health')).length,
      africa = rows.filter(v => storyTagIds(v, 'secondary').includes('africa')).length
    await signIn(page, 'root@example.test')
    await page.goto('/pages/' + pageId + '?section=0')
    const panel = page.getByRole('complementary', { name: 'Inspector', exact: true }),
      canvas = page.frameLocator('iframe[title="Page canvas"]')
    await expect(panel.getByLabel('View shown first', { exact: true })).toHaveValue('recent')
    await expect(panel.getByLabel('Maximum stories', { exact: true })).toHaveCount(0)
    await panel.getByLabel('View shown first', { exact: true }).selectOption('sectors')
    await expect(canvas.locator('.core-split-sector')).not.toHaveCount(0)
    const editorCapture = async (name: string) => {
      for (const width of [1440, 1024]) {
        await page.setViewportSize({ width, height: 1000 })
        await expect(page.getByText('Opening the page preview…', { exact: true })).toBeHidden()
        await page.screenshot({ path: resolve(folder, name + '-' + width + '.png') })
      }
    }
    await editorCapture('editor-sector')
    await panel.getByLabel('View shown first', { exact: true }).selectOption('map')
    await expect(canvas.locator('.cms-story-map')).toBeVisible()
    await editorCapture('editor-map')
    await panel.getByLabel('View shown first', { exact: true }).selectOption('recent')
    await panel.getByLabel('Stories per Show more', { exact: true }).selectOption('3')
    await saveDraft(page)
    await expect(canvas.locator('.core-story-card')).toHaveCount(3)
    await editorCapture('editor-recent')
    await page.goto('/sites/' + f.siteId + '/publishing?siteLook=1&lists=1&pages=' + pageId)
    const publish = page.getByRole('button', { name: /^Publish selected \(\d+\)$/ })
    await publish.click()
    const sample = page.getByRole('checkbox', { name: /Publish with sample content/ })
    await expect(sample.or(page.getByRole('alertdialog'))).toBeVisible({ timeout: 60000 })
    if (await sample.isVisible()) {
      await sample.check()
      const reason = page.getByRole('textbox', { name: 'Reason for publishing despite these findings' })
      if (await reason.isVisible()) await reason.fill('Reviewing isolated Split View behavior and responsive layouts.')
      await publish.click()
    }
    await page.getByRole('alertdialog').getByRole('button', { name: 'Publish selected', exact: true }).click()
    await expect(page.getByRole('status').filter({ hasText: 'Release applied.' })).toBeVisible({ timeout: 60000 })
    const url = 'http://' + f.hostname + `:${E2E_PORTS.site}/split-news`
    plainContext = await browser.newContext({ javaScriptEnabled: false })
    const plain = await plainContext.newPage()
    await plain.goto(url)
    await expect(plain.locator('.core-story-card')).toHaveCount(3)
    await expect(plain.locator('[data-cms-stories-ready]')).toHaveCount(0)
    const capture = async (name: string) => {
      for (const width of [1440, 1024, 390]) {
        await plain.setViewportSize({ width, height: 900 })
        expect(await plain.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
        await plain.evaluate(() => scrollTo(0, 0))
        await plain.screenshot({ path: resolve(folder, name + '-' + width + '.png') })
      }
    }
    await capture('recent-no-js')
    await plain.getByRole('link', { name: 'Show more stories', exact: true }).click()
    await expect(plain.locator('.core-story-card')).toHaveCount(6)
    await expect(plain).toHaveURL(/story0_page=2/)
    await plain.getByRole('link', { name: 'By Project Sector', exact: true }).click()
    await expect(plain.locator('.core-split-sector')).not.toHaveCount(0)
    await capture('sector-picker-no-js')
    await plain.locator('.core-split-sector').filter({ hasText: 'Health' }).click()
    await expect(plain.locator('.core-story-card')).toHaveCount(health)
    await expect(plain.getByRole('heading', { name: 'Our Stories in Health', exact: true })).toBeVisible()
    await capture('sector-no-js')
    await plain.getByRole('link', { name: 'By Map', exact: true }).click()
    await plain.locator('.core-world-regions a[data-cms-story-region=africa]').click()
    await expect(plain.locator('.core-story-card')).toHaveCount(africa)
    await capture('map-no-js')
    await plainContext.close()
    plainContext = undefined
    visitor = await browser.newContext({ reducedMotion: 'no-preference' })
    const live = await visitor.newPage()
    await live.route('https://sawso.org/**', async route => {
      sourceReads++
      await route.abort()
    })
    await live.goto(url)
    let navigations = 0
    live.on('request', request => {
      if (request.isNavigationRequest() && request.frame() === live.mainFrame()) navigations++
    })
    const root = live.locator('[data-cms-story-kind=split]')
    await expect(root).toHaveAttribute('data-cms-stories-ready', '')
    await expect(live.getByRole('switch', { name: 'Project Sector', exact: true })).toHaveAttribute(
      'aria-checked',
      'true',
    )
    await live.getByRole('switch', { name: 'Project Sector', exact: true }).click()
    await expect(root).toHaveClass(/core-split-hide-themes/)
    await live.reload()
    navigations = 0
    await expect(live.getByRole('switch', { name: 'Project Sector', exact: true })).toHaveAttribute(
      'aria-checked',
      'false',
    )
    await live.getByRole('switch', { name: 'Project Sector', exact: true }).click()
    await live.getByRole('tab', { name: 'By Project Sector', exact: true }).click()
    await expect(root).toHaveAttribute('data-cms-story-view', 'sectors')
    expect(
      await root.evaluate(node => node.getAnimations({ subtree: true }).some(a => a.playState === 'running')),
    ).toBe(true)
    await expect
      .poll(() =>
        root.evaluate(node => node.getAnimations({ subtree: true }).filter(a => a.playState === 'running').length),
      )
      .toBe(0)
    await live.emulateMedia({ reducedMotion: 'reduce' })
    await live.getByRole('tab', { name: 'By Map', exact: true }).click()
    await expect(root).toHaveAttribute('data-cms-story-view', 'map')
    await root.locator('.cms-story-map-region[data-cms-story-region=africa]').focus()
    await root.locator('.cms-story-map-region[data-cms-story-region=africa]').press('Enter')
    await expect(root.locator('.core-story-card')).toHaveCount(africa)
    expect(
      await root.evaluate(node => node.getAnimations({ subtree: true }).filter(a => a.playState === 'running').length),
    ).toBe(0)
    expect(navigations).toBe(0)
    await live.getByRole('tab', { name: 'By Map', exact: true }).press('Home')
    await expect(root).toHaveAttribute('data-cms-story-view', 'recent')
    await live.getByRole('link', { name: 'Show more stories', exact: true }).click()
    await expect(root.locator('.core-story-card')).toHaveCount(6)
    await expect(root.locator('.core-story-card').nth(3).locator('h3 a')).toBeFocused()
    await live.route('**/split-news?**', route =>
      route.fulfill({ status: 503, contentType: 'text/html', body: '<p>Unavailable</p>' }),
    )
    await live.getByRole('tab', { name: 'By Project Sector', exact: true }).click()
    await expect(root.getByRole('alert')).toContainText('Stories could not be loaded')
    await expect(root.locator('.core-story-card')).toHaveCount(6)
    for (const width of [1440, 1024, 390]) {
      await live.setViewportSize({ width, height: 900 })
      await live.screenshot({ path: resolve(folder, 'public-error-' + width + '.png') })
    }
    await live.unroute('**/split-news?**')
    await root.getByRole('button', { name: 'Try again', exact: true }).click()
    await expect(root).toHaveAttribute('data-cms-story-view', 'sectors')
    expect(sourceReads).toBe(0)
  } finally {
    await visitor?.close()
    await plainContext?.close()
    await f.client.query('ROLLBACK').catch(() => {})
    if (pageId) await f.pool.query('UPDATE pages SET archived_at=now() WHERE id=$1', [pageId])
    await f.pool.query('UPDATE sites SET archived_at=now() WHERE id=$1', [f.siteId])
    f.client.release()
    await f.pool.end()
  }
})
