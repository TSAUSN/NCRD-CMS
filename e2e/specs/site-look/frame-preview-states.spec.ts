import { test, expect } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { sawsoFixture } from '../fixtures/sawso.ts'
import { signIn } from '../helpers.ts'

test('header and footer reserve error wording and retry for a failed preview, then recover to a settled frame', async ({
  page,
}, info) => {
  test.setTimeout(90000)
  const f = await sawsoFixture(true, true)
  try {
    await signIn(page, 'root@example.test')
    const folder = resolve('../.r8-progress/round3/frame-preview-states/' + info.project.name)
    await mkdir(folder, { recursive: true })
    for (const part of ['header', 'footer']) {
      let release: () => void = () => {},
        started = false
      const gate = new Promise<void>(resolve => {
        release = resolve
      })
      await page.route('**/api/sites/*/global-elements/preview', async route => {
        if (!started) {
          started = true
          await gate
          await route.fulfill({ status: 503, body: 'Preview temporarily unavailable.' })
        } else await route.continue()
      })
      await page.goto('/sites/' + f.siteId + '/' + part)
      await expect.poll(() => started).toBe(true)
      await expect(page.getByRole('status').filter({ hasText: /^Opening preview…$/ })).toBeVisible()
      await expect(page.getByText('Your saved choices are safe. Try the preview again.', { exact: true })).toHaveCount(
        0,
      )
      await expect(page.getByRole('button', { name: 'Try preview again', exact: true })).toHaveCount(0)
      release()
      await expect(
        page.getByRole('heading', {
          name: (part === 'header' ? 'Header' : 'Footer') + ' preview unavailable',
          exact: true,
        }),
      ).toBeVisible()
      await page.getByRole('button', { name: 'Try preview again', exact: true }).click()
      const frame = page.frameLocator('iframe[title="' + (part === 'header' ? 'Header' : 'Footer') + ' preview"]')
      await expect(frame.locator(part)).toBeVisible()
      await expect(page.getByText('Opening preview…', { exact: true })).toHaveCount(0)
      for (const width of [1440, 1024]) {
        await page.setViewportSize({ width, height: 1000 })
        await page.screenshot({ path: resolve(folder, part + '-settled-' + width + '.png') })
      }
      await page.unroute('**/api/sites/*/global-elements/preview')
    }
  } finally {
    f.client.release()
    await f.pool.end()
  }
})

test('a stalled inline preview offers a standalone view and can be retried', async ({ page }) => {
  test.setTimeout(60000)
  const f = await sawsoFixture(true, true)
  try {
    await signIn(page, 'root@example.test')
    let failed = false
    await page.route(
      url => url.pathname.startsWith('/__cms/canvas/') && url.searchParams.get('visit') === '1',
      async route => {
        if (failed) return route.continue()
        failed = true
        await route.fulfill({ status: 503, body: 'Temporary preview error' })
      },
    )
    await page.goto('/sites/' + f.siteId + '/header')
    await expect(page.getByRole('heading', { name: 'Header & menu', level: 1 })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Add to menu', exact: true })).toBeEnabled()
    await expect(
      page.getByText('The inline preview hasn’t opened. Your changes are still here.', { exact: true }),
    ).toBeVisible({ timeout: 20000 })
    const fallback = page.getByRole('link', { name: 'Open preview in a new tab', exact: true })
    await expect(fallback).toBeVisible()
    const opened = page.waitForEvent('popup')
    await fallback.click()
    const visitor = await opened
    try {
      await expect(visitor.locator('.cms-frame--header')).toBeVisible()
    } finally {
      await visitor.close()
    }
    await page.getByRole('button', { name: 'Try preview again', exact: true }).click()
    await expect(page.frameLocator('iframe[title="Header preview"]').locator('header')).toBeVisible()
    await expect(fallback).toHaveCount(0)
  } finally {
    await f.pool.query('UPDATE sites SET archived_at=now() WHERE id=$1', [f.siteId])
    f.client.release()
    await f.pool.end()
  }
})
