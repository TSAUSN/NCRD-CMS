import type { Queryable } from '@cms/platform'
import { CollectionModel, StoriesSettings, StoriesTagOperation, removeStoryTag, resuggestStoryTags } from '@cms/schema'
import { DomainError } from '@cms/domain'
import { escapeText } from '@cms/renderer'
import { storyTagIds } from '@cms/schema'
export type { StoriesTagOperation } from '@cms/schema'
import { storiesCatalog, withStoriesCatalog } from './stories-catalog.ts'
export function newStoryTagId(label: string, used: readonly string[]): string {
  const base =
    label
      .toLowerCase()
      .replace(/&/g, ' and ')
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 70)
      .replace(/-$/, '') || 'tag'
  let next = base,
    suffix = 2
  while (used.includes(next)) next = base + '-' + suffix++
  return next
}
/** One identity transaction covers catalog changes plus any affected stories. */
export async function changeStoriesTags(
  client: Queryable,
  siteId: string,
  collectionId: string,
  revision: string,
  entryRevision: string,
  input: unknown,
) {
  const parsed = StoriesTagOperation.safeParse(input)
  if (!parsed.success || !/^\d+$/.test(revision) || !/^\d+$/.test(entryRevision))
    throw new DomainError('invalid_state', 'Check the tag name, keywords and map areas, then try again.')
  const operation = parsed.data
  const list = (
    await client.query(
      `SELECT c.revision,c.entry_revision,v.fields,v.sort,s.slug,app.can_administer_site(c.site_id) AS allowed FROM collections c JOIN sites s ON s.id=c.site_id JOIN collection_schema_versions v ON v.id=c.draft_schema_version_id WHERE c.id=$1 AND c.site_id=$2 AND c.reader_key='stories'`,
      [collectionId, siteId],
    )
  ).rows[0]
  if (!list) throw new DomainError('not_found', 'Stories is unavailable.')
  if (!list.allowed) throw new DomainError('not_authorized', 'Only a Site admin can manage tags.')
  if (String(list.revision) !== revision || String(list.entry_revision) !== entryRevision)
    throw new DomainError('stale_revision', 'Stories changed. Reload Manage tags before saving.')
  const whole = CollectionModel.safeParse(list.fields),
    model = whole.success ? whole.data : CollectionModel.parse({ fields: list.fields, presentation: list.sort })
  let settings = storiesCatalog(model, list.slug)
  const rows = (
    await client.query(
      `SELECT e.id,e.stable_key,v.values FROM collection_entries e JOIN collection_entry_versions v ON v.id=e.draft_version_id WHERE e.collection_id=$1 AND e.archived_at IS NULL ORDER BY e.sort_index,e.created_at,e.id`,
      [collectionId],
    )
  ).rows
  let values = rows.map(row => row.values as Record<string, unknown>)
  if (operation.action === 'resuggest') values = values.map(v => resuggestStoryTags(v, settings))
  else if (operation.action === 'review-policy')
    settings = { ...settings, publishUnreviewed: operation.publishUnreviewed }
  else if (operation.action === 'rename-group')
    settings = { ...settings, [operation.group === 'main' ? 'mainLabel' : 'secondaryLabel']: operation.label }
  else if (operation.action === 'delete') {
    const result = removeStoryTag(settings, operation.group, operation.id, operation.replacement, values)
    settings = result.settings
    values = result.stories
  } else {
    const key = operation.group === 'main' ? 'mainTags' : 'secondaryTags',
      tags = [...settings[key]]
    if (operation.action === 'add') {
      if (tags.length >= 100)
        throw new DomainError('invalid_state', 'This group has 100 tags. Remove a tag before adding another.')
      tags.push({
        id: newStoryTagId(
          operation.label,
          tags.map(t => t.id),
        ),
        label: operation.label,
        keywords: operation.keywords,
        ...(operation.group === 'secondary' ? { areas: operation.areas } : {}),
      })
    } else {
      const index = tags.findIndex(t => t.id === operation.id)
      if (index < 0) throw new DomainError('stale_revision', 'This tag was removed. Reload Manage tags.')
      if (operation.action === 'edit')
        tags[index] = {
          ...tags[index]!,
          label: operation.label,
          keywords: operation.keywords,
          ...(operation.group === 'secondary' ? { areas: operation.areas } : {}),
        }
      else if (operation.before !== operation.id) {
        const [tag] = tags.splice(index, 1),
          target = operation.before === null ? tags.length : tags.findIndex(t => t.id === operation.before)
        if (target < 0) throw new DomainError('stale_revision', 'The tag order changed. Reload Manage tags.')
        tags.splice(target, 0, tag!)
      }
    }
    settings = StoriesSettings.parse({ ...settings, [key]: tags })
  }
  // Labels shown on legacy story pages are derived tag text, never story body copy.
  const paths = new Set(
    (await client.query('SELECT slug FROM pages WHERE site_id=$1 AND archived_at IS NULL', [siteId])).rows.map(row =>
      String(row.slug),
    ),
  )
  values = values.map(value => ({
    ...value,
    region_label: storyTagIds(value, 'secondary')
      .map(id => settings.secondaryTags.find(t => t.id === id)?.label ?? id)
      .join(', '),
    sector_links: storyTagIds(value, 'main')
      .map(id => {
        const label = escapeText(settings.mainTags.find(t => t.id === id)?.label ?? id),
          path = 'ways-we-help/' + id
        return paths.has(path) ? '<a href="/' + path + '">' + label + '</a>' : label
      })
      .join(' '),
  }))
  const upgraded = withStoriesCatalog(model, settings)
  const catalogChanged = JSON.stringify(model) !== JSON.stringify(upgraded),
    storiesChanged = values.some((v, i) => JSON.stringify(v) !== JSON.stringify(rows[i]!.values))
  const saved = catalogChanged
    ? (
        await client.query('SELECT * FROM app.save_collection_schema($1,$2,$3,$4)', [
          collectionId,
          revision,
          JSON.stringify(upgraded.fields),
          JSON.stringify(upgraded.presentation),
        ])
      ).rows[0]!
    : { revision }
  let nextEntryRevision = entryRevision
  if (storiesChanged) {
    const result = (
      await client.query('SELECT * FROM app.save_collection_entries($1,$2,$3)', [
        collectionId,
        entryRevision,
        JSON.stringify(rows.map((row, i) => ({ id: row.id, stableKey: row.stable_key, values: values[i] }))),
      ])
    ).rows[0]!
    nextEntryRevision = String(result.entry_revision)
  }
  return {
    changed: catalogChanged || storiesChanged,
    settings,
    revision: String(saved.revision),
    entryRevision: nextEntryRevision,
    entries: rows.map((row, i) => ({ id: String(row.id), values: values[i]! })),
  }
}
