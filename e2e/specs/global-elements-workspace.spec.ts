import { expect, test, type Page } from '@playwright/test'
import { fetchPublic, signIn, STAGING_ORIGIN } from './helpers.ts'

async function openGlobalElements(page: Page, email = 'editor@example.test') {
  await signIn(page, email)
  await page.getByRole('main').getByRole('link', { name: 'Demo site', exact: true }).click()
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Demo site')
  if ((page.viewportSize()?.width ?? 1280) <= 960) {
    const opener = page.getByRole('button', { name: 'Open navigation' })
    await expect(opener).toBeVisible()
    await opener.click()
    await expect(page.locator('.app')).toHaveAttribute('data-drawer', 'open')
  }
  // The combined Site look workspace owns navigation now; keep this legacy
  // frame-route regression reachable by its existing bookmark.
  const base = new URL(page.url()).pathname
  await page.goto(base + '/global-elements')
  await expect(page.getByRole('heading', { name: 'Header & footer', exact: true })).toBeVisible()
}

test.describe.serial('site-wide header and footer workspace', () => {
  test('previews a private combined draft and publishes the exact public frame', async ({ page, context }) => {
    await openGlobalElements(page)
    const before = await fetchPublic('/')
    expect(before.body).not.toContain('Emergency help')
    expect(before.body).not.toContain('Here whenever our neighbors need us.')

    await page.getByLabel('Layout').selectOption('compact')
    await page.getByLabel('Keep it visible while scrolling').check()
    await page.getByRole('heading', { name: 'Utility links', exact: true }).click()
    await page.getByRole('button', { name: 'Add utility link' }).click()
    await page.getByLabel('Utility link 1 label').fill('Emergency help')
    // This serial suite leaves its published frame in place for the remaining
    // product journeys. Point at the seeded live home rather than inventing a
    // route that would correctly make every later page fail readiness.
    await page.getByLabel('Utility link 1 URL').fill('/')

    const preview = page.frameLocator('iframe[title="Demo site header and footer preview"]')
    await expect(preview.locator('h1')).toHaveCount(1)
    await expect(preview.getByRole('link', { name: 'Emergency help' })).toBeVisible()
    await expect(preview.locator('.cms-global-header--compact')).toBeVisible()
    await expect(page.getByText('Saved changes are not live yet')).toBeVisible()

    await page.getByRole('tab', { name: 'Footer' }).click()
    await page.getByLabel('Short description').fill('Here whenever our neighbors need us.')
    await page.getByLabel('Layout').selectOption('columns')
    await page.getByRole('heading', { name: 'Link groups', exact: true }).click()
    await page.getByRole('button', { name: 'Add link group' }).click()
    await page.getByLabel('Group 1 heading').fill('Explore')
    await page.getByRole('button', { name: 'Add link', exact: true }).click()
    await page.getByLabel('Link 1 label').fill('About us')
    await page.getByLabel('Link 1 URL').fill('/')
    await expect(preview.getByText('Here whenever our neighbors need us.')).toBeVisible()

    await page.getByRole('button', { name: 'Save draft' }).click()
    await expect(
      page.getByText('Header and footer draft saved. Visitors still see the published version.'),
    ).toBeVisible()
    expect((await fetchPublic('/')).body).not.toContain('Emergency help')

    await page.getByRole('button', { name: 'Publish header & footer' }).click()
    const dialog = page.getByRole('alertdialog')
    await expect(dialog).toBeVisible()
    await dialog.getByRole('button', { name: 'Publish header & footer' }).click()
    await expect(page.getByText('Header and footer published together across the live site.')).toBeVisible()
    await expect.poll(async () => (await fetchPublic('/')).body).toContain('Emergency help')
    const publicHtml = (await fetchPublic('/')).body
    expect(publicHtml).toContain('Here whenever our neighbors need us.')
    expect(publicHtml).toContain('The Salvation Army')
    expect(publicHtml).toContain('aria-label="Main"')

    const live = await context.newPage()
    await live.goto(STAGING_ORIGIN)
    await expect(live.locator('.cms-global-header--compact')).toBeVisible()
    await expect(live.getByRole('link', { name: 'Emergency help' })).toBeVisible()
    await expect(live.getByRole('contentinfo')).toContainText('Here whenever our neighbors need us.')
    expect(await live.locator('script').count()).toBe(0)
    await live.close()
  })

  test('keeps navigation and visual styling in their dedicated workspaces', async ({ page }) => {
    await openGlobalElements(page)
    const boundary = page.locator('.global-ownership')
    await expect(boundary.getByText('Edited elsewhere')).toBeVisible()
    await expect(boundary.getByRole('link', { name: 'Navigation', exact: true })).toBeVisible()
    await expect(boundary.getByRole('link', { name: 'Design', exact: true })).toBeVisible()
    await expect(boundary.getByRole('link', { name: 'Media', exact: true })).toBeVisible()
    await expect(page.getByRole('textbox', { name: /menu label/i })).toHaveCount(0)
    await page.getByRole('tab', { name: 'Footer' }).click()
    await expect(page.getByRole('textbox', { name: /colour|color/i })).toHaveCount(0)
    await expect(page.getByRole('textbox', { name: /html|css/i })).toHaveCount(0)
  })

  test('refuses an unsafe destination without erasing the author’s draft', async ({ page }) => {
    await openGlobalElements(page)
    await page.getByRole('tab', { name: 'Header' }).click()
    await page.getByRole('heading', { name: 'Utility links', exact: true }).click()
    const url = page.getByLabel('Utility link 1 URL')
    await url.fill('javascript:alert(1)')
    await page.getByRole('button', { name: 'Save draft' }).click()
    await expect(page.locator('.notice-error')).toContainText('Use an internal path or an https URL')
    await expect(url).toHaveValue('javascript:alert(1)')
    await url.fill('/help-again')
    await page.getByRole('button', { name: 'Save draft' }).click()
    await expect(
      page.getByText('Header and footer draft saved. Visitors still see the published version.'),
    ).toBeVisible()
  })

  test('gives contributors a complete but honestly read-only workspace', async ({ page }) => {
    await openGlobalElements(page, 'contributor@example.test')
    await expect(
      page.getByText('You can inspect the site frame. An editor or site administrator can change it.'),
    ).toBeVisible()
    await expect(page.getByRole('button', { name: 'Save draft' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Publish header & footer' })).toHaveCount(0)
    await expect(page.getByLabel('Displayed site name')).toBeDisabled()
    await page.getByRole('tab', { name: 'Footer' }).click()
    await expect(page.getByLabel('Show the shared Salvation Army foundation')).toBeDisabled()
  })

  test('keeps the complete authoring flow usable at tablet width', async ({ page }) => {
    await page.setViewportSize({ width: 900, height: 1100 })
    await openGlobalElements(page)
    await expect(page.getByRole('heading', { name: 'Header', exact: true })).toBeVisible()
    await expect(page.locator('.global-preview')).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    // In one column the preview comes first, scaled to the column, so the
    // frame being edited stays in view (V1 reference 15).
    const preview = await page.locator('.global-preview').boundingBox()
    const controls = await page.locator('.global-controls').boundingBox()
    expect(preview!.y).toBeLessThan(controls!.y)
    const stage = (await page.locator('.global-real-preview').boundingBox())!
    await expect
      .poll(async () => (await page.locator('.global-real-preview iframe').boundingBox())!.width)
      .toBeGreaterThan(stage.width - 40)
    // The footer tab brings the footer into the preview.
    await page.getByRole('tab', { name: 'Footer' }).click()
    await expect
      .poll(() =>
        page.evaluate(() => {
          const stage = document.querySelector('.global-real-preview')!.getBoundingClientRect()
          const frame = document.querySelector<HTMLIFrameElement>('.global-real-preview iframe')
          const footer = frame?.contentDocument?.querySelector('footer')?.getBoundingClientRect()
          if (!frame || !footer) return false
          const box = frame.getBoundingClientRect(),
            scale = box.width / frame.offsetWidth
          const top = box.top + footer.top * scale
          return top >= stage.top && top < stage.bottom
        }),
      )
      .toBe(true)
  })
})
