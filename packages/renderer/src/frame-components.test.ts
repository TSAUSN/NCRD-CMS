// Authored header and footer components (ADR 0010).
import { describe, expect, it } from 'vitest'
import type { SlotDef } from '@cms/schema'
import { compileSection, sectionScopeSelector } from './compile.ts'
import { renderPage, type RenderManifest, type SectionDefView, type SiteShell } from './render.ts'

const HOME_ID = '11111111-1111-4111-8111-111111111111'
const ABOUT_ID = '22222222-2222-4222-8222-222222222222'
const DEF_ID = '55555555-5555-4555-8555-555555555555'

function definition(slug: string, html: string, css: string, slots: SlotDef[], version = 1): SectionDefView {
  const compiled = compileSection({
    sourceHtml: html,
    sourceCss: css,
    slots,
    scopeSelector: sectionScopeSelector(slug)!,
  })
  expect(compiled.blocking).toEqual([])
  return {
    section_def_id: DEF_ID,
    version,
    slug,
    compiled_ast: compiled.ast,
    css: compiled.css,
    css_policy_version: compiled.ast.cssPolicyVersion,
    sanitizer_policy_version: compiled.ast.policyVersion,
    slots,
  }
}

const headerDef = () =>
  definition(
    'site-frame-header',
    '<div class="bar"><a class="brand" href="/">{{title}}</a></div>' +
      '<nav class="row" aria-label="Main">{{menu}}</nav>' +
      '<details class="phone"><summary>Menu</summary>{{menu}}</details>',
    '.bar{display:flex}.row a[aria-current=page]{color:#e03b3b}',
    [
      { id: 'title', kind: 'text', label: 'Title', constraints: {} },
      { id: 'menu', kind: 'navigation', label: 'Site menu', constraints: {} },
    ],
  )

const manifest = (path = '/about', pageId = ABOUT_ID): RenderManifest => ({
  page: { id: pageId, version_id: 'version-1', title: 'About', path },
  meta: {},
  sections: [],
})

const shell = (over: Partial<SiteShell> = {}): SiteShell => ({
  site: { id: 'site-1', name: 'Baseline Site', slug: 'baseline' },
  theme: {},
  navigation: [
    { label: 'Home', visible: true, target: { type: 'page', page_id: HOME_ID } },
    { label: 'About', visible: true, target: { type: 'page', page_id: ABOUT_ID } },
    { label: 'Overview', visible: true, target: { type: 'url', url: '/about#overview' } },
  ],
  canonical_host: 'example.test',
  staging_host: null,
  ...over,
})

const authoredHeader = (over: Record<string, unknown> = {}) => ({
  schemaVersion: 2,
  enabled: true,
  sticky: true,
  component: { section_def_id: DEF_ID, section_def_version: 1, values: { title: 'Human <Needs> Index' } },
  ...over,
})

const render = (over: Partial<SiteShell> = {}, preview = false) =>
  renderPage({
    manifest: manifest(),
    shell: shell(over),
    isStaging: false,
    navigationPaths: { [HOME_ID]: '/', [ABOUT_ID]: '/about' },
    options: preview ? { preview: true } : {},
  }).html

