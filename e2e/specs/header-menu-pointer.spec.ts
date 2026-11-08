import { expect, test, type Locator, type Page } from '@playwright/test'
import { siteLookFixture } from './fixtures/r8-site-look.ts'
import { signIn, SITE_PORT } from './helpers.ts'

const item = (label: string) => ({
  label,
  visible: true,
  target: { type: 'url', url: label === 'Home' ? '/' : '/visit' },
})

async function grab(
  page: Page,
  source: Locator,
  target: Locator,
  after: boolean,
  horizontal = 0,
  afterPress?: () => Promise<void>,
) {
  await source.scrollIntoViewIfNeeded()
  await target.scrollIntoViewIfNeeded()
  const handle = source.locator(':scope > svg').first()
  const [from, sourceRow, to, childrenTop] = await Promise.all([
    handle.boundingBox(),
    source.boundingBox(),
    target.boundingBox(),
    target.evaluate(
      row => row.querySelector(':scope > [data-reorder-child-list]')?.getBoundingClientRect().top ?? null,
    ),
  ])
  if (!from || !sourceRow || !to) throw Error('The drag source and target must both be visible.')
  const x = horizontal < 0 ? Math.max(from.x + from.width / 2, to.x - horizontal + 8) : from.x + from.width / 2
  if (x > sourceRow.x + sourceRow.width) throw Error('Start the drag inside its visible row.')
  const y = from.y + from.height / 2
  await page.mouse.move(x, y)
  await page.mouse.down()
  if (afterPress) await afterPress()
  // Start the browser's native drag before moving across the row.
  await page.mouse.move(x, y + 8)
  // The parent row excludes its nested list from its hit area.
  const targetHeight = childrenTop === null ? to.height : childrenTop - to.y
  const destinationX = x + horizontal
  const destinationY = to.y + targetHeight * (after ? 0.78 : 0.22)
  await page.mouse.move(destinationX, destinationY, { steps: 12 })
  // Move again inside the target so Chromium delivers dragover after dragenter.
  await page.mouse.move(destinationX + 1, destinationY)
  await page.mouse.move(destinationX, destinationY)
  await expect(source).toHaveAttribute('data-reorder-source', 'true')
}

