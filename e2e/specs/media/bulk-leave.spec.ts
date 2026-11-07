import { test, expect } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { siteLookFixture } from '../fixtures/r8-site-look.ts'
import { signIn } from '../helpers.ts'

test('bulk image organization preserves typed targets and waits for an exact normal library save before leaving', async ({
  page,
}, info) => {
  test.setTimeout(120000)
  const f = await siteLookFixture(),
    folder = resolve('../.r8-progress/round3/media-bulk-leave/' + info.project.name)
  let release = () => {}
  const rows = async () => (await f.pool.query('SELECT * FROM media WHERE site_id=$1 ORDER BY id', [f.site])).rows
  const capture = async (name: string) => {
    for (const width of [1440, 1024]) {
      await page.setViewportSize({ width, height: 950 })
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      await page.screenshot({ path: resolve(folder, name + '-' + width + '.png'), animations: 'disabled' })
    }
  }
  try {
    await mkdir(folder, { recursive: true })
    const before = await rows(),
      pages = (
        await f.pool.query('SELECT id,draft_version_id,published_version_id FROM pages WHERE site_id=$1 ORDER BY id', [
          f.site,
        ])
      ).rows,
      address = '/sites/' + f.site + '/media'
    await signIn(page, 'editor@example.test')
    await page.goto(address)
    const images = page.getByRole('list', { name: 'Images', exact: true }),
      bulk = page.getByRole('region', { name: 'Bulk media actions', exact: true }),
      leave = page.getByRole('alertdialog', { name: 'Before you leave', exact: true }),
      path = bulk.getByRole('textbox', { name: 'Move to folder', exact: true }),
      tags = bulk.getByRole('textbox', { name: 'Add tags', exact: true }),
      select = () => page.getByRole('button', { name: 'Select this page', exact: true }).click(),
      clear = () => bulk.getByRole('button', { name: 'Clear selection', exact: true }).click()
    await expect(page.locator('section.media-library')).toHaveAttribute('aria-busy', 'false')
    await select()
    await path.fill('Campaigns/Local')
    await tags.fill('local, approved')
    await capture('edited')
    await clear()
    await expect(leave).toContainText('Selected image organization')
    await capture('leave')
    await leave.getByRole('button', { name: 'Keep editing', exact: true }).click()
    await expect(path).toHaveValue('Campaigns/Local')
    await expect(images.getByRole('checkbox').first()).toBeChecked()
    expect(await rows()).toEqual(before)
    await images.getByRole('checkbox', { name: 'Select Local demonstration logo.png', exact: true }).click()
    await expect(leave).toBeVisible()
    await leave.getByRole('button', { name: 'Keep editing', exact: true }).click()
    await expect(
      images.getByRole('checkbox', { name: 'Select Local demonstration logo.png', exact: true }),
    ).toBeChecked()
    await clear()
    await leave.getByRole('button', { name: 'Discard changes', exact: true }).click()
    await expect(bulk).toHaveCount(0)
    expect(await rows()).toEqual(before)
    await select()
    await expect(path).toHaveValue('')
    await path.fill('Campaigns/Local')
    await tags.fill('local, approved')
    await page.getByRole('searchbox', { name: 'Search all images', exact: true }).fill('no-match')
    await expect(leave).toBeVisible()
    await leave.getByRole('button', { name: 'Keep editing', exact: true }).click()
    await expect(path).toHaveValue('Campaigns/Local')
    await expect(images.getByRole('listitem')).toHaveCount(2)
    const endpoint = '**/api/sites/' + f.site + '/media/bulk'
    await page.route(endpoint, route =>
      route.fulfill({ status: 503, json: { error: { message: 'The local organization service is unavailable.' } } }),
    )
    await clear()
    await leave.getByRole('button', { name: 'Save and leave', exact: true }).click()
    await expect(leave.getByRole('alert')).toContainText('local organization service is unavailable')
    await capture('save-error')
    await leave.getByRole('button', { name: 'Keep editing', exact: true }).click()
    await expect(tags).toHaveValue('local, approved')
    expect(await rows()).toEqual(before)
    await page.unroute(endpoint)
    // The normal metadata API advances one selected revision in another editing context.
    const library = await (await page.request.get('/api/sites/' + f.site + '/media')).json(),
      asset = library.assets.find((item: { id: string }) => item.id === f.picture),
      concurrent = await page.request.patch('/api/media/assets/' + f.picture, {
        headers: { origin: new URL(page.url()).origin },
        data: {
          expectedRevision: asset.revision,
          altText: asset.altText,
          decorative: asset.decorative,
          focal: asset.focal,
          folder: asset.folder,
          attribution: '[Concurrent credit]',
          source: asset.source,
          tags: asset.tags,
        },
      })
    expect(concurrent.ok()).toBe(true)
    const advanced = await rows()
    await clear()
    await leave.getByRole('button', { name: 'Save and leave', exact: true }).click()
    await expect(leave.getByRole('alert')).toBeVisible()
    await capture('stale')
    await leave.getByRole('button', { name: 'Keep editing', exact: true }).click()
    await expect(path).toHaveValue('Campaigns/Local')
    expect(await rows()).toEqual(advanced)
    await clear()
    await leave.getByRole('button', { name: 'Discard changes', exact: true }).click()
    await page.getByRole('button', { name: 'Refresh library', exact: true }).click()
    await expect(page.locator('section.media-library')).toHaveAttribute('aria-busy', 'false')
    await select()
    await path.fill('Campaigns/Local')
    await tags.fill('local, approved')
    const gate = new Promise<void>(resolve => {
      release = resolve
    })
    await page.route(endpoint, async route => {
      await gate
      await route.continue()
    })
    await page.getByRole('link', { name: 'Pages', exact: true }).click()
    await leave.getByRole('button', { name: 'Save and leave', exact: true }).click()
    await expect(leave.getByRole('status')).toContainText('Saving your changes before leaving')
    await expect(leave.getByRole('button', { name: 'Keep editing', exact: true })).toBeDisabled()
    await capture('saving')
    expect(new URL(page.url()).pathname).toBe(address)
    release()
    await expect(page).toHaveURL(new RegExp('/sites/' + f.site + '/pages$'))
    await page.unroute(endpoint)
    const saved = await rows()
    for (const row of saved) {
      const old = advanced.find(item => item.id === row.id)!
      expect(row.folder).toBe('Campaigns/Local')
      expect(row.tags).toEqual(expect.arrayContaining(['local', 'approved']))
      expect(Number(row.revision)).toBe(Number(old.revision) + 1)
      for (const key of ['object_key', 'content_hash', 'alt_text', 'decorative', 'attribution', 'source'])
        expect(row[key]).toEqual(old[key])
    }
    await page.goto(address)
    await expect(page.locator('section.media-library')).toHaveAttribute('aria-busy', 'false')
    await select()
    await tags.fill('extra')
    await bulk.getByRole('button', { name: 'Apply organization', exact: true }).click()
    await expect(bulk).toHaveCount(0)
    await capture('saved-library')
    for (const row of await rows()) {
      expect(row.folder).toBe('Campaigns/Local')
      expect(row.tags).toEqual(expect.arrayContaining(['local', 'approved', 'extra']))
      expect(Number(row.revision)).toBe(Number(saved.find(item => item.id === row.id)!.revision) + 1)
    }
    const final = await rows(),
      details = page.getByRole('dialog', { name: 'Image details', exact: true }),
      description = details.getByLabel('Description for people who can’t see it')
    await description.fill('[Unsent image description]')
    await select()
    await expect(leave).toContainText('Image details')
    await capture('other-draft-protected')
    await leave.getByRole('button', { name: 'Keep editing', exact: true }).click()
    await expect(description).toHaveValue('[Unsent image description]')
    expect(await rows()).toEqual(final)
    await select()
    await leave.getByRole('button', { name: 'Discard changes', exact: true }).click()
    await expect(details).toHaveCount(0)
    await expect(path).toHaveValue('')
    await clear()
    expect(await rows()).toEqual(final)
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