describe('authored frame components', () => {
  it('renders the pinned definition as the site header, scoped by its slug', () => {
    const html = render({ header: authoredHeader(), header_component: headerDef() })
    expect(html).toContain(
      '<header class="cms-frame cms-frame--header cms-section--site-frame-header cms-frame--sticky">',
    )
    expect(html).toContain('Human &lt;Needs&gt; Index')
    expect(html).toContain('.cms-section--site-frame-header .bar{display:flex}')
    expect(html).toContain('.cms-frame--sticky{position:sticky;top:0;z-index:50}')
    expect(html).not.toContain('cms-global-header')
    expect(html).not.toContain('<script')
  })

  it('fills every navigation slot with the governed menu and marks only the current page', () => {
    const html = render({ header: authoredHeader(), header_component: headerDef() })
    const menus = html.match(/<ul class="cms-nav-list">/g) ?? []
    expect(menus).toHaveLength(2)
    expect(html).toContain('<a href="/about" aria-current="page">About</a>')
    expect(html).toContain('<a href="/">Home</a>')
    // An in-page anchor to the same page is not the current location.
    expect(html).toContain('<a href="/about#overview">Overview</a>')
  })

  it('never renders a stored value for a navigation slot, even a hostile one', () => {
    const header = authoredHeader({
      component: {
        section_def_id: DEF_ID,
        section_def_version: 1,
        values: { title: 'T', menu: '<img src=x onerror=alert(1)>' },
      },
    })
    const html = render({ header, header_component: headerDef() })
    expect(html).not.toContain('onerror')
  })

  it('leaves a navigation slot empty inside page content', () => {
    const def = headerDef()
    const html = renderPage({
      manifest: {
        ...manifest(),
        sections: [{ def, instance: { section_def_id: DEF_ID, section_def_version: 1, values: { title: 'x' } } }],
      },
      shell: shell(),
      isStaging: false,
      navigationPaths: { [HOME_ID]: '/', [ABOUT_ID]: '/about' },
    }).html
    const main = html.slice(html.indexOf('<main'), html.indexOf('</main>'))
    expect(main).not.toContain('cms-nav-list')
  })

  it('falls back to the baseline frame when the shell lacks the pinned definition or version', () => {
    const missing = render({ header: authoredHeader() })
    const stale = render({
      header: authoredHeader(),
      header_component: headerDef().version === 1 ? { ...headerDef(), version: 2 } : null,
    })
    for (const html of [missing, stale]) {
      expect(html).toContain('<a class="cms-site-brand" href="/">Baseline Site</a>')
      expect(html).not.toContain('class="cms-frame')
    }
  })

  it('refuses a definition whose stylesheet is not at the current policy', () => {
    const html = render({ header: authoredHeader(), header_component: { ...headerDef(), css_policy_version: 1 } })
    expect(html).not.toContain('cms-section--site-frame-header')
  })

  it('honours a disabled authored header', () => {
    const html = render({ header: authoredHeader({ enabled: false }), header_component: headerDef() })
    expect(html).not.toContain('<header')
  })

  it('renders an authored footer and marks the frame as site-wide in preview only', () => {
    const footerDef = {
      ...definition('site-frame-footer', '<p class="legal">{{copy}}</p>', '.legal{opacity:.5}', [
        { id: 'copy', kind: 'text', label: 'Copyright', constraints: {} },
      ]),
    }
    const footer = {
      schemaVersion: 2,
      enabled: true,
      component: { section_def_id: DEF_ID, section_def_version: 1, values: { copy: '© The Salvation Army' } },
    }
    const live = render({ footer, footer_component: footerDef })
    expect(live).toContain(
      '<footer class="cms-frame cms-frame--footer cms-section--site-frame-footer"><p class="legal">© The Salvation Army</p></footer>',
    )
    expect(live).not.toContain('data-cms-frame')
    const preview = render({ footer, footer_component: footerDef }, true)
    expect(preview).toContain('data-cms-frame="footer"')
  })

  it('keeps preset-framed pages byte-identical to before', () => {
    const html = render()
    expect(html).not.toContain('cms-frame')
    expect(html).toContain('<header class="cms-site-header">')
  })
})

describe('navigation slot compilation', () => {
  it('refuses a navigation slot inside an attribute', () => {
    const compiled = compileSection({
      sourceHtml: '<a title="{{menu}}">x</a>',
      slots: [{ id: 'menu', kind: 'navigation', label: 'Menu', constraints: {} }],
      scopeSelector: '.cms-section--x',
    })
    expect(compiled.blocking.join(' ')).toMatch(/inside an attribute/)
  })

  it('does not report a repeated navigation slot as a problem', () => {
    const compiled = compileSection({
      sourceHtml: '<nav>{{menu}}</nav><details>{{menu}}</details>',
      slots: [{ id: 'menu', kind: 'navigation', label: 'Menu', constraints: {} }],
      scopeSelector: '.cms-section--x',
    })
    expect(compiled.problems).toEqual([])
  })
})
