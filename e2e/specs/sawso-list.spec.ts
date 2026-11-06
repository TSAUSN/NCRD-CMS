import { test, expect } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { sawsoFixture } from './fixtures/sawso.ts'
import { signIn } from './helpers.ts'
test('the local Stories list contains all34 imported titles without loading source photos', async ({ page }) => {
  const f = await sawsoFixture(),
    remote: string[] = []
  page.on('request', request => {
    const host = new URL(request.url()).hostname
    if (!['127.0.0.1', 'localhost'].includes(host) && !host.endsWith('.localhost')) remote.push(request.url())
  })
  try {
    await signIn(page, 'root@example.test')
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/sites/' + f.siteId + '/content?collection=' + f.collectionId)
    await expect(page.getByRole('heading', { name: 'Stories', exact: true })).toBeVisible()
    await expect(page.getByRole('list', { name: 'Stories items' }).getByRole('listitem')).toHaveCount(34)
    await page
      .getByLabel('Search items', { exact: true })
      .fill('Primary Health Care to Support the Growing Chikankata Community')
    await expect(page.getByRole('list', { name: 'Stories items' }).getByRole('listitem')).toHaveCount(1)
    await expect(
      page.getByRole('button', {
        name: 'Edit Primary Health Care to Support the Growing Chikankata Community',
        exact: true,
      }),
    ).toBeVisible()
    await page.getByLabel('Search items', { exact: true }).fill('')
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    const folder = resolve('../.r8-progress/sawso/list')
    await mkdir(folder, { recursive: true })
    await page.screenshot({ path: resolve(folder, 'stories-1440.png'), fullPage: false })
    expect(remote).toEqual([])
  } finally {
    await f.pool.query('UPDATE sites SET archived_at=now() WHERE id=$1', [f.siteId])
    f.client.release()
    await f.pool.end()
  }
})
