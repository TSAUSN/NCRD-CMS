import { it, expect } from 'vitest'
import { renderPage, renderSection, CSS_POLICY_VERSION, type ManifestSection } from '@cms/renderer'
import { CORE_LIBRARY, compileCoreSection, corePreviewValues } from './core-library.ts'
import { ECHELON_THEME } from './core-themes.ts'
const variants = CORE_LIBRARY.filter(entry => entry.definition.slug.match(/^core-echelon-(hero|jump-links)$/))
function placed(index: number): ManifestSection {
  const entry = variants[index]!,
    compiled = compileCoreSection(entry)
  return {
    def: {
      section_def_id: '11111111-1111-4111-a111-111111111111',
      version: 1,
      slug: entry.definition.slug,
      slots: compiled.slots,
      compiled_ast: compiled.compiledAst,
      css: compiled.compiledCss,
      css_policy_version: CSS_POLICY_VERSION,
    },
    instance: {
      section_def_id: '11111111-1111-4111-a111-111111111111',
      section_def_version: 1,
      values: corePreviewValues(entry),
    },
  }
}
it('keeps the approved Echelon opener in ordinary safe fields with fixed layout and all links reachable', () => {
  expect(variants).toHaveLength(2)
  const hero = placed(0),
    jump = placed(1),
    html =
      renderSection(hero, 0, { preview: true, siteThemeHooks: true, nationalPanels: true }) +
      renderSection(jump, 1, { siteThemeHooks: true, nationalPanels: true })
  expect(html).toContain('echelon-opener-logo')
  expect(html).toContain('data-cms-slot="intro"')
  expect(html).toContain('href="#ech-demo-chapters"')
  expect(html.match(/class="cms-material-symbols"/g)).toHaveLength(6)
  expect(html).not.toContain('national-content-panel')
  expect(html).not.toMatch(/<script|<style|onerror=/)
  expect(hero.def.slots?.[0]?.constraints?.coreCapabilities).toMatchObject({
    background: false,
    spacing: false,
    alignment: false,
  })
  const page = renderPage({
    shell: {
      site: { id: 'site', name: '[Site]', slug: 'echelon-chapters' },
      theme: ECHELON_THEME,
      navigation: [],
      canonical_host: null,
      staging_host: null,
    },
    manifest: { page: { id: 'page', version_id: 'v', title: 'Echelon', path: '/' }, sections: [hero, jump], meta: {} },
    isStaging: true,
  }).html
  expect(page).toContain('grid-template-columns:minmax(0,1.06fr) minmax(0,1fr)')
  expect(page).toContain('grid-template-columns:repeat(2,minmax(0,1fr))')
  expect(page).not.toContain('trajan-pro-3')
})
