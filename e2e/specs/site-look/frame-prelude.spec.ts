import { expect, test } from '@playwright/test'
import { sawsoFixture } from '../fixtures/sawso.ts'
import { signIn } from '../helpers.ts'

test('Header and Footer show the real preview without waiting for a separate setup script', async ({ page }) => {
  const fixture = await sawsoFixture(true, true)
  let release: () => void = () => {}
  const blocked = new Promise<void>(resolve => {
    release = resolve
  })
  try {
    await signIn(page, 'root@example.test')
    const requests: string[] = []
    await page.route(
      url => url.pathname === '/__cms/editor/prelude.js',
      async route => {
        requests.push(route.request().resourceType())
        await blocked
        await route.continue().catch(() => {})
      },
    )
    for (const part of ['Header', 'Footer'] as const) {
      await page.goto('/sites/' + fixture.siteId + '/' + part.toLowerCase(), { waitUntil: 'domcontentloaded' })
      const frame = page.frameLocator('iframe[title="' + part + ' preview"]')
      await expect(frame.locator(part.toLowerCase())).toBeVisible({ timeout: 9000 })
      await expect(page.getByText('Opening preview…', { exact: true })).toHaveCount(0)
    }
    expect(requests).toEqual([])
  } finally {
    release()
    await fixture.pool.query("UPDATE sites SET status='archived',archived_at=now() WHERE id=$1", [fixture.siteId])
    fixture.client.release()
    await fixture.pool.end()
  }
})
