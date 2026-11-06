import { isObject } from './backup.ts'
import { attribute, parseHtml, type HtmlElement } from './html.ts'
import type { MigrationBundle } from './migration.ts'

/** Recover the author's label or catalogue name from the immutable source, or
 * failing both, the name V1's editor gave a page's own section. */
export function sourceSectionLabel(bundle: MigrationBundle, sourceKey: string, index: number, html?: string): string {
  const record = bundle.records.find(record => record.key === sourceKey)
  const payload = record?.payload
  const item = isObject(payload) && Array.isArray(payload.sections) ? payload.sections[index] : null
  const label = isObject(item) && typeof item.label === 'string' ? item.label.trim() : ''
  if (label) return label.slice(0, 200)
  const template = isObject(item) && typeof item.templateId === 'string' ? item.templateId : ''
  const definition = bundle.records.find(
    record =>
      record.kind === 'section-definition' &&
      isObject(record.payload) &&
      isObject(record.payload.source) &&
      record.payload.source.id === template,
  )
  const source = isObject(definition?.payload) ? definition.payload.source : null
  if (isObject(source) && typeof source.name === 'string' && source.name.trim()) return source.name.trim().slice(0, 200)
  if (template.startsWith('native:')) {
    const name = readable(template.slice(7))
    if (name) return name
  }
  return (html && landmarkName(html)) || `Section ${index + 1}`
}

const readable = (id: string) => {
  const name = id.replace(/[-_]+/g, ' ').trim()
  return name ? (name[0]!.toUpperCase() + name.slice(1)).slice(0, 200) : ''
}

/** V1's editor named a source page's own sections after their landmark: an
 * explicit data-section-id, else the element's id (cms-inplace-embed.js), so
 * Echelon's home page read “Hero”, “About”, “Speakers”. */
export function landmarkName(html: string): string {
  const parsed = parseHtml(html)
  if (!parsed.ok) return ''
  const first = (nodes: typeof parsed.nodes) => nodes.find((node): node is HtmlElement => node.kind === 'element')
  let root = first(parsed.nodes)
  // The importer's preserved-reference wrapper is not the source's section.
  if (root && root.tag === 'div' && (attribute(root, 'class') ?? '').split(/\s+/).includes('v1-reference-root'))
    root = first(root.children)
  if (!root) return ''
  for (const name of ['data-section-id', 'id']) {
    const value = readable(attribute(root, name) ?? '')
    if (value) return value
  }
  return ''
}
