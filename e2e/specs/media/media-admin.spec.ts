import { test, expect } from '@playwright/test'
import { mkdir, readFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { processMediaBytes } from '../../../apps/worker/src/media.ts'
import { createFilesystemMediaStore, defaultMediaRoot } from '../../../packages/platform/src/local/index.ts'
import { resolve } from 'node:path'
import { siteLookFixture } from '../fixtures/r8-site-look.ts'
import { signIn } from '../helpers.ts'

test('native Media keeps the grid beside details and guards image, filter and search changes', async ({
  page,
}, info) => {
  test.setTimeout(120000)
  const f = await siteLookFixture(),
    folder = resolve('../.r8-progress/round3/media-admin/' + info.project.name)
  const details = page.getByRole('dialog', { name: 'Image details', exact: true }),
    leave = page.getByRole('alertdialog', { name: 'Before you leave', exact: true }),
    description = details.getByLabel('Description for people who can’t see it'),
    images = page.getByRole('list', { name: 'Images', exact: true })
  const capture = async (name: string) => {
    await expect(page.locator('section.media-library')).toHaveAttribute('aria-busy', 'false')
    await expect
      .poll(() =>
        images
          .locator('img')
          .evaluateAll(nodes =>
            nodes.every(node => (node as HTMLImageElement).complete && (node as HTMLImageElement).naturalWidth > 0),
          ),
      )
      .toBe(true)
    for (const width of [1440, 1024]) {
      await page.setViewportSize({ width, height: width === 1440 ? 900 : 768 })
      await page.evaluate(() => document.fonts.ready)
      await page.evaluate(() => window.scrollTo({ top: 0, left: 0, behavior: 'instant' }))
      await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0)
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      await page.screenshot({ path: resolve(folder, name + '-' + width + '.png'), animations: 'disabled' })
    }
  }
  const store = createFilesystemMediaStore(defaultMediaRoot()),
    objects: string[] = []
  try {
    await mkdir(folder, { recursive: true })
    const bytes = await readFile(resolve('../apps/admin/public/cms-samples/r8-landscape.png'))
    for (const id of [f.picture, f.compactPicture]) {
      const processed = await processMediaBytes(
          {
            intentId: randomUUID(),
            siteId: f.site,
            uploadObjectKey: 'media-panel/input.png',
            finalKeyPrefix: 'media-panel/' + id + '/',
            declaredMime: 'image/png',
            declaredBytes: bytes.length,
          },
          bytes,
        ),
        original = processed.original
      for (const file of [original, ...processed.variants]) {
        await store.put(file.objectKey, file.data, file.mimeType)
        objects.push(file.objectKey)
      }
      await f.pool.query(
        'UPDATE media SET object_key=$2,content_hash=$3,width=$4,height=$5,bytes=$6,mime_type=$7 WHERE id=$1',
        [id, original.objectKey, original.sha256, original.width, original.height, original.bytes, original.mimeType],
      )
      await f.pool.query('DELETE FROM media_variants WHERE media_id=$1', [id])
      for (const file of processed.variants)
        await f.pool.query(
          'INSERT INTO media_variants(media_id,kind,object_key,content_hash,width,height,bytes,mime_type) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
          [id, file.kind, file.objectKey, file.sha256, file.width, file.height, file.bytes, file.mimeType],
        )
    }
    const longName = '[Description review] Long imported photograph filename with original identifier.png'
    await f.pool.query('UPDATE media SET original_name=$2 WHERE id=$1', [f.picture, longName])
    const before = (
        await f.pool.query('SELECT * FROM media WHERE id=ANY($1::uuid[]) ORDER BY id', [[f.picture, f.compactPicture]])
      ).rows,
      pages = (
        await f.pool.query('SELECT id,draft_version_id,published_version_id FROM pages WHERE site_id=$1 ORDER BY id', [
          f.site,
        ])
      ).rows
    await signIn(page, 'editor@example.test')
    await page.goto('/sites/' + f.site + '/media')
    await expect(images.getByRole('listitem')).toHaveCount(2)
    await expect(page.getByRole('main').getByRole('link', { name: 'Back', exact: true })).toHaveCount(0)
    await capture('library')
    const first = images.getByRole('button').filter({ hasText: longName }),
      second = images.getByRole('button').filter({ hasText: 'Local compact logo.png' })
    await first.click()
    await expect(details).toHaveAttribute('aria-modal', 'false')
    await expect(description).toHaveValue('Local demonstration mark')
    for (const width of [1440, 1024]) {
      await page.setViewportSize({ width, height: width === 1440 ? 900 : 768 })
      await description.focus()
      const grid = await images.boundingBox(),
        panel = await details.boundingBox()
      expect(panel!.x).toBeGreaterThan(grid!.x + grid!.width)
      await expect
        .poll(() =>
          details.locator('[class*="detailPanelBody"]').evaluate(node => node.scrollWidth <= node.clientWidth + 1),
        )
        .toBe(true)
    }
    await capture('details')
    await page.setViewportSize({ width: 390, height: 900 })
    await details.scrollIntoViewIfNeeded()
    await expect.poll(() => details.evaluate(node => node.getBoundingClientRect().height > innerHeight / 2)).toBe(true)
    await expect(description).toBeInViewport()
    await page.screenshot({ path: resolve(folder, 'phone-details-390.png'), animations: 'disabled' })
    await page.setViewportSize({ width: 1440, height: 900 })
    await description.fill('[Unsaved Media description]')
    await second.click()
    await expect(leave).toBeVisible()
    await capture('switch-choices')
    await leave.getByRole('button', { name: 'Keep editing', exact: true }).click()
    await expect(description).toHaveValue('[Unsaved Media description]')
    await expect(details.getByRole('heading', { name: longName, exact: true })).toBeVisible()
    await page.getByText('More filters', { exact: true }).click()
    await page.getByRole('combobox', { name: 'Sort', exact: true }).selectOption('name-asc')
    await expect(leave).toBeVisible()
    await leave.getByRole('button', { name: 'Discard changes', exact: true }).click()
    await expect(details).toHaveCount(0)
    await expect(images.getByRole('listitem')).toHaveCount(2)
    await second.click()
    await description.fill('[Saved Media description]')
    await details.getByRole('button', { name: 'Save image details', exact: true }).click()
    await expect(details.getByRole('button', { name: 'Save image details', exact: true })).toBeDisabled()
    await expect(description).toHaveValue('[Saved Media description]')
    await capture('saved-details')
    await description.fill('[Saved before Media search]')
    await page.getByRole('searchbox', { name: 'Search all images', exact: true }).fill('no-image-can-match')
    await expect(leave).toBeVisible()
    await leave.getByRole('button', { name: 'Save and leave', exact: true }).click()
    await expect(details).toHaveCount(0)
    await expect(page.getByRole('heading', { name: 'No images match these filters', exact: true })).toBeVisible()
    await capture('empty-search')
    const saved = (await f.pool.query('SELECT * FROM media WHERE id=$1', [f.compactPicture])).rows[0]!,
      old = before.find(row => row.id === f.compactPicture)!
    expect(saved.alt_text).toBe('[Saved before Media search]')
    expect(Number(saved.revision)).toBe(Number(old.revision) + 2)
    expect(saved.object_key).toBe(old.object_key)
    expect((await f.pool.query('SELECT * FROM media WHERE id=$1', [f.picture])).rows[0]).toEqual(
      before.find(row => row.id === f.picture),
    )
    expect(
      (
        await f.pool.query('SELECT id,draft_version_id,published_version_id FROM pages WHERE site_id=$1 ORDER BY id', [
          f.site,
        ])
      ).rows,
    ).toEqual(pages)
    await page.getByRole('button', { name: 'Clear filters', exact: true }).click()
    await expect(images.getByRole('listitem')).toHaveCount(2)
    let fail = true
    await page.route('**/api/sites/' + f.site + '/media?**', async route => {
      if (fail) {
        fail = false
        await route.fulfill({ status: 503, json: { error: 'The local library is temporarily unavailable.' } })
      } else await route.continue()
    })
    await page
      .getByRole('group', { name: 'Filter images by status', exact: true })
      .getByRole('button', { name: 'Ready', exact: true })
      .click()
    await expect(page.getByRole('alert').filter({ hasText: 'temporarily unavailable' })).toBeVisible()
    await capture('recoverable-error')
    await page.getByRole('button', { name: 'Refresh library', exact: true }).click()
    await expect(page.getByRole('alert').filter({ hasText: 'temporarily unavailable' })).toHaveCount(0)
    await expect(images.getByRole('listitem')).toHaveCount(2)
  } finally {
    await f.pool.query('UPDATE sites SET archived_at=now() WHERE id=$1', [f.site])
    await f.pool.end()
    for (const key of objects) await store.remove(key)
  }
})
