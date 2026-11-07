import { E2E_PORTS } from '../../test-ports.ts'
import { test, expect } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { compileSection, renderPage, CSS_POLICY_VERSION, type SiteShell } from '@cms/renderer'
import { compileSeedSection } from '@cms/seeds'
import { NATIONAL_LIBRARY, NATIONAL_FOOTER } from '@cms/seeds/national-library'
import { CORE_LIBRARY, compileCoreSection, corePreviewValues } from '@cms/seeds/core-library'
import { SAWSO_THEME } from '@cms/seeds/core-themes'
import { DEFAULT_BUTTON_APPEARANCE } from '@cms/schema'
test('national template keeps reports, accountability and teams on white surfaces at every public width', async ({
  browser,
}) => {
  const compiled = compileSection({
    sourceHtml: '<section><h2>{{title}}</h2><p>{{intro}}</p><a href="/">Read more</a></section>',
    sourceCss: '',
    slots: [
      { id: 'title', kind: 'text', label: 'Title', constraints: {} },
      { id: 'intro', kind: 'text', label: 'Introduction', constraints: {} },
    ],
  })
  const shell: SiteShell = {
    site: { id: 'sample', slug: 'sample', name: '[Site]' },
    theme: SAWSO_THEME,
    navigation: [],
    canonical_host: null,
    staging_host: null,
  }
  const sections = ['Annual Reports', 'Financial Accountability', 'Meet Our Team'].map((title, i) => ({
    instance: {
      section_def_id: 'sample-' + i,
      section_def_version: 1,
      values: { title, intro: '[Approved text — sample content]' },
    },
    def: {
      section_def_id: 'sample-' + i,
      slug: 'ordinary-' + i,
      version: 1,
      compiled_ast: compiled.ast,
      css: compiled.css,
      css_policy_version: CSS_POLICY_VERSION,
    },
  }))
  const html = renderPage({
    manifest: { page: { id: 'sample', version_id: 'sample', title: '[Page]', path: '/' }, meta: {}, sections },
    shell,
    isStaging: true,
  }).html
  const context = await browser.newContext({ javaScriptEnabled: false })
  try {
    const page = await context.newPage(),
      folder = resolve('../.r8-progress/round3/white-panels')
    await mkdir(folder, { recursive: true })
    for (const width of [1440, 1024, 390]) {
      await page.setViewportSize({ width, height: 900 })
      await page.setContent(html)
      await expect(page.locator('.national-content-panel')).toHaveCount(3)
      for (const panel of await page.locator('.national-content-panel').all())
        await expect(panel).toHaveCSS('background-color', 'rgb(255, 255, 255)')
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      await page.screenshot({ path: resolve(folder, 'public-' + width + '.png'), fullPage: true })
    }
  } finally {
    await context.close()
  }
})

test('native section headings keep their complete side link inside the page with short and long titles', async ({
  browser,
}) => {
  const shell: SiteShell = {
    site: { id: 'sample', slug: 'sample', name: '[Site]' },
    theme: SAWSO_THEME,
    navigation: [],
    canonical_host: null,
    staging_host: null,
  }
  const context = await browser.newContext({ javaScriptEnabled: false })
  try {
    const page = await context.newPage()
    for (const heading of ['What We Do', 'Local acceptance What We Do']) {
      const sections = ['core-feature-slider', 'core-feature-tiles'].map((slug, index) => {
        const seed = NATIONAL_LIBRARY.find(item => item.definition.slug === slug)!,
          compiled = compileSeedSection(seed.definition)
        return {
          instance: {
            section_def_id: slug,
            section_def_version: 1,
            values: {
              ...seed.samples,
              ...(index === 1 ? { heading, link: { label: 'Ways We Help', url: '/ways-we-help' } } : {}),
            },
          },
          def: {
            section_def_id: slug,
            slug,
            version: 1,
            compiled_ast: compiled.compiledAst,
            css: compiled.compiledCss,
            css_policy_version: CSS_POLICY_VERSION,
          },
        }
      })
      const html = renderPage({
        manifest: { page: { id: 'sample', version_id: 'sample', title: '[Page]', path: '/' }, meta: {}, sections },
        shell,
        isStaging: true,
      }).html
      for (const width of [1440, 1024, 390]) {
        await page.setViewportSize({ width, height: 900 })
        await page.setContent(html)
        const row = page.locator('.national-block-head'),
          link = row.getByRole('link', { name: /^Ways We Help/ })
        await expect(row.getByRole('heading', { name: heading, exact: true })).toBeVisible()
        await expect(link).toBeVisible()
        const bounds = await link.evaluate(e => {
          const range = document.createRange()
          range.selectNodeContents(e)
          return {
            textRight: range.getBoundingClientRect().right,
            linkRight: e.getBoundingClientRect().right,
            viewport: innerWidth,
            scrollWidth: e.scrollWidth,
            width: e.getBoundingClientRect().width,
          }
        })
        expect(bounds.scrollWidth).toBeLessThanOrEqual(Math.ceil(bounds.width))
        expect(bounds.textRight).toBeLessThanOrEqual(bounds.linkRight + 1)
        expect(bounds.linkRight).toBeLessThanOrEqual(bounds.viewport)
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      }
    }
  } finally {
    await context.close()
  }
})

