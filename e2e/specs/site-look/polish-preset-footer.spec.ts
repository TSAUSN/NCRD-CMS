import { test, expect } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { siteLookFixture } from '../fixtures/r8-site-look.ts'
import { signIn } from '../helpers.ts'

test('preset Footer keeps every grouped field and saves only its private footer', async ({ page }, info) => {
  const f = await siteLookFixture(),
    folder = resolve('../.r8-progress/round3/polish-footer/preset-' + info.project.name)
  try {
    await mkdir(folder, { recursive: true })
    const heads = async () =>
        (
          await f.pool.query(
            'SELECT kind,draft_version_id,published_version_id FROM global_elements WHERE site_id=$1 ORDER BY kind',
            [f.site],
          )
        ).rows,
      before = await heads(),
      pages = (
        await f.pool.query('SELECT id,draft_version_id,published_version_id FROM pages WHERE site_id=$1 ORDER BY id', [
          f.site,
        ])
      ).rows
    await signIn(page, 'root@example.test')
    await page.goto('/sites/' + f.site + '/footer')
    await expect(page.getByRole('heading', { name: 'Footer', level: 1, exact: true })).toBeVisible()
    for (const title of ['Logo and name', 'Text', 'Links'])
      await expect(page.getByRole('region', { name: title, exact: true })).toBeVisible()
    await page.getByLabel('Displayed site name', { exact: true }).fill('[Reviewed preset footer]')
    await page.getByLabel('Short description', { exact: true }).fill('[Reviewed footer introduction]')
    await page.getByText('Layout and visibility', { exact: true }).click()
    await expect(page.getByLabel('Show the shared Salvation Army foundation', { exact: true })).toBeDisabled()
    await page.getByRole('switch', { name: 'Show the footer', exact: true }).uncheck()
    await page.getByRole('switch', { name: 'Show the footer', exact: true }).check()
    await page.getByLabel('Layout', { exact: true }).selectOption('columns')
    await page.getByText('Contact details', { exact: true }).click()
    await page.getByRole('button', { name: 'Add contact details', exact: true }).click()
    await page.getByLabel('Contact heading', { exact: true }).fill('[Contact heading]')
    await page.getByLabel('Contact phone', { exact: true }).fill('555-0100')
    await page.getByLabel('Contact email', { exact: true }).fill('footer@example.test')
    await page.getByLabel('Contact address', { exact: true }).fill('[Local contact address]')
    await page.getByText('Link groups', { exact: true }).click()
    await page.getByRole('button', { name: 'Add link group', exact: true }).click()
    await page.getByText('Explore', { exact: true }).click()
    await page.getByLabel('Group 1 heading', { exact: true }).fill('[Reviewed links]')
    await page.getByRole('button', { name: 'Add link', exact: true }).click()
    await page.getByText('New link', { exact: true }).click()
    await page.getByLabel('Link 1 label', { exact: true }).fill('[Reviewed page]')
    await page.getByLabel('Link 1 destination type', { exact: true }).selectOption('page')
    await page.getByLabel('Link 1 page', { exact: true }).selectOption(f.pages[1]!)
    await page.getByText('Legal and accessibility links', { exact: true }).click()
    await page.getByLabel('Copyright line', { exact: true }).fill('[Reviewed copyright]')
    await page.getByRole('button', { name: 'Add privacy link', exact: true }).click()
    await page.getByText('Privacy', { exact: true }).click()
    await page.getByLabel('Privacy URL', { exact: true }).fill('/privacy')
    for (const width of [1440, 1024]) {
      await page.setViewportSize({ width, height: 1000 })
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      await page.screenshot({ path: resolve(folder, 'all-fields-' + width + '.png'), animations: 'disabled' })
    }
    await page.getByRole('button', { name: 'Save draft', exact: true }).click()
    await expect(page.getByRole('status').filter({ hasText: 'Footer draft saved.' })).toBeVisible()
    const after = await heads()
    expect(after.find(row => row.kind === 'header')).toEqual(before.find(row => row.kind === 'header'))
    expect(after.find(row => row.kind === 'footer').published_version_id).toBe(
      before.find(row => row.kind === 'footer').published_version_id,
    )
    expect(
      (
        await f.pool.query('SELECT id,draft_version_id,published_version_id FROM pages WHERE site_id=$1 ORDER BY id', [
          f.site,
        ])
      ).rows,
    ).toEqual(pages)
    const saved = (
      await f.pool.query(
        "SELECT v.content FROM global_elements g JOIN global_element_versions v ON v.id=g.draft_version_id WHERE g.site_id=$1 AND g.kind='footer'",
        [f.site],
      )
    ).rows[0]!.content
    expect(saved.brand.siteName).toBe('[Reviewed preset footer]')
    expect(saved.brand.blurb).toBe('[Reviewed footer introduction]')
    expect(saved.contact).toMatchObject({
      phone: '555-0100',
      email: 'footer@example.test',
      address: '[Local contact address]',
    })
    expect(saved.groups[0].links[0].target).toEqual({ type: 'page', page_id: f.pages[1] })
    expect(saved.legal.privacy.target).toEqual({ type: 'url', url: '/privacy' })
    await page.reload()
    await expect(page.getByLabel('Displayed site name', { exact: true })).toHaveValue('[Reviewed preset footer]')
  } finally {
    await f.pool.query('UPDATE sites SET archived_at=now() WHERE id=$1', [f.site])
    await f.pool.end()
  }
})
