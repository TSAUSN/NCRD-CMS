import {
  CollectionModel,
  CollectionFields,
  StructuredDocument,
  structuredFieldNodes,
  collectionTemplateNode,
  type SlotDef,
} from '@cms/schema'
import type { Queryable } from '@cms/platform'
import { storiesCatalog } from './stories-catalog.ts'
import { collectionBindingProblem, type CollectionBindingOption } from './collection-binding.ts'

/** All reads use the caller's identity-scoped transaction; no owner connection. */
export async function readCollectionBindingOptions(
  client: Queryable,
  siteId: string,
  definitionId: string,
  version: number,
  fieldId: string,
): Promise<CollectionBindingOption[] | null> {
  const site = (await client.query('SELECT id,slug FROM sites WHERE id=$1', [siteId])).rows[0]
  if (!site) return null
  const definition = (
    await client.query<{ definition_kind: string; structured_doc: unknown; slots: SlotDef[] }>(
      `SELECT v.definition_kind,v.structured_doc,v.slots FROM section_defs d JOIN section_def_versions v ON v.section_def_id=d.id
     WHERE d.id=$1 AND v.version=$2 AND (d.scope='global' OR d.site_id=$3)
       AND d.placement='page'`,
      [definitionId, version, siteId],
    )
  ).rows[0]
  const parsed = StructuredDocument.safeParse(definition?.structured_doc)
  const slot = definition?.slots?.find(slot => slot.id === fieldId)
  const repeat =
    definition?.definition_kind === 'structured' && parsed.success
      ? structuredFieldNodes(parsed.data.nodes).find(node => node.type === 'repeat' && node.field === fieldId)
      : definition?.definition_kind === 'legacy' && slot
        ? collectionTemplateNode(slot)
        : null
  if (!repeat || repeat.type !== 'repeat') return null
  const collections = (
    await client.query<{
      id: string
      name: string
      reader_key: string
      fields: unknown
      presentation: unknown
      draft_fields: unknown
      draft_presentation: unknown
    }>(
      `SELECT c.id,c.name,c.reader_key,v.fields,v.sort AS presentation,d.fields AS draft_fields,d.sort AS draft_presentation FROM collections c
      LEFT JOIN collection_schema_versions v ON v.id=c.published_schema_version_id AND v.collection_id=c.id
      LEFT JOIN collection_schema_versions d ON d.id=c.draft_schema_version_id AND d.collection_id=c.id
      WHERE c.site_id=$1 ORDER BY lower(c.name),c.id`,
      [siteId],
    )
  ).rows
  const entries = (
    await client.query<{
      collection_id: string
      stable_key: string
      values: Record<string, unknown>
      fields: unknown
    }>(
      `SELECT e.collection_id,e.stable_key,v.values,s.fields FROM collection_entries e
      JOIN collection_entry_versions v ON v.id=e.published_version_id AND v.entry_id=e.id
      JOIN collection_schema_versions s ON s.id=v.schema_version_id AND s.collection_id=e.collection_id
      WHERE e.site_id=$1 AND e.published_archived_at IS NULL ORDER BY e.published_sort_index,e.id`,
      [siteId],
    )
  ).rows
  return collections.map(collection => {
    const model = CollectionModel.safeParse({ fields: collection.fields, presentation: collection.presentation })
    const records = entries.filter(entry => entry.collection_id === collection.id)
    let problem = model.success ? collectionBindingProblem(repeat, model.data.fields) : 'Publish the list fields first.'
    for (const record of records) {
      const fields = CollectionFields.safeParse(record.fields)
      if (!problem && (!fields.success || collectionBindingProblem(repeat, fields.data)))
        problem = 'Some published items use older fields. Save and publish them with the current list fields first.'
    }
    const whole = CollectionModel.safeParse(collection.draft_fields),
      draft = whole.success
        ? whole
        : CollectionModel.safeParse({ fields: collection.draft_fields, presentation: collection.draft_presentation }),
      catalog = collection.reader_key === 'stories' && draft.success ? storiesCatalog(draft.data, site.slug) : null
    return {
      ...(catalog
        ? {
            storyTags: {
              mainLabel: catalog.mainLabel,
              secondaryLabel: catalog.secondaryLabel,
              source: catalog.source,
              mainTags: catalog.mainTags.map(({ id, label }) => ({ id, label })),
              secondaryTags: catalog.secondaryTags.map(({ id, label }) => ({ id, label })),
            },
          }
        : {}),
      id: collection.id,
      name: collection.name,
      readerKey: collection.reader_key,
      compatible: problem === null,
      problem,
      filters: model.success
        ? model.data.fields
            .filter(
              field =>
                field.type === 'select' ||
                (field.type === 'text' && ['tag', 'tags', 'category', 'categories'].includes(field.key)),
            )
            .map(field => ({
              key: field.key,
              label: field.label,
              values: [
                ...new Set(
                  records.flatMap(record => {
                    const value = record.values[field.key]
                    return typeof value === 'string'
                      ? (field.key === 'tag' || field.key === 'tags' ? value.split(',') : [value])
                          .map(tag => tag.trim())
                          .filter(Boolean)
                      : []
                  }),
                ),
              ].sort(),
            }))
        : [],
      entries: records.map(record => ({
        stableKey: record.stable_key,
        title: model.success
          ? String(record.values[model.data.presentation.titleField] ?? record.stable_key)
              .replace(/<[^>]*>/g, '')
              .trim() || record.stable_key
          : record.stable_key,
      })),
    }
  })
}
