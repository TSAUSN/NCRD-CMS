import { test, expect, type Locator } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { siteLookFixture } from '../fixtures/r8-site-look.ts'
import { echelonFixture } from '../fixtures/echelon.ts'
import { signIn } from '../helpers.ts'

async function expectVisibleIcons(nav: Locator) {
  await expect
    .poll(() =>
      nav.getByRole('link').evaluateAll(links =>
        links.flatMap(link => {
          const icons = link.querySelectorAll('svg')
          const icon = icons[0]
          const box = icon?.getBoundingClientRect()
          if (
            icons.length === 1 &&
            icon &&
            box &&
            box.width > 0 &&
            box.height > 0 &&
            getComputedStyle(icon).visibility === 'visible'
          )
            return []
          return [link.getAttribute('aria-label') ?? link.textContent ?? 'Unlabelled navigation link']
        }),
      ),
    )
    .toEqual([])
}

test.use({ actionTimeout: 15000 })
test('Home matches the Main card hierarchy and shared navigation keeps visible icons across site screens', async ({
  page,
}, info) => {
  test.setTimeout(120000)
  const f = await siteLookFixture(),
    chapter = await echelonFixture(false, false),
    folder = resolve('../.r8-progress/round3/polish-home/' + info.project.name),
    heads = (
      await f.pool.query(
        'SELECT id,draft_version_id,published_version_id FROM pages WHERE site_id=ANY($1::uuid[]) ORDER BY id',
        [[f.site, chapter.site]],
      )
    ).rows
  try {
    await mkdir(folder, { recursive: true })
    await signIn(page, 'root@example.test')
    const main = page.getByRole('main'),
      sidebar = page.getByRole('complementary', { name: 'CMS navigation', exact: true }),
      capture = async (name: string) => {
        for (const width of [1440, 1024]) {
          await page.setViewportSize({ width, height: 1000 })
          await page.evaluate(() => document.fonts.ready)
          expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
          await page.screenshot({ path: resolve(folder, name + '-' + width + '.png'), animations: 'disabled' })
        }
      }
    await expect(sidebar.getByRole('heading', { name: 'Your sites', exact: true })).toBeVisible()
    const common = await sidebar
      .getByRole('navigation', { name: 'Sections of the CMS', exact: true })
      .getByRole('link')
      .evaluateAll(links => links.slice(0, 6).map(link => link.getAttribute('aria-label')))
    for (const width of [1440, 1024]) {
      await page.setViewportSize({ width, height: 1000 })
      const title = await main.getByRole('heading', { name: 'Home', level: 1, exact: true }).boundingBox()
      expect(title!.y).toBe(28)
      const cards = main.locator('article.site-card:visible')
      const active = (
        await f.pool.query<{ id: string }>(
          "SELECT id FROM sites WHERE status <> 'archived' AND archived_at IS NULL ORDER BY id",
        )
      ).rows.map(site => '/sites/' + site.id)
      await expect(cards).toHaveCount(active.length)
      expect(
        await cards
          .getByRole('link', { name: /^Open / })
          .evaluateAll(links => links.map(link => link.getAttribute('href')).sort()),
      ).toEqual(active)
      const boxes = await cards.evaluateAll(nodes =>
        nodes.map(node => {
          const b = node.getBoundingClientRect()
          return { x: b.x, y: b.y, width: b.width, height: b.height }
        }),
      )
      expect(boxes[0]!.y).toBe(boxes[1]!.y)
      expect(boxes[0]!.height).toBe(boxes[1]!.height)
      if (width === 1440) expect(boxes[2]!.y).toBe(boxes[0]!.y)
      else expect(boxes[2]!.y).toBeGreaterThan(boxes[0]!.y)
      await expectVisibleIcons(sidebar.getByRole('navigation', { name: 'Sections of the CMS', exact: true }))
    }
    const tools = main
      .locator('details')
      .filter({ has: page.getByText('Test tools (this computer only)', { exact: true }) })
    await expect(tools).not.toHaveAttribute('open', '')
    await expect(main.getByText('The worker is not running', { exact: true })).not.toBeVisible()
    for (const card of await main.locator('article.site-card').all()) {
      await card.scrollIntoViewIfNeeded()
      await expect(card.getByText('Loading saved preview…', { exact: true })).toHaveCount(0)
    }
    await page.evaluate(() => scrollTo(0, 0))
    await expect(main.getByText('Loading saved preview…', { exact: true })).toHaveCount(0)
    await capture('home')
    await main
      .locator('article')
      .filter({ has: page.locator('a[href="/sites/' + f.site + '"]') })
      .getByRole('button', { name: 'Actions for Shared site look', exact: true })
      .click()
    await expect(main.getByRole('link', { name: 'View site', exact: true })).toBeVisible()
    await expect(main.getByRole('link', { name: 'View site', exact: true })).toHaveAttribute('target', '_blank')
    expect(
      await main
        .getByRole('link', { name: 'View site', exact: true })
        .evaluate(node => getComputedStyle(node).textDecorationLine),
    ).toBe('none')
    await capture('site-actions')
    await page.keyboard.press('Escape')
    await main.getByText('Test tools (this computer only)', { exact: true }).click()
    await expect(main.getByText('The worker is not running', { exact: true })).toBeVisible()
    await main.getByText('Test tools (this computer only)', { exact: true }).click()
    let labels: string[] | undefined
    for (const route of ['header', 'chapters']) {
      await page.goto('/sites/' + chapter.site + '/' + route)
      const nav = sidebar.getByRole('navigation', { name: 'Sections of the CMS', exact: true }),
        current = await nav.getByRole('link').evaluateAll(links => links.map(link => link.getAttribute('aria-label')!))
      if (labels) expect(current).toEqual(labels)
      else labels = current
      expect(current.filter(label => common.includes(label))).toEqual(common)
      await expectVisibleIcons(nav)
      await capture('shared-' + route)
    }
    expect(
      (
        await f.pool.query(
          'SELECT id,draft_version_id,published_version_id FROM pages WHERE site_id=ANY($1::uuid[]) ORDER BY id',
          [[f.site, chapter.site]],
        )
      ).rows,
    ).toEqual(heads)
  } finally {
    chapter.client.release()
    await f.pool.query('UPDATE sites SET archived_at=now() WHERE id=ANY($1::uuid[])', [[f.site, chapter.site]])
    await chapter.pool.end()
    await f.pool.end()
  }
})
