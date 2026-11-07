import { test, expect } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { siteLookFixture } from '../fixtures/r8-site-look.ts'
import { signIn } from '../helpers.ts'
import { rawRequest } from '../http.ts'

test('native Settings retains its rail beside Redirects and uses saved destinations without publishing unrelated drafts', async ({
  page,
  browser,
}, info) => {
  test.setTimeout(120000)
  const f = await siteLookFixture(),
    folder = resolve('../.r8-progress/round3/settings-admin/' + info.project.name),
    restricted = await browser.newContext()
  try {
    await mkdir(folder, { recursive: true })
    const heads = (
        await f.pool.query('SELECT id,draft_version_id,published_version_id FROM pages WHERE site_id=$1 ORDER BY id', [
          f.site,
        ])
      ).rows,
      base = '/sites/' + f.site,
      errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    await signIn(page, 'root@example.test')
    const capture = async (name: string) => {
      for (const width of [1440, 1024]) {
        await page.setViewportSize({ width, height: 950 })
        await page.evaluate(() => document.fonts.ready)
        await page
          .getByRole('heading', { name: 'Settings', level: 1, exact: true })
          .evaluate(node => node.scrollIntoView({ block: 'start', behavior: 'instant' }))
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
        await page.screenshot({ path: resolve(folder, name + '-' + width + '.png'), animations: 'disabled' })
      }
    }
    for (const [name, path] of [
      ['general', '/settings'],
      ['publishing', '/settings?tab=publishing'],
      ['reviews', '/settings?tab=reviews'],
      ['search', '/settings/search'],
      ['social', '/settings/social'],
      ['advanced', '/settings?tab=advanced'],
    ]) {
      await page.goto(base + path)
      await expect(page.getByRole('navigation', { name: 'Settings tabs', exact: true })).toBeVisible()
      await capture(name!)
    }
    await page.getByRole('link', { name: 'Redirects', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Settings', level: 1, exact: true })).toBeVisible()
    const card = page.getByRole('region', { name: 'Redirects', exact: true }),
      rail = page.getByRole('navigation', { name: 'Settings tabs', exact: true })
    await expect(rail.getByRole('link', { name: 'Redirects', exact: true })).toHaveAttribute('aria-current', 'page')
    await expect(card.getByRole('heading', { name: 'No redirects yet', exact: true })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Settings', exact: true })).toHaveAttribute('aria-current', 'page')
    await capture('redirects-empty')
    for (const width of [1440, 1024]) {
      await page.setViewportSize({ width, height: 950 })
      const left = await rail.boundingBox(),
        right = await card.boundingBox()
      expect(right!.x).toBeGreaterThanOrEqual(left!.x + left!.width)
    }
    await card.getByRole('button', { name: 'Add redirect', exact: true }).click()
    let form = page.getByRole('dialog', { name: 'Add redirect', exact: true })
    await form.getByRole('combobox', { name: /^New page/ }).selectOption(f.pages[1]!)
    await form.getByRole('textbox', { name: /^Old address/ }).fill('https://example.test/old-visit')
    await form.getByRole('button', { name: 'Save redirect', exact: true }).click()
    await expect(form.getByRole('alert')).toContainText('old page address')
    await capture('redirects-invalid')
    await form.getByRole('textbox', { name: /^Old address/ }).fill('/old-visit')
    await form.getByRole('button', { name: 'Save redirect', exact: true }).click()
    await expect(page.getByRole('status')).toContainText('Redirect saved')
    await expect(card.getByRole('table', { name: 'Site redirects', exact: true })).toContainText('Ready')
    await capture('redirects-saved')
    const response = await rawRequest({ host: f.host, path: '/old-visit?from=local', method: 'GET' })
    expect(response.status).toBe(308)
    expect(response.headers['location']).toBe('/visit?from=local')
    await card.getByRole('button', { name: 'Import from a spreadsheet', exact: true }).click()
    const importer = page.getByRole('dialog', { name: 'Import redirects from a spreadsheet', exact: true })
    await importer.getByLabel('Spreadsheet saved as CSV', { exact: true }).setInputFiles({
      name: 'redirects.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from('Old address,New address\n/old-home,/\n/old-visit,/visit'),
    })
    await importer.getByRole('button', { name: 'Preview redirects', exact: true }).click()
    await expect(importer.getByRole('table', { name: 'Redirect import preview', exact: true })).toContainText('Keep')
    await capture('redirects-import')
    await importer.getByRole('button', { name: 'Import 1 redirect', exact: true }).click()
    await expect(page.getByRole('status')).toContainText('1 redirect imported')
    await expect(card.getByRole('table', { name: 'Site redirects', exact: true }).locator('tbody tr')).toHaveCount(2)
    await card.getByRole('button', { name: 'Remove /old-visit', exact: true }).click()
    await capture('redirects-remove')
    await page
      .getByRole('alertdialog', { name: 'Remove redirect?', exact: true })
      .getByRole('button', { name: 'Remove redirect', exact: true })
      .click()
    await expect(page.getByRole('status')).toContainText('Redirect removed')
    expect((await rawRequest({ host: f.host, path: '/old-visit', method: 'GET' })).status).toBe(404)
    expect(
      (
        await f.pool.query('SELECT id,draft_version_id,published_version_id FROM pages WHERE site_id=$1 ORDER BY id', [
          f.site,
        ])
      ).rows,
    ).toEqual(heads)
    const editor = await restricted.newPage()
    await signIn(editor, 'editor@example.test')
    expect((await editor.request.get(base + '/redirects')).status()).toBe(404)
    expect(errors).toEqual([])
  } finally {
    await restricted.close()
    await f.pool.query('UPDATE sites SET archived_at=now() WHERE id=$1', [f.site])
    await f.pool.end()
  }
})
