import 'server-only'
import { asUser } from '@cms/platform'
import { CollectionModel, type CollectionEntryDraft, type CollectionModel as CollectionModelValue } from '@cms/schema'
import type { SiteDocument } from './document-library.ts'

/** Document bytes remain private; selection exposes only an owned download URL. */
export function listCollectionDocuments(userId: string, siteId: string): Promise<SiteDocument[]> {
  return asUser({ userId }, async client =>
    (
      await client.query<{
        id: string
        original_name: string
        bytes: string
      }>(
        `SELECT a.id,a.original_name,a.bytes FROM site_assets a
      JOIN site_document_metadata m ON m.asset_id=a.id AND m.site_id=a.site_id
      WHERE a.site_id=$1 AND a.kind='document' AND NOT m.archived
      ORDER BY lower(a.original_name),a.id`,
        [siteId],
      )
    ).rows.map(row => ({
      id: row.id,
      originalName: row.original_name,
      bytes: Number(row.bytes),
      url: `/assets/${row.id}`,
    })),
  )
}

export type CollectionSummary = {
  id: string
  slug: string
  readerKey: string
  name: string
  source: 'admin' | 'builtin'
  revision: number
  entryRevision: number
  publishedEntryRevision: number
  usedOn?: { id: string; title: string }[]
  totalEntries: number
  liveEntries: number
  changedEntries: number
  draftSchemaVersionId: string | null
  publishedSchemaVersionId: string | null
}

export type CollectionEntryWorkspace = CollectionEntryDraft & {
  editedAt?: string
  editedBy?: string
  schemaVersionId: string | null
  revision: number
  sortIndex: number
  publishedSortIndex: number | null
  publishedValues: Record<string, unknown> | null
  archived: boolean
  publishedArchived: boolean
}

export type CollectionWorkspace = {
  collections: CollectionSummary[]
  selected:
    | (CollectionSummary & {
        draft: CollectionModelValue
        published: CollectionModelValue | null
        entries: CollectionEntryWorkspace[]
      })
    | null
}

export type CollectionRights = { editEntries: boolean; manageSchema: boolean; publish: boolean }

type SummaryRow = {
  id: string
  slug: string
  reader_key: string
  name: string
  source: 'admin' | 'builtin'
  revision: string
  entry_revision: string
  published_entry_revision: string
  draft_schema_version_id: string | null
  published_schema_version_id: string | null
  total_entries: string
  live_entries: string
  changed_entries: string
  draft_fields: unknown
  draft_sort: unknown
  published_fields: unknown
  published_sort: unknown
}

function parseStoredModel(fields: unknown, presentation: unknown): CollectionModelValue {
  // The initial table called these columns `fields` and `sort`. Collection v1
  // gives `sort` the richer presentation contract while accepting a whole
  // model in `fields` during an upgrade, so the read boundary understands both
  // shapes and still validates either one before it reaches the client.
  const whole = CollectionModel.safeParse(fields)
  if (whole.success) return whole.data
  return CollectionModel.parse({ fields, presentation })
}

function summary(row: SummaryRow): CollectionSummary {
  return {
    id: row.id,
    slug: row.slug,
    readerKey: row.reader_key,
    name: row.name,
    source: row.source,
    revision: Number(row.revision),
    entryRevision: Number(row.entry_revision),
    publishedEntryRevision: Number(row.published_entry_revision),
    totalEntries: Number(row.total_entries),
    liveEntries: Number(row.live_entries),
    changedEntries: Number(row.changed_entries),
    draftSchemaVersionId: row.draft_schema_version_id,
    publishedSchemaVersionId: row.published_schema_version_id,
  }
}

/**
 * One RLS-scoped read model for the collection rail and the open collection.
 * Entry bodies are fetched only for the selected collection; a 2,000-entry
 * catalogue therefore does not multiply by every collection in the rail.
 */
