import { test, expect, type Page, type Locator } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { Pool } from 'pg'
import { e2eTarget } from '../../test-target.ts'
import { resolve } from 'node:path'
import { signIn } from '../helpers.ts'
import { CORE_THEME_PRESETS } from '@cms/seeds/core-themes'
const folder = resolve('../.r8-progress/step-4/workspaces')
async function capture(page: Page, name: string, focus?: Locator) {
  await mkdir(folder, { recursive: true })
  for (const width of [1440, 1024]) {
    await page.setViewportSize({ width, height: width === 1440 ? 900 : 768 })
    await page.evaluate(
      () => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
    )
    if (focus) await focus.evaluate(element => element.scrollIntoView({ block: 'center' }))
    await page.screenshot({ path: resolve(folder, name + '-' + width + '.png'), animations: 'disabled' })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  }
  await page.setViewportSize({ width: 1440, height: 900 })
}
async function openSite(page: Page) {
  await page.getByRole('main').getByRole('link', { name: 'Demo site', exact: true }).click()
  await expect(page).toHaveURL(/\/sites\/[0-9a-f-]+$/)
  return new URL(page.url()).pathname
}
test('revision 8 workspaces: personal Home, Site overview, Pages search and page details', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await signIn(page, 'editor@example.test')
  await expect(page.getByRole('heading', { name: 'Home', level: 1 })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Edit a page', exact: true })).toBeVisible()
  await capture(page, 'editor-home')
  await openSite(page)
  await expect(page.getByRole('heading', { name: 'Quick actions', exact: true })).toBeVisible()
  await expect(page.getByRole('table', { name: 'Pages', exact: true })).toBeVisible()
  await capture(page, 'site-overview-pages')
  const overview = page.url(),
    nav = page.getByRole('navigation', { name: 'Sections of the CMS' })
  const sections = await nav.getByRole('link').evaluateAll(links => links.map(link => link.getAttribute('aria-label')))
  expect(sections).toEqual(['Home', 'Pages', ...(sections.includes('Lists') ? ['Lists'] : []), 'Media', 'Publish'])
  const switcher = page.getByRole('button', { name: 'Switch site · Demo site', exact: true }),
    switchBox = await switcher.boundingBox(),
    overviewBox = await nav.getByRole('link', { name: 'Home', exact: true }).boundingBox()
  expect(overviewBox!.y).toBeGreaterThan(switchBox!.y)
  await expect(nav.getByRole('link', { name: 'People & access', exact: true })).toHaveCount(0)
  await expect(nav.getByRole('link', { name: 'Sections', exact: true })).toHaveCount(0)
  await expect(nav.getByRole('link', { name: 'Home', exact: true })).not.toHaveAttribute('aria-current', 'page')
  await nav.getByRole('link', { name: 'Pages', exact: true }).click()
  await expect(page).toHaveURL(/\/sites\/[0-9a-f-]+\/pages$/)
  await expect(page.getByRole('heading', { name: 'Pages', level: 1, exact: true })).toBeVisible()
  await expect(nav.getByRole('link', { name: 'Pages', exact: true })).toHaveAttribute('aria-current', 'page')
  await expect(page.getByRole('heading', { name: 'Quick actions', exact: true })).toHaveCount(0)
  await capture(page, 'dedicated-pages')
  await switcher.click()
  await switcher.locator('..').getByRole('link', { name: 'Demo site', exact: true }).click()
  await expect(page).toHaveURL(overview)
  await switcher.click()
  await switcher.locator('..').getByRole('link', { name: 'All sites', exact: true }).click()
  await expect(page).toHaveURL(/\/sites$/)
  await expect(page.getByRole('heading', { name: 'All sites', level: 1, exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'What would you like to do?', exact: true })).toHaveCount(0)
  await capture(page, 'all-sites-directory')
  await page.getByRole('link', { name: 'Back', exact: true }).click()
  await expect(page).toHaveURL(overview)
  await page.getByLabel('Search pages', { exact: true }).fill('No page could possibly match these words')
  await expect(page.getByRole('heading', { name: 'No matching pages', exact: true })).toBeVisible()
  await capture(page, 'pages-empty-search')
  await page.getByLabel('Search pages', { exact: true }).clear()
  await page.getByRole('button', { name: 'More actions for A page served by cms-v2', exact: true }).click()
  await page.getByRole('button', { name: 'Move', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'Page name and address', exact: true })).toBeVisible()
  await expect(page.getByLabel('Parent page', { exact: true })).toBeVisible()
  await capture(page, 'pages-move-drawer')
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'Add a page', exact: true }).click()
  await page.getByText('A copy of a page', { exact: true }).click()
  await expect(page.getByLabel('Page to copy', { exact: true })).toBeVisible()
  await capture(page, 'add-page-duplicate-choice')
  await page.keyboard.press('Escape')
  await page
    .getByRole('alertdialog', { name: 'Before you leave', exact: true })
    .getByRole('button', { name: 'Discard changes', exact: true })
    .click()
  await page.getByRole('link', { name: 'A page served by cms-v2', exact: true }).click()
  await expect(page).toHaveURL(/\/pages\/[0-9a-f-]+$/)
  await page.getByRole('button', { name: 'More page actions', exact: true }).click()
  await page.getByRole('link', { name: 'All sites', exact: true }).click()
  await expect(page).toHaveURL(/\/sites$/)
  await expect(page.getByRole('heading', { name: 'All sites', level: 1, exact: true })).toBeVisible()
  expect(errors).toEqual([])
})
test('revision 8 workspaces: list tiles, private drawer saves, cards, search, bulk and admin-only settings', async ({
  page,
}) => {
  test.setTimeout(120000)
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await signIn(page, 'root@example.test')
  const base = await openSite(page)
  await page.goto(base + '/content')
  await capture(page, 'lists-index-admin')
  await page.getByRole('button', { name: 'New list', exact: true }).click()
  const create = page.getByRole('dialog', { name: 'Create a list', exact: true })
  await create.getByLabel('List name', { exact: true }).fill('R8 shared speakers ' + Date.now())
  await create.getByRole('button', { name: 'Create list', exact: true }).click()
  await expect(page).toHaveURL(/collection=/)
  const address = page.url()
  await capture(page, 'list-empty')
  await page.getByRole('button', { name: 'More list actions', exact: true }).click()
  await page.getByRole('button', { name: 'List settings', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'List settings', exact: true })).toBeVisible()
  await capture(page, 'list-settings-admin')
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'More list actions', exact: true }).click()
  await page.getByRole('button', { name: 'Publish field changes', exact: true }).click()
  await expect(page.getByRole('status').filter({ hasText: 'List fields published.' })).toBeVisible()
  await page.getByRole('button', { name: 'Sign out', exact: true }).click()
  await expect(page).toHaveURL(/\/sign-in(?:[?#]|$)/)
  await signIn(page, 'editor@example.test')
  await page.goto(address)
  await expect(page.getByRole('button', { name: 'More list actions', exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: 'Add item', exact: true }).click()
  const drawer = page.getByRole('dialog', { name: 'Add item', exact: true })
  await expect(drawer.getByRole('button', { name: 'Save item', exact: true })).toBeDisabled()
  await capture(page, 'list-add-empty')
  await drawer
    .getByRole('textbox', { name: /^Name(?: required)?$/ })
    .fill('A very long speaker name that remains readable in both the table and the card view')
  await drawer.getByLabel('Role or title', { exact: true }).fill('Coordinator and workshop presenter')
  await capture(page, 'list-add-filled')
  await drawer.getByRole('button', { name: 'Save item', exact: true }).click()
  await expect(drawer).toBeHidden()
  await expect(page.getByRole('listitem')).toHaveCount(1)
  await capture(page, 'list-table-draft', page.getByRole('list', { name: /R8 shared speakers .* items/ }))
  await page.getByRole('button', { name: 'Publish list', exact: true }).click()
  await page.getByRole('alertdialog').getByText('View item details', { exact: true }).click()
  await expect(
    page.getByRole('alertdialog').getByText('Coordinator and workshop presenter', { exact: true }),
  ).toBeVisible()
  await capture(page, 'list-publish-review')
  await page.getByRole('alertdialog').getByRole('button', { name: 'Publish this list', exact: true }).click()
  await expect(page.getByRole('alertdialog')).toBeHidden()
  await expect(page.getByRole('status').filter({ hasText: 'item is now live.' })).toBeVisible()
  await page.getByRole('button', { name: 'Cards', exact: true }).click()
  const cards = page.getByRole('list', { name: /R8 shared speakers .* items/ })
  await cards.scrollIntoViewIfNeeded()
  const photo = await cards.locator('[class*=photo]').boundingBox(),
    card = await cards.getByRole('listitem').boundingBox()
  expect(photo!.width).toBeGreaterThan(card!.width * 0.75)
  for (const width of [1440, 1024]) {
    await page.setViewportSize({ width, height: width === 1440 ? 900 : 768 })
    expect(
      await cards.getByRole('listitem').evaluateAll(items =>
        items.every(item => {
          const box = item.getBoundingClientRect(),
            name = item.querySelector('strong')
          if (!name) return false
          const range = document.createRange()
          range.selectNodeContents(name)
          return [...range.getClientRects()].every(text => text.right <= box.right && text.left >= box.left)
        }),
      ),
    ).toBe(true)
  }
  await capture(page, 'list-cards-long', cards)
  await page.getByLabel('Search items', { exact: true }).fill('missing-speaker')
  await capture(page, 'list-search-empty', page.getByRole('heading', { name: 'No matching items', exact: true }))
  await page.getByLabel('Search items', { exact: true }).clear()
  await page.getByLabel(/^Select A very long speaker/).check()
  await capture(page, 'list-bulk-actions', page.getByText('1 selected', { exact: true }))
  await page.getByRole('button', { name: 'Clear selection', exact: true }).click()
  await page
    .getByRole('button', {
      name: 'Edit A very long speaker name that remains readable in both the table and the card view',
      exact: true,
    })
    .click()
  await page
    .getByRole('dialog', { name: 'Edit item', exact: true })
    .getByRole('button', { name: 'Cancel', exact: true })
    .click()
  expect(errors).toEqual([])
})
test('revision 8 workspaces: Site look previews real pages and private style choices with a site-level header handoff', async ({
  page,
}) => {
  test.setTimeout(120000)
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await signIn(page, 'root@example.test')
  const base = await openSite(page)
  await page.getByRole('link', { name: 'Site look', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Site look', level: 1 })).toBeVisible()
  const preview = page.frameLocator('iframe[title="Site look page preview"]')
  await expect(preview.locator('h1')).toBeVisible()
  await expect(page.getByRole('status').filter({ hasText: 'Updating site preview' })).toHaveCount(0)
  await capture(page, 'site-look-style')
  await page.getByRole('button', { name: 'Phone', exact: true }).click()
  await expect(preview.locator('.cms-phone-menu')).toBeVisible()
  await preview.locator('.cms-phone-menu summary').click()
  await capture(page, 'site-look-phone-menu')
  await page
    .getByRole('complementary', { name: 'CMS navigation', exact: true })
    .getByRole('link', { name: 'Header & menu', exact: true })
    .click()
  await expect(page.getByRole('heading', { name: 'Header & menu', exact: true })).toBeVisible()
  await page.goto(base + '/design')
  await expect(preview.locator('h1')).toBeVisible()
  const original = await preview
      .locator('html')
      .evaluate(node => getComputedStyle(node).getPropertyValue('--color-primary').trim()),
    preset = CORE_THEME_PRESETS.find(item => item.name === 'Forest')!
  await page.getByLabel('Theme preset', { exact: true }).selectOption(preset.name)
  await expect
    .poll(() =>
      preview.locator('html').evaluate(node => getComputedStyle(node).getPropertyValue('--color-primary').trim()),
    )
    .toBe(preset.theme.colors.primary)
  await expect(page.getByRole('button', { name: 'Publish site look', exact: true })).toBeDisabled()
  await capture(page, 'site-look-style-private')
  page.once('dialog', dialog => dialog.accept())
  await page.reload()
  await expect(preview.locator('h1')).toBeVisible()
  await expect
    .poll(() =>
      preview.locator('html').evaluate(node => getComputedStyle(node).getPropertyValue('--color-primary').trim()),
    )
    .toBe(original)
  await page.getByLabel('Theme preset', { exact: true }).selectOption(preset.name)
  await page.getByRole('button', { name: 'Save draft', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Save draft', exact: true })).toBeDisabled()
  await page.getByRole('button', { name: 'Publish site look', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'Publish site look', exact: true })).toContainText(
    'A page served by cms-v2',
  )
  await capture(page, 'site-look-affected-pages')
  await page.keyboard.press('Escape')
  expect(errors).toEqual([])
  await page.getByRole('button', { name: 'Sign out', exact: true }).click()
  await expect(page).toHaveURL(/\/sign-in(?:[?#]|$)/)
  await signIn(page, 'editor@example.test')
  await page.goto(base + '/design')
  await expect(page.getByLabel('Theme preset', { exact: true })).toBeDisabled()
  await expect(preview.locator('h1')).toBeVisible()
  await expect(
    page
      .getByRole('complementary', { name: 'CMS navigation', exact: true })
      .getByRole('link', { name: 'Header & menu', exact: true }),
  ).toHaveCount(0)
  await capture(page, 'site-look-editor-permissions')
})
test('revision 8 workspaces: media grid, conditional attention filter, details drawer and upload drop', async ({
  page,
}) => {
  test.setTimeout(90000)
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await signIn(page, 'root@example.test')
  const base = await openSite(page),
    siteId = base.split('/').at(-1)!
  const assets = [0, 1, 2].map(index => ({
    id: randomUUID(),
    revision: 1,
    siteId,
    scope: 'site',
    name:
      index === 2 ? 'A failed image with a long descriptive file name.jpg' : 'Community image ' + (index + 1) + '.png',
    altText: 'A welcoming community gathering',
    decorative: false,
    focal: null,
    width: 1200,
    height: 800,
    bytes: 20480,
    mimeType: 'image/png',
    status: index === 2 ? 'failed' : 'ready',
    folder: 'Events/2027',
    attribution: 'Original CMS demonstration artwork',
    source: 'Local fixture',
    tags: ['event'],
    variants: { original: true, thumbnail: true, card: true, wide: true },
    previewUrl: '/cms-samples/r8-landscape.png',
    deliveryUrl: '/cms-samples/r8-landscape.png',
    usedOnItems: 0,
    usedInVersions: 0,
    createdAt: '2026-10-25T12:00:00Z',
    deletedAt: null,
  }))
  const { host, port, database } = e2eTarget()
  const pool = new Pool({ connectionString: `postgres://cms:cms@${host}:${port}/${database}` })
  try {
    // The initial library comes from the server; the route below still controls later filter/error responses.
    for (const [index, asset] of assets.entries()) {
      await pool.query(
        `INSERT INTO media
           (id,site_id,object_key,content_hash,original_name,alt_text,width,height,bytes,mime_type,status,
            folder,attribution,source,tags,created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,now()+($16*interval '1 second'))`,
        [
          asset.id,
          siteId,
          'e2e-workspace/' + asset.id,
          asset.id.replaceAll('-', '').repeat(2),
          asset.name,
          asset.altText,
          asset.width,
          asset.height,
          asset.bytes,
          asset.mimeType,
          asset.status,
          asset.folder,
          asset.attribution,
          asset.source,
          asset.tags,
          3 - index,
        ],
      )
      if (asset.status === 'ready') {
        await pool.query(
          `INSERT INTO media_variants(media_id,kind,object_key,content_hash,width,height,bytes,mime_type)
           VALUES ($1,'thumbnail',$2,$3,$4,$5,$6,'image/webp')`,
          [
            asset.id,
            'e2e-workspace/thumb-' + asset.id,
            asset.id.replaceAll('-', '').repeat(2),
            asset.width,
            asset.height,
            asset.bytes,
          ],
        )
        await page.route('**/media/' + asset.id + '/thumbnail', route =>
          route.fulfill({
            path: resolve('../apps/site/public/cms-samples/r8-landscape.png'),
            contentType: 'image/png',
          }),
        )
      }
    }
    let fail = false
    let filterRequests = 0
    await page.route('**/api/sites/*/media?**', async route => {
      filterRequests += 1
      if (fail) {
        await route.fulfill({ status: 503, json: { error: 'The local fixture is temporarily unavailable.' } })
        return
      }
      const parameters = new URL(route.request().url()).searchParams,
        status = parameters.get('status'),
        shown =
          parameters.get('search') === 'missing-picture'
            ? []
            : status === 'failed'
              ? assets.filter(asset => asset.status === 'failed')
              : assets
      await route.fulfill({
        json: {
          assets: shown,
          total: shown.length,
          page: 1,
          pageSize: 24,
          pageCount: 1,
          facets: {
            folders: [{ path: 'Events/2027', count: 3 }],
            tags: [{ tag: 'event', count: 3 }],
            scopes: { site: 3, shared: 0 },
            statuses: { ready: 2, processing: 0, failed: 1, deleted: 0 },
          },
        },
      })
    })
    await page.route('**/api/media/assets/*/usage', route =>
      route.fulfill({ json: { usage: { currentLive: [], currentDraft: [], history: [] } } }),
    )
    await page.goto(base + '/media')
    await expect(page.getByRole('button', { name: 'Needs attention (1)', exact: true })).toBeVisible()
    if (await page.getByRole('button', { name: 'Close upload panel', exact: true }).count())
      await page.getByRole('button', { name: 'Close upload panel', exact: true }).click()
    await expect(page.locator('.media-summary')).toHaveCount(0)
    await capture(page, 'media-grid-folders')
    expect(filterRequests, 'The first Media screen uses the result already read by the server').toBe(0)
    await page.locator('.media-asset-open').first().click()
    const drawer = page.getByRole('dialog', { name: 'Image details', exact: true })
    await expect(drawer.getByLabel('Description for people who can’t see it', { exact: true })).toBeVisible()
    await capture(page, 'media-details-drawer')
    await expect(drawer.getByRole('button', { name: 'Save image details', exact: true })).toBeInViewport()
    await drawer
      .getByLabel('Description for people who can’t see it', { exact: true })
      .fill('An unsaved description that should not disappear')
    await expect(drawer.getByRole('button', { name: 'Save image details', exact: true })).toBeEnabled()
    await drawer.getByRole('button', { name: 'Close Image details', exact: true }).click()
    await page
      .getByRole('alertdialog', { name: 'Before you leave', exact: true })
      .getByRole('button', { name: 'Keep editing', exact: true })
      .click()
    await expect(drawer).toBeVisible()
    await drawer
      .getByLabel('Description for people who can’t see it', { exact: true })
      .fill('A welcoming community gathering')
    await expect(drawer.getByRole('button', { name: 'Save image details', exact: true })).toBeDisabled()
    await drawer.getByText('More details', { exact: true }).click()
    await capture(page, 'media-more-details', drawer.getByText('More details', { exact: true }))
    await drawer.getByRole('tab', { name: 'Used on', exact: true }).click()
    await expect(drawer.getByRole('tab', { name: 'Used on', exact: true })).toHaveAttribute('aria-selected', 'true')
    await expect(drawer.getByText('No saved content references this image.', { exact: true })).toBeVisible()
    await capture(page, 'media-unused')
    await page.keyboard.press('Escape')
    await page.getByLabel('Search all images', { exact: true }).fill('missing-picture')
    await expect(page.getByRole('heading', { name: 'No images match these filters', exact: true })).toBeVisible()
    await capture(
      page,
      'media-empty-search',
      page.getByRole('heading', { name: 'No images match these filters', exact: true }),
    )
    await page.getByLabel('Search all images', { exact: true }).clear()
    await expect(page.locator('.media-asset')).toHaveCount(3)
    await page.getByRole('button', { name: 'Needs attention (1)', exact: true }).click()
    await expect(page.locator('.media-asset')).toHaveCount(1)
    await capture(page, 'media-attention', page.locator('.media-asset'))
    await page.getByRole('button', { name: 'Upload images', exact: true }).click()
    await capture(page, 'media-upload-empty')
    await page.getByRole('button', { name: 'Close upload panel', exact: true }).click()
    fail = true
    await page.getByRole('button', { name: 'All', exact: true }).click()
    await expect(page.getByRole('alert').filter({ hasText: 'temporarily unavailable' })).toBeVisible()
    await capture(page, 'media-error')
    expect(errors).toEqual([])
  } finally {
    try {
      const ids = assets.map(asset => asset.id)
      await pool.query('DELETE FROM media_variants WHERE media_id=ANY($1::uuid[])', [ids])
      await pool.query('DELETE FROM media WHERE id=ANY($1::uuid[])', [ids])
    } finally {
      await pool.end()
    }
  }
})
