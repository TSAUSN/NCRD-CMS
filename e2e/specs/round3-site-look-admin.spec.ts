import { test, expect, type Locator } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { siteLookFixture } from './fixtures/r8-site-look.ts'
import { signIn } from './helpers.ts'
import { rawRequest } from './http.ts'

test('native Site look groups starting choices and shared parts while Save and Publish stay together on a private draft', async ({
  page,
}, info) => {
  test.setTimeout(120000)
  const f = await siteLookFixture(),
    folder = resolve('../.r8-progress/round3/site-look-admin/' + info.project.name)
  try {
    await mkdir(folder, { recursive: true })
    const before = {
      pages: (
        await f.pool.query('SELECT id,draft_version_id,published_version_id FROM pages WHERE site_id=$1 ORDER BY id', [
          f.site,
        ])
      ).rows,
      frame: (await f.pool.query('SELECT * FROM global_elements WHERE site_id=$1 ORDER BY kind', [f.site])).rows,
      menu: (await f.pool.query('SELECT * FROM navigations WHERE site_id=$1', [f.site])).rows,
      live: (await rawRequest({ host: f.host, path: '/' })).body,
    }
    await signIn(page, 'root@example.test')
    await page.goto('/sites/' + f.site + '/design')
    const controls = page.getByRole('group', { name: 'Site look controls', exact: true }),
      commands = page.getByRole('region', { name: 'Design publishing status', exact: true }),
      capture = async (name: string, target?: Locator) => {
        for (const width of [1440, 1024]) {
          await page.setViewportSize({ width, height: 1000 })
          await expect(page.getByText('Updating site preview…', { exact: true })).toHaveCount(0)
          if (target) await target.scrollIntoViewIfNeeded()
          await page.evaluate(() => document.fonts.ready)
          expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
          await expect(commands.getByRole('button', { name: 'Save draft', exact: true })).toBeInViewport()
          await expect(commands.getByRole('button', { name: 'Publish site look', exact: true })).toBeInViewport()
          await page.screenshot({ path: resolve(folder, name + '-' + width + '.png'), animations: 'disabled' })
        }
      }
    await expect(page.getByRole('region', { name: 'Starts from', exact: true })).toBeVisible()
    const resize = page.getByRole('separator', { name: 'Resize Site look controls', exact: true })
    await resize.focus()
    await resize.press('End')
    await expect(resize).toHaveAttribute('aria-valuenow', (await resize.getAttribute('aria-valuemax'))!)
    for (const width of [1440, 1024]) {
      await page.setViewportSize({ width, height: 1000 })
      await resize.focus()
      await resize.press('End')
      await expect
        .poll(async () => (await page.getByLabel('Real site preview', { exact: true }).boundingBox())!.width)
        .toBeGreaterThanOrEqual(240)
    }
    await resize.dblclick()
    await expect(resize).toHaveAttribute('aria-valuenow', '400')
    await expect(
      page
        .frameLocator('iframe[title="Site look page preview"]')
        .getByRole('heading', { name: 'Welcome', exact: true }),
    ).toBeVisible()
    await capture('main', page.getByLabel('Brand', { exact: true }))
    await page.getByLabel('Brand', { exact: true }).fill('#12')
    await expect(commands.getByRole('button', { name: 'Save draft', exact: true })).toBeDisabled()
    await capture('invalid', page.getByLabel('Brand', { exact: true }))
    await page.getByLabel('Brand', { exact: true }).fill('#123456')
    await controls.getByRole('button', { name: 'Advanced colours', exact: true }).click()
    await expect(page.getByLabel('On primary', { exact: true })).toBeVisible()
    await capture('advanced', page.getByLabel('On primary', { exact: true }))
    await controls.getByRole('button', { name: 'Advanced colours', exact: true }).click()
    await controls.getByRole('button', { name: 'Use Rounded button shape', exact: true }).click()
    await capture('buttons', controls.getByRole('button', { name: 'Use Rounded button shape', exact: true }))
    await commands.getByRole('button', { name: 'Save draft', exact: true }).click()
    await expect(page.getByRole('status').filter({ hasText: 'Design draft saved.' })).toBeVisible()
    await capture('saved', controls.getByRole('button', { name: 'Use Rounded button shape', exact: true }))
    const related = page.getByRole('region', { name: 'Logo and shared parts', exact: true })
    await expect(related.getByRole('link', { name: 'Header & menu', exact: true })).toHaveAttribute(
      'href',
      '/sites/' + f.site + '/header',
    )
    await expect(related.getByRole('link', { name: 'Footer', exact: true })).toHaveAttribute(
      'href',
      '/sites/' + f.site + '/footer',
    )
    await capture('shared-parts', related)
    await commands.getByRole('button', { name: 'Publish site look', exact: true }).click()
    await expect(page.getByRole('dialog', { name: 'Publish site look', exact: true })).toBeVisible()
    await capture('review')
    await page
      .getByRole('dialog', { name: 'Publish site look', exact: true })
      .getByRole('button', { name: 'Cancel', exact: true })
      .click()
    const tokens = (
      await f.pool.query(
        'SELECT d.tokens AS draft,p.tokens AS published FROM themes h JOIN theme_versions d ON d.id=h.draft_version_id JOIN theme_versions p ON p.id=h.published_version_id WHERE h.site_id=$1',
        [f.site],
      )
    ).rows[0]!
    expect(tokens.draft.colors.primary).toBe('#123456')
    expect(tokens.draft.buttons.radius).toBe('0.5rem')
    expect(tokens.draft).not.toEqual(tokens.published)
    expect((await rawRequest({ host: f.host, path: '/' })).body).toBe(before.live)
    expect(
      (
        await f.pool.query('SELECT id,draft_version_id,published_version_id FROM pages WHERE site_id=$1 ORDER BY id', [
          f.site,
        ])
      ).rows,
    ).toEqual(before.pages)
    expect((await f.pool.query('SELECT * FROM global_elements WHERE site_id=$1 ORDER BY kind', [f.site])).rows).toEqual(
      before.frame,
    )
    expect((await f.pool.query('SELECT * FROM navigations WHERE site_id=$1', [f.site])).rows).toEqual(before.menu)
  } finally {
    await f.pool.query('UPDATE sites SET archived_at=now() WHERE id=$1', [f.site])
    await f.pool.end()
  }
})

test('site editors can inspect Site look without a Fonts link to an administrator-only page', async ({ page }) => {
  const f = await siteLookFixture()
  try {
    await signIn(page, 'editor@example.test')
    await page.goto('/sites/' + f.site + '/design')
    await expect(
      page.getByText('You can inspect this design. A site administrator can change it.', { exact: true }),
    ).toBeVisible()
    await expect(page.getByRole('link', { name: 'Fonts', exact: true })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Use Modern type', exact: true })).toBeDisabled()
    const denied = await page.goto('/sites/' + f.site + '/design/fonts')
    expect(denied?.status()).toBe(404)
    await expect(page.getByRole('heading', { name: '404', exact: true })).toBeVisible()
  } finally {
    await f.pool.end()
  }
})
