import 'server-only'
import { asUser } from '@cms/platform'
import { MEDIA_FILTER_SQL, MEDIA_FACETS_SQL, mediaLibraryPageSql } from './media-library-queries.ts'
import type {
  MediaAsset,
  MediaLibraryQuery,
  MediaLibraryResult,
  MediaStatus,
  MediaUsageRecord,
  MediaUsageResult,
} from './media-library.ts'

type MediaRow = {
  id: string
  revision: string
  site_id: string | null
  original_name: string
  alt_text: string
  decorative: boolean
  focal: unknown
  width: number | null
  height: number | null
  bytes: string | null
  mime_type: string
  status: MediaStatus
  folder: string
  attribution: string
  source: string
  tags: string[]
  created_at: Date
  deleted_at: Date | null
  used_on_items: number
  used_in_versions: number
  has_thumbnail: boolean
  has_card: boolean
  has_wide: boolean
}

type UsageRow = {
  key: string
  kind: MediaUsageRecord['kind']
  title: string
  version_label: string
  is_current_draft: boolean
  is_current_live: boolean
  href: string | null
  created_at: Date
}

function focalPoint(value: unknown): { x: number; y: number } | null {
  if (!value || typeof value !== 'object') return null
  const point = value as { x?: unknown; y?: unknown }
  return typeof point.x === 'number' &&
    Number.isFinite(point.x) &&
    typeof point.y === 'number' &&
    Number.isFinite(point.y)
    ? { x: point.x, y: point.y }
    : null
}

function assetFrom(row: MediaRow): MediaAsset {
  return {
    id: row.id,
    revision: Number(row.revision),
    siteId: row.site_id,
    scope: row.site_id === null ? 'shared' : 'site',
    name: row.original_name || 'Untitled image',
    altText: row.alt_text,
    decorative: row.decorative,
    focal: focalPoint(row.focal),
    width: row.width,
    height: row.height,
    bytes: row.bytes === null ? null : Number(row.bytes),
    mimeType: row.mime_type,
    status: row.status,
    folder: row.folder,
    attribution: row.attribution,
    source: row.source,
    tags: row.tags,
    variants: {
      original: true,
      thumbnail: row.has_thumbnail,
      card: row.has_card,
      wide: row.has_wide,
    },
    previewUrl: row.has_thumbnail ? `/media/${encodeURIComponent(row.id)}/thumbnail` : null,
    deliveryUrl: row.has_wide ? `/media/${encodeURIComponent(row.id)}/wide` : null,
    usedOnItems: row.used_on_items,
    usedInVersions: row.used_in_versions,
    createdAt: row.created_at.toISOString(),
    deletedAt: row.deleted_at?.toISOString() ?? null,
  }
}

export function listMediaLibrary(
  userId: string,
  siteId: string,
  query: MediaLibraryQuery,
): Promise<MediaLibraryResult> {
  return asUser({ userId }, async client => {
    const args = [siteId, query.search, query.status, query.scope, query.folder, query.tag]
    const total = Number(
      (await client.query<{ count: string }>(`SELECT count(*) FROM media m WHERE ${MEDIA_FILTER_SQL}`, args)).rows[0]
        ?.count ?? 0,
    )
    const pageCount = Math.max(1, Math.ceil(total / query.pageSize))
    const page = Math.min(query.page, pageCount)
    const rows = await client.query<MediaRow>(mediaLibraryPageSql(query.sort), [
      ...args,
      query.pageSize,
      (page - 1) * query.pageSize,
    ])
    const facets = (
      await client.query<{
        folders: Array<{ path: string; count: string }>
        tags: Array<{ tag: string; count: string }>
        scopes: Array<{ scope: 'site' | 'shared'; count: string }>
        statuses: Array<{ status: MediaStatus; count: string }>
      }>(MEDIA_FACETS_SQL, [siteId])
    ).rows[0]!
    const statuses: Record<MediaStatus, number> = { ready: 0, processing: 0, failed: 0, deleted: 0 }
    for (const row of facets.statuses) statuses[row.status] = Number(row.count)
    const scopes = { site: 0, shared: 0 }
    for (const row of facets.scopes) scopes[row.scope] = Number(row.count)
    return {
      assets: rows.rows.map(assetFrom),
      total,
      page,
      pageSize: query.pageSize,
      pageCount,
      facets: {
        folders: facets.folders.map(row => ({ path: row.path, count: Number(row.count) })),
        tags: facets.tags.map(row => ({ tag: row.tag, count: Number(row.count) })),
        scopes,
        statuses,
      },
    }
  })
}

