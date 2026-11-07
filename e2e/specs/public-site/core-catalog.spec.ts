import { E2E_PORTS } from '../../test-ports.ts'
import { expect, test } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { CORE_LIBRARY, compileCoreSection, corePreviewValues } from '@cms/seeds/core-library'
import { CORE_THEME_PRESETS } from '@cms/seeds/core-themes'
import {
  renderPage,
  compileSection,
  CSS_POLICY_VERSION,
  SANITIZER_POLICY_VERSION,
  type ManifestSection,
} from '@cms/renderer'
function markup(
  entry: (typeof CORE_LIBRARY)[number],
  theme: (typeof CORE_THEME_PRESETS)[number]['theme'],
  amend?: (section: ManifestSection) => void,
) {
  const compiled = compileCoreSection(entry)
  const section: ManifestSection = {
    def: {
      section_def_id: 'core',
      version: 1,
      slug: entry.definition.slug,
      compiled_ast: compiled.compiledAst,
      css: compiled.compiledCss,
      slots: compiled.slots,
      definition_kind: compiled.definitionKind,
      structured_doc: compiled.structuredDoc,
      structured_schema_version: compiled.structuredSchemaVersion,
      sanitizer_policy_version: SANITIZER_POLICY_VERSION,
      css_policy_version: CSS_POLICY_VERSION,
    },
    instance: {
      section_def_id: 'core',
      section_def_version: 1,
      values: corePreviewValues(entry),
      hidden: false,
      hidden_at: [],
      label: entry.definition.name,
    },
  }
  amend?.(section)
  const sections = [section]
  if (entry.definition.slug === 'core-report-page-links') {
    const target = compileSection({ sourceHtml: '<section><h2>[Report section]</h2></section>', slots: [] })
    sections.push({
      def: {
        section_def_id: 'target',
        version: 1,
        slug: 'core-page-header',
        compiled_ast: target.ast,
        css: '',
        slots: [],
      },
      instance: {
        section_def_id: 'target',
        section_def_version: 1,
        values: { heading: '[Report section]', __cms_anchor: 'catalogue-target', page_link_label: '[Report section]' },
      },
    })
  }
  return renderPage({
    manifest: {
      page: { id: 'catalogue', version_id: 'catalogue', title: entry.definition.name, path: '/_core-review' },
      sections,
      meta: {},
    },
    shell: {
      site: { id: 'catalogue', slug: 'catalogue', name: '[Catalogue]' },
      theme,
      navigation: [],
      canonical_host: null,
      staging_host: null,
    },
    isStaging: true,
    options: { siteFrame: false },
  }).html
}
for (const preset of CORE_THEME_PRESETS)
  test(`core catalogue: ${preset.name} at phone, tablet and desktop`, async ({ page }) => {
    test.setTimeout(180_000)
    const folder = resolve('../.r8-progress/step-2/catalog', preset.name.toLowerCase())
    await mkdir(folder, { recursive: true })
    const route = `http://127.0.0.1:${E2E_PORTS.site}/_core-review`
    let html = ''
    await page.route(route, request => request.fulfill({ status: 200, contentType: 'text/html', body: html }))
    for (const entry of CORE_LIBRARY) {
      html = markup(entry, preset.theme)
      for (const width of [390, 768, 1280]) {
        await page.setViewportSize({ width, height: width === 390 ? 844 : 900 })
        await page.goto(route)
        await expect(page.locator('main section').first()).toBeVisible()
        await expect
          .poll(() =>
            page
              .locator('img')
              .evaluateAll(images =>
                images.every(image => image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0),
              ),
          )
          .toBe(true)
        expect(
          await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
          entry.definition.name + ' overflow',
        ).toBe(true)
        if (width === 390) {
          const heights = await page
            .locator('.core-card')
            .evaluateAll(cards => cards.map(card => card.getBoundingClientRect().height))
          expect(
            heights.every(height => height <= 844),
            entry.definition.name + ' phone card height',
          ).toBe(true)
          const audit = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()
          // Keep the recorded reference-palette exceptions and exact red/white
          // Echelon controls. Axe still runs unchanged; every other finding fails.
          const controlNodes = new Set<string>()
          if (entry.definition.slug.startsWith('core-echelon-'))
            for (const item of audit.violations)
              for (const node of item.nodes) {
                const target = node.target[0]
                if (
                  node.target.length === 1 &&
                  typeof target === 'string' &&
                  (await page.locator(target).evaluate(element => Boolean(element.closest('a,button,summary'))))
                )
                  controlNodes.add(node.html)
              }
          const reference = preset.theme.presentation?.referenceContrast === 'sawso-2026-10-29'
          const referencePairs = new Set(
            [
              ['#ef3e42', '#ffffff'],
              ['#686769', '#d9d9d9'],
              ['#727173', '#f2f2f2'],
              ['#707072', '#edf0ef'],
            ].map(pair => pair.sort().join(',')),
          )
          const violations = audit.violations.flatMap(item => {
            if (item.id !== 'color-contrast') return [item]
            const nodes = item.nodes.filter(
              node =>
                !node.any.some(check => {
                  const data = check.data as { fgColor?: string; bgColor?: string } | null
                  if (!data) return false
                  const pair = [data.fgColor?.toLowerCase(), data.bgColor?.toLowerCase()].sort().join(',')
                  return (
                    (reference && referencePairs.has(pair)) ||
                    (controlNodes.has(node.html) && pair === '#ef3e42,#ffffff')
                  )
                }),
            )
            return nodes.length ? [{ ...item, nodes }] : []
          })
          expect
            .soft(
              violations.map(item => ({
                id: item.id,
                nodes: item.nodes.map(node => ({ summary: node.failureSummary, html: node.html, target: node.target })),
              })),
              entry.definition.name,
            )
            .toEqual([])
        }
        await page
          .locator('#s0')
          .screenshot({ path: resolve(folder, `${entry.definition.slug}-${width}.png`), animations: 'disabled' })
      }
    }
  })
