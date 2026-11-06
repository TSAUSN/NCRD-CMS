import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { test, expect, type Page } from '@playwright/test'
import { compileSection } from '../../packages/renderer/src/index.ts'
import { siteLookFixture } from './fixtures/r8-site-look.ts'
import { signIn } from './helpers.ts'
import { rawRequest } from './http.ts'
async function fixture() {
  const f = await siteLookFixture(),
    c = await f.pool.connect(),
    pins = []
  let released = false
  try {
    await c.query('BEGIN')
    await c.query(
      "SELECT set_config('app.user_id',(SELECT id::text FROM app_users WHERE email='root@example.test'),true)",
    )
    const components = []
    for (const kind of ['header', 'footer']) {
      const slots =
        kind === 'header'
          ? [
              {
                id: 'menu',
                kind: 'navigation' as const,
                label: 'Menu',
                constraints: { menuStyle: 'bt2027-bootstrap5' },
              },
            ]
          : [
              { id: 'title', kind: 'text' as const, label: 'Footer invitation', constraints: {} },
              {
                id: 'destination',
                kind: 'link' as const,
                label: 'Contact link',
                constraints: { destinationOnly: true },
              },
            ]
      const html =
          kind === 'header'
            ? '<nav class="navbar fixed-top" style="position:fixed;top:0">{{menu}}</nav>'
            : '<div class="footer"><a href="{{destination}}">{{title}}</a></div>',
        compiled = compileSection({ sourceHtml: html, slots })
      const id = (
        await c.query(
          'SELECT section_def_id FROM app.upsert_section_def_version($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)',
          [
            'original-' + kind + '-' + f.site.slice(0, 8),
            kind,
            'Original',
            html,
            '',
            '',
            JSON.stringify(compiled.ast),
            JSON.stringify(slots),
            compiled.renderHash,
            compiled.ast.policyVersion,
            compiled.ast.cssPolicyVersion,
            'Local original frame',
            false,
            'legacy',
            null,
            null,
            'site',
            f.site,
          ],
        )
      ).rows[0]!.section_def_id
      await c.query('SELECT app.set_section_def_placement($1,$2)', [id, kind])
      pins.push({ section_def_id: id, section_def_version: 1 })
      components.push({
        section_def_id: id,
        section_def_version: 1,
        values:
          kind === 'header'
            ? {}
            : { title: 'Original invitation', destination: { url: 'mailto:original@example.test', label: 'Contact' } },
      })
    }
    const heads = (await c.query('SELECT kind,revision FROM global_elements WHERE site_id=$1', [f.site])).rows
    await c.query('SELECT app.save_global_elements_draft($1,$2,$3,$4,$5)', [
      f.site,
      heads.find(h => h.kind === 'header')!.revision,
      heads.find(h => h.kind === 'footer')!.revision,
      JSON.stringify({ schemaVersion: 2, enabled: true, sticky: false, component: components[0] }),
      JSON.stringify({ schemaVersion: 2, enabled: true, component: components[1] }),
    ])
    const nav = (await c.query('SELECT revision FROM navigations WHERE site_id=$1', [f.site])).rows[0]!
    await c.query('SELECT app.save_navigation_draft($1,$2,$3,$4)', [
      f.site,
      nav.revision,
      JSON.stringify([
        { label: 'Welcome', target: { type: 'page', page_id: f.pages[0] }, visible: true },
        {
          label: 'More',
          target: { type: 'url', url: '/' },
          visible: true,
          children: [{ label: 'Visit', target: { type: 'page', page_id: f.pages[1] }, visible: true }],
        },
      ]),
      'manual',
    ])
    await c.query('SELECT app.save_site_file_bundle($1,0,$2)', [
      f.site,
      JSON.stringify({
        version: 1,
        files: [],
        styles: [],
        scripts: [],
        original: {
          version: 1,
          definitions: pins,
          pages: f.pages.map((pageId, i) => ({
            pageId,
            html: { lang: 'en' },
            body: {},
            header: i === 0,
            footer: true,
          })),
          newPages: { html: { lang: 'en' }, body: {}, header: true, footer: true },
        },
      }),
    ])
    await c.query('COMMIT')
    return f
  } catch (error) {
    await c.query('ROLLBACK')
    c.release()
    released = true
    await f.pool.end()
    throw error
  } finally {
    if (!released) c.release()
  }
}
async function capture(page: Page, name: string, engine: string) {
  const folder = resolve('../.r8-progress/step-5/original-frame/' + engine)
  await mkdir(folder, { recursive: true })
  for (const width of [1440, 1024]) {
    await page.setViewportSize({ width, height: width === 1440 ? 900 : 768 })
    await expect(page.getByText('Updating site preview…', { exact: true })).toHaveCount(0)
    const look = page.locator('iframe[title="Site look page preview"]')
    if (await look.count())
      await expect
        .poll(() =>
          look.evaluate(frame => {
            const canvas = frame.parentElement!.parentElement!,
              style = getComputedStyle(canvas),
              available = canvas.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight)
            return Math.abs(frame.getBoundingClientRect().width - Math.min(frame.clientWidth, available)) < 1
          }),
        )
        .toBe(true)
    const viewport = page.locator('.canvas-viewport')
    if (await viewport.count())
      await expect
        .poll(() =>
          viewport.evaluate(node => {
            const frame = node.querySelector('iframe')
            return (
              !frame ||
              node.getAttribute('data-zoom') !== 'fit' ||
              Math.abs(
                frame.getBoundingClientRect().width -
                  Math.min(
                    node.clientWidth - parseFloat(getComputedStyle(node).paddingInlineStart || '0'),
                    parseFloat(getComputedStyle(frame).width),
                  ),
              ) < 2
            )
          }),
        )
        .toBe(true)
    await page.screenshot({ path: resolve(folder, name + '-' + width + '.png'), animations: 'disabled' })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  }
  await page.setViewportSize({ width: 1440, height: 900 })
}
test('brought-in sites expose original menu and footer fields with accurate page impact and no theme controls', async ({
  page,
}, info) => {
  test.setTimeout(120000)
  const f = await fixture(),
    errors: string[] = []
  page.on('pageerror', e => errors.push(e.message))
  try {
    await signIn(page, 'editor@example.test')
    await page.goto('/sites/' + f.site + '/design')
    await expect(page.getByRole('heading', { name: 'Menu & footer', exact: true })).toBeVisible()
    await expect(page.getByLabel('Theme preset', { exact: true })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Style', exact: true })).toHaveCount(0)
    const preview = page.frameLocator('iframe[title="Site look page preview"]'),
      panel = page.getByRole('complementary', { name: 'Site-wide settings', exact: true })
    await expect(preview.locator('h1')).toHaveText('Welcome')
    await expect(panel).toContainText('Menu — on 1 page.')
    await expect(panel.getByText('Opens the links below.', { exact: true })).toBeVisible()
    await capture(page, 'menu', info.project.name)
    await panel.getByLabel('Menu label', { exact: true }).first().fill('Conference home')
    await expect(preview.locator('nav').getByRole('link', { name: 'Conference home', exact: true })).toBeVisible()
    await panel.getByRole('button', { name: 'Save site-wide draft', exact: true }).click()
    await expect(panel.getByRole('button', { name: 'Save site-wide draft', exact: true })).toBeDisabled()
    const outerScroll = await page.evaluate(() => scrollY)
    await page.getByRole('button', { name: 'Footer', exact: true }).click()
    await expect(panel).toContainText('Footer — on 2 pages.')
    await expect(preview.locator('.footer a')).toBeInViewport()
    expect(await page.evaluate(() => scrollY)).toBe(outerScroll)
    await panel.getByLabel('Footer invitation', { exact: true }).fill('Come together')
    await panel.getByLabel('Contact link destination', { exact: true }).fill('mailto:coordinator@example.test')
    await expect(preview.locator('.footer a')).toHaveText('Come together')
    await expect(preview.locator('.footer a')).toHaveAttribute('href', 'mailto:coordinator@example.test')
    await capture(page, 'footer-private', info.project.name)
    await page.getByLabel('Preview page', { exact: true }).selectOption({ label: 'Visit us' })
    await expect(preview.locator('h1')).toHaveText('Visit us')
    await expect(preview.locator('.footer a')).toHaveText('Come together')
    await page.getByRole('button', { name: 'Phone', exact: true }).click()
    await capture(page, 'footer-second-page-phone', info.project.name)
    await panel.getByRole('button', { name: 'Save site-wide draft', exact: true }).click()
    await expect(panel.getByRole('button', { name: 'Save site-wide draft', exact: true })).toBeDisabled()
    expect((await rawRequest({ host: f.host, path: '/' })).body).not.toContain('Come together')
    await page.getByRole('button', { name: 'Publish menu & footer', exact: true }).click()
    const review = page.getByRole('dialog', { name: 'Publish menu & footer', exact: true })
    await expect(review.getByRole('listitem')).toHaveCount(2)
    await capture(page, 'affected-pages', info.project.name)
    await review.getByRole('button', { name: 'Cancel', exact: true }).click()
    expect(errors).toEqual([])
  } finally {
    await f.pool.end()
  }
})
test('collapsed Structure keeps its close button reachable and closes after choosing a section', async ({
  page,
}, info) => {
  const f = await fixture()
  try {
    await page.setViewportSize({ width: 1024, height: 768 })
    await signIn(page, 'editor@example.test')
    await page.goto('/pages/' + f.pages[0])
    await expect(page.locator('#editor-panes')).toHaveAttribute('data-collapsed', 'true')
    const tree = page.getByRole('complementary', { name: 'Page structure', exact: true })
    await page.getByRole('button', { name: 'Open Structure', exact: true }).click()
    await expect(tree).toBeVisible()
    await page.getByRole('button', { name: 'Close Structure', exact: true }).click()
    await expect(tree).toBeHidden()
    await page.getByRole('button', { name: 'Open Structure', exact: true }).click()
    await tree.locator('.tree-label').first().click()
    await expect(tree).toBeHidden()
    await expect(page.getByRole('button', { name: 'Open Structure', exact: true })).toHaveAttribute(
      'aria-expanded',
      'false',
    )
    await expect(page.getByRole('complementary', { name: 'Inspector', exact: true })).toBeVisible()
    await capture(page, 'collapsed-structure-selection', info.project.name)
  } finally {
    await f.pool.end()
  }
})
test('Contributors see the original-design workspace with clear access guidance and no site-wide editing', async ({
  page,
}, info) => {
  test.setTimeout(60000)
  const f = await fixture()
  try {
    await signIn(page, 'contributor@example.test')
    await page.goto('/sites/' + f.site + '/design')
    await expect(page.getByRole('heading', { name: 'Menu & footer', exact: true })).toBeVisible()
    await expect(page.getByText('An editor can change this site-wide area.', { exact: true })).toBeVisible()
    await expect(page.getByLabel('Theme preset', { exact: true })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Save site-wide draft', exact: true })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Publish menu & footer', exact: true })).toHaveCount(0)
    await page.getByRole('button', { name: 'Footer', exact: true }).click()
    await expect(page.getByRole('textbox', { name: 'Footer invitation', exact: true })).toHaveCount(0)
    await capture(page, 'contributor', info.project.name)
  } finally {
    await f.pool.end()
  }
})
test('an Editor creates a template page using reviewed new-page frame defaults without changing the original pages', async ({
  page,
}, info) => {
  test.setTimeout(90000)
  const f = await fixture(),
    errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('console', message => {
    if (message.type() === 'error') errors.push(message.text())
  })
  try {
    await signIn(page, 'editor@example.test')
    await page.goto('/sites/' + f.site)
    await page.getByRole('button', { name: 'Add a page', exact: true }).click()
    const creator = page.getByRole('dialog', { name: 'Create a page', exact: true })
    await creator.getByLabel('What is this page called?', { exact: true }).fill('Hotel information template copy')
    await creator.getByLabel('Web address', { exact: true }).fill('hotel-template-copy')
    await creator.getByLabel('Page template', { exact: true }).selectOption('visit')
    await creator.getByRole('button', { name: 'Create this page', exact: true }).click()
    await expect(creator).toBeHidden()
    await expect(page).toHaveURL(/\/pages\/[0-9a-f-]{36}$/)
    await expect(page.getByRole('link', { name: 'Menu & footer', exact: true }).first()).toBeVisible()
    await page.getByRole('button', { name: 'Preview', exact: true }).click()
    await page.getByLabel('Preview with saved menu & footer changes', { exact: true }).check()
    await page.keyboard.press('Escape')
    const canvas = page.frameLocator('iframe[title="Page canvas"]')
    await expect(canvas.locator('nav.navbar a').first()).toHaveText('Welcome')
    await expect(canvas.locator('.footer a')).toHaveText('Original invitation')
    expect(await canvas.locator('body').evaluate(() => document.compatMode)).toBe('CSS1Compat')
    await expect(canvas.locator('nav.navbar')).toHaveCSS('position', 'sticky')
    await expect
      .poll(() =>
        canvas
          .locator('h1')
          .evaluate(
            title =>
              title.getBoundingClientRect().top >= document.querySelector('nav.navbar')!.getBoundingClientRect().bottom,
          ),
      )
      .toBe(true)
    await capture(page, 'new-template-original-frame', info.project.name)
    await page.getByRole('button', { name: 'Phone', exact: true }).click()
    await expect
      .poll(() =>
        canvas
          .locator('h1')
          .evaluate(
            title =>
              title.getBoundingClientRect().top >= document.querySelector('nav.navbar')!.getBoundingClientRect().bottom,
          ),
      )
      .toBe(true)
    await capture(page, 'new-template-phone', info.project.name)
    const pages = (await f.pool.query('SELECT id FROM pages WHERE site_id=$1 AND archived_at IS NULL', [f.site])).rows
    expect(pages).toHaveLength(3)
    expect(pages.map(p => p.id)).toEqual(expect.arrayContaining(f.pages))
    const bundle = (
      await f.pool.query(
        'SELECT v.bundle FROM site_file_heads h JOIN site_file_versions v ON v.id=h.draft_version_id WHERE h.site_id=$1',
        [f.site],
      )
    ).rows[0]!.bundle
    expect(bundle.original.pages).toHaveLength(2)
    expect(bundle.original.newPages).toEqual({ html: { lang: 'en' }, body: {}, header: true, footer: true })
    expect(bundle.scripts).toEqual([])
    expect((await rawRequest({ host: f.host, path: '/hotel-template-copy' })).status).toBe(404)
    expect(errors).toEqual([])
  } finally {
    await f.pool.end()
  }
})
