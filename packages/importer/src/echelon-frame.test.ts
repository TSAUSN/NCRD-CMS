import { readFileSync } from 'node:fs'
import postcss from 'postcss'
import { describe, expect, it } from 'vitest'
import { renderPage } from '@cms/renderer'
import { frameComponent, sourceFooterFrame, sourceHeaderFrame } from './frame-components.ts'
import { attribute, parseHtml, type HtmlNode, type HtmlElement } from './html.ts'

// Real native frame markup and its CSS closure, from the sanitized V1 source
// transfer on October 2, 2026. No runtime, export data, or credentials are used.
const source = readFileSync(new URL('./__fixtures__/echelon-frame.html', import.meta.url), 'utf8')
const css = readFileSync(new URL('./__fixtures__/echelon-frame.css', import.meta.url), 'utf8')
const media = new Map([
  [
    '/images/echelon-leaders-symposium-logo.png',
    { mediaId: '11111111-1111-4111-8111-111111111111', url: '/media/11111111-1111-4111-8111-111111111111/original' },
  ],
  [
    '/images/shield.png',
    { mediaId: '22222222-2222-4222-8222-222222222222', url: '/media/22222222-2222-4222-8222-222222222222/original' },
  ],
])
function elements(html: string): HtmlElement[] {
  const parsed = parseHtml(html)
  if (!parsed.ok) throw new Error(parsed.refusal)
  const walk = (nodes: HtmlNode[]): HtmlElement[] =>
    nodes.flatMap(node => (node.kind === 'text' ? [] : [node, ...walk(node.children)]))
  return walk(parsed.nodes)
}

describe('native Echelon frame', () => {
  const header = sourceHeaderFrame(source)
  const footer = sourceFooterFrame(source, 2031)
  const component = frameComponent({
    slug: 'echelon-header',
    frame: header,
    builtCss: css,
    assets: media,
    links: new Map(),
  })

  it('replaces direct desktop anchors and the div phone panel with governed menus', () => {
    const nodes = elements(header.html)
    const desktop = nodes.find(node => attribute(node, 'class') === 'desktop-nav')!
    expect(desktop.tag).toBe('nav')
    expect(desktop.children).toHaveLength(1)
    expect(desktop.children[0]).toMatchObject({ tag: 'span' })
    const disclosure = nodes.find(node => attribute(node, 'class') === 'echelon-mobile-menu')!
    expect(disclosure.tag).toBe('details')
    expect(disclosure.children[0]).toMatchObject({ tag: 'summary' })
    expect(nodes.filter(node => node.tag === 'button')).toHaveLength(0)
    expect(nodes.filter(node => attribute(node, 'id') === 'mobile-menu')).toHaveLength(0)
    const panel = nodes.find(node => attribute(node, 'class') === 'mobile-menu')!
    expect(panel.tag).toBe('nav')
    expect(attribute(panel, 'hidden')).toBeUndefined()
    expect(component.sourceHtml.match(/\{\{site-menu\}\}/g)).toHaveLength(2)
    expect(component.compiled.blocking).toEqual([])
    expect(component.compiled.carriesTrustedCode).toBe(false)
  })

  it('keeps native branding and the source registration unavailable state', () => {
    expect(component.sourceHtml).toContain('<strong>ECHELON</strong>')
    expect(component.sourceHtml).toContain('/media/11111111-1111-4111-8111-111111111111/original')
    const registration = elements(component.sourceHtml).filter(
      node => attribute(node, 'data-registration-cta') !== undefined,
    )
    expect(registration).toHaveLength(2)
    expect(registration.every(node => (attribute(node, 'class') ?? '').includes('registration-unavailable'))).toBe(true)
    expect(registration.every(node => attribute(node, 'href') === '/#register')).toBe(true)
    const styles = postcss.parse(component.sourceCss)
    let unavailable = false
    styles.walkRules(rule => {
      if (rule.selector === '.registration-unavailable') {
        unavailable = rule.nodes.some(
          node => node.type === 'decl' && node.prop === 'display' && node.value === 'none' && node.important,
        )
      }
    })
    expect(unavailable).toBe(true)
  })

  it('preserves native desktop/phone breakpoints and gives the outer frame control of positioning', () => {
    expect(component.sourceCss).toContain('grid-template-columns: minmax(13rem, 1fr) auto minmax(10rem, 1fr)')
    expect(component.sourceCss).toContain('gap: clamp(1.5rem, 4vw, 4rem)')
    expect(header.css).toContain(
      '.echelon-frame>.site-header{position:relative;top:auto;left:auto;right:auto;z-index:auto}',
    )
    expect(header.css).toContain('@media(max-width:900px){.echelon-frame .echelon-mobile-menu{display:block}}')
    expect(component.sourceCss).toContain('@media (min-width: 901px)')
    expect(component.sourceCss).not.toContain('.hni-frame')
    expect(header.html).not.toContain('sm:hidden')
  })

  it('renders both menu instances without nested anchors, including child navigation', () => {
    const id = '33333333-3333-4333-8333-333333333333'
    const { html } = renderPage({
      manifest: { page: { id: 'preview', version_id: 'preview', title: 'Echelon', path: '/' }, meta: {}, sections: [] },
      shell: {
        site: { id: 'site', name: 'Echelon', slug: 'echelon' },
        theme: {},
        canonical_host: null,
        staging_host: null,
        navigation: [
          {
            label: 'About',
            visible: true,
            target: { type: 'url', url: '#about' },
            children: [{ label: 'Details', visible: true, target: { type: 'url', url: '#details' } }],
          },
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
    })
    const renderedHeader = /<header\b[\s\S]*?<\/header>/.exec(html)![0]
    expect(renderedHeader).toContain('cms-frame--sticky')
    expect(renderedHeader.match(/href="#about"/g)).toHaveLength(2)
    expect(renderedHeader.match(/href="#details"/g)).toHaveLength(2)
    for (const node of elements(renderedHeader).filter(node => node.tag === 'a')) {
      expect(node.children.some(child => child.kind === 'element' && ['a', 'ul', 'li'].includes(child.tag))).toBe(false)
    }
    expect(header.css).toContain('.cms-nav-item:focus-within>.cms-nav-submenu{display:block}')
    expect(header.css).toContain('.echelon-mobile-menu .cms-nav-submenu{display:block;position:static')
  })

  it('compiles the real footer and preserves legal destinations and editable fields', () => {
    const result = frameComponent({
      slug: 'echelon-footer',
      frame: footer,
      builtCss: css,
      assets: media,
      links: new Map(),
    })
    expect(result.compiled.blocking).toEqual([])
    expect(result.sourceHtml).toContain('echelon-frame')
    expect(JSON.stringify(result.values)).toContain('2031 The Salvation Army')
    expect(JSON.stringify(result.values)).toContain('https://www.salvationarmyusa.org/privacy-policy/')
    expect(result.slots.filter(slot => slot.kind === 'link').length).toBeGreaterThan(5)
    expect(result.sourceCss).toContain('.registration-unavailable')
  })

  it('refuses a changed Echelon menu shape instead of silently applying the HNI adapter', () => {
    expect(() => sourceHeaderFrame(source.replace('id="mobile-menu"', 'id="other-menu"'))).toThrow(
      /Echelon header menu/,
    )
  })
})