export function mediaUsage(userId: string, mediaId: string): Promise<MediaUsageResult | null> {
  return asUser({ userId }, async client => {
    if (!(await client.query('SELECT 1 FROM media WHERE id=$1', [mediaId])).rowCount) return null
    const rows = await client.query<UsageRow>(
      `SELECT 'page:'||u.version_id AS key,'page' AS kind,p.title,
              'Saved version '||pv.revision AS version_label,
              p.draft_version_id=u.version_id AS is_current_draft,
              p.published_version_id=u.version_id AS is_current_live,
              '/pages/'||p.id AS href,pv.created_at
         FROM media_usage u JOIN pages p ON p.id=u.item_id AND u.item_type='page'
         JOIN page_versions pv ON pv.id=u.version_id
        WHERE u.media_id=$1
       UNION ALL
       SELECT 'collection:'||u.version_id,'collection',c.name||' — '||ce.stable_key,
              'Saved version '||cev.revision,
              ce.draft_version_id=u.version_id,ce.published_version_id=u.version_id,
              '/sites/'||ce.site_id||'/content?collection='||c.id||'&entry='||ce.id,cev.created_at
         FROM media_usage u JOIN collection_entries ce ON ce.id=u.item_id AND u.item_type='collection_entry'
         JOIN collections c ON c.id=ce.collection_id
         JOIN collection_entry_versions cev ON cev.id=u.version_id
        WHERE u.media_id=$1
       UNION ALL
       SELECT 'global:'||gv.id,'global',initcap(g.kind::text),
              'Saved version '||gv.revision,g.draft_version_id=gv.id,g.published_version_id=gv.id,
              '/sites/'||g.site_id||'/global-elements',gv.created_at
         FROM global_element_versions gv JOIN global_elements g ON g.id=gv.global_element_id
        WHERE g.kind='header' AND (
          gv.content #>> '{brand,logoMediaId}'=$1::text
          OR gv.content #>> '{brand,compactLogoMediaId}'=$1::text)
       UNION ALL
       SELECT 'site-files:'||v.id,'site-files','Site interactions',
              'Reviewed version '||v.version,h.draft_version_id=v.id,h.published_version_id=v.id,
              '/sites/'||u.site_id||'/settings',v.reviewed_at
         FROM site_file_media_usage u JOIN site_file_versions v ON v.id=u.version_id AND v.site_id=u.site_id
         JOIN site_file_heads h ON h.site_id=u.site_id WHERE u.media_id=$1
        ORDER BY created_at DESC`,
      [mediaId],
    )
    const mapped = rows.rows.map(
      (row): MediaUsageRecord => ({
        key: row.key,
        kind: row.kind,
        title: row.title,
        versionLabel: row.version_label,
        isCurrentDraft: row.is_current_draft,
        isCurrentLive: row.is_current_live,
        href: row.href,
        createdAt: row.created_at.toISOString(),
      }),
    )
    return {
      currentLive: mapped.filter(row => row.isCurrentLive),
      currentDraft: mapped.filter(row => row.isCurrentDraft && !row.isCurrentLive),
      history: mapped.filter(row => !row.isCurrentDraft && !row.isCurrentLive),
    }
  })
}
