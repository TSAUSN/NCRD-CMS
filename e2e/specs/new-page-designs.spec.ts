import { test, expect } from '@playwright/test'
import { sawsoFixture } from './fixtures/sawso.ts'
import { signIn } from './helpers.ts'
test('New page uses a shared design or a copied SAWSO page with its chosen private name and address', async ({
  page,
}) => {
  test.setTimeout(120000)
  const f = await sawsoFixture(true, true)
  try {
    await signIn(page, 'root@example.test')
    await page.goto('/sites/' + f.siteId + '/pages')
    await page.getByRole('button', { name: 'New page', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'New page', exact: true })
    await dialog.getByLabel('Page title', { exact: true }).fill('Community health draft')
    await expect(dialog).toContainText('Web address: /community-health-draft')
    await dialog.getByRole('button', { name: 'Change', exact: true }).click()
    await expect(dialog.getByLabel('Web address', { exact: true })).toHaveValue('community-health-draft')
    await dialog.getByText('A page design', { exact: true }).click()
    await dialog.getByLabel('Page design', { exact: true }).selectOption('resources')
    for (const width of [1440, 1024, 390]) {
      await page.setViewportSize({ width, height: 900 })
      await dialog
        .getByRole('radio', { name: 'A page design Sector page, news page, event and more', exact: true })
        .focus()
      const fit = await dialog.evaluate(node => {
        const bounds = node.getBoundingClientRect(),
          heading = node.querySelector('h2')!.getBoundingClientRect()
        return {
          scrollLeft: node.scrollLeft,
          horizontalOverflow: node.scrollWidth > node.clientWidth,
          headingVisible: heading.left >= bounds.left && heading.right <= bounds.right,
        }
      })
      expect(fit).toEqual({ scrollLeft: 0, horizontalOverflow: false, headingVisible: true })
      await page.screenshot({ path: `../.r8-progress/polish-new-page-${width}.png` })
    }
    await dialog.getByRole('button', { name: 'Create draft', exact: true }).click()
    await expect(page).toHaveURL(/\/pages\/[a-f0-9-]+$/)
    const created = (
      await f.pool.query(
        "SELECT title,slug,published_version_id FROM pages WHERE site_id=$1 AND slug='community-health-draft'",
        [f.siteId],
      )
    ).rows[0]
    expect(created).toEqual({
      title: 'Community health draft',
      slug: 'community-health-draft',
      published_version_id: null,
    })
    await page.goto('/sites/' + f.siteId + '/pages')
    await page.getByRole('button', { name: 'New page', exact: true }).click()
    await dialog.getByLabel('Page title', { exact: true }).fill('Copied help')
    await dialog.getByText('A copy of a page', { exact: true }).click()
    const source = (await f.pool.query("SELECT id FROM pages WHERE site_id=$1 AND slug='ways-we-help'", [f.siteId]))
      .rows[0].id
    await dialog.getByLabel('Page to copy', { exact: true }).selectOption(source)
    await dialog.getByRole('button', { name: 'Create draft', exact: true }).click()
    await expect(page).toHaveURL(/\/pages\/[a-f0-9-]+$/)
    expect(
      (await f.pool.query("SELECT published_version_id FROM pages WHERE site_id=$1 AND slug='copied-help'", [f.siteId]))
        .rows[0].published_version_id,
    ).toBeNull()
  } finally {
    await f.pool.query('UPDATE sites SET archived_at=now() WHERE id=$1', [f.siteId])
    f.client.release()
    await f.pool.end()
  }
})

test('a new blank SAWSO page opens with its site look, a header and labelled sample text', async ({ page }) => {
  const f = await sawsoFixture(true, true)
  try {
    await signIn(page, 'root@example.test')
    await page.goto('/sites/' + f.siteId + '/pages')
    await page.getByRole('button', { name: 'New page', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'New page', exact: true })
    await dialog.getByLabel('Page title', { exact: true }).fill('A useful blank page')
    await dialog.getByText('A blank page', { exact: true }).click()
    await dialog.getByRole('button', { name: 'Create draft', exact: true }).click()
    await expect(page).toHaveURL(/\/pages\/[a-f0-9-]+$/)
    const id = new URL(page.url()).pathname.split('/').at(-1)!
    const saved = (
      await f.pool.query(
        'SELECT p.published_version_id,v.content FROM pages p JOIN page_versions v ON v.id=p.draft_version_id WHERE p.id=$1',
        [id],
      )
    ).rows[0]
    expect(saved.published_version_id).toBeNull()
    expect(saved.content).toHaveLength(2)
    expect(saved.content[1].values.body.length).toBeGreaterThan(0)
    const frame = page.frameLocator('iframe[title="Page canvas"]')
    await expect(frame.getByRole('heading', { name: 'A useful blank page', exact: true })).toBeVisible()
    await expect(frame.locator('[data-cms-section="1"]')).toHaveCount(1)
    for (const width of [1440, 1024]) {
      await page.setViewportSize({ width, height: 1000 })
      await expect(frame.locator('[data-cms-section="1"] [data-cms-slot="body"]')).not.toHaveText('')
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      await page.screenshot({ path: '../.r8-progress/polish-blank-page-' + width + '.png', animations: 'disabled' })
    }
    await page.reload()
    await expect(frame.locator('[data-cms-section="1"]')).toHaveCount(1)
  } finally {
    await f.pool.query('UPDATE sites SET archived_at=now() WHERE id=$1', [f.siteId])
    f.client.release()
    await f.pool.end()
  }
})
