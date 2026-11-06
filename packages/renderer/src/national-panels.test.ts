import { nationalSectionPanel } from './national-panels.ts'
import { expect, it } from 'vitest'
import { compileSection, CSS_POLICY_VERSION, renderPage, type SiteShell } from './index.ts'
const id = '11111111-1111-4111-a111-111111111111'
const compiled = compileSection({
  sourceHtml: '<section><h2>{{title}}</h2><p>{{body}}</p></section>',
  sourceCss: '',
  slots: [
    { id: 'title', kind: 'text', label: 'Title', constraints: {} },
    { id: 'body', kind: 'text', label: 'Text', constraints: {} },
  ],
})
const manifest = {
  page: { id, version_id: id, title: 'Annual Reports', path: '/annual-reports' },
  sections: [
    {
      instance: {
        section_def_id: id,
        section_def_version: 1,
        values: { title: '2026 Annual Report', body: 'Approved content' },
      },
      def: {
        section_def_id: id,
        slug: 'core-documents',
        version: 1,
        compiled_ast: compiled.ast,
        css: compiled.css,
        css_policy_version: CSS_POLICY_VERSION,
      },
    },
  ],
  meta: {},
}
const shell: SiteShell = {
  site: { id, slug: 'sample', name: '[Site]' },
  theme: { presentation: { kind: 'panels', canvas: '#d9d9d9', layout: 'national' } },
  navigation: [],
  canonical_host: null,
  staging_host: null,
}
it('gives every ordinary section a white container in national public output and the editing canvas', () => {
  for (const preview of [false, true]) {
    const html = renderPage({ manifest, shell, isStaging: true, options: { preview } }).html
    expect(html).toContain('<div class="national-content-panel"><section>')
    expect(html).toContain('2026 Annual Report')
    expect(html).toContain('Approved content')
    if (preview) expect(html).toContain('data-cms-section="0"')
  }
})
it('does not change other site skins or standalone catalogue previews', () => {
  const ordinary = { ...shell, theme: {} }
  expect(renderPage({ manifest, shell: ordinary, isStaging: true }).html).not.toContain('national-content-panel')
  expect(renderPage({ manifest, shell, isStaging: true, options: { sectionOnly: true } }).html).not.toContain(
    'national-content-panel',
  )
})

it('keeps the page title on grey and puts a supplied introduction on white', () => {
  const body = '<section><div><h1>[Page]</h1><p class="core-intro">[Introduction]</p></div></section>'
  expect(nationalSectionPanel(body, 'core-page-header', { intro: '[Introduction]' })).toContain(
    '<h1>[Page]</h1><div class="national-content-panel"><p',
  )
  expect(nationalSectionPanel(body, 'core-page-header', { intro: '' })).toBe(body)
  expect(nationalSectionPanel(body, 'core-text-block')).toBe(body)
})
