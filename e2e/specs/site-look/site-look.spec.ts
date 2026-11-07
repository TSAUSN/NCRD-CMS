import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { test, expect, type Page, type Locator } from '@playwright/test'
import { signIn } from '../helpers.ts'
import { rawRequest } from '../http.ts'
import { siteLookFixture as baseSiteLookFixture } from '../fixtures/r8-site-look.ts'
// Retain the legacy identity/menu/footer contract only for brought-in designs.
async function siteLookFixture() {
  const f = await baseSiteLookFixture(),
    client = await f.pool.connect()
  let completed = false
  try {
    await client.query('BEGIN')
    await client.query(
      "SELECT set_config('app.user_id',(SELECT id::text FROM app_users WHERE email='root@example.test'),true)",
    )
    await client.query('SELECT app.save_site_file_bundle($1,0,$2)', [
      f.site,
      JSON.stringify({
        version: 1,
        files: [],
        styles: [],
        scripts: [],
        original: {
          version: 1,
          definitions: [],
          pages: f.pages.map(pageId => ({ pageId, html: { lang: 'en' }, body: {}, header: true, footer: true })),
        },
      }),
    ])
    await client.query('COMMIT')
    completed = true
    return f
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
    if (!completed) await f.pool.end()
  }
}
const folder = resolve('../.r8-progress/step-4/site-look')
async function capture(page: Page, name: string, target?: Locator) {
  await expect(page.getByRole('status').filter({ hasText: 'Updating site preview…' })).toHaveCount(0)
  await mkdir(folder, { recursive: true })
  for (const width of [1440, 1024]) {
    await page.setViewportSize({ width, height: width === 1440 ? 900 : 768 })
    if (target) {
      await target.evaluate(node => node.scrollIntoView({ block: 'center', inline: 'nearest' }))
      await expect(target).toBeInViewport({ ratio: 1 })
    }
    await page.screenshot({ path: resolve(folder, `${name}-${width}.png`), animations: 'disabled' })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    const save = page.getByRole('button', { name: 'Save site-wide draft', exact: true })
    if (await save.count()) await expect(save).toBeInViewport()
  }
  await page.setViewportSize({ width: 1440, height: 900 })
}
async function chooseLogo(page: Page, kind: 'full' | 'compact') {
  await page.getByRole('button', { name: 'Choose ' + kind + ' logo', exact: true }).click()
  const picker = page.getByRole('dialog', { name: 'Choose from the media library', exact: true })
  await picker
    .getByRole('searchbox', { name: 'Search images', exact: true })
    .fill(kind === 'compact' ? 'Local compact logo' : 'Local demonstration logo')
  await picker
    .getByRole('option')
    .filter({ hasText: kind === 'compact' ? 'Local compact logo.png' : 'Local demonstration logo.png' })
    .click()
  const use = picker.getByRole('button', { name: 'Use as ' + kind + ' logo', exact: true })
  await expect(use).toBeEnabled()
  await expect(picker.getByRole('textbox', { name: 'Image description', exact: true })).toHaveCount(0)
  await use.click()
  await expect(picker).toBeHidden()
}
async function openGroup(page: Page, name: string) {
  const summary = page.locator('summary').filter({ has: page.getByRole('heading', { name, exact: true }) })
  if (!(await summary.evaluate(node => (node.parentElement as HTMLDetailsElement).open))) await summary.click()
}
test('Original-design compatibility: Site look edits complete shared identity, actions and footer privately on the real page', async ({
  page,
}) => {
  test.setTimeout(120000)
  page.setDefaultTimeout(10000)
  const f = await siteLookFixture(),
    errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  try {
    await page.route(/\/media\/[0-9a-f-]{36}\/(wide|thumbnail)/, route =>
      route.fulfill({ path: resolve('../apps/admin/public/cms-samples/r8-square.png') }),
    )
    await signIn(page, 'root@example.test')
    await page.goto(`/sites/${f.site}/design`)
    const preview = page.frameLocator('iframe[title="Site look page preview"]')
    await expect(preview.locator('h1')).toHaveText('Welcome')
    await page.getByRole('button', { name: 'Header & menu', exact: true }).click()
    await page.getByLabel('Site name', { exact: true }).fill('A welcoming shared site')
    await capture(page, 'header-name-fixed-save', page.getByLabel('Site name', { exact: true }))
    await openGroup(page, 'Logos')
    await chooseLogo(page, 'full')
    await chooseLogo(page, 'compact')
    await expect(preview.locator('header img').first()).toBeVisible()
    await capture(page, 'logos', page.getByRole('button', { name: 'Change compact logo', exact: true }))
    await openGroup(page, 'Partner')
    await page.getByRole('button', { name: 'Add a partner', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Save site-wide draft', exact: true })).toBeDisabled()
    await expect(preview.locator('h1')).toHaveText('Welcome')
    await expect(
      page.getByRole('complementary', { name: 'Site-wide settings', exact: true }).getByRole('alert'),
    ).toContainText('Add the partner’s name')
    await capture(page, 'incomplete-partner', page.getByLabel('Partner’s name', { exact: true }))
    await page.getByLabel('Partner’s name', { exact: true }).fill('Community partners')
    await page.getByLabel('Partner’s web address (optional)', { exact: true }).fill('https://example.test/partners')
    await expect(preview.getByText('Community partners', { exact: true })).toBeVisible()
    await capture(page, 'partner', page.getByLabel('Partner’s web address (optional)', { exact: true }))
    await openGroup(page, 'Utility links')
    await page.getByRole('button', { name: 'Add utility link', exact: true }).click()
    await page.getByLabel('Utility link 1 label', { exact: true }).fill('Get help')
    await page.getByLabel('Utility link 1 URL', { exact: true }).fill('/visit')
    await expect(preview.getByRole('link', { name: 'Get help', exact: true })).toBeVisible()
    await capture(page, 'utility-links', page.getByLabel('Utility link 1 URL', { exact: true }))
    await openGroup(page, 'Header call to action')
    await page.getByRole('button', { name: 'Add call to action', exact: true }).click()
    await page.getByLabel('Call to action label', { exact: true }).fill('Plan your visit')
    await page.getByLabel('Call to action URL', { exact: true }).fill('/visit')
    await expect(preview.getByRole('link', { name: 'Plan your visit', exact: true })).toBeVisible()
    await capture(page, 'header-action', page.getByLabel('Call to action URL', { exact: true }))
    await page.getByRole('button', { name: 'Save site-wide draft', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Save site-wide draft', exact: true })).not.toHaveAttribute(
      'aria-busy',
      'true',
    )
    await expect(page.getByRole('button', { name: 'Save site-wide draft', exact: true })).toBeDisabled()
    expect((await rawRequest({ host: f.host, path: '/' })).body).not.toContain('A welcoming shared site')
    await page.getByRole('button', { name: 'Footer', exact: true }).click()
    await page.getByLabel('Footer introduction', { exact: true }).fill('A welcoming place for every neighbour.')
    await page.getByLabel('Layout', { exact: true }).selectOption('columns')
    await openGroup(page, 'Link groups')
    await page.getByRole('button', { name: 'Add link group', exact: true }).click()
    await page.getByRole('button', { name: 'Add link', exact: true }).click()
    await page.getByLabel('Link 1 label', { exact: true }).fill('Visit us')
    await page.getByLabel('Link 1 URL', { exact: true }).fill('/visit')
    await capture(page, 'footer-columns', page.getByLabel('Link 1 URL', { exact: true }))
    await openGroup(page, 'Contact details')
    await page.getByRole('button', { name: 'Add contact details', exact: true }).click()
    await page.getByLabel('Contact address', { exact: true }).fill('100 Community Road')
    await page.getByLabel('Contact email', { exact: true }).fill('hello@example.test')
    await expect(preview.getByText('100 Community Road', { exact: true })).toBeVisible()
    await capture(page, 'footer-contact', page.getByLabel('Contact email', { exact: true }))
    await openGroup(page, 'Social links')
    await page.getByRole('button', { name: 'Add social profile', exact: true }).click()
    await page.getByLabel('Social profile 1 URL', { exact: true }).fill('https://www.facebook.com/example')
    await expect(preview.getByRole('link', { name: 'Facebook', exact: true })).toBeVisible()
    await capture(page, 'footer-social', page.getByLabel('Social profile 1 URL', { exact: true }))
    await openGroup(page, 'Legal and accessibility links')
    await page.getByLabel('Copyright line', { exact: true }).fill('© 2026 Community welcome')
    await page.getByRole('button', { name: 'Add privacy link', exact: true }).click()
    await page.getByLabel('Privacy URL', { exact: true }).fill('/visit')
    await capture(page, 'footer-legal', page.getByLabel('Privacy URL', { exact: true }))
    await page.getByRole('button', { name: 'Save site-wide draft', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Save site-wide draft', exact: true })).toBeDisabled()
    expect((await rawRequest({ host: f.host, path: '/' })).body).not.toContain('100 Community Road')
    await page.getByRole('button', { name: 'Phone', exact: true }).click()
    await capture(page, 'footer-phone')
    await page.getByRole('button', { name: 'Header & menu', exact: true }).click()
    await expect(preview.locator('.cms-phone-menu summary')).toBeVisible()
    await preview.locator('.cms-phone-menu summary').click()
    await capture(page, 'full-header-phone')
    const frame = (
      await f.pool.query(
        'SELECT g.kind,v.content AS saved,l.content AS live FROM global_elements g JOIN global_element_versions v ON v.id=g.draft_version_id JOIN global_element_versions l ON l.id=g.published_version_id WHERE g.site_id=$1 ORDER BY g.kind',
        [f.site],
      )
    ).rows
    expect(frame.find(row => row.kind === 'header')!.saved.partner.name).toBe('Community partners')
    expect(frame.find(row => row.kind === 'header')!.live.partner ?? null).toBeNull()
    expect(frame.find(row => row.kind === 'footer')!.saved.contact.address).toBe('100 Community Road')
    expect(frame.find(row => row.kind === 'footer')!.live.contact).toBeNull()
    expect(errors).toEqual([])
  } finally {
    await f.pool.end()
  }
})
test('Original-design compatibility: Site look explains Contributor access and keeps theme and shared frame changes unavailable', async ({
  page,
}) => {
  test.setTimeout(60000)
  const f = await siteLookFixture()
  try {
    await signIn(page, 'contributor@example.test')
    await page.goto(`/sites/${f.site}/design`)
    await expect(page.getByLabel('Theme preset', { exact: true })).toHaveCount(0)
    await page.getByRole('button', { name: 'Header & menu', exact: true }).click()
    await expect(page.getByText('An editor can change this site-wide area.', { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Save site-wide draft', exact: true })).toHaveCount(0)
    await expect(page.getByRole('textbox', { name: 'Site name', exact: true })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Publish site look', exact: true })).toHaveCount(0)
    await capture(page, 'contributor-explanation')
  } finally {
    await f.pool.end()
  }
})

test('Original-design compatibility: Editor changes menu destinations, hides a dropdown and preserves private links across reload', async ({
  page,
}) => {
  test.setTimeout(120000)
  page.setDefaultTimeout(10000)
  const f = await siteLookFixture(),
    errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  try {
    const initialMenu = (
        await f.pool.query(
          'SELECT v.tree FROM navigations n JOIN navigation_versions v ON v.id=n.draft_version_id WHERE n.site_id=$1',
          [f.site],
        )
      ).rows[0]!.tree,
      parentLabel = initialMenu[1].label
    await signIn(page, 'editor@example.test')
    await page.goto(`/sites/${f.site}/design`)
    const preview = page.frameLocator('iframe[title="Site look page preview"]')
    await expect(preview.locator('h1')).toHaveText('Welcome')
    await page.getByRole('button', { name: 'Header & menu', exact: true }).click()
    const menu = page.getByRole('complementary', { name: 'Site-wide settings', exact: true }),
      save = menu.getByRole('button', { name: 'Save site-wide draft', exact: true })
    await menu.getByRole('button', { name: 'Add web link to menu', exact: true }).click()
    let link = menu.getByRole('listitem', { name: 'Menu item 2', exact: true })
    await link.getByLabel('Menu label', { exact: true }).fill('Community help')
    if (!(await link.locator('details').evaluate(node => (node as HTMLDetailsElement).open)))
      await link.locator('summary').click()
    await link.getByLabel('Web address', { exact: true }).fill('javascript:alert(1)')
    await expect(save).toBeDisabled()
    await expect(link.getByText('Use /path or https://example.org.', { exact: true })).toBeVisible()
    await expect(preview.locator('h1')).toHaveText('Welcome')
    await capture(page, 'menu-unsafe-address', link.getByLabel('Web address', { exact: true }))
    await link.getByLabel('Web address', { exact: true }).fill('https://example.org/community')
    await expect(preview.getByRole('link', { name: 'Community help', exact: true })).toHaveAttribute(
      'href',
      'https://example.org/community',
    )
    await capture(page, 'menu-web-destination', link.getByLabel('Web address', { exact: true }))
    await link.getByRole('button', { name: 'Indent', exact: true }).click()
    const parent = menu.getByRole('listitem', { name: 'Menu item 1', exact: true })
    await parent.getByRole('button', { name: 'Hide', exact: true }).first().click()
    await expect(preview.getByRole('link', { name: parentLabel, exact: true })).toHaveCount(0)
    await expect(preview.getByRole('link', { name: 'Community help', exact: true })).toHaveCount(0)
    await expect(parent.getByText('Hidden from the menu with its dropdown links.', { exact: true })).toBeVisible()
    await expect(menu.getByLabel('Add page to menu', { exact: true })).toBeDisabled()
    await capture(page, 'menu-hidden-dropdown', parent.getByRole('button', { name: 'Show', exact: true }).first())
    await save.click()
    await expect(save).not.toHaveAttribute('aria-busy', 'true')
    await expect(save).toBeDisabled()
    await page.reload()
    await page.getByRole('button', { name: 'Header & menu', exact: true }).click()
    const restored = menu.getByRole('listitem', { name: 'Menu item 1', exact: true })
    await expect(restored.getByLabel('Menu label', { exact: true }).first()).toHaveValue(parentLabel)
    await expect(restored.getByRole('button', { name: 'Show', exact: true }).first()).toBeVisible()
    await restored.getByRole('button', { name: 'Show', exact: true }).first().click()
    link = menu.getByRole('listitem', { name: 'Menu item 1.0', exact: true })
    if (!(await link.locator('details').evaluate(node => (node as HTMLDetailsElement).open)))
      await link.locator('summary').click()
    await expect(link.getByLabel('Web address', { exact: true })).toHaveValue('https://example.org/community')
    await link.getByRole('combobox', { name: 'Destination type', exact: true }).selectOption('page')
    await link.getByRole('combobox', { name: 'Page', exact: true }).selectOption(f.pages[0]!)
    await expect(preview.locator('.cms-desktop-nav a').filter({ hasText: 'Community help' })).toHaveAttribute(
      'href',
      '/',
    )
    await preview.getByRole('link', { name: parentLabel, exact: true }).hover()
    await expect(preview.getByRole('link', { name: 'Community help', exact: true })).toBeVisible()
    await capture(page, 'menu-page-destination', link.getByRole('combobox', { name: 'Page', exact: true }))
    await save.click()
    await expect(save).not.toHaveAttribute('aria-busy', 'true')
    await expect(save).toBeDisabled()
    const row = (
      await f.pool.query(
        'SELECT d.tree AS draft,l.tree AS live FROM navigations n JOIN navigation_versions d ON d.id=n.draft_version_id JOIN navigation_versions l ON l.id=n.published_version_id WHERE n.site_id=$1',
        [f.site],
      )
    ).rows[0]!
    expect(row.draft[1].visible).toBe(true)
    expect(row.draft[1].children).toEqual([
      { label: 'Community help', target: { type: 'page', page_id: f.pages[0] }, visible: true },
    ])
    expect(JSON.stringify(row.live)).not.toContain('Community help')
    expect((await rawRequest({ host: f.host, path: '/' })).body).not.toContain('Community help')
    await restored.getByRole('button', { name: 'Remove menu item', exact: true }).first().click()
    const removal = page.getByRole('dialog', { name: 'Remove menu item?', exact: true })
    await expect(removal).toContainText('and its 1 dropdown link')
    await capture(page, 'menu-remove-confirmation')
    await removal.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(menu.getByRole('listitem', { name: 'Menu item 1.0', exact: true })).toHaveCount(1)
    await restored.getByRole('button', { name: 'Remove menu item', exact: true }).first().click()
    await removal.getByRole('button', { name: 'Remove from menu', exact: true }).click()
    await expect(menu.getByRole('listitem', { name: 'Menu item 1.0', exact: true })).toHaveCount(0)
    await save.click()
    await expect(save).not.toHaveAttribute('aria-busy', 'true')
    await expect(save).toBeDisabled()
    expect((await rawRequest({ host: f.host, path: '/' })).body).toContain(parentLabel)
    expect(errors).toEqual([])
  } finally {
    await f.pool.end()
  }
})

test('Editor logo choices use the verified shared picker and preserve saved files through cancellation and errors', async ({
  page,
}) => {
  test.setTimeout(120000)
  page.setDefaultTimeout(10000)
  const f = await siteLookFixture(),
    folder = resolve('../.r8-progress/step-4/site-look-logos'),
    errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  async function shot(name: string, target?: Locator) {
    const modal = page.getByRole('dialog', { name: 'Choose from the media library', exact: true })
    if (!(await modal.count())) {
      await expect(page.getByRole('status').filter({ hasText: 'Updating site preview…' })).toHaveCount(0)
      await expect(page.frameLocator('iframe[title="Site look page preview"]').locator('h1')).toHaveText('Welcome')
    }
    await mkdir(folder, { recursive: true })
    for (const width of [1440, 1024]) {
      await page.setViewportSize({ width, height: width === 1440 ? 900 : 768 })
      if (target) {
        await target.evaluate(node => node.scrollIntoView({ block: 'center', inline: 'nearest' }))
        await expect(target).toBeInViewport({ ratio: 1 })
      }
      await page.screenshot({ path: resolve(folder, `${name}-${width}.png`), animations: 'disabled' })
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      const picker = page.getByRole('dialog', { name: 'Choose from the media library', exact: true })
      if (await picker.count()) {
        await expect(picker.getByRole('button', { name: 'Close media library', exact: true })).toBeInViewport()
        await expect(picker.getByRole('button', { name: 'Use as full logo', exact: true })).toBeInViewport()
      }
    }
    await page.setViewportSize({ width: 1440, height: 900 })
  }
  try {
    await page.route(/\/media\/[0-9a-f-]{36}\/(wide|thumbnail)/, route =>
      route.fulfill({ path: resolve('../apps/admin/public/cms-samples/r8-square.png') }),
    )
    await signIn(page, 'editor@example.test')
    await page.goto(`/sites/${f.site}/design`)
    const preview = page.frameLocator('iframe[title="Site look page preview"]')
    await expect(preview.locator('h1')).toHaveText('Welcome')
    await page.getByRole('button', { name: 'Header & menu', exact: true }).click()
    await openGroup(page, 'Logos')
    const save = page.getByRole('button', { name: 'Save site-wide draft', exact: true }),
      before = await rawRequest({ host: f.host, path: '/' })
    await page.getByRole('button', { name: 'Choose full logo', exact: true }).click()
    const picker = page.getByRole('dialog', { name: 'Choose from the media library', exact: true })
    await expect(picker.getByRole('option').filter({ hasText: 'Local demonstration logo.png' })).toBeVisible()
    await shot('logo-picker')
    await picker.getByRole('searchbox', { name: 'Search images', exact: true }).fill('No image has this name')
    await expect(picker.getByRole('heading', { name: 'No images match', exact: true })).toBeVisible()
    await shot('logo-picker-empty-search')
    await picker.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(save).toBeDisabled()
    await expect(page.getByRole('region', { name: 'Full logo', exact: true })).toContainText(
      'The site name is shown without a logo.',
    )
    await page.route('**/api/sites/*/media?**', route => route.fulfill({ status: 503, body: 'Unavailable' }))
    await page.getByRole('button', { name: 'Choose full logo', exact: true }).click()
    await expect(picker.getByRole('alert')).toContainText('Your current logo is unchanged')
    await expect(picker.getByRole('button', { name: 'Use as full logo', exact: true })).toBeDisabled()
    await expect(picker.getByRole('heading', { name: 'Images unavailable', exact: true })).toBeVisible()
    await shot('logo-library-error')
    await page.unroute('**/api/sites/*/media?**')
    await picker.getByRole('button', { name: 'Refresh library', exact: true }).click()
    await picker.getByRole('option').filter({ hasText: 'Local demonstration logo.png' }).click()
    await expect(picker.getByRole('textbox', { name: 'Image description', exact: true })).toHaveCount(0)
    await picker.getByRole('button', { name: 'Use as full logo', exact: true }).click()
    await expect(preview.locator('header img').first()).toBeVisible()
    await chooseLogo(page, 'compact')
    await save.click()
    await expect(save).not.toHaveAttribute('aria-busy', 'true')
    await expect(save).toBeDisabled()
    await page.getByRole('button', { name: 'Footer', exact: true }).click()
    await page.getByRole('button', { name: 'Header & menu', exact: true }).click()
    await openGroup(page, 'Logos')
    await expect(page.getByRole('region', { name: 'Full logo', exact: true }).locator('img')).toBeVisible()
    await page.getByRole('button', { name: 'Change compact logo', exact: true }).scrollIntoViewIfNeeded()
    await shot('chosen-site-logos', page.getByRole('button', { name: 'Change compact logo', exact: true }))
    await expect
      .poll(() =>
        preview
          .locator('header img')
          .first()
          .evaluate(node => (node as HTMLImageElement).currentSrc),
      )
      .toContain(f.picture + '/wide')
    await page.getByRole('button', { name: 'Phone', exact: true }).click()
    await expect
      .poll(() =>
        preview
          .locator('header img')
          .first()
          .evaluate(node => (node as HTMLImageElement).currentSrc),
      )
      .toContain(f.compactPicture + '/thumbnail')
    await shot('compact-logo-phone', page.getByRole('button', { name: 'Change compact logo', exact: true }))
    const rows = (
      await f.pool.query(
        "SELECT d.content AS draft,l.content AS live FROM global_elements e JOIN global_element_versions d ON d.id=e.draft_version_id JOIN global_element_versions l ON l.id=e.published_version_id WHERE e.site_id=$1 AND e.kind='header'",
        [f.site],
      )
    ).rows
    expect(rows[0]!.draft.brand).toMatchObject({ logoMediaId: f.picture, compactLogoMediaId: f.compactPicture })
    expect(rows[0]!.live.brand.logoMediaId).toBeNull()
    expect((await rawRequest({ host: f.host, path: '/' })).body).toBe(before.body)
    expect((await f.pool.query('SELECT alt_text FROM media WHERE id=$1', [f.picture])).rows[0]!.alt_text).toBe(
      'Local demonstration mark',
    )
    await page.getByRole('button', { name: 'Use full logo on phones', exact: true }).click()
    await page.getByRole('button', { name: 'Use site name instead', exact: true }).click()
    await expect(preview.locator('header img')).toHaveCount(0)
    await save.click()
    await expect(save).not.toHaveAttribute('aria-busy', 'true')
    await expect(save).toBeDisabled()
    await page.reload()
    await expect(preview.locator('header img')).toHaveCount(0)
    await page.getByRole('button', { name: 'Header & menu', exact: true }).click()
    await openGroup(page, 'Logos')
    await expect(page.getByRole('region', { name: 'Full logo', exact: true })).toContainText(
      'The site name is shown without a logo.',
    )
    await shot('site-name-fallback', page.getByRole('button', { name: 'Choose full logo', exact: true }))
    await expect(preview.locator('header img')).toHaveCount(0)
    expect(
      (
        await f.pool.query(
          "SELECT count(*)::int AS n FROM global_element_versions v JOIN global_elements e ON e.id=v.global_element_id WHERE e.site_id=$1 AND e.kind='header' AND v.content->'brand'->>'logoMediaId'=$2",
          [f.site, f.picture],
        )
      ).rows[0]!.n,
    ).toBeGreaterThan(0)
    await chooseLogo(page, 'compact')
    await expect(page.getByRole('region', { name: 'Full logo', exact: true })).toContainText(
      'The compact logo is used until you choose a full logo.',
    )
    await expect
      .poll(() =>
        preview
          .locator('header img')
          .first()
          .evaluate(node => (node as HTMLImageElement).currentSrc),
      )
      .toContain(f.compactPicture + '/thumbnail')
    await shot('compact-only-logo', page.getByRole('button', { name: 'Change compact logo', exact: true }))
    await save.click()
    await expect(save).not.toHaveAttribute('aria-busy', 'true')
    await expect(save).toBeDisabled()
    expect((await rawRequest({ host: f.host, path: '/' })).body).toBe(before.body)
    expect(errors).toEqual([])
  } finally {
    await f.pool.end()
  }
})
