import { expect, test } from '@playwright/test'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { compileSection, sectionScopeSelector } from '@cms/renderer'
import { importWebsite } from '../../packages/importer/src/website.ts'
import { renderPage } from '@cms/renderer'
import { sourceShell } from '../../packages/importer/src/source-shell.ts'
import { frameComponent, sourceHeaderFrame } from '../../packages/importer/src/frame-components.ts'

// Safari on macOS uses Option-Tab to include links unless the user has enabled
// full Tab navigation. Exercise its native link-navigation key, not an assumed
// Chromium preference (Apple's Safari keyboard-shortcuts reference).
async function nextLink(page: import('@playwright/test').Page, browserName: string) {
  await page.keyboard.press(browserName === 'webkit' && process.platform === 'darwin' ? 'Alt+Tab' : 'Tab')
}

test('an imported wide partner logo remains readable and contained on phones', async ({ page }) => {
  const logo =
    'data:image/svg+xml,' +
    encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="250"><rect width="1200" height="250" fill="#7a0019"/></svg>',
    )
  const html = `<header><a href="https://philanthropy.example.test/about"><img src="${logo}" width="1200" height="250" alt="Partner logo"></a></header><footer></footer>`
  const shell = sourceShell(
    {
      records: [
        {
          key: 'source/tsa-humanneedsindex/index.html',
          payload: { text: html },
          kind: 'site-source',
          sourceSite: 'humanneedsindex',
          sourceSha256: 'a'.repeat(64),
          issues: [],
        },
      ],
    },
    'humanneedsindex',
    [],
    new Map(),
  )
  const section = shell.supplemental.find(item => item.label === 'Source partnership')!
  for (const width of [320, 390, 1280]) {
    await page.setViewportSize({ width, height: 600 })
    await page.setContent(
      `<style>body{margin:0;font:16px Arial}*{box-sizing:border-box}${section.css}</style>${section.html}`,
    )
    const image = page.getByRole('img', { name: 'Partner logo' })
    await expect.poll(() => image.evaluate(element => (element as HTMLImageElement).naturalWidth)).toBe(1200)
    const bounds = await image.boundingBox()
    expect(bounds!.x).toBeGreaterThanOrEqual(24)
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width - 24)
    expect(bounds!.height).toBeGreaterThan(45)
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width)
    const label = await page.getByText('In partnership with').boundingBox()
    expect(label!.height).toBeLessThan(24)
    if (width < 400) expect(bounds!.y).toBeGreaterThan(label!.y + label!.height)
    else expect(Math.abs(bounds!.y + bounds!.height / 2 - label!.y - label!.height / 2)).toBeLessThan(2)
  }
})

const nativeEchelon = readFileSync(
  new URL('../../packages/importer/src/__fixtures__/echelon-frame.html', import.meta.url),
  'utf8',
)
const nativeEchelonCss = readFileSync(
  new URL('../../packages/importer/src/__fixtures__/echelon-frame.css', import.meta.url),
  'utf8',
)

