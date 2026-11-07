import { test, expect, type Locator, type Page } from '@playwright/test'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { sawsoFixture } from './fixtures/sawso.ts'
import { signIn } from './helpers.ts'

async function inspectFocus(page: Page, dialog: Locator, name: string, engine: string) {
  const folder = resolve('../.r8-progress/dialog-focus/' + engine)
  await mkdir(folder, { recursive: true })
  const records = []
  for (const width of [1440, 1024]) {
    await page.setViewportSize({ width, height: 1000 })
    await page.keyboard.press('Tab')
    const controls = dialog.locator('input:not([type="hidden"]),select,textarea,button,a[href]')
    for (let i = 0; i < (await controls.count()); i++) {
      const control = controls.nth(i)
      if (!(await control.isVisible()) || !(await control.isEnabled())) continue
      await control.scrollIntoViewIfNeeded()
      await control.focus()
      const fit = await control.evaluate(node => {
        const own = node.getBoundingClientRect()
        const target = own.width <= 2 || getComputedStyle(node).opacity === '0' ? (node.closest('label') ?? node) : node
        const box = target.getBoundingClientRect(),
          css = getComputedStyle(target)
        const extent =
          css.outlineStyle === 'none' ? 0 : Math.max(0, parseFloat(css.outlineWidth) + parseFloat(css.outlineOffset))
        const clips = []
        for (let parent = target.parentElement; parent; parent = parent.parentElement) {
          const style = getComputedStyle(parent)
          if (/auto|scroll|hidden|clip/.test(style.overflowX)) {
            const clip = parent.getBoundingClientRect()
            clips.push({
              left: clip.left + parent.clientLeft,
              right: clip.left + parent.clientLeft + parent.clientWidth,
              top: clip.top + parent.clientTop,
              bottom: clip.top + parent.clientTop + parent.clientHeight,
            })
          }
          // A showModal dialog paints in the top layer; application ancestors
          // outside it cannot clip it, even when it extends over the sidebar.
          if (parent instanceof HTMLDialogElement) break
        }
        return {
          focused: document.activeElement === node,
          label: node.getAttribute('aria-label') || node.getAttribute('id') || node.textContent?.trim(),
          left: box.left - extent,
          right: box.right + extent,
          top: box.top - extent,
          bottom: box.bottom + extent,
          clips,
        }
      })
      expect(fit.focused).toBe(true)
      for (const clip of fit.clips) {
        expect(fit.left, name + ' ' + fit.label + ' left ring').toBeGreaterThanOrEqual(clip.left - 0.5)
        expect(fit.right, name + ' ' + fit.label + ' right ring').toBeLessThanOrEqual(clip.right + 0.5)
        expect(fit.top, name + ' ' + fit.label + ' top ring').toBeGreaterThanOrEqual(clip.top - 0.5)
        expect(fit.bottom, name + ' ' + fit.label + ' bottom ring').toBeLessThanOrEqual(clip.bottom + 0.5)
      }
      const file = name + '-' + width + '-' + String(i).padStart(2, '0') + '.png'
      await page.screenshot({ path: resolve(folder, file), animations: 'disabled' })
      records.push({ width, file, ...fit })
    }
  }
  await writeFile(resolve(folder, name + '.json'), JSON.stringify(records, null, 2))
}

test('scrolling New page, publish review, archive confirmation and media picker keep every focused control ring inside clipping boundaries', async ({
  page,
}, info) => {
  test.setTimeout(120000)
  const f = await sawsoFixture(true, true)
  try {
    await signIn(page, 'root@example.test')
    await page.goto('/sites/' + f.siteId + '/pages')
    await page.getByRole('button', { name: 'New page', exact: true }).click()
    const creator = page.getByRole('dialog', { name: 'New page', exact: true })
    await creator.getByRole('button', { name: 'Change', exact: true }).click()
    await creator.getByText('A page design', { exact: true }).click()
    await inspectFocus(page, creator, 'new-page', info.project.name)
    await creator.getByText('A copy of a page', { exact: true }).click()
    await inspectFocus(page, creator, 'new-page-copy', info.project.name)
    await creator.getByText('A link to another website', { exact: true }).click()
    await inspectFocus(page, creator, 'new-page-link', info.project.name)
    await creator.getByText('A blank page', { exact: true }).click()
    await creator.getByRole('button', { name: 'Cancel', exact: true }).click()
    const id = (await f.pool.query("SELECT id FROM pages WHERE site_id=$1 AND slug='ways-we-help'", [f.siteId])).rows[0]
      .id
    await page.goto('/pages/' + id)
    await page.getByRole('button', { name: 'Publish', exact: true }).click()
    const review = page.getByRole('dialog', { name: 'Publish this page', exact: true })
    await expect(review).toBeVisible()
    await inspectFocus(page, review, 'publish-review', info.project.name)
    await review.getByRole('button', { name: 'Cancel', exact: true }).click()
    await page.getByRole('button', { name: 'More page actions', exact: true }).click()
    await page.getByRole('button', { name: 'Page settings', exact: true }).click()
    await page.getByRole('button', { name: 'Archive page', exact: true }).click()
    const archive = page.getByRole('alertdialog', { name: 'Archive this page?', exact: true })
    await expect(archive).toBeVisible()
    await inspectFocus(page, archive, 'archive-confirm', info.project.name)
    await archive.getByRole('button', { name: 'Cancel', exact: true }).click()
    const asset = {
      id: randomUUID(),
      revision: 1,
      siteId: f.siteId,
      scope: 'site',
      objectKey: 'focus-fixture',
      name: 'Focus review image.png',
      altText: 'Designed sample image',
      decorative: false,
      focal: null,
      width: 1600,
      height: 1067,
      bytes: 248000,
      mimeType: 'image/png',
      status: 'ready',
      folder: '',
      attribution: '',
      source: '',
      tags: [],
      variants: { original: true, thumbnail: true, card: true, wide: true },
      previewUrl: '/cms-samples/r8-landscape.png',
      deliveryUrl: '/cms-samples/r8-landscape.png',
      usedOnItems: 0,
      usedInVersions: 0,
      createdAt: '2026-11-03T12:00:00Z',
      deletedAt: null,
    }
    await page.route(/\/api\/sites\/[^/]+\/media\?/, route =>
      route.fulfill({
        json: {
          assets: [asset],
          total: 1,
          page: 1,
          pageSize: 48,
          pageCount: 1,
          facets: {
            folders: [],
            tags: [],
            scopes: { site: 1, shared: 0 },
            statuses: { ready: 1, processing: 0, failed: 0, deleted: 0 },
          },
        },
      }),
    )
    await page.getByText('Search visibility & sharing', { exact: true }).click()
    await page.getByRole('button', { name: /^(Choose|Change) sharing image$/ }).click()
    const picker = page.getByRole('dialog', { name: 'Choose from the media library', exact: true })
    await expect(picker.getByRole('option')).toHaveCount(1)
    await picker.getByRole('option').first().click()
    await expect(picker.getByLabel('Image description', { exact: true })).toBeVisible()
    await inspectFocus(page, picker, 'media-picker-selected', info.project.name)
    await picker.getByRole('button', { name: 'Upload', exact: true }).click()
    await inspectFocus(page, picker, 'media-picker-upload', info.project.name)
    await picker.getByRole('button', { name: 'Close media library', exact: true }).click()
  } finally {
    await f.pool.query('UPDATE sites SET archived_at=now() WHERE id=$1', [f.siteId])
    f.client.release()
    await f.pool.end()
  }
})
