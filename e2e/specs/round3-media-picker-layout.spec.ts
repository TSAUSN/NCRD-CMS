import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { sawsoFixture } from './fixtures/sawso.ts'
import { signIn } from './helpers.ts'

test('a full media picker keeps thumbnail cards and scrolls inside its dialog at both editor widths', async ({
  page,
}, info) => {
  const f = await sawsoFixture(true, true)
  try {
    const assets = Array.from({ length: 48 }, (_, i) => ({
      id: randomUUID(),
      revision: 1,
      siteId: f.siteId,
      scope: 'site',
      objectKey: 'sample/' + i,
      name: 'Reviewed photo ' + (i + 1) + '.jpg',
      altText: '[Reviewed sample photo]',
      decorative: false,
      focal: null,
      width: 1600,
      height: 1067,
      bytes: 248000,
      mimeType: 'image/jpeg',
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
    }))
    await page.route(/\/api\/sites\/[^/]+\/media\?/, route =>
      route.fulfill({
        json: {
          assets,
          total: assets.length,
          page: 1,
          pageSize: 48,
          pageCount: 1,
          facets: {
            folders: [],
            tags: [],
            scopes: { site: 48, shared: 0 },
            statuses: { ready: 48, processing: 0, failed: 0, deleted: 0 },
          },
        },
      }),
    )
    await signIn(page, 'root@example.test')
    await page.goto('/sites/' + f.siteId + '/header')
    await page.getByRole('tab', { name: 'Logo', exact: true }).click()
    await page.getByRole('button', { name: 'Replace', exact: true }).click()
    const picker = page.getByRole('dialog', { name: 'Choose from the media library', exact: true }),
      gallery = picker.getByRole('listbox', { name: 'Available images' })
    await expect(picker.getByRole('button', { name: 'Refresh library', exact: true })).toBeEnabled()
    await expect(gallery.getByRole('option')).toHaveCount(48)
    const folder = resolve('../.r8-progress/round3/media-picker-layout/' + info.project.name)
    await mkdir(folder, { recursive: true })
    for (const width of [1440, 1024]) {
      await page.setViewportSize({ width, height: 1000 })
      const visibleImagesDecoded = () =>
        gallery.evaluate(node => {
          const bounds = node.getBoundingClientRect()
          return [...node.querySelectorAll('img')]
            .filter(image => {
              const imageBounds = image.getBoundingClientRect()
              return imageBounds.top < bounds.bottom && imageBounds.bottom > bounds.top
            })
            .every(image => image.complete && image.naturalWidth > 0)
        })
      await expect.poll(visibleImagesDecoded).toBe(true)
      const card = gallery.getByRole('option').first()
      expect((await card.boundingBox())!.height).toBeGreaterThan(100)
      expect((await card.locator('.media-thumb').boundingBox())!.height).toBeGreaterThan(60)
      expect(await gallery.evaluate(node => node.scrollHeight > node.clientHeight)).toBe(true)
      await card.click()
      await expect(card).toHaveAttribute('aria-selected', 'true')
      await expect(picker.getByRole('button', { name: 'Use this logo', exact: true })).toBeEnabled()
      await page.screenshot({ path: resolve(folder, 'selected-' + width + '.png') })
      await gallery.hover()
      const segments = await gallery.evaluate(node => ({
        size: Math.floor(node.clientHeight * 0.8),
        max: node.scrollHeight - node.clientHeight,
      }))
      expect(segments.size).toBeGreaterThan(0)
      for (let top = segments.size; top - segments.size < segments.max; top += segments.size) {
        const previous = await gallery.evaluate(node => node.scrollTop)
        await page.mouse.wheel(0, segments.size)
        await expect.poll(() => gallery.evaluate(node => node.scrollTop)).toBeGreaterThan(previous)
        await expect.poll(visibleImagesDecoded).toBe(true)
      }
      await expect
        .poll(() =>
          gallery
            .locator('img')
            .evaluateAll(images =>
              images.every(
                image => (image as HTMLImageElement).complete && (image as HTMLImageElement).naturalWidth > 0,
              ),
            ),
        )
        .toBe(true)
      await expect(gallery.getByRole('option').last()).toBeInViewport()
      await page.screenshot({ path: resolve(folder, 'scrolled-' + width + '.png') })
      await gallery.evaluate(node => {
        node.scrollTop = 0
      })
    }
    await picker.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(picker).toHaveCount(0)
  } finally {
    f.client.release()
    await f.pool.end()
  }
})