for (const width of [1440, 1024]) {
  test(`Header menu pointer moves show the exact insertion gap and persist at ${width}px`, async ({ page }, info) => {
    test.setTimeout(120_000)
    const fixture = await siteLookFixture()
    const client = await fixture.pool.connect()
    const { site: siteId, host: hostname } = fixture
    let releasePreview = () => {}
    const waitForPress = new Promise<void>(resolve => {
      releasePreview = resolve
    })
    try {
      const {
        rows: [{ id: actor }],
      } = await client.query("SELECT id FROM app_users WHERE email='root@example.test'")
      const tree = [
        item('Home'),
        item('About'),
        { ...item('Programs'), children: [item('Program detail')] },
        item('Contact'),
      ]
      await client.query('BEGIN')
      await client.query('SET LOCAL ROLE cms_authenticated_user')
      await client.query("SELECT set_config('app.user_id',$1,true)", [actor])
      const {
        rows: [head],
      } = await client.query('SELECT revision FROM navigations WHERE site_id=$1', [siteId])
      await client.query("SELECT * FROM app.save_navigation_draft($1,$2,$3::jsonb,'manual')", [
        siteId,
        head.revision,
        JSON.stringify(tree),
      ])
      await client.query('COMMIT')
      await page.setViewportSize({ width, height: 900 })
      await signIn(page, 'root@example.test')
      if (width === 1024) {
        await page.route(
          url => url.pathname.startsWith('/__cms/canvas/') && url.searchParams.get('visit') === '1',
          async route => {
            await waitForPress
            await route.continue()
          },
        )
      }
      await page.goto('/sites/' + siteId + '/header', { waitUntil: 'domcontentloaded' })
      const menu = page.getByRole('region', { name: 'Main menu', exact: true })
      const row = (label: string) =>
        menu.locator('li[data-reorder-row]:has(> button[title=' + JSON.stringify(label) + '])')
      const save = page.getByRole('button', { name: 'Save draft', exact: true })
      const marker = menu.locator('[data-drop-marker]')
      const topOrder = () =>
        menu.locator('li[data-reorder-row]:not([data-nested]) > button:first-of-type').allTextContents()
      const verify = (labels: string[]) =>
        expect.poll(async () => (await topOrder()).map(label => label.trim())).toEqual(labels)
      await verify(['Home', 'About', 'Programs', 'Contact'])
      await expect(save).toBeDisabled()
      const drop = async (
        from: string,
        to: string,
        after: boolean,
        dx = 0,
        capture?: string,
        afterPress?: () => Promise<void>,
      ) => {
        await grab(page, row(from), row(to), after, dx, afterPress)
        await expect(marker).toBeVisible()
        if (capture) await page.screenshot({ path: info.outputPath(capture + '.png') })
        await page.mouse.up()
        await expect(marker).toHaveCount(0)
      }
      const preview = page.frameLocator('iframe[title="Header preview"]')
      const previewNav = preview.getByRole('navigation', { name: 'Main', exact: true })
      const openPreviewMidDrag =
        width === 1024
          ? async () => {
              const before = await row('Home').boundingBox()
              expect(before).not.toBeNull()
              releasePreview()
              await expect(previewNav.getByRole('link', { name: 'Home', exact: true })).toBeVisible()
              expect((await row('Home').boundingBox())?.y).toBe(before!.y)
            }
          : undefined
      await drop('Home', 'Contact', true, 0, 'first-to-last-mid-drag', openPreviewMidDrag)
      await verify(['About', 'Programs', 'Contact', 'Home'])
      await drop('Home', 'About', false)
      await verify(['Home', 'About', 'Programs', 'Contact'])
      await drop('Home', 'About', true)
      await verify(['About', 'Home', 'Programs', 'Contact'])
      await drop('Home', 'About', false)
      await verify(['Home', 'About', 'Programs', 'Contact'])

      await drop('Contact', 'Programs', true, 45, 'into-dropdown-mid-drag')
      await expect(row('Contact')).toHaveAttribute('data-nested', 'true')
      await verify(['Home', 'About', 'Programs'])
      await drop('Contact', 'About', false, -34)
      await expect(row('Contact')).not.toHaveAttribute('data-nested')
      await verify(['Home', 'Contact', 'About', 'Programs'])
      await drop('Programs', 'Home', false)
      await verify(['Programs', 'Home', 'Contact', 'About'])
      await expect(row('Program detail')).toHaveAttribute('data-nested', 'true')

      await grab(page, row('Programs'), row('Home'), true, 46)
      await expect(marker).toHaveCount(0)
      await expect(row('Home')).toHaveAttribute('data-reorder-blocked', 'true')
      await page.screenshot({ path: info.outputPath('blocked-mid-drag.png') })
      await page.mouse.up()
      await expect(menu.locator('[data-reorder-announcement]')).toContainText('Menus go two levels deep')
      await verify(['Programs', 'Home', 'Contact', 'About'])

      await grab(page, row('About'), row('Programs'), false)
      await expect(marker).toBeVisible()
      await page.keyboard.press('Escape')
      await page.mouse.up()
      await expect(marker).toHaveCount(0)
      await verify(['Programs', 'Home', 'Contact', 'About'])

      await save.click()
      await expect(page.getByRole('status').filter({ hasText: 'Header & menu draft saved.' })).toBeVisible()
      await page.reload()
      await verify(['Programs', 'Home', 'Contact', 'About'])
      await grab(page, row('About'), row('About'), false)
      await expect(marker).toHaveCount(0)
      await page.mouse.up()
      await expect(save).toBeDisabled()
      await expect(previewNav.getByRole('link', { name: 'Programs', exact: true })).toBeVisible()
      const order = (links: Locator) => links.allTextContents().then(names => names.map(name => name.trim()))
      const previewOrder = await order(previewNav.getByRole('link'))
      expect(previewOrder).toEqual(['Programs', 'Home', 'Contact', 'About'])
      await page.getByRole('link', { name: 'Publish…', exact: true }).click()
      const publish = page.getByRole('button', { name: /^Publish selected \(\d+\)$/ })
      const review = page.getByRole('heading', { name: 'Check selected changes', exact: true })
      const confirm = page.getByRole('alertdialog', { name: 'Publish selected changes?', exact: true })
      await publish.click()
      await expect(review.or(confirm)).toBeVisible()
      if (await review.isVisible()) {
        await expect(publish).toBeEnabled()
        await publish.click()
      }
      await confirm.getByRole('button', { name: 'Publish selected', exact: true }).click()
      await expect(page.getByRole('status').filter({ hasText: 'Release applied.' })).toBeVisible()
      await expect
        .poll(async () => {
          const {
            rows: [saved],
          } = await client.query('SELECT draft_version_id,published_version_id FROM navigations WHERE site_id=$1', [
            siteId,
          ])
          return saved.draft_version_id === saved.published_version_id
        })
        .toBe(true)
      await page.goto(`http://${hostname}:${SITE_PORT}/`)
      const publishedNav = page.getByRole('navigation', { name: 'Main', exact: true })
      await expect.poll(() => order(publishedNav.getByRole('link'))).toEqual(previewOrder)
    } finally {
      releasePreview()
      await client.query('ROLLBACK').catch(() => {})
      await client.query('UPDATE sites SET archived_at=now() WHERE id=$1', [siteId])
      client.release()
      await fixture.pool.end()
    }
  })
}