export function getCollectionWorkspace(
  userId: string,
  siteId: string,
  requestedCollectionId?: string,
): Promise<CollectionWorkspace> {
  return asUser({ userId }, async client => {
    const { rows } = await client.query<SummaryRow>(
      `SELECT c.id, c.slug, c.reader_key, c.name, c.source, c.revision,
              c.entry_revision, c.published_entry_revision,
              c.draft_schema_version_id, c.published_schema_version_id,
              draft.fields AS draft_fields, draft.sort AS draft_sort,
              live.fields AS published_fields, live.sort AS published_sort,
              count(e.id) FILTER (WHERE e.archived_at IS NULL)::text AS total_entries,
              count(e.id) FILTER (WHERE e.published_archived_at IS NULL AND e.published_version_id IS NOT NULL)::text AS live_entries,
              count(e.id) FILTER (
                WHERE (e.published_version_id IS NULL AND e.archived_at IS NULL)
                   OR (e.published_version_id IS NOT NULL AND (
                      entry_draft.values IS DISTINCT FROM entry_live.values
                   OR entry_draft.schema_version_id IS DISTINCT FROM entry_live.schema_version_id
                   OR e.sort_index IS DISTINCT FROM e.published_sort_index
                   OR (e.archived_at IS NULL) IS DISTINCT FROM (e.published_archived_at IS NULL)))
              )::text AS changed_entries
         FROM collections c
         LEFT JOIN collection_schema_versions draft ON draft.id = c.draft_schema_version_id
         LEFT JOIN collection_schema_versions live ON live.id = c.published_schema_version_id
         LEFT JOIN collection_entries e ON e.collection_id = c.id
         LEFT JOIN collection_entry_versions entry_draft ON entry_draft.id = e.draft_version_id
         LEFT JOIN collection_entry_versions entry_live ON entry_live.id = e.published_version_id
        WHERE c.site_id = $1
        GROUP BY c.id, draft.fields, draft.sort, live.fields, live.sort
        ORDER BY lower(c.name), c.created_at`,
      [siteId],
    )
    const usage = (
      await client.query<{ id: string; pages: { id: string; title: string }[] }>(
        `SELECT c.id,COALESCE(jsonb_agg(DISTINCT jsonb_build_object('id',p.id,'title',p.title)) FILTER(WHERE p.id IS NOT NULL),'[]'::jsonb) AS pages
      FROM collections c LEFT JOIN pages p ON p.site_id=c.site_id AND p.archived_at IS NULL AND EXISTS(SELECT 1 FROM page_versions v WHERE v.id IN(p.draft_version_id,p.published_version_id) AND jsonb_path_exists(v.content,'$[*].values.* ? (@.readerKey == $reader)',jsonb_build_object('reader',c.reader_key))) WHERE c.site_id=$1 GROUP BY c.id`,
        [siteId],
      )
    ).rows
    const collections = rows.map(row => ({
      ...summary(row),
      usedOn: usage.find(item => item.id === row.id)?.pages ?? [],
    }))
    const selectedRow = rows.find(row => row.id === requestedCollectionId) ?? rows[0] ?? null
    if (!selectedRow || selectedRow.draft_schema_version_id === null) {
      return { collections, selected: null }
    }

    const entryRows = await client.query<{
      id: string
      stable_key: string
      revision: string
      sort_index: number
      published_sort_index: number | null
      edited_at: string
      edited_by: string
      draft_schema_version_id: string | null
      draft_values: unknown
      published_values: unknown
      archived_at: Date | null
      published_archived_at: Date | null
    }>(
      `SELECT e.id, e.stable_key, e.revision, e.sort_index, e.published_sort_index, draft.created_at::text AS edited_at, CASE WHEN draft.author_id=app.current_user_id() THEN 'You' ELSE 'Another editor' END AS edited_by,
              draft.schema_version_id AS draft_schema_version_id, draft.values AS draft_values, live.values AS published_values,
              e.archived_at, e.published_archived_at
         FROM collection_entries e
         LEFT JOIN collection_entry_versions draft ON draft.id = e.draft_version_id
         LEFT JOIN collection_entry_versions live ON live.id = e.published_version_id
        WHERE e.collection_id = $1
        ORDER BY e.archived_at NULLS FIRST, e.sort_index, e.created_at, e.id`,
      [selectedRow.id],
    )
    return {
      collections,
      selected: {
        ...collections.find(item => item.id === selectedRow.id)!,
        draft: parseStoredModel(selectedRow.draft_fields, selectedRow.draft_sort),
        published:
          selectedRow.published_schema_version_id === null
            ? null
            : parseStoredModel(selectedRow.published_fields, selectedRow.published_sort),
        entries: entryRows.rows.map(entry => ({
          id: entry.id,
          stableKey: entry.stable_key,
          editedAt: new Date(entry.edited_at).toISOString(),
          editedBy: entry.edited_by,
          schemaVersionId: entry.draft_schema_version_id,
          revision: Number(entry.revision),
          sortIndex: entry.sort_index,
          publishedSortIndex: entry.published_sort_index,
          values: (entry.draft_values ?? {}) as Record<string, unknown>,
          publishedValues: entry.published_values === null ? null : (entry.published_values as Record<string, unknown>),
          archived: entry.archived_at !== null,
          publishedArchived: entry.published_archived_at !== null,
        })),
      },
    }
  })
}

/** Rights use the same database predicates and membership rows as commands. */
export function collectionRights(userId: string, siteId: string): Promise<CollectionRights> {
  return asUser({ userId }, async client => {
    const { rows } = await client.query<{
      super_admin: boolean
      site_admin: boolean
      editor: boolean
      publisher: boolean
    }>(
      `SELECT app.is_super_admin() AS super_admin,
              app.can_administer_site($1) AS site_admin,
              EXISTS (
                SELECT 1 FROM site_memberships
                 WHERE site_id = $1 AND user_id = app.current_user_id()
                   AND role IN ('contributor','editor','site_admin')
              ) AS editor,
              app.can_publish($1) AS publisher`,
      [siteId],
    )
    const row = rows[0]
    const administer = row?.super_admin === true || row?.site_admin === true
    return {
      editEntries: administer || row?.editor === true,
      manageSchema: administer,
      publish: row?.publisher === true,
    }
  })
}
