import { expect, it } from 'vitest'
import { compileSection, sectionScopeSelector } from './compile.ts'
import { renderPage, type SiteShell, type SectionDefView } from './render.ts'
import { escapeAttribute } from './escape.ts'
import type { SlotDef } from '@cms/schema'
const id = '11111111-1111-4111-8111-111111111111',
  settings = {
    schemaVersion: 1,
    name: '[Site]',
    social: [
      { service: 'instagram', url: 'https://instagram.com/account/', handle: '@account', inFooter: true },
      { service: 'facebook', url: 'https://facebook.com/account/', handle: '', inFooter: false },
    ],
  }
const shell: SiteShell = {
  site: { id, name: '[Site]', slug: 'site' },
  theme: {},
  navigation: [],
  canonical_host: 'example.test',
  staging_host: null,
}
const slots: SlotDef[] = [
  { id: 'heading', kind: 'text', label: 'Heading', constraints: {} },
  { id: 'accounts_from', kind: 'text', label: 'Links from', constraints: { siteSocialAccounts: true } },
  {
    id: 'links',
    kind: 'repeat',
    label: 'Links',
    constraints: { item: { unit: 'Link', fields: [{ id: 'action', kind: 'link', label: 'Link', constraints: {} }] } },
  },
]
const compiled = compileSection({
    sourceHtml:
      '<h2>{{heading}}</h2><nav aria-label="Related links" data-links-from="{{accounts_from}}">{{#links}}{{action}}{{/links}}</nav>',
    sourceCss: 'nav{display:flex}',
    slots,
    scopeSelector: sectionScopeSelector('core-on-page-navigation')!,
  }),
  def: SectionDefView = {
    section_def_id: id,
    version: 1,
    slug: 'core-on-page-navigation',
    slots,
    compiled_ast: compiled.ast,
    css: compiled.css,
    css_policy_version: compiled.ast.cssPolicyVersion,
    sanitizer_policy_version: compiled.ast.policyVersion,
  }
const manifest = {
  page: { id, version_id: id, title: '[Page]', path: '/' },
  meta: {},
  sections: [
    {
      def,
      instance: {
        section_def_id: id,
        section_def_version: 1,
        values: {
          heading: '[Follow]',
          accounts_from: 'site',
          links: { items: ['i1'] },
          links__i1__action: { url: '/old', label: '[Old link]' },
        },
      },
    },
  ],
}
it('shared account sections read site settings independently of Footer visibility and keep legacy manual links', () => {
  expect(compiled.blocking).toEqual([])
  const html = renderPage({ manifest, shell: { ...shell, settings }, isStaging: true }).html
  expect(html).toContain('href="https://instagram.com/account/"')
  expect(html).toContain('href="https://facebook.com/account/"')
  expect(html).not.toContain('[Old link]')
  const preview = renderPage({
    manifest,
    shell: { ...shell, settings },
    isStaging: true,
    options: { preview: true },
  }).html
  expect(preview).not.toContain('data-cms-slot="links__')
  expect(preview).toContain('data-cms-slot="heading"')
  const manual = structuredClone(manifest)
  manual.sections[0]!.instance.values.accounts_from = 'own'
  expect(renderPage({ manifest: manual, shell: { ...shell, settings }, isStaging: true }).html).toContain('[Old link]')
  expect(renderPage({ manifest, shell, isStaging: true }).html).not.toContain('[Follow]')
})
it('authored Footer accounts use central switches and respect disabled Footer', () => {
  const footerCompiled = compileSection({
      sourceHtml: '<p>[Footer text]</p>',
      sourceCss: 'p{margin:0}',
      slots: [],
      scopeSelector: sectionScopeSelector('test-footer')!,
    }),
    footerDef = { ...def, slug: 'test-footer', slots: [], compiled_ast: footerCompiled.ast, css: footerCompiled.css },
    footer = { schemaVersion: 2, enabled: true, component: { section_def_id: id, section_def_version: 1, values: {} } }
  const html = renderPage({
    manifest: { ...manifest, sections: [] },
    shell: { ...shell, settings, footer, footer_component: footerDef },
    isStaging: true,
  }).html
  expect(html).toContain('aria-label="Social media"')
  expect(html).toContain('href="https://instagram.com/account/"')
  expect(html).not.toContain('https://facebook.com/account/')
  expect(html).toContain('[Footer text]')
  expect(
    renderPage({
      manifest: { ...manifest, sections: [] },
      shell: { ...shell, settings, footer: { ...footer, enabled: false }, footer_component: footerDef },
      isStaging: true,
    }).html,
  ).not.toContain('https://instagram.com/account/')
})

it('keeps dollar-sign sequences literal in generated footer account addresses', () => {
  for (const suffix of ['$`', '$&', "$'", '$$', '$1']) {
    const url = 'https://instagram.com/account/?note=' + suffix
    const html = renderPage({
      manifest: { ...manifest, sections: [] },
      shell: { ...shell, settings: { ...settings, social: [{ ...settings.social[0]!, url }] } },
      isStaging: true,
    }).html
    expect(html).toContain(
      '<nav class="cms-global-footer-social" aria-label="Social media"><ul><li><a href="' +
        escapeAttribute(url) +
        '">Instagram</a></li></ul></nav></footer>',
    )
    expect(html.match(/<footer\b/g)).toHaveLength(1)
  }
})
