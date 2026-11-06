import { test, expect, type Page } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { siteLookFixture } from './fixtures/r8-site-look.ts'
import { signIn } from './helpers.ts'
import { rawRequest } from './http.ts'
async function capture(page: Page, name: string, engine: string) {
  const folder = resolve('../.r8-progress/round3/site-look-consolidation', engine)
  await mkdir(folder, { recursive: true })
  for (const width of [1440, 1024]) {
    await page.setViewportSize({ width, height: 1000 })
    await expect(page.getByText('Updating site preview…', { exact: true })).toHaveCount(0)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: resolve(folder, name + '-' + width + '.png') })
  }
  await page.setViewportSize({ width: 1440, height: 1000 })
}
test('native Site look edits only appearance, previews the saved frame immediately and routes shared-area work to its own screens', async ({
  page,
}, info) => {
  test.setTimeout(120000)
  const f = await siteLookFixture()
  try {
    const before = {
      frame: (await f.pool.query('SELECT * FROM global_elements WHERE site_id=$1 ORDER BY id', [f.site])).rows,
      menu: (await f.pool.query('SELECT * FROM navigations WHERE site_id=$1', [f.site])).rows,
      live: (await rawRequest({ host: f.host, path: '/' })).body,
    }
    await signIn(page, 'root@example.test')
    await page.goto('/sites/' + f.site + '/design')
    const controls = page.getByRole('group', { name: 'Site look controls', exact: true }),
      preview = page.frameLocator('iframe[title="Site look page preview"]')
    await expect(preview.getByRole('heading', { name: 'Welcome', exact: true })).toBeVisible()
    await expect(page.getByRole('complementary', { name: 'Site-wide settings', exact: true })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Header & menu', exact: true })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Footer', exact: true })).toHaveCount(0)
    await expect(controls.getByRole('link', { name: 'Header & menu', exact: true })).toHaveAttribute(
      'href',
      '/sites/' + f.site + '/header',
    )
    await expect(controls.getByRole('link', { name: 'Footer', exact: true })).toHaveAttribute(
      'href',
      '/sites/' + f.site + '/footer',
    )
    await expect(page.getByLabel('Site name', { exact: true })).toHaveCount(0)
    await capture(page, 'appearance', info.project.name)
    await page.getByLabel('Brand', { exact: true }).fill('#123456')
    await expect
      .poll(() =>
        preview
          .locator('html')
          .evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--color-primary').trim()),
      )
      .toBe('#123456')
    await expect(page.getByRole('button', { name: 'Publish site look', exact: true })).toBeDisabled()
    await capture(page, 'unsaved-style', info.project.name)
    const save = page.getByRole('button', { name: 'Save draft', exact: true })
    await save.click()
    await expect(save).not.toHaveAttribute('aria-busy', 'true')
    await expect(save).toBeDisabled()
    await expect
      .poll(
        async () =>
          (
            await f.pool.query(
              "SELECT v.tokens#>>'{colors,primary}' AS color FROM themes h JOIN theme_versions v ON v.id=h.draft_version_id WHERE h.site_id=$1",
              [f.site],
            )
          ).rows[0]!.color,
      )
      .toBe('#123456')
    expect((await f.pool.query('SELECT * FROM global_elements WHERE site_id=$1 ORDER BY id', [f.site])).rows).toEqual(
      before.frame,
    )
    expect((await f.pool.query('SELECT * FROM navigations WHERE site_id=$1', [f.site])).rows).toEqual(before.menu)
    expect((await rawRequest({ host: f.host, path: '/' })).body).toBe(before.live)
    await page.reload()
    await expect(page.getByLabel('Brand', { exact: true })).toHaveValue('#123456')
    await expect(preview.getByRole('heading', { name: 'Welcome', exact: true })).toBeVisible()
    await capture(page, 'saved-style', info.project.name)
  } finally {
    await f.pool.query('UPDATE sites SET archived_at=now() WHERE id=$1', [f.site])
    await f.pool.end()
  }
})
test('native read-only Site look has no shared-area controls or publishing action', async ({ page }, info) => {
  const f = await siteLookFixture()
  try {
    await signIn(page, 'editor@example.test')
    await page.goto('/sites/' + f.site + '/design')
    const controls = page.getByRole('group', { name: 'Site look controls', exact: true })
    await expect(page.frameLocator('iframe[title="Site look page preview"]').locator('h1')).toHaveText('Welcome')
    await expect(controls.getByRole('link', { name: 'Header & menu', exact: true })).toHaveCount(0)
    await expect(controls.getByRole('link', { name: 'Footer', exact: true })).toHaveCount(0)
    await expect(page.getByRole('complementary', { name: 'Site-wide settings', exact: true })).toHaveCount(0)
    await expect(page.getByLabel('Brand', { exact: true })).toBeDisabled()
    await expect(page.getByRole('button', { name: 'Publish site look', exact: true })).toHaveCount(0)
    await capture(page, 'read-only', info.project.name)
  } finally {
    await f.pool.query('UPDATE sites SET archived_at=now() WHERE id=$1', [f.site])
    await f.pool.end()
  }
})
