import { test, expect } from '@playwright/test'
import { mkdir, readFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { processMediaBytes } from '../../apps/worker/src/media.ts'
import { createFilesystemMediaStore, defaultMediaRoot } from '../../packages/platform/src/local/index.ts'
import { resolve } from 'node:path'
import { siteLookFixture } from './fixtures/r8-site-look.ts'
import { signIn } from './helpers.ts'
test('image details leave explains library saves, keeps invalid and failed work, and resumes only after saving', async ({
  page,
}, info) => {
  test.setTimeout(120000)
  const f = await siteLookFixture(),
    folder = resolve('../.r8-progress/round3/media-leave/' + info.project.name)
  await mkdir(folder, { recursive: true })
  let release = () => {},
    native = 0
  page.on('dialog', async dialog => {
    native++
    await dialog.dismiss()
  })
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
    const before = (await f.pool.query('SELECT * FROM media WHERE id=$1', [f.picture])).rows[0]!,
      pages = (
        await f.pool.query('SELECT id,draft_version_id,published_version_id FROM pages WHERE site_id=$1 ORDER BY id', [
          f.site,
        ])
      ).rows
    const c = await f.pool.connect()
    let destination = ''
    try {
      await c.query('BEGIN')
      await c.query(
        "SELECT set_config('app.user_id',(SELECT id::text FROM app_users WHERE email='root@example.test'),true)",
      )
      destination = (
        await c.query('SELECT app.create_page($1,$2,$3) AS id', [f.site, 'media-destination', '[Media destination]'])
      ).rows[0]!.id
      await c.query('COMMIT')
    } finally {
      c.release()
    }
    const base = '/sites/' + f.site + '/media',
      details = page.getByRole('dialog', { name: 'Image details', exact: true }),
      leave = page.getByRole('alertdialog', { name: 'Before you leave', exact: true }),
      description = details.getByLabel('Description for people who can’t see it'),
      search = page.getByRole('dialog', { name: 'Search or jump to', exact: true })
    const capture = async (name: string) => {
        for (const width of [1440, 1024]) {
          await page.setViewportSize({ width, height: 900 })
          expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
          await page.screenshot({ path: resolve(folder, name + '-' + width + '.png') })
        }
      },
      open = async () => {
        await page.goto(base)
        await page.getByRole('button').filter({ hasText: 'Local demonstration logo.png' }).click()
        await expect(details).toBeVisible()
      },
      attempt = async () => {
        await page.keyboard.press('Control+k')
        await search.getByRole('combobox').fill('[Media destination]')
        await search.getByRole('option').filter({ hasText: '[Media destination]' }).click()
        await expect(leave).toBeVisible()
      }
    await signIn(page, 'editor@example.test')
    await open()
    await description.fill('[Unsaved description]')
    await details.getByRole('button', { name: 'Close Image details', exact: true }).click()
    await expect(leave).toContainText('updates the Media library immediately')
    await capture('close-choices')
    await leave.getByRole('button', { name: 'Keep editing', exact: true }).click()
    await expect(description).toHaveValue('[Unsaved description]')
    await details.getByRole('tab', { name: 'Used on', exact: true }).click()
    await expect(leave).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(description).toHaveValue('[Unsaved description]')
    await details.getByRole('tab', { name: 'Used on', exact: true }).click()
    await leave.getByRole('button', { name: 'Discard changes', exact: true }).click()
    await expect(details.getByRole('tab', { name: 'Used on', exact: true })).toHaveAttribute('aria-selected', 'true')
    expect((await f.pool.query('SELECT * FROM media WHERE id=$1', [f.picture])).rows[0]).toEqual(before)
    await details.getByRole('tab', { name: 'Details', exact: true }).click()
    await description.fill('')
    await attempt()
    await leave.getByRole('button', { name: 'Save and leave', exact: true }).click()
    await expect(leave.getByRole('alert')).toHaveText('Add a description or mark the image as decorative.')
    await capture('validation-refused')
    await leave.getByRole('button', { name: 'Keep editing', exact: true }).click()
    await description.fill('[Saved image description]')
    let fail = true
    await page.route('**/api/media/assets/' + f.picture, async route => {
      if (fail && route.request().method() === 'PATCH') {
        fail = false
        await route.abort('failed')
      } else await route.continue()
    })
    await attempt()
    await leave.getByRole('button', { name: 'Save and leave', exact: true }).click()
    await expect(leave.getByRole('alert')).toContainText('could not be confirmed')
    await capture('save-refused')
    await leave.getByRole('button', { name: 'Keep editing', exact: true }).click()
    await expect(description).toHaveValue('[Saved image description]')
    expect((await f.pool.query('SELECT * FROM media WHERE id=$1', [f.picture])).rows[0]).toEqual(before)
    const gate = new Promise<void>(resolve => {
      release = resolve
    })
    let waiting = false
    await page.route('**/api/media/assets/' + f.picture, async route => {
      if (!waiting && route.request().method() === 'PATCH') {
        waiting = true
        await gate
      }
      await route.fallback()
    })
    await attempt()
    await leave.getByRole('button', { name: 'Save and leave', exact: true }).click()
    await expect(leave.getByRole('status')).toHaveText('Saving your changes before leaving…')
    await capture('saving-before-leaving')
    expect(new URL(page.url()).pathname).toBe(base)
    release()
    await expect(page).toHaveURL(new RegExp('/pages/' + destination + '$'))
    const saved = (await f.pool.query('SELECT * FROM media WHERE id=$1', [f.picture])).rows[0]!
    expect(saved.alt_text).toBe('[Saved image description]')
    expect(Number(saved.revision)).toBe(Number(before.revision) + 1)
    expect(saved.object_key).toBe(before.object_key)
    expect(saved.content_hash).toBe(before.content_hash)
    expect(
      (
        await f.pool.query(
          'SELECT id,draft_version_id,published_version_id FROM pages WHERE site_id=$1 AND id<>$2 ORDER BY id',
          [f.site, destination],
        )
      ).rows,
    ).toEqual(pages)
    expect(native).toBe(0)
  } finally {
    release()
    await f.pool.query('UPDATE sites SET archived_at=now() WHERE id=$1', [f.site])
    await f.pool.end()
    for (const key of objects) await store.remove(key)
  }
})
