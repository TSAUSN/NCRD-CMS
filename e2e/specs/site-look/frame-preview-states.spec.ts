import { test, expect, type Page } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { sawsoFixture } from '../fixtures/sawso.ts'
import { signIn } from '../helpers.ts'

async function observeHeaderPreviewFrames(page: Page) {
  await page.addInitScript(() => {
    if (window !== window.top) return
    const opened = new WeakSet<Element>()
    let count = 0
    new MutationObserver(changes => {
      for (const change of changes)
        for (const node of change.addedNodes)
          if (node instanceof HTMLIFrameElement && node.title.endsWith('Header preview') && !opened.has(node)) {
            opened.add(node)
            document.documentElement.dataset.testHeaderPreviewFrames = String(++count)
          }
    }).observe(document, { subtree: true, childList: true })
  })
  return page.locator('html')
}

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
    const frames = await observeHeaderPreviewFrames(page)
    let failInlinePreview = true
    await page.route(
      url => url.pathname.startsWith('/__cms/canvas/') && url.searchParams.get('visit') === '1',
      async route => {
        // Keep both inline attempts unavailable. The standalone fallback and
        // the later manual retry still go through the real preview endpoint.
        if (!failInlinePreview) return route.continue()
        await route.fulfill({ status: 503, body: 'Temporary preview error' })
      },
    )
    await page.goto('/sites/' + f.siteId + '/header')
    await expect(page.getByRole('heading', { name: 'Header & menu', level: 1 })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Add to menu', exact: true })).toBeEnabled()
    await expect(
      page.getByText('The inline preview hasn’t opened. Your changes are still here.', { exact: true }),
    ).toBeVisible({ timeout: 20000 })
    await expect(frames).toHaveAttribute('data-test-header-preview-frames', '2')
    failInlinePreview = false
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

test('Header & menu can ask a loaded preview to repeat its size after missing the first announcement', async ({
  page,
}) => {
  const f = await sawsoFixture(true, true)
  try {
    await page.addInitScript(() => {
      if (window === window.top) {
        // Ignore early announcements until the same frame acknowledges a size request.
        const requested = new Set<MessageEvent['source']>()
        window.addEventListener(
          'message',
          event => {
            if (event.data === 'test:frame-size-requested') requested.add(event.source)
            if (event.data?.type === 'cms:frame-size' && !requested.has(event.source)) event.stopImmediatePropagation()
          },
          true,
        )
      } else {
        window.addEventListener('message', event => {
          if (event.source === window.parent && event.data?.type === 'cms:request-frame-size')
            window.parent.postMessage('test:frame-size-requested', event.origin)
        })
      }
    })
    await signIn(page, 'root@example.test')
    await page.goto('/sites/' + f.siteId + '/header')
    await expect(page.frameLocator('iframe[title="Header preview"]').locator('header')).toBeVisible()
    await expect(page.getByText('Opening preview…', { exact: true })).toHaveCount(0)
  } finally {
    await f.pool.query('UPDATE sites SET archived_at=now() WHERE id=$1', [f.siteId])
    f.client.release()
    await f.pool.end()
  }
})

test('Header & menu reopens an unresponsive frame once without asking for another ticket', async ({ page }) => {
  const f = await sawsoFixture(true, true)
  try {
    await signIn(page, 'root@example.test')
    const frames = await observeHeaderPreviewFrames(page)
    let blockedFirst = false,
      tickets = 0
    const ticketUrls = new Set<string>()
    await page.route('**/api/sites/*/global-elements/preview', async route => {
      tickets++
      await route.continue()
    })
    await page.route(
      url => url.pathname.startsWith('/__cms/canvas/') && url.searchParams.get('visit') === '1',
      async route => {
        ticketUrls.add(route.request().url())
        if (blockedFirst) return route.continue()
        blockedFirst = true
        await route.fulfill({
          status: 200,
          contentType: 'text/html',
          body: '<html><body>Unverified preview</body></html>',
        })
      },
    )
    await page.goto('/sites/' + f.siteId + '/header')
    await expect(page.frameLocator('iframe[title="Header preview"]').locator('header')).toBeVisible({ timeout: 14000 })
    await expect(page.getByText('Opening preview…', { exact: true })).toHaveCount(0)
    await expect(page.locator('iframe[title="Loading Header preview"]')).toHaveCount(0)
    await expect(frames).toHaveAttribute('data-test-header-preview-frames', '2')
    expect(blockedFirst).toBe(true)
    expect(ticketUrls.size).toBe(1)
    expect(tickets).toBe(1)
  } finally {
    await f.pool.query('UPDATE sites SET archived_at=now() WHERE id=$1', [f.siteId])
    f.client.release()
    await f.pool.end()
  }
})

test('an unfinished preview document can recover before its load event', async ({ page }) => {
  const f = await sawsoFixture(true, true)
  try {
    await signIn(page, 'root@example.test')
    const frames = await observeHeaderPreviewFrames(page)
    const canvasAddresses = new Set<string>()
    let heldScript = false
    let firstDocument = true
    let releaseScript: () => void = () => {}
    const scriptGate = new Promise<void>(resolve => {
      releaseScript = resolve
    })
    await page.route('**/__cms-test-hold-preview-load.js', async route => {
      heldScript = true
      await scriptGate
      await route.abort().catch(() => {})
    })
    await page.route(
      url => url.pathname.startsWith('/__cms/canvas/') && url.searchParams.get('visit') === '1',
      async route => {
        canvasAddresses.add(route.request().url())
        if (!firstDocument) return route.continue()
        firstDocument = false
        await route.fulfill({
          status: 200,
          contentType: 'text/html',
          body: '<!doctype html><script src="/__cms-test-hold-preview-load.js"></script>',
        })
      },
    )
    try {
      await page.goto('/sites/' + f.siteId + '/header', { waitUntil: 'domcontentloaded' })
      await expect.poll(() => heldScript).toBe(true)
      await expect(frames).toHaveAttribute('data-test-header-preview-frames', '1')
      await expect(page.frameLocator('iframe[title="Header preview"]').locator('header')).toBeVisible({
        timeout: 14000,
      })
      await expect(frames).toHaveAttribute('data-test-header-preview-frames', '2')
      await expect(page.getByRole('button', { name: 'Try preview again', exact: true })).toHaveCount(0)
      expect(canvasAddresses.size).toBe(1)
    } finally {
      releaseScript()
    }
  } finally {
    await f.pool.query("UPDATE sites SET status='archived',archived_at=now() WHERE id=$1", [f.siteId])
    f.client.release()
    await f.pool.end()
  }
})
