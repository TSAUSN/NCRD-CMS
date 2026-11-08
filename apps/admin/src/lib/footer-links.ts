import { parseHtml, decodeSourceText, type HtmlNode } from '@cms/renderer/source-html'
import { escapeAttribute, escapeText } from '@cms/renderer/escape'
import { NavUrl } from '@cms/schema'
export type FooterLink = { label: string; url: string }
/** Refuse unfamiliar content rather than flattening or silently losing it. */
export function readFooterLinks(value: unknown): FooterLink[] | null {
  if (value === undefined || value === '') return []
  if (typeof value !== 'string') return null
  const parsed = parseHtml(value)
  if (!parsed.ok) return null
  const meaningful = (nodes: HtmlNode[]) =>
    nodes.filter(node => node.kind !== 'text' || decodeSourceText(node.text).trim())
  const result: FooterLink[] = []
  for (let node of meaningful(parsed.nodes)) {
    if (node.kind === 'element' && node.tag === 'p' && !node.attributes.length) {
      const children = meaningful(node.children)
      if (children.length !== 1) return null
      node = children[0]!
    }
    if (
      node.kind !== 'element' ||
      node.tag !== 'a' ||
      node.attributes.length !== 1 ||
      node.attributes[0]?.name !== 'href' ||
      node.children.some(child => child.kind !== 'text')
    )
      return null
    const url = decodeSourceText(node.attributes[0].value)
    const label = decodeSourceText(node.children.map(child => (child.kind === 'text' ? child.text : '')).join(''))
    if (!label.trim() || label.length > 120 || !NavUrl.safeParse(url).success) return null
    result.push({ label, url })
    if (result.length > 50) return null
  }
  return result
}
export function writeFooterLinks(links: FooterLink[]): string {
  if (
    links.length > 50 ||
    links.some(link => !link.label.trim() || link.label.length > 120 || !NavUrl.safeParse(link.url).success)
  )
    throw Error('Complete each link name and destination.')
  return links
    .map(link => '<p><a href="' + escapeAttribute(link.url) + '">' + escapeText(link.label) + '</a></p>')
    .join('')
}

/** The simple Text card keeps a plain paragraph plain. Richer copy stays rich. */
export function readFooterText(value: unknown): string | null {
  if (value === undefined || value === '') return ''
  if (typeof value !== 'string') return null
  const parsed = parseHtml(value)
  if (!parsed.ok) return null
  const result: string[] = []
  for (const node of parsed.nodes) {
    if (node.kind === 'text' && !node.text.trim()) continue
    if (node.kind !== 'element' || node.tag !== 'p' || node.attributes.length) return null
    let line = ''
    for (const child of node.children) {
      if (child.kind === 'text') line += decodeSourceText(child.text)
      else if (child.tag === 'br' && !child.attributes.length) line += '\n'
      else return null
    }
    result.push(line)
  }
  return result.join('\n\n')
}
export const writeFooterText = (value: string) =>
  '<p>' + escapeText(value).replace(/\n\n/g, '</p><p>').replace(/\n/g, '<br>') + '</p>'