test('core FAQ and biographies work without JavaScript', async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 390, height: 844 } })
  const page = await context.newPage()
  for (const slug of ['core-faq', 'core-speakers-grid']) {
    const entry = CORE_LIBRARY.find(entry => entry.definition.slug === slug)!
    const html = markup(entry, CORE_THEME_PRESETS[0].theme)
    await page.route(`http://127.0.0.1:${E2E_PORTS.site}/_core-native`, request =>
      request.fulfill({ status: 200, contentType: 'text/html', body: html }),
    )
    await page.goto(`http://127.0.0.1:${E2E_PORTS.site}/_core-native`)
    const details = page.locator('details').first()
    await expect(details).not.toHaveAttribute('open', '')
    await details.locator('summary').press('Enter')
    await expect(details).toHaveAttribute('open', '')
    await page.unroute(`http://127.0.0.1:${E2E_PORTS.site}/_core-native`)
  }
  await context.close()
})

test('core lists: empty, one, many, long text and missing pictures stay readable on phones', async ({ page }) => {
  test.setTimeout(180_000)
  const folder = resolve('../.r8-progress/step-2/edge-cases')
  await mkdir(folder, { recursive: true })
  await page.setViewportSize({ width: 390, height: 844 })
  const route = `http://127.0.0.1:${E2E_PORTS.site}/_core-edges`
  let html = ''
  await page.route(route, request => request.fulfill({ status: 200, contentType: 'text/html', body: html }))
  for (const entry of CORE_LIBRARY.filter(entry => entry.list))
    for (const count of [0, 1, 30]) {
      html = markup(entry, CORE_THEME_PRESETS[0].theme, section => {
        const list = section.instance.values![entry.list!] as {
          entries: { id: string; stableKey: string; schemaVersionId: string; values: Record<string, unknown> }[]
        }
        const example = list.entries[0]!
        list.entries = Array.from({ length: count }, (_, index) => ({
          ...structuredClone(example),
          id: `00000000-0000-4000-8000-${String(index + 10).padStart(12, '0')}`,
          stableKey: `entry-${index + 1}`,
          values: {
            ...example.values,
            name: 'A very long speaker name with several family names and a community leadership role',
            photo: '',
            title: 'Practical ideas for stronger communities and a shared future together',
            bio: '<p>' + 'A thoughtful introduction. '.repeat(150) + '</p>',
            summary: '<p>' + 'Practical details and useful context. '.repeat(150) + '</p>',
          },
        }))
      })
      await page.goto(route)
      await expect(page.locator('.core-card')).toHaveCount(count)
      if (count && entry.list === 'resources') {
        const picture = page.locator('.core-card img').first()
        await expect
          .poll(() =>
            picture.evaluate(image => image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0),
          )
          .toBe(true)
        await picture.evaluate(async image => {
          if (image instanceof HTMLImageElement) await image.decode()
        })
        await page.evaluate(
          () => new Promise<void>(done => requestAnimationFrame(() => requestAnimationFrame(() => done()))),
        )
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      expect(
        await page
          .locator('.core-card')
          .evaluateAll(cards => cards.every(card => card.getBoundingClientRect().height <= 844)),
      ).toBe(true)
      if (count && ['speakers', 'people'].includes(entry.list!))
        await expect(page.locator('.cms-initials-avatar').first()).toBeVisible()
      await page.screenshot({
        path: resolve(folder, `${entry.definition.slug}-${count}-390.png`),
        animations: 'disabled',
      })
    }
})
test('schedule filters tracks by keyboard and leaves all sessions readable without JavaScript', async ({
  page,
  browser,
}) => {
  const { renderPage, scheduleFilterScriptHash } = await import('@cms/renderer')
  const entry = CORE_LIBRARY.find(entry => entry.definition.slug === 'core-schedule')!,
    compiled = compileCoreSection(entry)
  const section: ManifestSection = {
    def: {
      section_def_id: 'core',
      version: 1,
      slug: entry.definition.slug,
      compiled_ast: compiled.compiledAst,
      css: compiled.compiledCss,
      slots: compiled.slots,
      definition_kind: compiled.definitionKind,
      structured_doc: compiled.structuredDoc,
      structured_schema_version: compiled.structuredSchemaVersion,
      sanitizer_policy_version: SANITIZER_POLICY_VERSION,
      css_policy_version: CSS_POLICY_VERSION,
    },
    instance: { section_def_id: 'core', section_def_version: 1, values: corePreviewValues(entry) },
  }
  const list = section.instance.values!.program as { entries: { values: Record<string, unknown> }[] }
  list.entries[0]!.values.category = 'Community'
  list.entries[1]!.values.category = 'Leadership'
  list.entries[2]!.values.category = 'Leadership'
  list.entries[2]!.values.date = 'June 9, 2027'
  const html = renderPage({
    manifest: { page: { id: 'p', version_id: 'v', title: 'Program', path: '/' }, meta: {}, sections: [section] },
    shell: {
      theme: CORE_THEME_PRESETS[0].theme,
      site: { id: 'core', slug: 'core', name: 'Core preview' },
      navigation: [],
      canonical_host: null,
      staging_host: null,
    },
    isStaging: true,
  }).html
  const route = `http://127.0.0.1:${E2E_PORTS.site}/_schedule-filter`
  const response = {
    status: 200,
    contentType: 'text/html',
    headers: {
      'content-security-policy': `default-src 'none'; style-src 'unsafe-inline'; img-src 'self'; font-src 'self'; script-src '${scheduleFilterScriptHash()}'`,
    },
    body: html,
  }
  await page.route(route, request => request.fulfill(response))
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(route)
  const filter = page.getByRole('group', { name: 'Filter sessions by track' })
  await expect(filter).toBeVisible()
  await filter.getByRole('button', { name: 'Community', exact: true }).press('Enter')
  await expect(page.locator('.core-card:visible')).toHaveCount(1)
  await expect(page.locator('.cms-list-day:visible')).toHaveCount(1)
  await filter.getByRole('button', { name: 'All tracks' }).click()
  await expect(page.locator('.core-card:visible')).toHaveCount(3)
  const folder = resolve('../.r8-progress/step-2/edge-cases')
  await mkdir(folder, { recursive: true })
  await page.screenshot({ path: resolve(folder, 'schedule-track-filter-390.png'), animations: 'disabled' })
  const context = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 390, height: 844 } }),
    native = await context.newPage()
  await native.route(route, request => request.fulfill(response))
  await native.goto(route)
  await expect(native.getByRole('group', { name: 'Filter sessions by track' })).not.toBeVisible()
  await expect(native.locator('.core-card:visible')).toHaveCount(3)
  await context.close()
})

