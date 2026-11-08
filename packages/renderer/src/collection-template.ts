import { CollectionFields, parseCollectionEntryValues, type SlotDef } from '@cms/schema'
import { resolvedCollection, repeatFieldCompatible } from './structured.ts'
import { escapeAttribute } from './escape.ts'
import { originalRoot } from './original-layout.ts'
import { parseHtml, type HtmlElement, type HtmlNode } from './source-html.ts'

/** Native entry envelopes use exactly the same field/schema checks as typed
 * sections. A template supplies markup only; no stored item HTML is trusted. */
export function renderCollectionTemplate(input: {
  raw: unknown
  field: string
  fields: SlotDef[]
  preview: boolean
  render: (values: Record<string, unknown>) => string | null
}): { html: string; readerKey: string; collectionId: string } | null {
  const list = resolvedCollection(input.raw)
  if (!list) return null
  const schemas = new Map(list.schemas.map(schema => [schema.id, CollectionFields.parse(schema.fields)]))
  let html = ''
  for (const entry of list.entries) {
    const fields = schemas.get(entry.schemaVersionId)
    if (
      !fields ||
      input.fields.some(
        field => !repeatFieldCompatible(field.kind, fields.find(column => column.key === field.id)?.type ?? ''),
      )
    )
      return null
    const parsed = parseCollectionEntryValues(fields, entry.values)
    if (!parsed.ok) return null
    const values: Record<string, unknown> = { ...parsed.values }
    for (const field of input.fields)
      if (field.kind === 'link')
        values[field.id] =
          parsed.values[field.id] === ''
            ? null
            : { url: parsed.values[field.id], label: fields.find(column => column.key === field.id)!.label }
    let item = input.render(values)
    if (item === null) return null
    if (input.preview)
      item =
        originalRoot(
          item,
          ` data-cms-entry="${escapeAttribute(entry.stableKey)}" data-cms-reader="${escapeAttribute(list.readerKey)}" data-cms-list-field="${escapeAttribute(input.field)}"`,
        ) ?? item
    html += item
  }
  return { html, readerKey: list.readerKey, collectionId: list.collectionId }
}

export type CollectionTemplateMark = { field: string; readerKey: string; collectionId: string }
export const collectionTemplateMarker = (field: string) => `<!--cms-bound-list:${field}-->`
/** Instrument the actual repeat parent, including tbody. A custom wrapper
 * inside a table is foster-parented by browsers and changes the real layout. */
export function markCollectionTemplateParents(html: string, marks: CollectionTemplateMark[]): string {
  if (!marks.length) return html
  const parsed = parseHtml(html, { locations: true })
  const insertions = new Map<number, string>()
  if (parsed.ok) {
    const elements: HtmlElement[] = []
    function walk(nodes: HtmlNode[]) {
      for (const node of nodes)
        if (node.kind === 'element') {
          elements.push(node)
          walk(node.children)
        }
    }
    walk(parsed.nodes)
    for (const mark of marks) {
      const at = html.indexOf(collectionTemplateMarker(mark.field))
      if (at < 0) continue
      const parent = elements
        .filter(node => node.source && node.source.openEnd <= at && node.source.closeStart >= at)
        .sort((a, b) => a.source!.end - a.source!.start - (b.source!.end - b.source!.start))[0]
      if (!parent?.source) continue
      const insertionAt = parent.source.start + 1 + parent.tag.length
      if (insertions.has(insertionAt)) continue
      insertions.set(
        insertionAt,
        ` data-cms-slot="${escapeAttribute(mark.field)}" data-cms-kind="repeat" data-cms-list="${escapeAttribute(mark.collectionId)}" data-cms-reader="${escapeAttribute(mark.readerKey)}"`,
      )
    }
    for (const [at, attributes] of [...insertions].sort((a, b) => b[0] - a[0]))
      html = html.slice(0, at) + attributes + html.slice(at)
  }
  for (const mark of marks) html = html.replace(collectionTemplateMarker(mark.field), '')
  return html
}
