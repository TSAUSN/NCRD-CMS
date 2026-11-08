import 'server-only'
import { STORY_SECTORS, STORY_REGIONS } from '@cms/seeds/sawso-stories'
import { asUser } from '@cms/platform'
import { getReleaseCollectionSelections } from './collection-queries.ts'
import { changedCells, readableReleaseValue, storyEntryPresentation, type ReleasePresentation } from './release-copy.ts'
import type { ReleaseItem } from './releases.ts'

export async function addReleaseListPresentations(
  userId: string,
  siteId: string,
  items: ReleaseItem[],
  retain: (item: ReleaseItem, data: ReleasePresentation) => void,
) {
  const itemsByCollection = new Map<string, ReleaseItem[]>()
  for (const item of items) {
    if (!item.type.startsWith('collection_')) continue
    const selected = itemsByCollection.get(item.id)
    if (selected) selected.push(item)
    else itemsByCollection.set(item.id, [item])
  }
  if (!itemsByCollection.size) return
  const collectionIds = [...itemsByCollection.keys()]
  const collections = await getReleaseCollectionSelections(userId, siteId, collectionIds)
  for (const [id, selected] of itemsByCollection) {
    const list = collections.get(id)
    if (!list) continue
    for (const item of selected) {
      if (item.type === 'collection_schema') {
        const describe = (model: typeof list.draft | null) =>
          model?.fields.map(field => `${field.label}${field.required ? ' (required)' : ''}`).join(' · ') ||
          'No fields yet'
        retain(item, {
          summary: 'Editor form fields changed',
          cells: [{ label: 'Fields', before: describe(list.published), after: describe(list.draft) }],
        })
      } else {
        const entryIds = item.entryIds ? new Set(item.entryIds) : undefined
        const entries = entryIds ? list.entries.filter(entry => entry.id && entryIds.has(entry.id)) : list.entries
        const labels = Object.fromEntries(list.draft.fields.map(field => [field.key, field.label]))
        const cells = entries.flatMap(entry => {
          const title = readableReleaseValue(entry.values[list.draft.presentation.titleField])
          if (entry.archived)
            return entry.publishedValues && !entry.publishedArchived
              ? [{ label: title, before: 'Live item', after: 'Removed from the live list' }]
              : []
          const fields = changedCells(entry.publishedValues ?? {}, entry.values, labels)
          if (entry.sortIndex !== entry.publishedSortIndex)
            fields.push({
              label: 'Position',
              before: entry.publishedSortIndex == null ? 'Not live' : String(entry.publishedSortIndex + 1),
              after: String(entry.sortIndex + 1),
            })
          return fields.map(field => ({ ...field, label: `${title} · ${field.label}` }))
        })
        if (item.entryIds && entries.length === 1) {
          const entry = entries[0]!
          const catalog = list.draft.presentation.stories
          const names = {
            main: Object.fromEntries((catalog?.mainTags ?? STORY_SECTORS).map(t => [t.id, t.label])),
            secondary: Object.fromEntries((catalog?.secondaryTags ?? STORY_REGIONS).map(t => [t.id, t.label])),
          }
          retain(item, storyEntryPresentation(entry.publishedValues, entry.values, list.draft.fields, names))
          continue
        }
        const count = item.entryIds
          ? entries.filter(
              entry =>
                JSON.stringify(entry.values) !== JSON.stringify(entry.publishedValues) ||
                entry.sortIndex !== entry.publishedSortIndex ||
                entry.archived !== entry.publishedArchived,
            ).length
          : list.changedEntries
        const upgrading =
          list.readerKey === 'stories' && !item.entryIds
            ? await asUser({ userId }, async client =>
                Number(
                  (
                    await client.query(
                      `SELECT COALESCE(sum(models.story_count),0) AS count FROM (
          SELECT v.schema_version_id,count(*) AS story_count FROM collection_entries e JOIN collection_entry_versions v ON v.id=e.draft_version_id
          WHERE e.collection_id=$1 AND e.archived_at IS NULL GROUP BY v.schema_version_id
         ) models WHERE NOT app.story_controls_schema_compatible(models.schema_version_id,$2::uuid)`,
                      [list.id, list.draftSchemaVersionId],
                    )
                  ).rows[0]!.count,
                ),
              )
            : 0
        const words = [
          ...(count || !upgrading
            ? [
                `${count} ${item.entryIds ? (count === 1 ? 'story changed' : 'stories changed') : count === 1 ? 'item changed' : 'items changed'}`,
              ]
            : []),
          ...(upgrading ? [`Update editing controls for ${upgrading} ${upgrading === 1 ? 'story' : 'stories'}`] : []),
          `used on ${list.usedOn?.length ?? 0} ${(list.usedOn?.length ?? 0) === 1 ? 'page' : 'pages'}`,
        ]
        retain(item, { summary: words.join(' · '), cells })
      }
    }
  }
}
