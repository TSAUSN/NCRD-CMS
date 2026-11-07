import { E2E_PORTS } from '../../test-ports.ts'
import { test, expect, type BrowserContext } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { storyDateInFeed, storyTagIds } from '@cms/schema'
import { sawsoFixture } from '../fixtures/sawso.ts'
import { signIn, saveDraft } from '../helpers.ts'
test('World View edits real settings, publishes with review and works by region with or without JavaScript', async ({
  page,
  browser,
}, info) => {
  test.setTimeout(180000)
  const f = await sawsoFixture(true, true),
    folder = resolve('../.r8-progress/round3/story-world/' + info.project.name)
  await mkdir(folder, { recursive: true })
  let visitor: BrowserContext | undefined,
    noJs: BrowserContext | undefined,
    pageId = '',
    reportPageId = '',
    sourceReads = 0
  const capture = async (name: string) => {
    for (const width of [1440, 1024]) {
      await page.setViewportSize({ width, height: 1000 })
      await expect(page.getByText('Opening the page preview…', { exact: true })).toBeHidden()
      await expect(
        page.frameLocator('iframe[title="Page canvas"]').locator('[data-cms-stories-widget="0"] .cms-story-map'),
      ).toBeVisible()
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      await page.screenshot({ path: resolve(folder, name + '-' + width + '.png') })
    }
    await page.setViewportSize({ width: 1440, height: 1000 })
  }
  try {
    await f.client.query('BEGIN')
    await f.client.query("SELECT set_config('app.user_id',$1,true)", [f.actor])
    const def = (
      await f.client.query(
        "SELECT d.id,v.version FROM section_defs d JOIN LATERAL(SELECT version FROM section_def_versions WHERE section_def_id=d.id ORDER BY version DESC LIMIT 1)v ON true WHERE d.slug='core-story-world' AND d.scope='global'",
      )
    ).rows[0]!
    const make = (heading: string, start: string, missing = false) => ({
      section_def_id: def.id,
      section_def_version: def.version,
      label: heading,
      hidden: false,
      hidden_at: [],
      values: {
        heading,
        start_region: start,
        per_region: '3',
        stories: {
          readerKey: 'stories',
          selection: {
            mode: 'automatic',
            limit: 200,
            order: 'newest',
            dateField: 'published_date',
            maxAgeMonths: 13,
            ...(missing ? { storyTags: { main: ['no-matching-stories'], secondary: [] } } : {}),
          },
        },
      },
    })
    pageId = (await f.client.query("SELECT app.create_page($1,'world-map','World View') AS id", [f.siteId])).rows[0]!.id
    await f.client.query('SELECT * FROM app.save_page_draft($1,0,$2,$3)', [
      pageId,
      JSON.stringify([make('Where We Work', ''), make('Another view', ''), make('Coming soon', '', true)]),
      '{}',
    ])
    const reportDefs = (
        await f.client.query(
          "SELECT d.id,d.slug,v.version FROM section_defs d JOIN LATERAL(SELECT version FROM section_def_versions WHERE section_def_id=d.id ORDER BY version DESC LIMIT 1)v ON true WHERE d.scope='global' AND d.slug=ANY($1::text[])",
          [['core-photo-banner', 'core-story-split']],
        )
      ).rows,
      cover = reportDefs.find(row => row.slug === 'core-photo-banner')!,
      split = reportDefs.find(row => row.slug === 'core-story-split')!
    reportPageId = (
      await f.client.query("SELECT app.create_page($1,'report-map','Report widget check') AS id", [f.siteId])
    ).rows[0]!.id
    await f.client.query('SELECT * FROM app.save_page_draft($1,0,$2,$3)', [
      reportPageId,
      JSON.stringify([
        {
          section_def_id: cover.id,
          section_def_version: cover.version,
          values: {
            heading: '[Report]',
            photo: { src: '/cms-samples/r8-landscape.png', alt: '[Sample report photo]', decorative: false },
            __cms_report_template: 'annual',
            __cms_report_part: 'cover',
            __cms_report_band: 'cover',
          },
        },
        make('[Report World View]', 'africa'),
        {
          section_def_id: split.id,
          section_def_version: split.version,
          values: { heading: '[Report news]', page_size: '12', stories: make('[Report news]', '').values.stories },
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
        .filter(
          v => storyDateInFeed(v.published_date) && v.hidden !== true && v.feed_removed !== true && v.in_feed !== false,
        ),
      count = (region: string, main?: string) =>
        rows.filter(
          v => storyTagIds(v, 'secondary').includes(region) && (!main || storyTagIds(v, 'main').includes(main)),
        ).length
    expect(count('africa')).toBeGreaterThan(0)
    const other = ['asia', 'latin-america-caribbean', 'europe'].find(id => count(id) > 0)!
    expect(other).toBeTruthy()
    await signIn(page, 'root@example.test')
    await page.goto('/pages/' + pageId + '?section=0')
    const panel = page.getByRole('complementary', { name: 'Inspector', exact: true }),
      frame = page.frameLocator('iframe[title="Page canvas"]'),
      world = frame.locator('[data-cms-stories-widget="0"]')
    await expect(panel.getByLabel('Region shown when the page opens', { exact: true })).toHaveValue('')
    await expect(panel.getByLabel('Stories per region', { exact: true })).toHaveValue('3')
    await expect(panel.getByLabel('Maximum stories', { exact: true })).toHaveCount(0)
    await expect(panel.locator('[data-inspector-slot="region_links"],[data-inspector-slot="hint"]')).toHaveCount(0)
    await expect(world.getByText('Select a region on the map to see our stories.', { exact: true })).toBeVisible()
    await capture('editor-prompt')
    await panel.getByLabel('Region shown when the page opens', { exact: true }).selectOption('africa')
    await panel
      .getByRole('group', { name: 'Project Sectors', exact: true })
      .getByRole('button', { name: 'Health', exact: true })
      .click()
    await expect(world.locator('.cms-story-map-region[aria-current=true]')).toHaveAttribute(
      'aria-label',
      'Africa: ' + count('africa', 'health') + ' ' + (count('africa', 'health') === 1 ? 'story' : 'stories'),
    )
    await expect(world.locator('.core-story-card')).toHaveCount(Math.min(3, count('africa', 'health')))
    await capture('editor-filtered')
    await saveDraft(page)
    await page.reload()
    await expect(
      panel
        .getByRole('group', { name: 'Project Sectors', exact: true })
        .getByRole('button', { name: 'Health', exact: true }),
    ).toHaveAttribute('aria-pressed', 'true')
    await panel
      .getByRole('group', { name: 'Project Sectors', exact: true })
      .getByRole('button', { name: 'Health', exact: true })
      .click()
    await saveDraft(page)
    await capture('editor-saved')
    const version = (await f.pool.query('SELECT draft_version_id FROM pages WHERE id=$1', [pageId])).rows[0]!
        .draft_version_id,
      privateUrl = '/preview/' + version + '?visit=1&site=draft&lists=draft&story0_region=' + other
    await page.goto(privateUrl)
    await expect(
      page.locator('[data-cms-stories-widget="0"] .cms-story-map-region[aria-current=true]'),
    ).toHaveAttribute('data-cms-story-region', other)
    expect((await page.request.get(privateUrl)).headers()['content-security-policy']).toContain("script-src 'none'")
    await page.locator('[data-cms-stories-widget="0"] .core-world-regions a[data-cms-story-region="africa"]').click()
    await expect(page).toHaveURL(/visit=1.*lists=draft.*story0_region=africa/)
    await page.goto('/sites/' + f.siteId + '/publishing?siteLook=1&lists=1&pages=' + [pageId, reportPageId].join(','))
    const publish = page.getByRole('button', { name: /^Publish selected \(\d+\)$/ })
    await publish.click()
    const sample = page.getByRole('checkbox', { name: /Publish with sample content/ })
    await expect(sample.or(page.getByRole('alertdialog'))).toBeVisible({ timeout: 60000 })
    if (await sample.isVisible()) {
      await sample.check()
      const reason = page.getByRole('textbox', { name: 'Reason for publishing despite these findings' })
      if (await reason.isVisible())
        await reason.fill('Reviewing isolated World View behavior and responsive map geometry.')
      await publish.click()
    }
    await page.getByRole('alertdialog').getByRole('button', { name: 'Publish selected', exact: true }).click()
    await expect(page.getByRole('status').filter({ hasText: 'Release applied.' })).toBeVisible({ timeout: 60000 })
    const url = 'http://' + f.hostname + `:${E2E_PORTS.site}/world-map`
    noJs = await browser.newContext({ javaScriptEnabled: false })
    const plain = await noJs.newPage()
    await plain.goto(url)
    await expect(plain.locator('[data-cms-stories-widget]')).toHaveCount(3)
    await expect(plain.locator('[data-cms-stories-widget="0"] .core-story-card')).toHaveCount(
      Math.min(3, count('africa')),
    )
    await expect(plain.locator('[data-cms-stories-widget="1"] .core-world-results')).toHaveCount(0)
    await expect(plain.locator('[data-cms-stories-widget="2"] .cms-story-map-region')).toHaveCount(0)
    await expect(
      plain.getByText('No current stories are available. Please check back soon.', { exact: true }),
    ).toBeVisible()
    for (const width of [1440, 1024, 390]) {
      await plain.setViewportSize({ width, height: 900 })
      expect(await plain.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      await plain.evaluate(() => scrollTo(0, 0))
      await plain.screenshot({ path: resolve(folder, 'public-viewport-' + width + '.png') })
      await plain
        .locator('[data-cms-stories-widget="0"]')
        .screenshot({ path: resolve(folder, 'public-no-js-' + width + '.png') })
      await plain
        .locator('[data-cms-stories-widget="2"]')
        .screenshot({ path: resolve(folder, 'empty-no-js-' + width + '.png') })
    }
    await plain
      .locator('[data-cms-stories-widget="0"] .core-world-regions a[data-cms-story-region="' + other + '"]')
      .click()
    await expect(plain).toHaveURL(new RegExp('story0_region=' + other))
    await expect(plain.locator('[data-cms-stories-widget="0"] .core-story-card')).toHaveCount(Math.min(3, count(other)))
    for (const width of [1440, 390]) {
      await plain.setViewportSize({ width, height: 900 })
      await plain.goto(url)
      const native = await plain
        .locator('[data-cms-stories-widget="0"] .core-story-card')
        .first()
        .evaluate(card => {
          const title = getComputedStyle(card.querySelector('h3 a')!),
            button = getComputedStyle(card.querySelector('.core-story-copy>a')!)
          return {
            family: title.fontFamily,
            size: title.fontSize,
            weight: title.fontWeight,
            decoration: title.textDecorationLine,
            buttonInk: button.color,
            buttonDecoration: button.textDecorationLine,
          }
        })
      await plain.goto('http://' + f.hostname + `:${E2E_PORTS.site}/report-map`)
      await expect(plain.locator('#cms-main.cms-report-page')).toBeVisible()
      for (const kind of ['.core-story-world', '.core-story-split']) {
        const card = plain.locator(kind + ' .core-story-card').first()
        await expect(card).toBeVisible()
        expect(
          await card.evaluate(card => {
            const title = getComputedStyle(card.querySelector('h3 a')!),
              button = getComputedStyle(card.querySelector('.core-story-copy>a')!)
            return {
              family: title.fontFamily,
              size: title.fontSize,
              weight: title.fontWeight,
              decoration: title.textDecorationLine,
              buttonInk: button.color,
              buttonDecoration: button.textDecorationLine,
            }
          }),
        ).toEqual(native)
      }
      await plain.screenshot({ path: resolve(folder, 'report-widgets-native-' + width + '.png'), fullPage: true })
    }
    await noJs.close()
    noJs = undefined
    visitor = await browser.newContext({ reducedMotion: 'reduce' })
    const live = await visitor.newPage()
    await live.route('https://sawso.org/**', async route => {
      sourceReads++
      await route.abort()
    })
    await live.goto(url)
    const response = await live.request.get(url),
      csp = response.headers()['content-security-policy']!
    expect(csp).toContain("connect-src 'self'")
    expect(csp).not.toContain("script-src 'self'")
    const root = live.locator('[data-cms-stories-widget="0"]')
    await expect(root).toHaveAttribute('data-cms-stories-ready', '')
    await expect(root.locator('.core-world-regions')).toBeHidden()
    expect(
      await root.evaluate(
        node =>
          getComputedStyle(node.querySelector('.core-world-region-heading')!).fontFamily ===
          getComputedStyle(node.querySelector('.core-world-heading')!).fontFamily,
      ),
    ).toBe(true)
    let navigations = 0
    live.on('request', request => {
      if (request.isNavigationRequest() && request.frame() === live.mainFrame()) navigations++
    })
    const choose = async (regionRoot: typeof root, region: string) => {
      const anchor = regionRoot.locator('.cms-story-map-region[data-cms-story-region="' + region + '"]')
      await anchor.scrollIntoViewIfNeeded()
      const box = await anchor.boundingBox(),
        pin = await anchor.locator('circle').boundingBox()
      expect(box).not.toBeNull()
      expect(pin).not.toBeNull()
      await anchor.click({ position: { x: pin!.x + pin!.width / 2 - box!.x, y: pin!.y + pin!.height / 2 - box!.y } })
    }
    await choose(root, other)
    await expect(root.locator('.cms-story-map-region[aria-current=true]')).toHaveAttribute(
      'data-cms-story-region',
      other,
    )
    expect(navigations).toBe(0)
    await expect(live).toHaveURL(new RegExp('story0_region=' + other))
    expect(
      await root.evaluate(node => node.getAnimations({ subtree: true }).filter(a => a.playState === 'running').length),
    ).toBe(0)
    const second = live.locator('[data-cms-stories-widget="1"]')
    await second.locator('.cms-story-map-region[data-cms-story-region="africa"]').focus()
    await live.keyboard.press('Enter')
    await expect(second.locator('.cms-story-map-region[aria-current=true]')).toHaveAttribute(
      'data-cms-story-region',
      'africa',
    )
    expect(new URL(live.url()).searchParams.get('story0_region')).toBe(other)
    await expect(root.locator('.cms-story-map-region[aria-current=true]')).toHaveAttribute(
      'data-cms-story-region',
      other,
    )
    await live.route('**/world-map?*', route =>
      route.fulfill({ status: 503, contentType: 'text/html', body: 'Unavailable' }),
    )
    await choose(root, 'africa')
    await expect(root.getByRole('alert')).toContainText('Stories could not be loaded. Try again or open this region.')
    await expect(root.getByRole('link', { name: 'Open region', exact: true })).toBeVisible()
    await expect(root.getByRole('alert')).toBeInViewport()
    for (const width of [1440, 1024, 390]) {
      await live.setViewportSize({ width, height: 900 })
      await root.getByRole('alert').scrollIntoViewIfNeeded()
      expect(await live.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      await live.screenshot({ path: resolve(folder, 'public-error-' + width + '.png') })
    }
    await live.unroute('**/world-map?*')
    await root.getByRole('button', { name: 'Try again', exact: true }).click()
    await expect(root.locator('.cms-story-map-region[aria-current=true]')).toHaveAttribute(
      'data-cms-story-region',
      'africa',
    )
    await live.setViewportSize({ width: 390, height: 900 })
    expect(await live.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await root.screenshot({ path: resolve(folder, 'public-enhanced-390.png') })
    expect(sourceReads).toBe(0)
  } finally {
    await visitor?.close()
    await noJs?.close()
    await f.client.query('ROLLBACK').catch(() => {})
    await f.pool.query('UPDATE sites SET archived_at=now() WHERE id=$1', [f.siteId])
    f.client.release()
    await f.pool.end()
  }
})

test('SAWSO sector World View explains and enforces six cards even when All is selected', async ({
  page,
  browser,
}, info) => {
  test.setTimeout(180000)
  const f = await sawsoFixture(true, true),
    folder = resolve('../.r8-progress/round3/story-world/' + info.project.name)
  await mkdir(folder, { recursive: true })
  let context: BrowserContext | undefined
  try {
    await f.client.query('BEGIN')
    await f.client.query("SELECT set_config('app.user_id',$1,true)", [f.actor])
    const def = (
        await f.client.query(
          "SELECT d.id,v.version FROM section_defs d JOIN LATERAL(SELECT version FROM section_def_versions WHERE section_def_id=d.id ORDER BY version DESC LIMIT 1)v ON true WHERE d.slug='core-story-world' AND d.scope='global'",
        )
      ).rows[0]!,
      id = (
        await f.client.query("SELECT app.create_page($1,'ways-we-help/region-map','Sector World View') AS id", [
          f.siteId,
        ])
      ).rows[0]!.id
    await f.client.query('SELECT * FROM app.save_page_draft($1,0,$2,$3)', [
      id,
      JSON.stringify([
        {
          section_def_id: def.id,
          section_def_version: def.version,
          label: 'World View',
          hidden: false,
          hidden_at: [],
          values: {
            heading: 'Where We Work',
            start_region: 'africa',
            per_region: '200',
            stories: {
              readerKey: 'stories',
              selection: {
                mode: 'automatic',
                limit: 200,
                order: 'newest',
                dateField: 'published_date',
                maxAgeMonths: 13,
              },
            },
          },
        },
      ]),
      '{}',
    ])
    await f.client.query('COMMIT')
    await signIn(page, 'root@example.test')
    await page.goto('/pages/' + id + '?section=0')
    const panel = page.getByRole('complementary', { name: 'Inspector', exact: true }),
      limit = panel.getByLabel('Stories per region', { exact: true }),
      frame = page.frameLocator('iframe[title="Page canvas"]')
    await expect(limit).toHaveValue('200')
    await expect(limit.locator('option')).toHaveCount(3)
    await expect(limit.locator('option:checked')).toHaveText('All (up to 6)')
    await expect(panel.getByText('SAWSO sector pages show up to 6 stories per region.', { exact: true })).toBeVisible()
    await expect(frame.locator('[data-cms-stories-widget="0"] .core-story-card')).toHaveCount(6)
    for (const width of [1440, 1024]) {
      await page.setViewportSize({ width, height: 1000 })
      await expect(page.getByText('Opening the page preview…', { exact: true })).toBeHidden()
      await expect(frame.locator('.cms-story-map')).toBeVisible()
      await page.screenshot({ path: resolve(folder, 'sector-limit-editor-' + width + '.png') })
    }
    await page.goto('/sites/' + f.siteId + '/publishing?siteLook=1&lists=1&pages=' + id)
    const publish = page.getByRole('button', { name: /^Publish selected \(\d+\)$/ })
    await publish.click()
    const consent = page.getByRole('checkbox', { name: /Publish with sample content/ })
    await expect(consent.or(page.getByRole('alertdialog'))).toBeVisible({ timeout: 60000 })
    if (await consent.isVisible()) {
      await consent.check()
      const reason = page.getByRole('textbox', { name: 'Reason for publishing despite these findings' })
      if (await reason.isVisible()) await reason.fill('Reviewing the isolated sector-map display limit.')
      await publish.click()
    }
    await page.getByRole('alertdialog').getByRole('button', { name: 'Publish selected', exact: true }).click()
    await expect(page.getByRole('status').filter({ hasText: 'Release applied.' })).toBeVisible({ timeout: 60000 })
    context = await browser.newContext({ javaScriptEnabled: false })
    const publicPage = await context.newPage()
    await publicPage.goto('http://' + f.hostname + `:${E2E_PORTS.site}/ways-we-help/region-map`)
    await expect(publicPage.locator('.core-story-card')).toHaveCount(6)
    for (const width of [1440, 1024, 390]) {
      await publicPage.setViewportSize({ width, height: 900 })
      expect(await publicPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      await publicPage.screenshot({ path: resolve(folder, 'sector-limit-public-' + width + '.png') })
    }
  } finally {
    await context?.close()
    await f.client.query('ROLLBACK').catch(() => {})
    await f.pool.query('UPDATE sites SET archived_at=now() WHERE id=$1', [f.siteId])
    f.client.release()
    await f.pool.end()
  }
})
