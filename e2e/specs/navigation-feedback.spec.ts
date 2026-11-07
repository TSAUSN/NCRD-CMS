import { expect, test } from '@playwright/test'
import { signIn } from './helpers.ts'

test('shows navigation progress before a pending response and clears it when the new screen opens', async ({
  page,
}, info) => {
  await signIn(page, 'root@example.test')
  for (const width of [1440, 1024]) {
    await page.setViewportSize({ width, height: 900 })
    const link = page.getByRole('main').getByRole('link', { name: 'Demo site', exact: true })
    const href = await link.getAttribute('href')
    expect(href).toMatch(/^\/sites\/[a-f0-9-]+$/)
    const destination = new URL(href!, page.url()).pathname
    const bar = page.locator('#cms-navigation-progress')
    await expect(bar).toBeHidden()
    await page.evaluate(() => {
      document.addEventListener(
        'click',
        () => {
          const start = performance.now()
          const element = document.getElementById('cms-navigation-progress')!
          function check() {
            if (element.hidden) return
            // Record the first animation frame with a visible progress bar.
            requestAnimationFrame(() => {
              element.dataset.proofPaintMs = String(performance.now() - start)
            })
          }
          new MutationObserver(check).observe(element, { attributeFilter: ['hidden'] })
        },
        { capture: true, once: true },
      )
    })
    let release = () => {}
    const response = new Promise<void>(resolve => {
      release = resolve
    })
    let arrived = () => {}
    const pending = new Promise<void>(resolve => {
      arrived = resolve
    })
    const matches = (url: URL) => url.pathname === destination
    await page.route(matches, async route => {
      arrived()
      await response
      await route.continue()
    })
    try {
      await link.click()
      await pending
      await expect(bar).toBeVisible()
      await expect(bar).toHaveAttribute('data-proof-paint-ms', /\d/)
      const ms = Number(await bar.getAttribute('data-proof-paint-ms'))
      await info.attach('progress-' + width + '-ms', { body: String(ms), contentType: 'text/plain' })
      await info.attach('pending-' + width, { body: await page.screenshot(), contentType: 'image/png' })
      release()
      await expect(page.getByRole('heading', { level: 1 })).toContainText('Demo site')
      await expect(bar).toBeHidden()
      await info.attach('ready-' + width, { body: await page.screenshot(), contentType: 'image/png' })
    } finally {
      release()
      await page.unroute(matches)
    }
    if (width !== 1024) await page.goto('/')
  }
})
