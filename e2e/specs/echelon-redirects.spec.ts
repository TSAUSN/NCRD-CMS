import { test, expect } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { echelonFixture } from './fixtures/echelon.ts'
import { signIn } from './helpers.ts'
import { rawRequest } from './http.ts'
const request = (host: string, path: string, method = 'GET') => rawRequest({ host, path, method })
test.use({ actionTimeout: 15_000 })
test('old chapter addresses redirect only to this site’s published pages and spreadsheet imports are reviewed first', async ({
  page,
}) => {
  test.setTimeout(120_000)
  const f = await echelonFixture(true, true, true),
    folder = resolve('../.r8-progress/echelon/redirects'),
    peoria = f.pages.find(row => row.slug === 'chapters/peoria')!,
    errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  const capture = async (name: string) => {
    for (const width of [1440, 1024]) {
      await page.setViewportSize({ width, height: width === 1440 ? 900 : 768 })
      await page.screenshot({ path: resolve(folder, name + '-' + width + '.png') })
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    }
    await page.setViewportSize({ width: 1440, height: 900 })
  }
  try {
    await mkdir(folder, { recursive: true })
    await signIn(page, 'root@example.test')
    await page.goto('/sites/' + f.site + '/settings')
    await page.getByRole('link', { name: 'Redirects', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'No redirects yet', exact: true })).toBeVisible()
    await capture('empty')
    await page.getByRole('button', { name: 'Add redirect', exact: true }).click()
    let form = page.getByRole('dialog', { name: 'Add redirect', exact: true })
    await form.getByRole('combobox', { name: /^New page/ }).selectOption(peoria.id)
    await form.getByRole('textbox', { name: /^Old address/ }).fill('https://example.test/chapter/peoria')
    await form.getByRole('button', { name: 'Save redirect', exact: true }).click()
    await expect(form.getByRole('alert')).toContainText('old page address')
    await capture('invalid-address')
    await form.getByRole('textbox', { name: /^Old address/ }).fill('/chapter/peoria')
    await form.getByRole('button', { name: 'Save redirect', exact: true }).click()
    await expect(page.getByRole('status')).toContainText('Redirect saved')
    await expect(page.getByRole('table', { name: 'Site redirects', exact: true })).toContainText(
      'Waiting for page publication',
    )
    await capture('waiting')
    expect((await request(f.hostname, '/chapter/peoria')).status).toBe(404)
    await page.goto(
      '/sites/' +
        f.site +
        '/publishing?pages=' +
        f.pages
          .filter(row => ['', 'chapters', 'chapters/peoria'].includes(row.slug))
          .map(row => row.id)
          .join(',') +
        '&siteLook=1&lists=1',
    )
    await page.getByRole('button', { name: /^Publish selected \(\d+\)$/ }).click()
    await page.getByRole('checkbox', { name: /Publish with sample content/ }).check()
    await page.getByRole('button', { name: /^Publish selected \(\d+\)$/ }).click()
    await page.getByRole('alertdialog').getByRole('button', { name: 'Publish selected', exact: true }).click()
    await expect(page.getByRole('status').filter({ hasText: 'Release applied.' })).toBeVisible()
    const old = await request(f.hostname, '/chapter/peoria?utm_source=local&tag=one&tag=two')
    expect(old.status).toBe(308)
    expect(old.headers['location']).toBe('/chapters/peoria?utm_source=local&tag=one&tag=two')
    expect(old.headers['cache-control']).toBe('no-store')
    expect((await request(f.hostname, '/chapter/peoria', 'HEAD')).headers['location']).toBe('/chapters/peoria')
    expect((await request('demo.staging.localhost', '/chapter/peoria')).status).toBe(404)
    await page.goto('/sites/' + f.site + '/redirects')
    await expect(page.getByRole('table', { name: 'Site redirects', exact: true })).toContainText('Ready')
    await capture('ready')
    await page.getByRole('button', { name: 'Import from a spreadsheet', exact: true }).click()
    const importer = page.getByRole('dialog', { name: 'Import redirects from a spreadsheet', exact: true }),
      file = importer.getByLabel('Spreadsheet saved as CSV', { exact: true })
    await file.setInputFiles({
      name: 'redirects.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(
        'Old address,New address\n/old-' + 'chapter-'.repeat(24) + 'finder,/chapters\n/foreign,/not-a-page',
      ),
    })
    await importer.getByRole('button', { name: 'Preview redirects', exact: true }).click()
    await expect(importer.getByRole('table', { name: 'Redirect import preview', exact: true })).toContainText(
      'Choose a page on this site',
    )
    await expect(importer.getByRole('button', { name: /^Import \d+ redirects$/ })).toBeDisabled()
    await capture('import-error')
    await file.setInputFiles({
      name: 'redirects.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(
        'Old address,New address\n/chapter/northtexas,/chapters/north-texas\n/old-finder,/chapters\n/chapter/peoria,/chapters/peoria',
      ),
    })
    await page
      .getByRole('alertdialog', { name: 'Before you leave', exact: true })
      .getByRole('button', { name: 'Discard changes', exact: true })
      .click()
    await importer.getByRole('button', { name: 'Preview redirects', exact: true }).click()
    await expect(importer.getByRole('table', { name: 'Redirect import preview', exact: true })).toContainText('Keep')
    await capture('import-preview')
    await importer.getByRole('button', { name: 'Import 2 redirects', exact: true }).click()
    await expect(page.getByRole('status')).toContainText('2 redirects imported')
    await expect(page.getByRole('table', { name: 'Site redirects', exact: true }).locator('tbody tr')).toHaveCount(3)
    await capture('imported')
    expect((await request(f.hostname, '/chapter/northtexas')).status).toBe(404)
    expect((await request(f.hostname, '/old-finder')).headers['location']).toBe('/chapters')
    await page.getByRole('button', { name: 'Edit /old-finder', exact: true }).click()
    form = page.getByRole('dialog', { name: 'Edit redirect', exact: true })
    await form.getByRole('textbox', { name: /^Old address/ }).fill('/old-finder-renamed')
    await form.getByRole('button', { name: 'Save redirect', exact: true }).click()
    await expect(page.getByRole('status')).toContainText('Redirect saved')
    expect((await request(f.hostname, '/old-finder')).status).toBe(404)
    await page.getByRole('button', { name: 'Remove /old-finder-renamed', exact: true }).click()
    await capture('remove-confirm')
    await page
      .getByRole('alertdialog', { name: 'Remove redirect?', exact: true })
      .getByRole('button', { name: 'Remove redirect', exact: true })
      .click()
    await expect(page.getByRole('status')).toContainText('Redirect removed')
    expect((await request(f.hostname, '/old-finder-renamed')).status).toBe(404)
    expect((await request(f.hostname, '/chapter/peoria')).headers['location']).toBe('/chapters/peoria')
    expect(errors).toEqual([])
  } finally {
    f.client.release()
    await f.pool.end()
  }
})
