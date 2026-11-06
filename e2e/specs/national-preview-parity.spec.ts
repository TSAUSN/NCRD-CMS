import { test, expect } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { sawsoFixture } from './fixtures/sawso.ts'
import { signIn } from './helpers.ts'

test('national page previews use the isolated renderer and match the public menu at desktop and phone widths', async ({
  page,
  context,
}, info) => {
  const f = await sawsoFixture(true, true)
  try {
    const home = (await f.pool.query("SELECT id FROM pages WHERE site_id=$1 AND slug=''", [f.siteId])).rows[0]!
    expect(
      Number(
        (await f.pool.query('SELECT count(*) AS count FROM site_file_heads WHERE site_id=$1', [f.siteId])).rows[0]!
          .count,
      ),
    ).toBe(0)
    await signIn(page, 'root@example.test')
    await page.goto('/sites/' + f.siteId + '/publishing')
    const publish = page.getByRole('button', { name: /^Publish selected \(\d+\)$/ })
    await publish.click()
    await page.getByRole('checkbox', { name: /Publish with sample content/ }).check()
    const reason = page.getByRole('textbox', { name: 'Reason for publishing despite these findings' })
    if (await reason.isVisible()) await reason.fill('Verify native national preview and public header parity.')
    await publish.click()
    await page.getByRole('alertdialog').getByRole('button', { name: 'Publish selected', exact: true }).click()
    await expect(page.getByRole('status').filter({ hasText: 'Release applied.' })).toBeVisible()
    await page.goto('/pages/' + home.id)
    const frame = page.frameLocator('iframe[title="Page canvas"]')
    await expect(frame.locator('h1')).toBeVisible()
    expect(
      await page
        .locator('iframe[title="Page canvas"]')
        .evaluate(frame => new URL((frame as HTMLIFrameElement).src).pathname.startsWith('/preview/')),
    ).toBe(true)
    await page.clock.install()
    await page.getByRole('button', { name: 'Preview', exact: true }).click()
    const opened = context.waitForEvent('page')
    await page.getByRole('button', { name: 'Open preview', exact: true }).click()
    const visitor = await opened
    try {
      await expect(visitor.locator('h1')).toBeVisible()
      const origin = `http://${f.hostname}:${process.env['E2E_SITE_PORT'] ?? '3201'}`
      expect(new URL(visitor.url()).origin).toBe(origin)
      expect(new URL(visitor.url()).pathname.startsWith('/__cms/canvas/')).toBe(true)
      const renewal = page.waitForResponse(
        response =>
          response.url().endsWith('/api/pages/' + home.id + '/canvas') &&
          response.request().postDataJSON()?.action === 'renew',
      )
      await page.clock.fastForward(240_001)
      expect((await renewal).ok()).toBe(true)
      const publicPage = await context.newPage()
      try {
        expect((await publicPage.goto(origin + '/'))?.status()).toBe(200)
        await expect(publicPage.locator('h1')).toBeVisible()
        const folder = resolve('../.r8-progress/national-preview-parity', info.project.name)
        await mkdir(folder, { recursive: true })
        for (const width of [1440, 1024, 390]) {
          for (const view of [visitor, publicPage]) {
            await view.setViewportSize({ width, height: 900 })
            await expect(view.locator('header[data-cms-nav-fit]')).toHaveAttribute(
              'data-cms-nav-fit',
              width === 1440 ? 'wide' : 'compact',
            )
            expect(await view.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
          }
          expect(await visitor.locator('header').innerText()).toBe(await publicPage.locator('header').innerText())
          expect(await visitor.locator('header img').getAttribute('alt')).toBe(
            await publicPage.locator('header img').getAttribute('alt'),
          )
          await visitor.screenshot({ path: resolve(folder, 'visitor-' + width + '.png') })
          await publicPage.screenshot({ path: resolve(folder, 'public-' + width + '.png') })
        }
      } finally {
        await publicPage.close()
      }
    } finally {
      await visitor.close()
    }
  } finally {
    await f.pool.query('UPDATE sites SET archived_at=now() WHERE id=$1', [f.siteId])
    f.client.release()
    await f.pool.end()
  }
})