test('core Schedule preserves speaker names, detail links and compact native phone content', async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false }),
    page = await context.newPage()
  const entry = CORE_LIBRARY.find(section => section.definition.slug === 'core-schedule')!,
    folder = resolve('../.r8-progress/step-4/schedule')
  await mkdir(folder, { recursive: true })
  try {
    await page.route(`http://127.0.0.1:${E2E_PORTS.site}/_schedule-review`, route =>
      route.fulfill({ contentType: 'text/html', body: markup(entry, CORE_THEME_PRESETS[0].theme) }),
    )
    for (const width of [390, 768, 1280, 1440, 1024]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : width === 1024 ? 768 : 900 })
      await page.goto(`http://127.0.0.1:${E2E_PORTS.site}/_schedule-review`)
      await expect(page.getByText('[Speaker name]', { exact: true })).toHaveCount(3)
      const links = page.getByRole('link', { name: 'Session details', exact: true })
      await expect(links).toHaveCount(3)
      await expect(links.first()).toHaveAttribute('href', 'https://example.test/session')
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      if (width === 390) {
        const cards = await page.locator('.core-card').evaluateAll(nodes =>
          nodes.map(node => {
            const r = node.getBoundingClientRect()
            return { left: r.left, height: r.height }
          }),
        )
        expect(new Set(cards.map(card => card.left)).size).toBe(1)
        expect(cards.every(card => card.height < 350)).toBe(true)
      }
      await page.screenshot({ path: resolve(folder, `schedule-${width}.png`), fullPage: true, animations: 'disabled' })
    }
    const details = page.locator('details').first()
    await expect(details).not.toHaveAttribute('open', '')
    await details.locator('summary').press('Enter')
    await expect(details).toHaveAttribute('open', '')
  } finally {
    await context.close()
  }
})
