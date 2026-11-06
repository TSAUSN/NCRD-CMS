import { test, expect } from '@playwright/test'
import { CORE_LIBRARY, compileCoreSection, corePreviewValues } from '@cms/seeds/core-library'
import { SAWSO_THEME } from '@cms/seeds/core-themes'
import { renderPage, CSS_POLICY_VERSION, SANITIZER_POLICY_VERSION, type ManifestSection } from '@cms/renderer'
const sections = ['feature-slider', 'feature-tiles', 'photo-grid'].map(slug => {
  const entry = CORE_LIBRARY.find(entry => entry.definition.slug === 'core-' + slug)!,
    compiled = compileCoreSection(entry)
  const values = corePreviewValues(entry)
  if (slug === 'feature-slider') {
    values.heading = '[Featured stories — sample content]'
    values.slides__i1__secondary = { label: '[Second button]', url: '#next' }
    values.slides__i1__secondary_visible = 'on'
  }
  return {
    def: {
      section_def_id: slug,
      version: 1,
      slug: entry.definition.slug,
      compiled_ast: compiled.compiledAst,
      css: compiled.compiledCss,
      slots: compiled.slots,
      definition_kind: compiled.definitionKind,
      sanitizer_policy_version: SANITIZER_POLICY_VERSION,
      css_policy_version: CSS_POLICY_VERSION,
    },
    instance: { section_def_id: slug, section_def_version: 1, values, hidden: false, hidden_at: [] },
  } as ManifestSection
})
test('native national hero, action links and tile links keep the same layout on the editor canvas and public page', async ({
  page,
}) => {
  const selectors = [
    '[data-cms-hero-key="i1"] img',
    '[data-cms-hero-key="i1"] .national-hero-copy',
    '[data-cms-hero-key="i1"] .cms-hero-main a',
    '#s1 .national-block-head a',
    '#s2 .national-photo-tile a',
  ]
  await page.route('**', route => route.abort())
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 })
    const layouts = []
    for (const preview of [false, true]) {
      const html = renderPage({
        manifest: {
          page: { id: 'p', version_id: 'v', title: '[National page — sample content]', path: '/' },
          meta: {},
          sections,
        },
        shell: {
          site: { id: 's', name: '[Site — sample content]', slug: 'sawso' },
          theme: SAWSO_THEME,
          navigation: [],
          canonical_host: null,
          staging_host: null,
        },
        isStaging: true,
        options: { preview },
      }).html
      await page.setContent(html)
      for (const selector of selectors) await expect(page.locator(selector)).toHaveCount(1)
      layouts.push(
        await page.evaluate(
          selectors =>
            selectors.map(selector => {
              const e = document.querySelector(selector)!
              const { x, y, width, height } = e.getBoundingClientRect(),
                style = getComputedStyle(e)
              return { selector, x, y, width, height, color: style.color, background: style.backgroundColor }
            }),
          selectors,
        ),
      )
      const buttons = await page
        .locator('[data-cms-hero-key="i1"] .national-actions a')
        .evaluateAll(es => es.map(e => getComputedStyle(e).backgroundColor))
      expect(buttons).toEqual(['rgb(239, 62, 66)', 'rgb(255, 255, 255)'])
    }
    for (let i = 0; i < layouts[0]!.length; i++) {
      const published = layouts[0]![i]!,
        preview = layouts[1]![i]!
      for (const key of ['x', 'y', 'width', 'height'] as const)
        expect(preview[key], published.selector + ' ' + width + ' ' + key).toBeCloseTo(published[key], 0)
      expect(preview.color).toBe(published.color)
      expect(preview.background).toBe(published.background)
    }
  }
})