test('a generic Bootstrap import gives phone visitors a keyboard-operated menu with working shared links', async ({
  page,
  browserName,
}) => {
  const root = mkdtempSync(join(tmpdir(), 'cms-bootstrap-menu-'))
  try {
    writeFileSync(
      join(root, 'index.html'),
      '<html><head><title>Fictional event</title></head><body>' +
        '<nav class="navbar navbar-expand-lg"><div class="container"><a class="navbar-brand" href="index.html">Fictional event</a>' +
        '<button class="navbar-toggler" aria-label="Toggle navigation"></button><div class="collapse navbar-collapse">' +
        '<ul><li><a href="#about">About</a></li><li><a href="hotels.html">Hotels</a></li></ul></div></div></nav>' +
        '<main><section id="about"><h1>Fictional event</h1></section></main><footer><a href="#about">About this event</a></footer></body></html>',
    )
    writeFileSync(
      join(root, 'hotels.html'),
      '<html><head><title>Hotels</title></head><body><main><h1>Hotels</h1></main></body></html>',
    )
    const { archive } = await importWebsite({
      root,
      name: 'Fictional event',
      slug: 'fictional-bootstrap',
      kind: 'event',
    })
    const content = archive.content
    const component = (kind: 'header' | 'footer') => {
      const head = content.global_elements.find(row => row.kind === kind)!
      const frame = content.global_element_versions.find(row => row.id === head.draft_version_id)!.content as {
        component: { section_def_id: string }
      }
      const definition = content.section_defs.find(row => row.id === frame.component.section_def_id)!
      const version = content.section_def_versions.find(row => row.section_def_id === definition.id)!
      const compiled = compileSection({
        sourceHtml: version.source_html,
        sourceCss: version.source_css,
        slots: version.slots,
        scopeSelector: sectionScopeSelector(definition.slug)!,
      })
      expect(compiled.blocking).toEqual([])
      return {
        frame,
        definition: {
          section_def_id: definition.id,
          version: version.version,
          slug: definition.slug,
          compiled_ast: compiled.ast,
          css: compiled.css,
          slots: version.slots,
          sanitizer_policy_version: compiled.ast.policyVersion,
          css_policy_version: compiled.ast.cssPolicyVersion,
        },
      }
    }
    const header = component('header'),
      footer = component('footer')
    const html = renderPage({
      manifest: {
        page: { id: 'preview', version_id: 'preview', title: 'Hotels', path: '/hotels' },
        meta: {},
        sections: [],
      },
      shell: {
        site: { id: 'preview', name: 'Fictional event', slug: 'fictional-bootstrap' },
        theme: {},
        canonical_host: null,
        staging_host: null,
        navigation: content.navigation_versions[0]!.tree,
        header: header.frame,
        footer: footer.frame,
        header_component: header.definition,
        footer_component: footer.definition,
      },
      isStaging: true,
    }).html
    await page.setViewportSize({ width: 390, height: 800 })
    await page.setContent(html)
    const banner = page.getByRole('banner'),
      menu = banner.getByRole('navigation', { name: 'Mobile navigation' })
    await expect(menu).toBeHidden()
    await banner.getByLabel('Menu', { exact: true }).focus()
    await page.keyboard.press('Enter')
    await expect(menu).toBeVisible()
    await nextLink(page, browserName)
    await expect(menu.getByRole('link', { name: 'About', exact: true })).toBeFocused()
    await expect(menu.getByRole('link', { name: 'About', exact: true })).toHaveAttribute('href', '/#about')
    await expect(menu.getByRole('link', { name: 'Hotels' })).toHaveAttribute('href', '/hotels')
    await expect(page.getByRole('contentinfo').getByRole('link', { name: 'About this event' })).toHaveAttribute(
      'href',
      '/#about',
    )
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390)
    await page.screenshot({ path: test.info().outputPath('generic-import-menu-phone.png') })
    await page.setViewportSize({ width: 1280, height: 800 })
    await expect(menu).toBeHidden()
    await expect(banner.getByRole('link', { name: 'About', exact: true })).toBeVisible()
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

// The HNI adapter's two-row/Tailwind menu structure. This small fixture tests
// menu behavior; full source-site visual comparison is separate evidence.
const hniMenuSource = `<header class="fixed top-0 bg-white">
  <div class="brand-row"><a href="/">Human Needs Index</a>
    <button class="sm:hidden" aria-controls="mobile-menu" aria-label="Menu">Menu</button></div>
  <div class="hidden sm:block"><nav aria-label="Main navigation"><div class="desktop-row"><a href="#source-only">Source menu</a></div></nav></div>
  <nav id="mobile-menu" class="hidden sm:hidden bg-white" aria-label="Mobile navigation"><a href="#source-only">Source menu</a></nav>
</header>`
const hniMenuCss = `:root{--color-sa-dark:#172333;--color-primary:#b5121b;--font-body:Arial}
  body{margin:0}*{box-sizing:border-box}.bg-white{background:#fff}.hidden{display:none}
  .brand-row{display:flex;align-items:center;justify-content:space-between;padding:1rem}
  .desktop-row{padding:1rem}.sm\\:hidden{display:block}
  @media(min-width:640px){.sm\\:hidden{display:none}.sm\\:block{display:block}}`

function headerDocument(source: string, css: string, slug: string) {
  const id = '33333333-3333-4333-8333-333333333333'
  const component = frameComponent({
    slug,
    frame: sourceHeaderFrame(source),
    builtCss: css,
    assets: new Map([
      [
        '/images/echelon-leaders-symposium-logo.png',
        {
          mediaId: '11111111-1111-4111-8111-111111111111',
          url: '/media/11111111-1111-4111-8111-111111111111/original',
        },
      ],
    ]),
    links: new Map(),
  })
  return renderPage({
    manifest: {
      page: { id: 'preview', version_id: 'preview', title: 'Authored frame behavior', path: '/' },
      meta: {},
      sections: [],
    },
    shell: {
      site: { id: 'site', name: 'Frame fixture', slug: 'frame' },
      theme: {},
      canonical_host: null,
      staging_host: null,
      navigation: [
        {
          label: 'About',
          visible: true,
          target: { type: 'url', url: '#about' },
          children: [{ label: 'Overview', visible: true, target: { type: 'url', url: '#overview' } }],
        },
        { label: 'Speakers', visible: true, target: { type: 'url', url: '#speakers' } },
        { label: 'Agenda', visible: true, target: { type: 'url', url: '#agenda' } },
        { label: 'Resources', visible: true, target: { type: 'url', url: '#resources' } },
      ],
      header: {
        schemaVersion: 2,
        enabled: true,
        sticky: true,
        component: { section_def_id: id, section_def_version: 1, values: component.values },
      },
      header_component: {
        section_def_id: id,
        version: 1,
        slug: component.slug,
        compiled_ast: component.compiled.ast,
        css: component.compiled.css,
        slots: component.slots,
        sanitizer_policy_version: component.compiled.ast.policyVersion,
        css_policy_version: component.compiled.ast.cssPolicyVersion,
      },
    },
    isStaging: true,
  }).html
}

test('authored HNI child links remain reachable by keyboard on desktop and inside the phone disclosure', async ({
  page,
  browserName,
}) => {
  const html = headerDocument(hniMenuSource, hniMenuCss, 'hni-menu-test')
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.setContent(html)
  const header = page.getByRole('banner')
  const desktop = header.getByRole('navigation', { name: 'Main navigation', exact: true })
  const child = desktop.getByRole('link', { name: 'Overview', exact: true })
  await expect(child).toBeHidden()
  await desktop.getByRole('link', { name: 'About', exact: true }).focus()
  await expect(child).toBeVisible()
  await nextLink(page, browserName)
  await expect(child).toBeFocused()
  await expect(child).toHaveAttribute('href', '#overview')
  await page.screenshot({ path: test.info().outputPath('hni-child-menu-desktop.png') })

  await page.setViewportSize({ width: 390, height: 800 })
  await expect(desktop).toBeHidden()
  const phone = header.getByRole('navigation', { name: 'Mobile navigation', exact: true })
  await expect(phone).toBeHidden()
  const disclosure = header.locator('details')
  await disclosure.locator('summary').focus()
  await page.keyboard.press('Enter')
  await expect(disclosure).toHaveAttribute('open', '')
  await expect(phone.getByRole('link', { name: 'Overview', exact: true })).toBeVisible()
  await nextLink(page, browserName)
  await expect(phone.getByRole('link', { name: 'About', exact: true })).toBeFocused()
  await nextLink(page, browserName)
  await expect(phone.getByRole('link', { name: 'Overview', exact: true })).toBeFocused()
  await expect(header.locator('a[href="#source-only"]')).toHaveCount(0)
  await page.screenshot({ path: test.info().outputPath('hni-child-menu-phone.png') })
})

test('native Echelon frame keeps its responsive menu, original registration state and valid links', async ({
  page,
  browserName,
}) => {
  const html = headerDocument(nativeEchelon, nativeEchelonCss, 'echelon-menu-test')
  // Media is a deterministic transport fixture here. The real source logo,
  // fonts and page content belong to the separate source-fidelity review.
  await page.route('http://frame.test/**', async route => {
    if (new URL(route.request().url()).pathname.startsWith('/media/')) {
      await route.fulfill({
        contentType: 'image/svg+xml',
        body: '<svg xmlns="http://www.w3.org/2000/svg" width="50" height="50"><rect width="50" height="50" fill="#d45b51"/></svg>',
      })
    } else await route.fulfill({ contentType: 'text/html', body: html })
  })
  for (const width of [390, 900, 1280]) {
    await page.setViewportSize({ width, height: 800 })
    await page.goto('http://frame.test/')
    const header = page.getByRole('banner')
    await expect(header).toHaveCSS('position', 'sticky')
    await expect(header.locator('.site-header')).toHaveCSS('position', 'relative')
    await expect(header.locator('.brand strong')).toHaveText('ECHELON')
    await expect(header.locator('a a, a ul')).toHaveCount(0)
    for (const label of ['About', 'Overview', 'Speakers', 'Agenda', 'Resources']) {
      // One governed copy for each viewport, with no source anchors left over.
      await expect(header.getByRole('link', { name: label, exact: true, includeHidden: true })).toHaveCount(2)
    }
    const registration = header.locator('[data-registration-cta]')
    await expect(registration).toHaveCount(2)
    await expect(registration.nth(0)).toBeHidden()
    await expect(registration.nth(1)).toBeHidden()
    const desktop = header.getByRole('navigation', { name: 'Primary navigation', exact: true })
    const phone = header.getByRole('navigation', { name: 'Mobile navigation', exact: true })
    const disclosure = header.locator('.echelon-mobile-menu')
    if (width <= 900) {
      await expect(desktop).toBeHidden()
      await expect(disclosure.locator('summary')).toBeVisible()
      await expect(phone).toBeHidden()
      await disclosure.locator('summary').click()
      await expect(phone).toBeVisible()
      await expect(phone.getByRole('link', { name: 'Overview', exact: true })).toBeVisible()
      for (const label of ['About', 'Speakers', 'Agenda', 'Resources']) {
        await expect(header.getByRole('link', { name: label, exact: true })).toHaveCount(1)
      }
    } else {
      await expect(desktop).toBeVisible()
      await expect(disclosure).toBeHidden()
      await desktop.getByRole('link', { name: 'About', exact: true }).focus()
      await nextLink(page, browserName)
      await expect(desktop.getByRole('link', { name: 'Overview', exact: true })).toBeFocused()
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width)
    await page.screenshot({ path: test.info().outputPath(`echelon-frame-${width}.png`) })
  }
})
