import { expect, test } from '@playwright/test'
import { fetchPublic, signIn, STAGING_ORIGIN } from './helpers.ts'

async function openNavigation(page: import('@playwright/test').Page, email = 'editor@example.test') {
  await signIn(page, email)
  await page.getByRole('main').getByRole('link', { name: 'Demo site', exact: true }).click()
  await expect(page).toHaveURL(/\/sites\/[0-9a-f-]+$/)
  // Historical links remain usable. New menu editing is covered on the real
  // site canvas in r8-site-look; this keeps the old route's security and draft
  // compatibility contract intact without restoring it to the main rail.
  await page.goto(new URL(page.url()).pathname + '/navigation')
  if ((page.viewportSize()?.width ?? 1280) <= 960) {
    await page.getByRole('button', { name: 'Open navigation', exact: true }).click()
  }
  if (email === 'root@example.test')
    await expect(
      page
        .getByRole('navigation', { name: 'Sections of the CMS' })
        .getByRole('link', { name: 'Site look', exact: true }),
    ).toHaveAttribute('aria-current', 'page')
  else
    await expect(
      page
        .getByRole('navigation', { name: 'Sections of the CMS' })
        .getByRole('link', { name: 'Site look', exact: true }),
    ).toHaveCount(0)
  if ((page.viewportSize()?.width ?? 1280) <= 960)
    await page.getByRole('button', { name: 'Close navigation', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Navigation', exact: true })).toBeVisible()
}

test.describe.serial('legacy menu route compatibility', () => {
  test('edits a private draft, previews it, and publishes it deliberately', async ({ page }) => {
    await openNavigation(page)

    const label = page.getByRole('textbox', { name: 'Menu label for A page served by cms-v2' })
    await expect(label).toBeVisible()
    await label.fill('Start here')
    await expect(
      page.getByRole('navigation', { name: 'Preview of the draft navigation' }).getByText('Start here'),
    ).toBeVisible()
    await expect(page.getByText('Saved changes are not live yet')).toBeVisible()

    const before = await fetchPublic('/')
    expect(before.body).toContain('A page served by cms-v2')
    expect(before.body).not.toContain('Start here')

    await page.getByRole('button', { name: 'Save draft' }).click()
    await expect(page.getByText('Navigation draft saved. Visitors still see the published menu.')).toBeVisible()
    const afterSave = await fetchPublic('/')
    expect(afterSave.body).not.toContain('Start here')

    await page.getByRole('button', { name: 'Publish navigation' }).click()
    await expect(page.getByText('Navigation published. The live site now uses this menu.')).toBeVisible()
    await expect.poll(async () => (await fetchPublic('/')).body).toContain('Start here')
    await expect(page.getByText('Matches the live site')).toBeVisible()

    // The authoring preview cannot be the polished side of a bait-and-switch:
    // the real JavaScript-free site owns the same baseline header treatment.
    await page.goto(STAGING_ORIGIN)
    const header = page.locator('.cms-site-header')
    await expect(header).toBeVisible()
    expect(await header.evaluate(element => getComputedStyle(element).borderTopStyle)).toBe('solid')
    expect(
      await page
        .locator('.cms-nav-list')
        .first()
        .evaluate(element => getComputedStyle(element).listStyleType),
    ).toBe('none')
  })

  test('adds, reorders, nests, hides, and removes menu items without touching pages', async ({ page }) => {
    await openNavigation(page)

    await page.getByRole('button', { name: 'Add an internal or external link' }).click()
    await page.getByLabel('Link label').fill('Give')
    await page.getByLabel('Destination').fill('https://www.salvationarmyusa.org/')
    await page.getByRole('button', { name: 'Add link', exact: true }).click()
    await expect(page.getByRole('textbox', { name: 'Menu label for Give' })).toBeVisible()

    await page.getByRole('button', { name: 'Make Give a submenu item' }).click()
    await expect(page.locator('.navigation-children .navigation-row-copy input')).toHaveValue('Give')
    await page.locator('.navigation-children .navigation-visible input').uncheck()
    await expect(
      page.getByRole('navigation', { name: 'Preview of the draft navigation' }).getByText('Give'),
    ).toHaveCount(0)
    await page.getByRole('button', { name: 'Move Give out of submenu' }).click()
    const rootLabels = page.locator('.navigation-list > li > .navigation-row .navigation-row-copy input')
    const values = () => rootLabels.evaluateAll(inputs => inputs.map(input => (input as HTMLInputElement).value))
    const beforeMove = await values()
    await page.getByRole('button', { name: 'Move Give up' }).click()
    const afterMove = await values()
    expect(afterMove.indexOf('Give')).toBe(beforeMove.indexOf('Give') - 1)
    await page.getByRole('button', { name: 'Remove Give from navigation' }).click()
    await expect(page.getByRole('textbox', { name: 'Menu label for Give' })).toHaveCount(0)

    // Removing a menu item is not page deletion or unpublishing.
    await page.getByRole('link', { name: 'Pages', exact: true }).click()
    await expect(page.getByRole('link', { name: 'A page served by cms-v2', exact: true })).toBeVisible()
  })

  test('refuses unsafe links at the server boundary and preserves the draft', async ({ page }) => {
    await openNavigation(page)
    await page.getByRole('button', { name: 'Add an internal or external link' }).click()
    await page.getByLabel('Link label').fill('Unsafe')
    await page.getByLabel('Destination').fill('javascript:alert(1)')
    await page.getByRole('button', { name: 'Add link', exact: true }).click()
    await page.getByRole('button', { name: 'Save draft' }).click()
    await expect(page.locator('.notice-error')).toContainText('Use an internal path or an https URL')
    await expect(page.getByRole('textbox', { name: 'Menu label for Unsafe' })).toHaveValue('Unsafe')
  })

  test('a contributor gets an inspectable, read-only navigation', async ({ page }) => {
    await openNavigation(page, 'contributor@example.test')
    await expect(
      page.getByText('You can inspect this menu. An editor or site administrator can change it.'),
    ).toBeVisible()
    await expect(page.getByRole('button', { name: 'Save draft' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Publish navigation' })).toHaveCount(0)
    await expect(page.locator('.navigation-row-copy input').first()).toBeDisabled()
  })

  test('keeps the complete workspace usable at tablet width', async ({ page }) => {
    await page.setViewportSize({ width: 900, height: 1100 })
    await openNavigation(page)
    await expect(page.getByRole('heading', { name: 'Header navigation' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Preview', exact: true })).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    const preview = page.locator('.navigation-preview')
    const outline = page.locator('.navigation-outline')
    expect((await preview.boundingBox())!.y).toBeGreaterThan((await outline.boundingBox())!.y)
  })
})
