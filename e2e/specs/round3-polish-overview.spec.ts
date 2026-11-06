import { test, expect } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { siteLookFixture } from './fixtures/r8-site-look.ts'
import { echelonFixture } from './fixtures/echelon.ts'
import { signIn } from './helpers.ts'

test.use({ actionTimeout: 15000 })
test('Site overview keeps the reference task rhythm and one reachable page-row menu without changing saved work', async ({
  page,
}, info) => {
  test.setTimeout(120000)
  const f = await siteLookFixture(),
    chapter = await echelonFixture(false, false),
    folder = resolve('../.r8-progress/round3/polish-overview/' + info.project.name),
    sites = [f.site, chapter.site],
    heads = (
      await f.pool.query(
        'SELECT id,draft_version_id,published_version_id,revision FROM pages WHERE site_id=ANY($1::uuid[]) ORDER BY id',
        [sites],
      )
    ).rows
  try {
    await mkdir(folder, { recursive: true })
    await signIn(page, 'root@example.test')
    const main = page.getByRole('main'),
      capture = async (name: string) => {
        for (const width of [1440, 1024]) {
          await page.setViewportSize({ width, height: 1000 })
          await page.evaluate(() => document.fonts.ready)
          expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
          await page.screenshot({ path: resolve(folder, name + '-' + width + '.png'), animations: 'disabled' })
        }
      }
    for (const [site, label] of [
      [f.site, 'native'],
      [chapter.site, 'chapters'],
    ]) {
      await page.goto('/sites/' + site)
      await expect(main.getByRole('heading', { level: 1 })).toBeVisible()
      for (const width of [1440, 1024]) {
        await page.setViewportSize({ width, height: 1000 })
        const table = main.getByRole('table', { name: 'Pages', exact: true })
        expect(await table.evaluate(n => n.getBoundingClientRect().width <= n.parentElement!.clientWidth + 1)).toBe(
          true,
        )
        await expect(table.getByRole('columnheader', { name: 'Last edited', exact: true })).toBeInViewport()
        expect((await main.getByRole('heading', { level: 1 }).boundingBox())!.y).toBe(28)
        const actions = main.getByRole('region', { name: 'Quick actions', exact: true }).locator('a,button'),
          boxes = await actions.evaluateAll(nodes =>
            nodes.map(node => {
              const b = node.getBoundingClientRect()
              return { y: b.y, height: b.height }
            }),
          )
        expect(boxes).toHaveLength(4)
        expect(new Set(boxes.map(box => box.y)).size).toBe(1)
        expect(new Set(boxes.map(box => box.height)).size).toBe(1)
        const controls = main.locator('header').first().getByRole('link'),
          heights = await controls.evaluateAll(nodes => nodes.map(node => node.getBoundingClientRect().height))
        expect(heights.every(height => height === 32)).toBe(true)
      }
      const lists = main.getByRole('region', { name: 'Lists', exact: true })
      expect(
        await lists
          .getByRole('link', { name: 'Open Lists', exact: true })
          .evaluate(node => getComputedStyle(node).textDecorationLine),
      ).toBe('none')
      await capture(label + '-overview')
      const home = (await f.pool.query("SELECT id,title FROM pages WHERE site_id=$1 AND slug=''", [site])).rows[0]!,
        table = main.getByRole('table', { name: 'Pages', exact: true }),
        row = table.getByRole('row').filter({ has: page.locator('a[href="/pages/' + home.id + '"]') })
      await row.scrollIntoViewIfNeeded()
      await expect(row.locator('td').last().getByRole('button')).toHaveCount(1)
      await expect(row.locator('td').last().getByRole('link')).toHaveCount(0)
      await row.getByRole('button', { name: 'More actions for ' + home.title, exact: true }).click()
      await expect(row.getByRole('link', { name: 'Edit ' + home.title, exact: true })).toHaveAttribute(
        'href',
        '/pages/' + home.id,
      )
      await expect(row.getByRole('button', { name: 'Rename', exact: true })).toBeVisible()
      if (label === 'native')
        await expect(
          row.getByRole('link', { name: 'View ' + home.title + ' on the live site', exact: true }),
        ).toHaveAttribute('target', '_blank')
      await capture(label + '-row-menu')
      await row.getByRole('button', { name: 'Rename', exact: true }).click()
      const details = page.getByRole('dialog', { name: 'Page name and address', exact: true })
      await expect(details.getByLabel('Page title', { exact: true })).toHaveValue(home.title)
      expect(
        await details
          .getByRole('link', { name: 'Header & menu', exact: true })
          .evaluate(node => getComputedStyle(node).textDecorationLine),
      ).toBe('none')
      await capture(label + '-page-details')
      await details.getByRole('button', { name: 'Close Page name and address', exact: true }).click()
      await expect(details).toHaveCount(0)
    }
    expect(
      (
        await f.pool.query(
          'SELECT id,draft_version_id,published_version_id,revision FROM pages WHERE site_id=ANY($1::uuid[]) ORDER BY id',
          [sites],
        )
      ).rows,
    ).toEqual(heads)
  } finally {
    chapter.client.release()
    await f.pool.query('UPDATE sites SET archived_at=now() WHERE id=ANY($1::uuid[])', [sites])
    await chapter.pool.end()
    await f.pool.end()
  }
})