test('six national cards balance into two rows and the phone bar reserves its full height', async ({ page }, info) => {
  const tile = NATIONAL_LIBRARY.find(item => item.definition.slug === 'core-feature-tiles')!,
    compiled = compileSeedSection(tile.definition),
    footer = compileSeedSection(NATIONAL_FOOTER),
    values: Record<string, unknown> = {
      heading: '[Six cards — sample content]',
      cards: { items: Array.from({ length: 6 }, (_, n) => 'i' + (n + 1)) },
    },
    folder = resolve('../.r8-progress/round3/national-layout-clearance', info.project.name)
  for (let n = 1; n <= 6; n++) {
    values['cards__i' + n + '__title'] = '[Card ' + n + ' — sample content]'
    values['cards__i' + n + '__body'] = '<p>[Card text — sample content]</p>'
    values['cards__i' + n + '__icon'] = 'heart'
  }
  values.__cms_tile_layout = 'five'
  const id = '77777777-7777-4777-8777-777777777777',
    shell: SiteShell = {
      site: { id: 'sample', slug: 'sample', name: '[Site]' },
      theme: SAWSO_THEME,
      navigation: [],
      canonical_host: null,
      staging_host: null,
      footer: {
        schemaVersion: 2,
        enabled: true,
        component: {
          section_def_id: id,
          section_def_version: 1,
          values: {
            name: '[Site]',
            mission_heading: '[Mission]',
            mission: '<p>[Mission text — sample content]</p>',
            base: '<p>[Last footer text — sample content]</p>',
          },
        },
      },
      footer_component: {
        section_def_id: id,
        version: 1,
        slug: NATIONAL_FOOTER.slug,
        compiled_ast: footer.compiledAst,
        css: footer.compiledCss,
        slots: footer.slots,
        css_policy_version: footer.compiledAst.cssPolicyVersion,
      },
    }
  const html = renderPage({
    manifest: {
      page: { id: 'sample', version_id: 'sample', title: '[Page]', path: '/' },
      meta: {},
      sections: [
        {
          instance: { section_def_id: id, section_def_version: 1, values },
          def: {
            section_def_id: id,
            slug: tile.definition.slug,
            version: 1,
            compiled_ast: compiled.compiledAst,
            css: compiled.compiledCss,
            slots: compiled.slots,
            css_policy_version: compiled.compiledAst.cssPolicyVersion,
          },
        },
      ],
    },
    shell,
    isStaging: true,
  }).html
  await mkdir(folder, { recursive: true })
  await page.setContent(html)
  for (const width of [1440, 1024, 390]) {
    await page.setViewportSize({ width, height: 900 })
    await page.evaluate(() => document.fonts.ready)
    const cards = page.locator('.national-tiles>.national-tile')
    await expect(cards).toHaveCount(6)
    if (width >= 992) {
      const tops = await cards.evaluateAll(nodes => nodes.map(n => Math.round(n.getBoundingClientRect().top)))
      expect(tops[0]).toBe(tops[2])
      expect(tops[3]).toBe(tops[5])
      expect(tops[3]).toBeGreaterThan(tops[0]!)
    }
    if (width === 390) {
      await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight))
      const bar = (await page.locator('.national-bottom-bar').boundingBox())!,
        last = (await page.locator('.national-footer-base').boundingBox())!
      expect(last.y + last.height).toBeLessThanOrEqual(bar.y)
      expect(
        await page.locator('body').evaluate(n => parseFloat(getComputedStyle(n).paddingBottom)),
      ).toBeGreaterThanOrEqual(bar.height + 12)
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: resolve(folder, 'six-cards-' + width + '.png'), fullPage: true })
  }
})

