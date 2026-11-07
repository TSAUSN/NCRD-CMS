import { test, expect } from '@playwright/test'
import { mkdir, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
test('retained report photos load locally with exact descriptions and stored focus points', async ({ page }, info) => {
  test.skip(process.env.CMS_CHECK_RETAINED_REPORT_MEDIA !== '1', 'Explicit read-only retained-demo check.')
  test.setTimeout(120000)
  const source = process.env.CMS_REPORT_SOURCE_MANIFEST
  if (!source) throw new Error('Give the approved local report photo manifest.')
  const photos = JSON.parse(await readFile(source, 'utf8')) as {
      key: string
      name: string
      altText: string
      focal: { x: number; y: number }
    }[],
    saved = JSON.parse(await readFile(resolve('../.r8-progress/round3/report-media/imported.json'), 'utf8')) as {
      key: string
      mediaId: string
    }[],
    folder = resolve('../.r8-progress/round3/report-media/actual-pages/' + info.project.name),
    base = 'http://localhost:3000',
    site = '95976d54-9dfc-41d3-83e1-93f1d070a76f'
  await mkdir(folder, { recursive: true })
  await page.goto(base + '/sign-in')
  await page.getByLabel('Email address', { exact: true }).fill('admin@example.test')
  await page.getByRole('button', { name: 'Continue to local CMS', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Home', exact: true })).toBeVisible()
  for (const width of [1440, 1024]) {
    await page.setViewportSize({ width, height: 1000 })
    await page.goto(base + '/sites/' + site + '/media')
    await page.getByLabel('Search all images', { exact: true }).fill('Annual Report 2026 photo')
    await expect(page.getByRole('status').filter({ hasText: /^15 results$/ })).toBeVisible()
    await expect(page.getByRole('list', { name: 'Images', exact: true }).getByRole('listitem')).toHaveCount(15)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: resolve(folder, 'report-photos-' + width + '.png'), fullPage: true })
  }
  for (const photo of photos) {
    const record = saved.find(row => row.key === photo.key)
    expect(record).toBeTruthy()
    const row = page.locator('#media-' + record!.mediaId)
    await row.scrollIntoViewIfNeeded()
    await expect
      .poll(() =>
        row
          .locator('img')
          .evaluate(img => (img as HTMLImageElement).complete && (img as HTMLImageElement).naturalWidth > 0),
      )
      .toBe(true)
    await row.getByRole('button').click()
    await expect(page.getByLabel('Description for people who can’t see it', { exact: true })).toHaveValue(photo.altText)
    await expect(
      page.getByText(Math.round(photo.focal.x * 100) + '% across · ' + Math.round(photo.focal.y * 100) + '% down', {
        exact: true,
      }),
    ).toBeVisible()
    for (const label of ['Card', 'Phone', 'Wide'])
      await expect(page.getByRole('img', { name: label + ' crop preview', exact: true })).toBeVisible()
    const original = await page.request.get(base + '/media/' + record!.mediaId + '/original')
    expect(original.status()).toBe(200)
    expect(original.headers()['content-type']).toMatch(/^image\//)
    if (photo === photos[0])
      for (const width of [1440, 1024]) {
        await page.setViewportSize({ width, height: 1000 })
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
        await page.screenshot({ path: resolve(folder, 'report-photo-focus-' + width + '.png'), fullPage: true })
      }
    await page.keyboard.press('Escape')
    await expect(page.getByLabel('Description for people who can’t see it', { exact: true })).toHaveCount(0)
  }
})
