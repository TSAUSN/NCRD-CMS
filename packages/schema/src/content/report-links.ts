import { validSectionAnchor } from './section-anchor.ts'
/** Only named, visible sections of the current page supply destinations. */
export function reportPageLinkValues(
  content: readonly { hidden?: boolean; values?: Record<string, unknown> }[],
): Record<string, unknown> {
  const candidates = content.filter(part => !part.hidden && validSectionAnchor(part.values?.__cms_anchor))
  const values: Record<string, unknown> = {},
    items: string[] = []
  for (const part of candidates) {
    const anchor = part.values!.__cms_anchor as string
    if (candidates.filter(other => other.values!.__cms_anchor === anchor).length !== 1) continue
    const label = [
      part.values!.page_link_label,
      part.values!.heading,
      part.values!.page_heading,
      part.values!.title,
    ].find(value => typeof value === 'string' && value.trim())
    if (typeof label !== 'string') continue
    const key = 'i' + (items.length + 1)
    items.push(key)
    values['links__' + key + '__action'] = { url: '#' + anchor, label }
    if (items.length === 48) break
  }
  return { links: { items }, ...values }
}
