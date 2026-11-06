import { decodeHTML, decodeHTMLAttribute } from 'entities'
import {
  DEFAULT_HEADER_CONFIG,
  DEFAULT_FOOTER_CONFIG,
  HeaderConfigV1,
  FooterConfigV1,
  NavTarget,
  NavTree,
} from '@cms/schema'
import { attribute, parseHtml, type HtmlElement, type HtmlNode } from './html.ts'
import { serializeLegacy } from './legacy-values.ts'
import type { MigrationBundle } from './migration.ts'

const elements = (nodes: HtmlNode[]): HtmlElement[] =>
  nodes.flatMap(node => (node.kind === 'text' ? [] : [node, ...elements(node.children)]))
const textOf = (node: HtmlNode): string =>
  (node.kind === 'text' ? decodeHTML(node.text) : node.tag === 'svg' ? '' : node.children.map(textOf).join(' '))
    .replace(/\s+/g, ' ')
    .trim()

export function sourceShell(
  bundle: Pick<MigrationBundle, 'records'>,
  sourceSite: string,
  pages: { pageId: string; slug: string }[],
  media: Map<string, string>,
) {
  const repository = sourceSite === 'humanneedsindex' ? 'tsa-humanneedsindex' : 'tsa-echelonsymposium'
  const record = bundle.records.find(record => record.key === `source/${repository}/index.html`)
  const payload = record?.payload
  if (!payload || typeof payload !== 'object' || Array.isArray(payload) || typeof payload.text !== 'string')
    throw new Error('source home HTML is required for the site frame')
  const headerSource = /<header\b[^>]*>[\s\S]*?<\/header\s*>/i.exec(payload.text)?.[0]
  const footerSource = /<footer\b[^>]*>[\s\S]*?<\/footer\s*>/i.exec(payload.text)?.[0]
  const parsed = parseHtml(`${headerSource ?? ''}${footerSource ?? ''}`)
  if (!parsed.ok) throw new Error('source frame HTML could not be parsed')
  const all = elements(parsed.nodes)
  const sourceHeader = all.find(node => node.tag === 'header')
  const sourceFooter = all.find(node => node.tag === 'footer')
  if (!sourceHeader || !sourceFooter) throw new Error('source site frame could not be found')
  const headerNodes = elements(sourceHeader.children)
  const footerNodes = elements(sourceFooter.children)
  const name = sourceSite === 'humanneedsindex' ? 'Human Needs Index' : 'Echelon Symposium'
  const issues = new Set(['source-frame-rebuilt-with-governed-layout', 'source-frame-visual-review-required'])
  const target = (href: string) => {
    let url = decodeHTMLAttribute(href)
    if (url.startsWith('#')) url = `/${url}`
    url = url.replace(/^\/index\.html(?=$|[?#])/, '/').replace(/^\/([a-z0-9-]+)\.html(?=$|[?#])/, '/$1')
    const page = pages.find(page => (page.slug ? `/${page.slug}` : '/') === url)
    const candidate = page ? { type: 'page' as const, page_id: page.pageId } : { type: 'url' as const, url }
    return NavTarget.safeParse(candidate).success ? candidate : null
  }
  const mapSourceLink = (node: HtmlElement) => {
    const destination = target(attribute(node, 'href') ?? '')
    const label = textOf(node)
    if (!destination || !label || label.length > 80) return null
    return { label, target: destination }
  }
  const nav = headerNodes.find(node => node.tag === 'nav' && !/mobile/i.test(attribute(node, 'id') ?? ''))
  const navigation = NavTree.parse(
    nav
      ? elements(nav.children)
          .filter(node => node.tag === 'a')
          .flatMap(node => {
            const mapped = mapSourceLink(node)
            return mapped ? [{ ...mapped, visible: true }] : []
          })
      : [],
  )
  const header = structuredClone(DEFAULT_HEADER_CONFIG) as HeaderConfigV1
  header.brand.siteName = name
  const logo = headerNodes.find(node => node.tag === 'img')
  if (logo) {
    const src = attribute(logo, 'src') ?? ''
    header.brand.logoMediaId = media.get(src) ?? null
    if (!header.brand.logoMediaId) issues.add('source-brand-logo-transfer-required')
  }
  header.sticky = true
  const cta = headerNodes.find(
    node => node.tag === 'a' && (attribute(node, 'class') ?? '').split(/\s+/).includes('header-cta'),
  )
  // A source runtime-disabled registration CTA must not become enabled merely
  // because its original HTML happened to call it Register Now.
  if (cta && !(attribute(cta, 'class') ?? '').includes('registration-unavailable')) header.cta = mapSourceLink(cta)
  const footer = structuredClone(DEFAULT_FOOTER_CONFIG) as FooterConfigV1
  footer.brand.siteName = name
  footer.preset = 'columns'
  const blurb = footerNodes.find(node => attribute(node, 'data-block-id') === 'footer-tagline')
  if (blurb) footer.brand.blurb = textOf(blurb).slice(0, 500)
  for (const node of footerNodes) {
    const heading = node.children.find(child => child.kind === 'element' && child.tag === 'h3')
    if (!heading) continue
    const links = elements(node.children)
      .filter(child => child.tag === 'a')
      .flatMap(child => {
        const mapped = mapSourceLink(child)
        return mapped ? [mapped] : []
      })
    if (!links.length) continue
    if (footer.groups.length >= 4 || links.length > 6 || textOf(heading).length > 80) {
      issues.add('source-footer-group-capacity-review')
      continue
    }
    footer.groups.push({ heading: textOf(heading), links })
  }
  const copyright = footerNodes.find(node => attribute(node, 'data-block-id') === 'footer-copy')
  if (copyright) footer.legal.copyright = textOf(copyright).slice(0, 200)
  for (const key of ['privacy', 'accessibility', 'terms'] as const) {
    const node = footerNodes.find(
      node => node.tag === 'a' && attribute(node, 'data-block-id') === `footer-legal-${key}`,
    )
    if (node) footer.legal[key] = mapSourceLink(node)
  }
  const contacts = footerNodes.filter(node => /^contact-\d+$/.test(attribute(node, 'data-block-id') ?? ''))
  if (!contacts.length) {
    const email = footerNodes.find(node => node.tag === 'a' && /^mailto:[^?]+$/.test(attribute(node, 'href') ?? ''))
    if (email) footer.contact = { email: attribute(email, 'href')!.slice(7) }
  }
  const partnership = headerNodes.find(
    node => node.tag === 'a' && /^https:\/\/philanthropy\./.test(attribute(node, 'href') ?? ''),
  )
  const supplemental = [
    ...(partnership
      ? [
          {
            label: 'Source partnership',
            html: `<section class="v1-frame-supplement"><p>In partnership with</p>${serializeLegacy([partnership])}</section>`,
            css: '.v1-frame-supplement{padding:1.5rem;display:flex;flex-wrap:wrap;gap:1rem 1.25rem;align-items:center;justify-content:center;text-align:center}.v1-frame-supplement>p{margin:0}.v1-frame-supplement>a{display:block;min-width:0;max-width:100%}.v1-frame-supplement img{display:block;width:260px;max-width:100%;height:auto;max-height:64px;object-fit:contain}',
          },
        ]
      : []),
    ...(contacts.length
      ? [
          {
            label: 'Source contact information',
            html: `<section class="v1-contact-supplement"><h2>Contact information</h2><div>${serializeLegacy(contacts)}</div></section>`,
            css: '.v1-contact-supplement{padding:2rem;max-width:72rem;margin:auto}.v1-contact-supplement>div{display:flex;gap:2rem;flex-wrap:wrap}.v1-contact-supplement a{display:block;overflow-wrap:anywhere}',
          },
        ]
      : []),
  ]
  if (partnership) issues.add('source-partnership-preserved-above-page-content')
  if (contacts.length) issues.add('source-contact-popup-rebuilt-as-accessible-content')
  return {
    name,
    header: HeaderConfigV1.parse(header),
    footer: FooterConfigV1.parse(footer),
    navigation,
    supplemental,
    issues: [...issues].sort(),
  }
}
