import {
  storyWidgetCardValues,
  storyWidgetSelection,
  newsroomSelection,
  collectionTemplateSpec,
  storyCatalog,
  StoriesSettings,
  emptyStoriesSettings,
} from '@cms/schema'
import type { Queryable } from '@cms/platform'
import type { RenderManifest } from '@cms/renderer'
import { readCollectionBinding, selectListRows } from './collection-binding.ts'
/** Private opt-in projection only; publication always uses the strict database manifest. */
export async function withDraftListPreview(
  client: Queryable,
  manifest: RenderManifest,
  versionId: string,
  siteId: string,
  contentOverride?: { values?: Record<string, unknown> }[],
): Promise<RenderManifest> {
  const version = contentOverride
    ? { content: contentOverride }
    : (
        await client.query<{ content: { values?: Record<string, unknown> }[] }>(
          'SELECT content FROM page_versions WHERE id=$1 AND site_id=$2',
          [versionId, siteId],
        )
      ).rows[0]
  if (!version) return manifest
  for (const [index, section] of manifest.sections.entries()) {
    if (!['structured', 'legacy'].includes(section.def.definition_kind ?? 'legacy')) continue
    for (const slot of (section.def.slots ?? []).filter(
      slot => slot.kind === 'repeat' && (section.def.definition_kind === 'structured' || collectionTemplateSpec(slot)),
    )) {
      const binding = readCollectionBinding(version.content[index]?.values?.[slot.id])
      if (!binding) continue
      const list = (
        await client.query<{
          id: string
          reader_key: string
          schema_id: string
          revision: string
          entry_revision: string
          fields: unknown
          settings: unknown
        }>(
          `SELECT c.id,c.reader_key,v.id AS schema_id,v.revision,c.entry_revision,v.fields,d.sort AS settings FROM collections c JOIN collection_schema_versions v ON v.id=COALESCE(c.published_schema_version_id,c.draft_schema_version_id) JOIN collection_schema_versions d ON d.id=c.draft_schema_version_id WHERE c.site_id=$1 AND c.reader_key=$2`,
          [siteId, binding.readerKey],
        )
      ).rows[0]
      if (!list) continue
      const rows = (
        await client.query<{
          id: string
          stableKey: string
          schemaVersionId: string
          values: unknown
          fields: unknown
          revision: string
          createdAt: string
        }>(
          `SELECT e.id,to_char(e.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US') AS "createdAt",e.stable_key AS "stableKey",v.schema_version_id AS "schemaVersionId",v.values,s.fields,s.revision FROM collection_entries e JOIN collection_entry_versions v ON v.id=e.draft_version_id AND v.entry_id=e.id JOIN collection_schema_versions s ON s.id=v.schema_version_id AND s.collection_id=e.collection_id WHERE e.site_id=$1 AND e.collection_id=$2 AND e.archived_at IS NULL ORDER BY e.sort_index,e.id LIMIT 2000`,
          [siteId, list.id],
        )
      ).rows
      const widget =
          list.reader_key === 'stories' &&
          ((section.def.slug === 'core-story-world' && slot.constraints?.['storyWidget'] === 'world') ||
            (section.def.slug === 'core-story-split' && slot.constraints?.['storyWidget'] === 'split')),
        selection = storyWidgetSelection(binding.selection, widget)
      const policy =
        list.reader_key === 'stories'
          ? (StoriesSettings.safeParse((list.settings as { stories?: unknown })?.stories).data ??
            emptyStoriesSettings())
          : undefined
      const entries = selectListRows(rows, selection, new Date(), policy)
      const schemas = new Map<string, { id: string; revision: string; fields: unknown }>([
        [list.schema_id, { id: list.schema_id, revision: list.revision, fields: list.fields }],
      ])
      entries.forEach(row =>
        schemas.set(row.schemaVersionId, { id: row.schemaVersionId, revision: row.revision, fields: row.fields }),
      )
      const envelope = {
        ...(policy && StoriesSettings.safeParse((list.settings as { stories?: unknown })?.stories).success
          ? {
              storyCatalog: {
                ...storyCatalog(policy),
                ...(widget ? { newsroomOrder: newsroomSelection(binding.selection) } : {}),
              },
            }
          : {}),
        kind: 'collection',
        collectionId: list.id,
        readerKey: list.reader_key,
        publishedSchemaVersionId: list.schema_id,
        publishedSchemaRevision: list.revision,
        publishedEntryRevision: list.entry_revision,
        schemas: [...schemas.values()],
        entries: entries.map(({ id, stableKey, schemaVersionId, values, fields }) => ({
          id,
          stableKey,
          schemaVersionId,
          values: widget
            ? storyWidgetCardValues(
                values as Record<string, unknown>,
                fields as import('@cms/schema').CollectionField[],
              )
            : values,
        })),
      }
      section.instance.values = { ...section.instance.values, [slot.id]: envelope }
    }
  }
  // Match the canonical resolver's resource bound, including invalid authored data.
  if (Buffer.byteLength(JSON.stringify(manifest)) > 1_800_000)
    throw new Error('The list preview is too large. Show fewer items in this section.')
  return manifest
}
