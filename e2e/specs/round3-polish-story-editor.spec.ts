import { test, expect } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { sawsoFixture } from './fixtures/sawso.ts'
import { signIn } from './helpers.ts'

test('Story writing keeps long source addresses and compact tag choices inside the remembered panel at both admin widths', async ({
  page,
}, info) => {
  test.setTimeout(120000)
  const f = await sawsoFixture(true, true),
    folder = resolve('../.r8-progress/round3/polish-story-editor/' + info.project.name)
  try {
    await mkdir(folder, { recursive: true })
    const records = (
        await f.client.query(
          'SELECT e.id,e.draft_version_id,e.published_version_id,v.values FROM collection_entries e JOIN collection_entry_versions v ON v.id=e.draft_version_id WHERE e.collection_id=$1 ORDER BY e.id',
          [f.collectionId],
        )
      ).rows,
      target = records.find(row => String(row.values.old_address ?? '').length > 90)!
    expect(target).toBeTruthy()
    const heads = (
      await f.client.query(
        'SELECT id,draft_version_id,published_version_id,revision FROM pages WHERE site_id=$1 ORDER BY id',
        [f.siteId],
      )
    ).rows
    await signIn(page, 'root@example.test')
    await page.goto('/sites/' + f.siteId + '/stories/' + target.id)
    const settings = page.getByRole('group', { name: 'Story settings', exact: true })
    for (const width of [1440, 1024]) {
      await page.setViewportSize({ width, height: 1000 })
      await page.getByRole('tab', { name: 'Content', exact: true }).click()
      await expect(page.getByLabel('Title', { exact: true })).toHaveValue(target.values.title)
      const bar = page.locator('main>header'),
        heights = await bar
          .getByRole('button')
          .evaluateAll(nodes => nodes.map(node => node.getBoundingClientRect().height))
      expect(new Set(heights).size).toBe(1)
      const chips = settings.getByRole('button', { name: 'Anti-Human Trafficking', exact: true }),
        next = settings.getByRole('button', { name: 'Capacity Building', exact: true })
      expect((await chips.boundingBox())!.y).toBe((await next.boundingBox())!.y)
      const regions = settings.getByRole('group', { name: 'Regions', exact: true }).getByRole('button')
      await expect(regions).toHaveCount(4)
      const tops = await regions.evaluateAll(ns => ns.map(n => Math.round(n.getBoundingClientRect().top)))
      expect(tops[0]).toBe(tops[1])
      expect(tops[2]).toBe(tops[3])
      expect(tops[2]).toBeGreaterThan(tops[0]!)
      const summary = page.getByRole('textbox', { name: 'Summary', exact: true })
      await expect(summary).toHaveAttribute(
        'aria-describedby',
        'story-summary-counter' + (String(target.values.summary ?? '').length > 155 ? ' story-summary-help' : ''),
      )
      await page.screenshot({ path: resolve(folder, 'content-' + width + '.png') })
      await page.getByRole('tab', { name: 'Advanced', exact: true }).click()
      const source = settings.locator('[title]').filter({ hasText: String(target.values.old_address) })
      await expect(source).toHaveAttribute('title', String(target.values.old_address))
      expect(await source.evaluate(node => getComputedStyle(node).textOverflow)).toBe('ellipsis')
      for (const key of ['Home', 'End']) {
        await page.getByRole('separator', { name: 'Resize Story settings', exact: true }).press(key)
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
        const box = (await settings.boundingBox())!
        expect(box.x + box.width).toBeLessThanOrEqual(width)
        await page.screenshot({ path: resolve(folder, 'advanced-' + key.toLowerCase() + '-' + width + '.png') })
      }
      await page.getByRole('separator', { name: 'Resize Story settings', exact: true }).press('Home')
    }
    expect(
      (
        await f.client.query(
          'SELECT e.id,e.draft_version_id,e.published_version_id,v.values FROM collection_entries e JOIN collection_entry_versions v ON v.id=e.draft_version_id WHERE e.collection_id=$1 ORDER BY e.id',
          [f.collectionId],
        )
      ).rows,
    ).toEqual(records)
    expect(
      (
        await f.client.query(
          'SELECT id,draft_version_id,published_version_id,revision FROM pages WHERE site_id=$1 ORDER BY id',
          [f.siteId],
        )
      ).rows,
    ).toEqual(heads)
  } finally {
    await f.pool.query('UPDATE sites SET archived_at=now() WHERE id=$1', [f.siteId])
    f.client.release()
    await f.pool.end()
  }
})

test('the phone read-only story screen keeps its entire toolbar inside the viewport', async ({ page }, info) => {
  const f = await sawsoFixture(true, true)
  try {
    const target = (
      await f.client.query('SELECT id FROM collection_entries WHERE collection_id=$1 ORDER BY id LIMIT 1', [
        f.collectionId,
      ])
    ).rows[0]!.id
    await signIn(page, 'root@example.test')
    await page.goto('/sites/' + f.siteId + '/stories/' + target)
    await page.setViewportSize({ width: 390, height: 1000 })
    await expect(page.getByText('Use a larger screen to edit.', { exact: true })).toBeVisible()
    await expect(page.getByLabel('Title', { exact: true })).toBeHidden()
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
    for (const button of await page.locator('main>header').getByRole('button').all()) {
      await expect(button).toBeInViewport()
      const box = (await button.boundingBox())!
      expect(box.x).toBeGreaterThanOrEqual(0)
      expect(box.x + box.width).toBeLessThanOrEqual(390)
    }
    await page.screenshot({ path: info.outputPath('story-read-only-phone.png') })
  } finally {
    await f.pool.query('UPDATE sites SET archived_at=now() WHERE id=$1', [f.siteId])
    f.client.release()
    await f.pool.end()
  }
})
