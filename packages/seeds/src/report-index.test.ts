import { it, expect } from 'vitest'
import { renderPage, CSS_POLICY_VERSION, SANITIZER_POLICY_VERSION } from '@cms/renderer'
import { CORE_LIBRARY, compileCoreSection } from './core-library.ts'
const section = (slug: string, values: Record<string, unknown>) => {
  const entry = CORE_LIBRARY.find(row => row.definition.slug === slug)!,
    compiled = compileCoreSection(entry)
  return {
    def: {
      section_def_id: slug,
      version: 1,
      slug,
      slots: compiled.slots,
      compiled_ast: compiled.compiledAst,
      css: compiled.compiledCss,
      css_policy_version: CSS_POLICY_VERSION,
      sanitizer_policy_version: SANITIZER_POLICY_VERSION,
    },
    instance: { section_def_id: slug, section_def_version: 1, values },
  }
}
it('reuses ordinary fields for one report index and gives each valid destination its fixed accessible label', () => {
  const values = {
      heading: '[Report]',
      body: '<p>[Preserved introduction]</p>',
      photo: '',
      __cms_report_links: true,
      report_page: { url: '/report', label: '[Earlier label]' },
      report_pdf: { url: 'javascript:alert(1)', label: '[Earlier PDF label]' },
    },
    row = section('core-text-image', values),
    manifest = {
      page: { id: 'page', version_id: 'version', title: '[Reports]', path: '/reports' },
      meta: {},
      sections: [section('core-page-header', { heading: '[Reports]', intro: '' }), row],
    },
    shell = {
      site: { id: 'site', name: '[Site]', slug: 'site' },
      theme: {},
      navigation: [],
      canonical_host: null,
      staging_host: null,
    },
    html = renderPage({ manifest, shell, isStaging: true }).html
  expect(html).toContain('class="cms-report-index-page"')
  expect(html).toContain('class="cms-report-index-card"')
  expect(html).toContain('href="/report">View page</a>')
  expect(html).toContain('class="core-report-pdf" hidden')
  expect(html).not.toContain('href="javascript:')
  expect(values.report_page.label).toBe('[Earlier label]')
  expect(values.body).toBe('<p>[Preserved introduction]</p>')
  const ordinary = renderPage({
    manifest: {
      ...manifest,
      sections: [manifest.sections[0]!, section('core-text-image', { ...values, __cms_report_links: false })],
    },
    shell,
    isStaging: true,
  }).html
  expect(ordinary).not.toContain('class="cms-report-index-card"')
  const mixed = renderPage({
    manifest: {
      ...manifest,
      sections: [
        ...manifest.sections,
        section('core-text-block', { heading: '[Another section]', body: '<p>[Ordinary text]</p>' }),
      ],
    },
    shell,
    isStaging: true,
  }).html
  expect(mixed).not.toContain('class="cms-report-index-card"')
  expect(mixed).toContain('#cms-main .cms-report-index-row .core-report-actions')
  expect(mixed).toContain('[Ordinary text]')
})
