import { test, expect } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { sawsoFixture } from './fixtures/sawso.ts'
import { signIn } from './helpers.ts'

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
      await expect(page.getByRole('heading', { name: 'Opening the ' + part + ' preview…', exact: true })).toBeVisible()
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
