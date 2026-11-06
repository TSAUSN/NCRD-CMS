import type { SlotDef } from '@cms/schema'
import type { Queryable } from '@cms/platform'
import { DomainError } from '@cms/domain'
import { readCollectionBinding } from './collection-binding.ts'
import {
  storyPlacementFeeds,
  storyPlacementFields,
  type StoryPlacementContext,
  type StoryPlacementPage,
  type StoryPlacementRow,
} from './story-placement.ts'
/** RLS-scoped, read-only context. Other private Story/page drafts are excluded. */
export async function readStoryPlacement(
  client: Queryable,
  siteId: string,
  collectionId: string,
  entryId: string | { id: string; stableKey: string; createdAt: string },
): Promise<StoryPlacementContext> {
  const list = (
    await client.query(
      "SELECT s.initial_release_required FROM sites s JOIN collections c ON c.site_id=s.id WHERE s.id=$1 AND c.id=$2 AND c.reader_key='stories' AND s.archived_at IS NULL",
      [siteId, collectionId],
    )
  ).rows[0]
  if (!list) throw new DomainError('not_found', 'Story placements are unavailable.')
  const privateSite = list.initial_release_required === true,
    entries = (
      await client.query(
        'SELECT e.id,e.stable_key,e.created_at::text,e.sort_index,e.published_sort_index,e.archived_at,e.published_archived_at,d.values AS draft_values,p.values AS published_values FROM collection_entries e LEFT JOIN collection_entry_versions d ON d.id=e.draft_version_id LEFT JOIN collection_entry_versions p ON p.id=e.published_version_id WHERE e.collection_id=$1 ORDER BY e.sort_index,e.created_at,e.id',
        [collectionId],
      )
    ).rows,
    target =
      typeof entryId === 'string'
        ? entries.find(row => row.id === entryId && row.archived_at === null)
        : {
            id: entryId.id,
            stable_key: entryId.stableKey,
            created_at: entryId.createdAt,
            sort_index: Math.max(-1, ...entries.map(row => Number(row.sort_index))) + 1,
            draft_values: { story_url: '' },
          }
  if (!target) throw new DomainError('not_found', 'This story is unavailable.')
  const path = String(target.draft_values?.story_url ?? ''),
    rows: StoryPlacementRow[] = entries.flatMap(row => {
      const values = privateSite
        ? row.archived_at === null
          ? row.draft_values
          : null
        : row.published_archived_at === null
          ? row.published_values
          : null
      return values
        ? [
            {
              id: row.id,
              stableKey: row.stable_key,
              createdAt: new Date(row.created_at).toISOString(),
              sortIndex: privateSite ? row.sort_index : (row.published_sort_index ?? row.sort_index),
              values,
            },
          ]
        : []
    })
  const saved = (
    await client.query(
      'SELECT p.id,p.title,CASE WHEN $2 OR app.page_path(p.slug)=$3 THEN app.page_path(p.slug) ELSE (SELECT r.path FROM published_routes r WHERE r.page_id=p.id ORDER BY r.updated_at DESC LIMIT 1) END AS path,v.content FROM pages p JOIN page_versions v ON v.id=CASE WHEN $2 OR app.page_path(p.slug)=$3 THEN p.draft_version_id ELSE p.published_version_id END WHERE p.site_id=$1 AND p.archived_at IS NULL AND ($2 OR app.page_path(p.slug)=$3 OR EXISTS(SELECT 1 FROM published_routes r WHERE r.page_id=p.id)) ORDER BY p.slug,p.id',
      [siteId, privateSite, path],
    )
  ).rows
  const ids = [
      ...new Set(
        saved.flatMap(page =>
          Array.isArray(page.content)
            ? page.content
                .map((section: { section_def_id?: unknown }) => section.section_def_id)
                .filter((id: unknown): id is string => typeof id === 'string' && /^[0-9a-f-]{36}$/i.test(id))
            : [],
        ),
      ),
    ],
    definitions = (
      await client.query(
        'SELECT d.id,d.slug,v.version,v.slots FROM section_defs d JOIN section_def_versions v ON v.section_def_id=d.id WHERE d.id=ANY($1::uuid[])',
        [ids],
      )
    ).rows,
    slugs = new Map<string, string>(definitions.map(row => [row.id, row.slug])),
    slots = new Map<string, readonly SlotDef[]>(definitions.map(row => [row.id + ':' + row.version, row.slots]))
  const hasArticle = saved.some(page => page.path === path)
  const pages: StoryPlacementPage[] = saved.map(page => {
    const first = Array.isArray(page.content) ? page.content[0] : null,
      binding = readCollectionBinding(first?.values?.story),
      ownerKey =
        binding?.selection.mode === 'manual' && binding.selection.stableKeys.length === 1
          ? binding.selection.stableKeys[0]
          : null,
      owner = ownerKey
        ? entries.find(
            row =>
              row.stable_key === ownerKey &&
              (row.id === entryId ? row.draft_values : privateSite ? row.draft_values : row.published_values)
                ?.story_url === page.path,
          )
        : null,
      article = Boolean(owner && slugs.get(first?.section_def_id) === 'core-story-detail')
    return {
      id: page.id,
      title: page.title,
      path: page.path,
      article,
      feeds: storyPlacementFeeds(page.content, slugs, slots).filter(
        feed =>
          !(
            article &&
            feed.selection.mode === 'manual' &&
            feed.selection.stableKeys.length === 1 &&
            feed.selection.stableKeys[0] === owner?.stable_key
          ),
      ),
    }
  })
  const fields = storyPlacementFields(pages)
  return {
    pages: pages.filter(page => page.feeds.length),
    rows: rows.map(row => ({
      ...row,
      values: Object.fromEntries(
        fields.filter(field => Object.hasOwn(row.values, field)).map(field => [field, row.values[field]]),
      ),
    })),
    candidate: {
      id: target.id,
      stableKey: target.stable_key,
      createdAt: new Date(target.created_at).toISOString(),
      sortIndex: target.sort_index,
    },
    privateSite,
    hasArticle,
    readAt: new Date().toISOString(),
    fields,
  }
}