test('national jump links keep all three phone actions in equal rows', async ({ page }, info) => {
  const entry = CORE_LIBRARY.find(item => item.definition.slug === 'core-on-page-navigation')!,
    compiled = compileCoreSection(entry),
    id = 'sample',
    shell: SiteShell = {
      site: { id, slug: id, name: '[Site]' },
      theme: SAWSO_THEME,
      navigation: [],
      canonical_host: null,
      staging_host: null,
    }
  const html = renderPage({
    manifest: {
      page: { id, version_id: id, title: '[Page]', path: '/' },
      meta: {},
      sections: [
        {
          instance: { section_def_id: id, section_def_version: 1, values: corePreviewValues(entry) },
          def: {
            section_def_id: id,
            slug: entry.definition.slug,
            version: 1,
            compiled_ast: compiled.compiledAst,
            css: compiled.compiledCss,
            slots: compiled.slots,
            css_policy_version: CSS_POLICY_VERSION,
          },
        },
      ],
    },
    shell,
    isStaging: true,
  }).html
  const folder = resolve('../.r8-progress/round3/jump-links', info.project.name)
  await mkdir(folder, { recursive: true })
  for (const width of [1440, 1024, 390]) {
    await page.setViewportSize({ width, height: 900 })
    await page.setContent(html)
    const links = page.locator('.core-nav a')
    await expect(links).toHaveCount(3)
    if (width === 390) {
      const boxes = await links.evaluateAll(ns =>
        ns.map(n => {
          const r = n.getBoundingClientRect()
          return { x: Math.round(r.x), width: Math.round(r.width), y: Math.round(r.y) }
        }),
      )
      expect(new Set(boxes.map(b => b.width)).size).toBe(1)
      expect(new Set(boxes.map(b => b.x)).size).toBe(1)
      expect(new Set(boxes.map(b => b.y)).size).toBe(3)
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: resolve(folder, 'links-' + width + '.png') })
  }
})

test('Story headers omit empty marks and a summary repeated at the start of the full paragraph', async ({
  browser,
}, info) => {
  const entry = CORE_LIBRARY.find(item => item.definition.slug === 'core-story-detail')!,
    compiled = compileCoreSection(entry),
    values = corePreviewValues(entry),
    story = values.story as { entries: { values: Record<string, unknown> }[] },
    id = 'sample',
    body = '<p>Opening sentence. More approved words.</p><p>Another paragraph stays intact.</p>'
  story.entries[0]!.values = {
    ...story.entries[0]!.values,
    title: '[Story title]',
    summary: 'Opening sentence.',
    body,
    region_label: '',
    sector_links: '',
  }
  const shell: SiteShell = {
      site: { id, slug: id, name: '[Site]' },
      theme: SAWSO_THEME,
      navigation: [],
      canonical_host: null,
      staging_host: null,
    },
    html = renderPage({
      manifest: {
        page: { id, version_id: id, title: '[Page]', path: '/' },
        meta: {},
        sections: [
          {
            instance: { section_def_id: id, section_def_version: 1, values },
            def: {
              section_def_id: id,
              slug: entry.definition.slug,
              version: 1,
              compiled_ast: compiled.compiledAst,
              css: compiled.compiledCss,
              slots: compiled.slots,
              css_policy_version: CSS_POLICY_VERSION,
            },
          },
        ],
      },
      shell,
      isStaging: true,
    }).html
  const context = await browser.newContext({ javaScriptEnabled: false }),
    page = await context.newPage(),
    folder = resolve('../.r8-progress/round3/story-opening', info.project.name),
    url = `http://demo.staging.localhost:${E2E_PORTS.site}/story-opening-specimen`
  await mkdir(folder, { recursive: true })
  try {
    await page.route(url, route => route.fulfill({ status: 200, contentType: 'text/html', body: html }))
    for (const width of [1440, 1024, 390]) {
      await page.setViewportSize({ width, height: 900 })
      await page.goto(url)
      await expect(
        page.locator(
          '.core-story-opening,.core-story-meta .core-story-region-pill,.core-story-meta .core-story-sectors',
        ),
      ).toHaveCount(0)
      await expect(page.locator('.core-story-text')).toHaveText(
        'Opening sentence. More approved words.Another paragraph stays intact.',
      )
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      await page.screenshot({ path: resolve(folder, 'header-' + width + '.png') })
    }
  } finally {
    await context.close()
  }
})

