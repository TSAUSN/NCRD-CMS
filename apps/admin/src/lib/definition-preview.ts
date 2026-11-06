import {
  sourceSampleValues,
  isIconSlot,
  type SlotDef,
  type StructuredDocument,
  type StructuredNode,
  type CollectionField,
} from '@cms/schema'
import { CORE_LIBRARY, corePreviewValues } from '@cms/seeds/core-library'
import { escapeText } from '@cms/renderer'

export function sampleFieldValue(kind: string, label: string): unknown {
  if (kind === 'richtext') return `<p>${escapeText(label)} goes here. Replace this with your own words.</p>`
  if (kind === 'link' || kind === 'button') return { label, url: '/' }
  if (kind === 'url') return 'https://example.test/resource'
  if (kind === 'image') return { src: '/section-preview-placeholder.svg', alt: label, decorative: false }
  return label
}

/** Preview-only records. They never become collection data or page defaults. */
export function definitionPreviewValues(slots: SlotDef[], doc: StructuredDocument | null): Record<string, unknown> {
  const metadata = slots[0]?.constraints
  if (metadata?.coreLibrary === 'r8') {
    const entry = CORE_LIBRARY.find(entry => entry.list === metadata.coreList && entry.list)
    if (entry) return { ...sourceSampleValues(slots), ...corePreviewValues(entry) }
  }
  const values = Object.fromEntries(
    slots.map(slot => [slot.id, isIconSlot(slot) ? 'heart' : sampleFieldValue(slot.kind, slot.label)]),
  )
  Object.assign(values, sourceSampleValues(slots))
  function walk(nodes: StructuredNode[]) {
    for (const node of nodes) {
      if (node.type === 'element') walk(node.children ?? [])
      if (node.type !== 'repeat') continue
      const fields = new Map<string, CollectionField>()
      function itemFields(items: StructuredNode[]) {
        for (const item of items) {
          if (item.type === 'element') itemFields(item.children ?? [])
          else if (item.type !== 'repeat' && item.type !== 'provider-embed')
            fields.set(item.field, {
              key: item.field,
              label: item.field,
              type:
                item.type === 'richtext'
                  ? 'richtext'
                  : item.type === 'image'
                    ? 'image'
                    : item.type === 'link'
                      ? 'url'
                      : 'text',
              required: false,
            })
        }
      }
      itemFields(node.item)
      if (!fields.size) fields.set('preview', { key: 'preview', label: 'Sample', type: 'text', required: false })
      const id = '00000000-0000-4000-8000-000000000001'
      const schemaId = '00000000-0000-4000-8000-000000000002'
      const samples = Object.fromEntries(
        [...fields.values()].map(field => [field.key, sampleFieldValue(field.type, field.label)]),
      )
      values[node.field] = {
        kind: 'collection',
        collectionId: id,
        readerKey: 'preview',
        publishedSchemaVersionId: schemaId,
        publishedSchemaRevision: '1',
        publishedEntryRevision: '1',
        schemas: [{ id: schemaId, revision: '1', fields: [...fields.values()] }],
        entries: [
          {
            id: '00000000-0000-4000-8000-000000000003',
            stableKey: 'sample-record',
            schemaVersionId: schemaId,
            values: samples,
          },
        ],
      }
    }
  }
  if (doc) walk(doc.nodes)
  return values
}
