import { expect, test } from '@playwright/test'
import { sawsoFixture } from './fixtures/sawso.ts'
import { signIn } from './helpers.ts'

function gate() {
  let release = () => {}
  const pending = new Promise<void>(resolve => {
    release = resolve
  })
  return { pending, release }
}

for (const width of [1440, 1024]) {
  test(`Header controls stay usable and the latest preview replaces the old one at ${width}px`, async ({
    page,
  }, info) => {
    const fixture = await sawsoFixture(true, true)
    const first = gate()
    const older = gate()
    try {
      const { client, actor, siteId } = fixture
      await client.query('BEGIN')
      await client.query('SET LOCAL ROLE cms_authenticated_user')
      await client.query("SELECT set_config('app.user_id',$1,true)", [actor])
      const {
        rows: [head],
      } = await client.query('SELECT revision FROM navigations WHERE site_id=$1', [siteId])
      const tree = ['Home', 'About', 'Contact'].map(label => ({
        label,
        visible: true,
        target: { type: 'url', url: '/' + label.toLowerCase() },
      }))
      await client.query("SELECT * FROM app.save_navigation_draft($1,$2,$3::jsonb,'manual')", [
        siteId,
        head.revision,
        JSON.stringify(tree),
      ])
      await client.query('COMMIT')
      await page.setViewportSize({ width, height: 1000 })
      await signIn(page, 'root@example.test')
      const matches = (url: URL) => url.pathname === `/api/sites/${siteId}/global-elements/preview`
      let calls = 0
      await page.route(matches, async route => {
        const number = ++calls
        if (number === 1) await first.pending
        if (number === 2) await older.pending
        try {
          await route.continue()
        } catch (error) {
          if (number !== 2) throw error
        }
      })
      const incoming = () =>
        page.waitForRequest(request => request.method() === 'POST' && matches(new URL(request.url())))
      const firstRequest = incoming()
      await page.goto('/sites/' + siteId + '/header')
      await firstRequest
      const menu = page.getByRole('region', { name: 'Main menu', exact: true })
      const visible = page.locator('iframe[title="Header preview"]')
      const pending = page.getByText('Opening preview…', { exact: true })
      await expect(menu.getByRole('button', { name: 'Add to menu', exact: true })).toBeEnabled()
      await expect(pending).toBeVisible()
      await page.screenshot({ path: info.outputPath('controls-before-preview.png'), animations: 'disabled' })
      first.release()
      await expect(visible).toBeVisible()
      const old = await visible.getAttribute('src')
      expect(old).toMatch(/\/canvas\//)
      const rowOrder = () => menu.locator('li[data-reorder-row] > button:first-of-type').allTextContents()
      async function move(label: string, direction: 'up' | 'down') {
        await menu.getByRole('button', { name: 'Actions for ' + label, exact: true }).click()
        await menu.getByRole('button', { name: 'Move ' + direction, exact: true }).click()
      }
      const secondRequest = incoming()
      await move('Contact', 'up')
      const stale = await secondRequest
      await expect.poll(rowOrder).toEqual(['Home', 'Contact', 'About'])
      await expect(visible).toHaveAttribute('src', old!)
      await expect(page.getByText('Updating header preview…', { exact: true })).toBeVisible()
      await expect(pending).toHaveCount(0)
      await page.screenshot({ path: info.outputPath('old-preview-while-reordering.png'), animations: 'disabled' })
      const canceled = page.waitForEvent('requestfailed', { predicate: request => request === stale })
      const thirdRequest = incoming()
      await move('Home', 'down')
      await thirdRequest
      expect((await canceled).failure()?.errorText).toMatch(/abort|cancel/i)
      older.release()
      await expect.poll(rowOrder).toEqual(['Contact', 'Home', 'About'])
      await expect(visible).not.toHaveAttribute('src', old!)
      await expect(visible).toBeVisible()
      await expect(pending).toHaveCount(0)
      const links = page
        .frameLocator('iframe[title="Header preview"]')
        .getByRole('navigation', { name: 'Main', exact: true })
        .getByRole('link')
      await expect
        .poll(async () => (await links.allTextContents()).map(text => text.trim()))
        .toEqual(['Contact', 'Home', 'About'])
      await page.screenshot({ path: info.outputPath('latest-preview-ready.png'), animations: 'disabled' })
    } finally {
      first.release()
      older.release()
      await fixture.client.query('ROLLBACK').catch(() => {})
      await fixture.pool.query('UPDATE sites SET archived_at=now() WHERE id=$1', [fixture.siteId])
      fixture.client.release()
      await fixture.pool.end()
    }
  })
}
