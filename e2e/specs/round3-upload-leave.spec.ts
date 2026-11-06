import { test, expect, type Page } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { siteLookFixture } from './fixtures/r8-site-look.ts'
import { signIn } from './helpers.ts'
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
)

test('unfinished image uploads use local leave choices and a confirmed library save without changing page drafts', async ({
  page,
}, info) => {
  test.setTimeout(120000)
  const f = await siteLookFixture(),
    folder = resolve('../.r8-progress/round3/media-upload-leave/' + info.project.name)
  let release = () => {}
  const capture = async (name: string) => {
    for (const width of [1440, 1024]) {
      await page.setViewportSize({ width, height: 950 })
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      await page.screenshot({ path: resolve(folder, name + '-' + width + '.png'), animations: 'disabled' })
    }
  }
  const count = async () =>
    (await f.pool.query('SELECT count(*)::int n FROM app.media_upload_intents WHERE site_id=$1', [f.site])).rows[0]!.n
  try {
    await mkdir(folder, { recursive: true })
    const pages = (
        await f.pool.query('SELECT id,draft_version_id,published_version_id FROM pages WHERE site_id=$1 ORDER BY id', [
          f.site,
        ])
      ).rows,
      before = (await f.pool.query('SELECT * FROM media WHERE site_id=$1 ORDER BY id', [f.site])).rows
    await signIn(page, 'editor@example.test')
    await page.goto('/sites/' + f.site + '/media')
    const upload = page.getByRole('region', { name: 'Upload an image', exact: true }),
      leave = page.getByRole('alertdialog', { name: 'Before you leave', exact: true }),
      description = upload.getByLabel('Image description', { exact: true })
    const open = () => page.getByRole('button', { name: 'Upload images', exact: true }).click(),
      choose = async (name: string) => {
        await upload
          .getByLabel('Choose an image to upload', { exact: true })
          .setInputFiles({ name, mimeType: 'image/png', buffer: png })
      },
      close = () => upload.getByRole('button', { name: 'Close upload panel', exact: true }).click()
    await open()
    await close()
    await expect(upload).toHaveCount(0)
    await expect(leave).toHaveCount(0)
    await open()
    await choose('discarded-local.png')
    await description.fill('[Unsent image description]')
    await capture('edited')
    await close()
    await expect(leave).toContainText('Image upload')
    await expect(leave).toContainText('An upload adds a file')
    await capture('leave')
    await leave.getByRole('button', { name: 'Keep editing', exact: true }).click()
    await expect(description).toHaveValue('[Unsent image description]')
    await page.getByRole('button', { name: 'Close upload', exact: true }).click()
    await leave.getByRole('button', { name: 'Discard changes', exact: true }).click()
    await expect(upload).toHaveCount(0)
    expect(await count()).toBe(0)
    await open()
    await choose('saved-local.png')
    await close()
    await leave.getByRole('button', { name: 'Save and leave', exact: true }).click()
    await expect(leave.getByRole('alert')).toContainText('Describe the image')
    await capture('invalid')
    expect(await count()).toBe(0)
    await leave.getByRole('button', { name: 'Keep editing', exact: true }).click()
    await description.fill('[Saved upload description]')
    const endpoint = '**/api/sites/' + f.site + '/media/uploads'
    await page.route(endpoint, route =>
      route.fulfill({ status: 503, json: { error: { message: 'The local upload is unavailable.' } } }),
    )
    await close()
    await leave.getByRole('button', { name: 'Save and leave', exact: true }).click()
    await expect(leave.getByRole('alert')).toContainText('local upload is unavailable')
    await capture('save-error')
    await leave.getByRole('button', { name: 'Keep editing', exact: true }).click()
    await expect(description).toHaveValue('[Saved upload description]')
    expect(await count()).toBe(0)
    await page.unroute(endpoint)
    // A real accepted PUT, delayed only to inspect the pending UI.
    const gate = new Promise<void>(resolve => {
      release = resolve
    })
    await page.route('**/api/media/uploads/*', async route => {
      if (route.request().method() === 'PUT') await gate
      await route.continue()
    })
    const received = page.waitForResponse(
      response => response.request().method() === 'POST' && new URL(response.url()).pathname.endsWith('/media/uploads'),
    )
    await close()
    await leave.getByRole('button', { name: 'Save and leave', exact: true }).click()
    await expect(leave.getByRole('status')).toContainText('Saving your changes before leaving')
    await expect(leave.getByRole('button', { name: 'Keep editing', exact: true })).toBeDisabled()
    await capture('saving')
    const intent = (await (await received).json()).intentId
    release()
    await expect(upload).toHaveCount(0)
    await expect(leave).toHaveCount(0)
    expect(await count()).toBe(1)
    const saved = (await f.pool.query('SELECT * FROM app.media_upload_intents WHERE id=$1', [intent])).rows[0]!
    expect(saved.alt_text).toBe('[Saved upload description]')
    expect(saved.status).toBe('uploaded')
    expect(Number(saved.received_bytes)).toBe(png.length)
    await page.unroute('**/api/media/uploads/*')
    // A late ready result may select its image, but must retain a newer unsent file.
    await open()
    await choose('newer-unsent.png')
    await description.fill('[Newer unsent description]')
    const library = await (await page.request.get('/api/sites/' + f.site + '/media')).json(),
      asset = library.assets.find((item: { id: string }) => item.id === f.picture)
    expect(asset).toBeTruthy()
    await page.route('**/api/media/uploads/' + intent + '/status', route =>
      route.fulfill({
        json: { intentId: intent, status: 'ready', originalName: 'saved-local.png', failureCode: null, asset },
      }),
    )
    await expect(page.getByRole('status').filter({ hasText: 'saved-local.png is ready in Media.' })).toBeVisible({
      timeout: 10000,
    })
    await expect(description).toHaveValue('[Newer unsent description]')
    await expect(upload).toContainText('newer-unsent.png')
    await capture('late-ready')
    await close()
    await leave.getByRole('button', { name: 'Discard changes', exact: true }).click()
    expect(await count()).toBe(1)
    // Nested picker dismissal saves only the upload, never a replacement or page.
    await page.locator('.media-asset-open').filter({ hasText: 'Local demonstration logo.png' }).click()
    const details = page.getByRole('dialog', { name: 'Image details', exact: true })
    await open()
    await expect(details).toHaveCount(0)
    await expect(upload).toBeVisible()
    await capture('open-from-details')
    await close()
    await page.locator('.media-asset-open').filter({ hasText: 'Local demonstration logo.png' }).click()
    await details.getByRole('button', { name: 'Replace image…', exact: true }).click()
    const picker = page.getByRole('dialog', { name: 'Choose from the media library', exact: true })
    await picker.getByRole('button', { name: 'Upload', exact: true }).click()
    await choose('picker-unsent.png')
    await description.fill('[Picker upload description]')
    await picker.getByRole('button', { name: 'Close media library', exact: true }).click()
    await leave.getByRole('button', { name: 'Keep editing', exact: true }).click()
    await expect(description).toHaveValue('[Picker upload description]')
    await capture('picker-kept')
    await page.keyboard.press('Escape')
    await leave.getByRole('button', { name: 'Discard changes', exact: true }).click()
    await expect(picker).toHaveCount(0)
    expect(await count()).toBe(1)
    await details.getByRole('button', { name: 'Replace image…', exact: true }).click()
    await picker.getByRole('button', { name: 'Upload', exact: true }).click()
    await choose('picker-saved.png')
    await description.fill('[Saved picker description]')
    await picker.getByRole('button', { name: 'Cancel', exact: true }).click()
    await leave.getByRole('button', { name: 'Save and leave', exact: true }).click()
    await expect(picker).toHaveCount(0)
    expect(await count()).toBe(2)
    await expect(page.getByRole('dialog', { name: 'Replace image in saved drafts', exact: true })).toHaveCount(0)
    expect((await f.pool.query('SELECT * FROM media WHERE site_id=$1 ORDER BY id', [f.site])).rows).toEqual(before)
    expect(
      (
        await f.pool.query('SELECT id,draft_version_id,published_version_id FROM pages WHERE site_id=$1 ORDER BY id', [
          f.site,
        ])
      ).rows,
    ).toEqual(pages)
  } finally {
    release()
    await f.pool.query('UPDATE sites SET archived_at=now() WHERE id=$1', [f.site])
    await f.pool.end()
  }
})
