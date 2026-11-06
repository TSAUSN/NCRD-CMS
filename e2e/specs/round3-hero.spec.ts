import { E2E_PORTS } from '../test-ports.ts'
import { test, expect } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { renderPage, type SiteShell } from '@cms/renderer'
import { CORE_LIBRARY, compileCoreSection } from '@cms/seeds/core-library'
import { SAWSO_THEME } from '@cms/seeds/core-themes'
import { publicSecurityHeaders } from '../../apps/site/src/lib/public-security.ts'
import { sawsoFixture } from './fixtures/sawso.ts'
import { signIn, saveDraft } from './helpers.ts'
function publicExample() {
  const photo = { src: '/cms-samples/r8-landscape.png', alt: '[Sample landscape]', decorative: false },
    values: Record<string, unknown> = {
      heading: '[Featured stories]',
      slides: { items: ['i1', 'i2', 'i3', 'i4', 'i5'] },
    }
  for (let n = 1; n <= 5; n++)
    Object.assign(values, {
      ['slides__i' + n + '__title']: '[Slide ' + n + ']',
      ['slides__i' + n + '__intro']: '[Description for slide ' + n + ']',
      ['slides__i' + n + '__photo']: photo,
      ['slides__i' + n + '__primary']: { label: 'Read More', url: '/story-' + n },
      ['slides__i' + n + '__secondary']: { label: '', url: '' },
      ['slides__i' + n + '__enabled']: n === 5 ? 'off' : 'on',
      ['slides__i' + n + '__starts_at']: n === 4 ? '2099-01-01T00:00:00Z' : '',
      ['slides__i' + n + '__ends_at']: '',
    })
  const grid: Record<string, unknown> = {
    heading: '[Services]',
    link: { label: '', url: '' },
    cards: { items: Array.from({ length: 8 }, (_, i) => 'i' + (i + 1)) },
  }
  for (let n = 1; n <= 8; n++)
    Object.assign(grid, {
      ['cards__i' + n + '__title']: '[Service ' + n + ']',
      ['cards__i' + n + '__photo']: photo,
      ['cards__i' + n + '__action']: { label: '[Service ' + n + ']', url: '/service-' + n },
    })
  const sections = ['core-feature-slider', 'core-photo-grid'].map((slug, i) => {
    const entry = CORE_LIBRARY.find(entry => entry.definition.slug === slug)!,
      compiled = compileCoreSection(entry)
    return {
      instance: { section_def_id: slug, section_def_version: 1, values: i ? grid : values },
      def: {
        section_def_id: slug,
        slug,
        version: 1,
        compiled_ast: compiled.compiledAst,
        css: compiled.compiledCss,
        slots: compiled.slots,
        css_policy_version: compiled.compiledAst.cssPolicyVersion,
      },
    }
  })
  const shell: SiteShell = {
    site: { id: 'sample', name: '[Site]', slug: 'sample' },
    theme: SAWSO_THEME,
    navigation: [],
    canonical_host: null,
    staging_host: 'demo.staging.localhost',
  }
  return renderPage({
    shell,
    manifest: {
      page: { id: 'page', version_id: 'version', title: '[Page]', path: '/hero-specimen' },
      meta: {},
      sections,
    },
    isStaging: true,
    options: { externalRuntimes: true },
  }).html
}
test('public repeating hero has working chevrons, six-second pause and reduced motion; tiles match hover and focus without touch hover', async ({
  browser,
}) => {
  test.setTimeout(120000)
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'no-preference' }),
    page = await context.newPage(),
    html = publicExample(),
    url = `http://demo.staging.localhost:${E2E_PORTS.site}/hero-specimen`,
    folder = resolve('../.r8-progress/round3/exact-hero', browser.browserType().name())
  await mkdir(folder, { recursive: true })
  const serve = (route: import('@playwright/test').Route) =>
    route.fulfill({
      status: 200,
      headers: {
        'content-type': 'text/html',
        ...publicSecurityHeaders({ siteStyles: true, heroSlides: true }),
      },
      body: html,
    })
  try {
    await page.route(url, serve)
    await page.goto(url)
    const track = page.locator('[data-cms-hero]'),
      slides = track.locator('.cms-hero-slide:not([hidden])')
    await expect(slides).toHaveCount(3)
    await expect(
      slides.first().getByRole('link', { name: 'Next slide', exact: true }).locator('svg path'),
    ).toHaveAttribute('d', 'm9 6 6 6-6 6')
    await expect(track.getByRole('link', { name: 'Previous slide', exact: true })).toHaveCount(0)
    await expect(track).toHaveAttribute('data-cms-hero-ready', '')
    await expect(slides.nth(1)).toBeInViewport({ ratio: 0.95, timeout: 9000 })
    await expect(slides.nth(1)).not.toHaveAttribute('inert', '')
    await track.hover()
    await page.waitForTimeout(6500)
    await expect(slides.nth(1)).not.toHaveAttribute('inert', '')
    await slides.nth(1).getByRole('link', { name: 'Next slide', exact: true }).click()
    await expect(slides.nth(2)).not.toHaveAttribute('inert', '')
    await slides.nth(2).getByRole('link', { name: 'Next slide', exact: true }).focus()
    await page.mouse.move(1, 1)
    await page.waitForTimeout(6500)
    await expect(slides.nth(2)).not.toHaveAttribute('inert', '')
    await slides.nth(2).getByRole('link', { name: 'Slide 2: [Slide 2]', exact: true }).click()
    await expect(slides.nth(1)).not.toHaveAttribute('inert', '')
    await expect(slides.nth(1)).toBeInViewport({ ratio: 0.95 })
    for (const width of [1440, 1024, 390]) {
      await page.setViewportSize({ width, height: 900 })
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      await page.screenshot({ path: resolve(folder, 'public-' + width + '.png'), fullPage: true })
    }
    await page.setViewportSize({ width: 1440, height: 900 })
    const tiles = page.locator('.national-photo-tile')
    await tiles.nth(0).hover()
    await expect(tiles.nth(0)).toHaveCSS('outline-color', 'rgb(239, 62, 66)')
    await tiles.nth(0).getByRole('link').focus()
    await page.keyboard.press(browser.browserType().name() === 'webkit' ? 'Alt+Tab' : 'Tab')
    await expect(tiles.nth(1).getByRole('link')).toBeFocused()
    await expect(tiles.nth(1)).toHaveCSS('outline-color', 'rgb(239, 62, 66)')
    await page.screenshot({ path: resolve(folder, 'tile-focus-1440.png'), fullPage: true })
    const reduced = await browser.newContext({ reducedMotion: 'reduce' })
    try {
      const view = await reduced.newPage()
      await view.route(url, serve)
      await view.clock.install()
      await view.goto(url)
      await view.clock.fastForward(13000)
      await expect(view.locator('.cms-hero-slide').nth(0)).not.toHaveAttribute('inert', '')
      await view.locator('.cms-hero-slide').nth(0).getByRole('link', { name: 'Next slide', exact: true }).click()
      await expect(view.locator('.cms-hero-slide').nth(1)).toBeInViewport()
    } finally {
      await reduced.close()
    }
    const nojs = await browser.newContext({
      javaScriptEnabled: false,
      viewport: { width: 390, height: 900 },
      reducedMotion: 'reduce',
    })
    try {
      const view = await nojs.newPage()
      await view.route(url, serve)
      await view.goto(url)
      await expect(view.locator('.cms-hero-slide').nth(0)).toBeInViewport()
      await view.locator('.cms-hero-slide').nth(0).getByRole('link', { name: 'Next slide', exact: true }).click()
      await expect(view.locator('.cms-hero-slide').nth(1)).toBeInViewport()
      await view
        .locator('.cms-hero-slide')
        .nth(1)
        .getByRole('link', { name: 'Slide 3: [Slide 3]', exact: true })
        .click()
      await expect(view.locator('.cms-hero-slide').nth(2)).toBeInViewport()
      await view.screenshot({ path: resolve(folder, 'no-js-390.png'), fullPage: true })
    } finally {
      await nojs.close()
    }
    const touch = await browser.newContext({ isMobile: true, hasTouch: true, viewport: { width: 390, height: 900 } })
    try {
      const view = await touch.newPage()
      await view.route(url, serve)
      await view.goto(url)
      const tile = view.locator('.national-photo-tile').first()
      await tile.hover()
      await expect(tile).toHaveCSS('outline-color', 'rgba(0, 0, 0, 0)')
    } finally {
      await touch.close()
    }
  } finally {
    await context.close()
  }
})
test('hero editor adds, previews, cancels, copies a story, reorders and saves date/on-off controls without leftovers', async ({
  page,
  browser,
}) => {
  test.setTimeout(120000)
  const f = await sawsoFixture(true, true)
  try {
    const home = (await f.pool.query("SELECT id FROM pages WHERE site_id=$1 AND slug=''", [f.siteId])).rows[0]!.id
    await signIn(page, 'root@example.test')
    await page.goto('/pages/' + home + '?section=0')
    const inspector = page.getByRole('complementary', { name: 'Inspector' }),
      folder = resolve('../.r8-progress/round3/exact-hero', browser.browserType().name())
    await mkdir(folder, { recursive: true })
    await expect(inspector.getByRole('heading', { name: 'Hero slides', exact: true })).toBeVisible()
    await expect(page.frameLocator('iframe[title="Page canvas"]').locator('[data-cms-hero]')).toHaveAttribute(
      'data-cms-hero-editing',
      'true',
    )
    await expect(page.frameLocator('iframe[title="Page canvas"]').locator('[data-cms-hero-ready]')).toHaveCount(1)
    const canvas = page.frameLocator('iframe[title="Page canvas"]')
    await canvas.locator('.cms-hero-slide').first().getByRole('link', { name: 'Next slide', exact: true }).click()
    await expect(inspector.getByRole('heading', { name: 'Slide 2 of 3', exact: true })).toBeVisible()
    await expect(canvas.locator('.cms-hero-slide').nth(1)).not.toHaveAttribute('inert', '')
    await inspector.getByRole('button', { name: 'Back', exact: true }).click()
    for (const width of [1440, 1024]) {
      await page.setViewportSize({ width, height: 900 })
      await page.screenshot({ path: resolve(folder, 'list-' + width + '.png'), fullPage: true })
    }
    const tree = page.getByRole('complementary', { name: 'Page structure', exact: true })
    if (await tree.isVisible()) {
      await expect(tree.getByRole('button', { name: /^Slide [123]:/ })).toHaveCount(3)
      await expect(tree.getByText(/Slide 1 ·/)).toHaveCount(0)
    }
    await inspector.getByRole('button', { name: 'Add slide', exact: true }).click()
    await expect(inspector.getByRole('button', { name: 'Start empty', exact: true })).toBeVisible()
    for (const width of [1440, 1024]) {
      await page.setViewportSize({ width, height: 900 })
      await page.screenshot({ path: resolve(folder, 'add-' + width + '.png'), fullPage: true })
    }
    await inspector.getByRole('button', { name: 'Start empty', exact: true }).click()
    await inspector.getByLabel('Title', { exact: true }).fill('[Temporary slide]')
    await expect(
      page.frameLocator('iframe[title="Page canvas"]').getByText('[Temporary slide]', { exact: true }),
    ).toBeVisible()
    await expect
      .poll(() =>
        page
          .frameLocator('iframe[title="Page canvas"]')
          .locator('[data-cms-hero]')
          .evaluate(element => element.scrollLeft),
      )
      .toBeGreaterThan(0)
    await inspector.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(inspector.getByText('[Temporary slide]', { exact: true })).toHaveCount(0)
    await inspector.getByRole('button', { name: 'Add slide', exact: true }).click()
    await expect(inspector.locator('ul button').first()).toBeVisible()
    await inspector.locator('ul button').first().click()
    await expect(inspector.getByLabel('Title', { exact: true })).not.toHaveValue('')
    await inspector.getByRole('button', { name: 'Cancel', exact: true }).click()
    await inspector.getByRole('button', { name: 'Slide 2 actions', exact: true }).click()
    await inspector.getByRole('button', { name: 'Move slide 2 up', exact: true }).click()
    await inspector.getByRole('button', { name: /^1\. Nepal Needs Our Prayers Now/ }).click()
    for (const width of [1440, 1024]) {
      await page.setViewportSize({ width, height: 900 })
      await expect(page.frameLocator('iframe[title="Page canvas"]').locator('[data-cms-hero-ready]')).toHaveCount(1)
      await page.screenshot({ path: resolve(folder, 'edit-' + width + '.png'), fullPage: true })
    }
    await inspector.getByLabel('Show this slide', { exact: true }).uncheck()
    await inspector.getByLabel('Schedule this slide', { exact: true }).check()
    await inspector.getByLabel('Show from', { exact: true }).fill('2026-11-01T00:00')
    await inspector.getByLabel('Show until', { exact: true }).fill('2026-10-31T23:59')
    await expect(inspector.getByRole('alert')).toContainText('end must be after')
    await expect(inspector.getByRole('button', { name: 'Done', exact: true })).toBeDisabled()
    await inspector.getByLabel('Show until', { exact: true }).fill('2026-11-15T23:59')
    for (const width of [1440, 1024]) {
      await page.setViewportSize({ width, height: 900 })
      await expect(page.frameLocator('iframe[title="Page canvas"]').locator('[data-cms-hero-ready]')).toHaveCount(1)
      await page.screenshot({ path: resolve(folder, 'dates-' + width + '.png'), fullPage: true })
    }
    await inspector.getByRole('button', { name: 'Done', exact: true }).click()
    await page.setViewportSize({ width: 1440, height: 900 })
    await tree.getByRole('button', { name: 'Page structure options', exact: true }).click()
    await tree.getByRole('button', { name: 'Changed only', exact: true }).click()
    await expect(tree.getByRole('button', { name: /^Slide 1: Nepal/ })).toBeVisible()
    await saveDraft(page)
    const values = (
      await f.pool.query(
        'SELECT v.content FROM pages p JOIN page_versions v ON v.id=p.draft_version_id WHERE p.id=$1',
        [home],
      )
    ).rows[0]!.content[0].values
    expect(values.slides.items).toEqual(['i2', 'i1', 'i3'])
    expect(values.slides__i2__enabled).toBe('off')
    expect(values.slides__i2__starts_at).toMatch(/^2026-11-01T/)
    expect(values.slides__i2__ends_at).toMatch(/^2026-11-16T/)
    expect(Object.keys(values).some(key => key.startsWith('slides__i4__'))).toBe(false)
    expect(JSON.stringify(values)).not.toContain('[Temporary slide]')
  } finally {
    await f.pool.query('UPDATE sites SET archived_at=now() WHERE id=$1', [f.siteId])
    f.client.release()
    await f.pool.end()
  }
})