test('shared national buttons use readable label weight and preserve explicit appearance choices', async ({
  browser,
}, info) => {
  const seed = NATIONAL_LIBRARY.find(item => item.definition.slug === 'core-photo-banner')!
  const compiled = compileSeedSection(seed.definition)
  const section = {
    instance: {
      section_def_id: 'sample-banner',
      section_def_version: 1,
      values: {
        ...seed.samples,
        heading: '[Sample heading]',
        primary: { label: 'Donate Today', url: '/support' },
        secondary: { label: 'Learn More', url: '/read' },
      },
    },
    def: {
      section_def_id: 'sample-banner',
      slug: seed.definition.slug,
      version: 1,
      compiled_ast: compiled.compiledAst,
      css: compiled.compiledCss,
      css_policy_version: CSS_POLICY_VERSION,
    },
  }
  const regular = {
    ...section,
    instance: {
      ...section.instance,
      values: {
        ...section.instance.values,
        secondary: {
          ...section.instance.values.secondary,
          buttonAppearance: { ...DEFAULT_BUTTON_APPEARANCE, weight: 'regular' },
        },
      },
    },
  }
  const shell: SiteShell = {
    site: { id: 'sample', slug: 'sample', name: '[Site]' },
    theme: SAWSO_THEME,
    navigation: [],
    canonical_host: null,
    staging_host: null,
  }
  const context = await browser.newContext({ javaScriptEnabled: false })
  const folder = resolve('../.r8-progress/round3/button-weight', info.project.name)
  try {
    await mkdir(folder, { recursive: true })
    const page = await context.newPage()
    const url = `http://demo.staging.localhost:${E2E_PORTS.site}/button-weight`
    let html = ''
    await page.route(url + '*', route => route.fulfill({ status: 200, contentType: 'text/html', body: html }))
    for (const [mode, specimen] of [
      ['default', section],
      ['regular', regular],
    ] as const) {
      html = renderPage({
        manifest: {
          page: { id: 'sample', version_id: 'sample', title: '[Page]', path: '/' },
          meta: {},
          sections: [specimen],
        },
        shell,
        isStaging: true,
      }).html
      await page.goto(url + '?mode=' + mode)
      for (const width of [1440, 1024, 390]) {
        await page.setViewportSize({ width, height: 1000 })
        const primary = page.getByRole('link', { name: 'Donate Today', exact: true })
        const secondary = page.getByRole('link', { name: 'Learn More', exact: true })
        await expect(primary).toHaveCSS('font-weight', '600')
        await expect(primary).toHaveCSS('background-color', 'rgb(239, 62, 66)')
        await expect(primary).toHaveCSS('color', 'rgb(255, 255, 255)')
        await expect(secondary).toHaveCSS('font-weight', mode === 'regular' ? '500' : '600')
        const first = await primary.boundingBox(),
          second = await secondary.boundingBox()
        expect(first!.y).toBeCloseTo(second!.y, 1)
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
        await page.screenshot({ path: resolve(folder, mode + '-buttons-' + width + '.png') })
      }
    }
  } finally {
    await context.close()
  }
})
