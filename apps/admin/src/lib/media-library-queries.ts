import type { MediaLibraryQuery } from './media-library.ts'

export const MEDIA_FILTER_SQL = `
  (m.site_id = $1 OR m.site_id IS NULL)
  AND ($2 = '' OR
    position(lower($2) in lower(coalesce(m.original_name,''))) > 0 OR
    to_tsvector('simple', coalesce(m.original_name,'') || ' ' || coalesce(m.alt_text,'') || ' '
      || coalesce(m.folder,'') || ' ' || coalesce(m.attribution,'') || ' ' || coalesce(m.source,''))
      @@ websearch_to_tsquery('simple', $2)
    OR EXISTS (SELECT 1 FROM unnest(m.tags) t WHERE position(lower($2) in lower(t)) > 0))
  AND ($3 = 'all' OR m.status::text = $3)
  AND ($4 = 'all' OR ($4 = 'site' AND m.site_id = $1) OR ($4 = 'shared' AND m.site_id IS NULL))
  AND ($5 = '' OR m.folder = $5 OR starts_with(m.folder, $5 || '/'))
  AND ($6 = '' OR m.tags @> ARRAY[$6]::text[])`

const ORDER_SQL: Record<MediaLibraryQuery['sort'], string> = {
  newest: "(m.status = 'deleted'), m.created_at DESC, m.id DESC",
  oldest: "(m.status = 'deleted'), m.created_at, m.id",
  'name-asc': "(m.status = 'deleted'), lower(m.original_name), m.id",
  'name-desc': "(m.status = 'deleted'), lower(m.original_name) DESC, m.id DESC",
}

/** Usage and available variants are counted independently for each visible asset. */
export const MEDIA_ASSET_DETAILS_SQL = `
      CROSS JOIN LATERAL (
        SELECT count(DISTINCT item_id)::int AS used_on_items,
               count(DISTINCT version_id)::int AS used_in_versions
          FROM (
            SELECT item_id,version_id FROM media_usage WHERE media_id=m.id
            UNION ALL
            SELECT site_id AS item_id,version_id FROM site_file_media_usage WHERE media_id=m.id
          ) records
      ) usage
      CROSS JOIN LATERAL (
        SELECT coalesce(bool_or(kind='thumbnail'),false) AS has_thumbnail,
               coalesce(bool_or(kind='card'),false) AS has_card,
               coalesce(bool_or(kind='wide'),false) AS has_wide
          FROM media_variants WHERE media_id=m.id
      ) variants
`

// Select the page first. The usage tables and variants are keyed by media ID,
// so records outside this page never need a usage or rendition lookup.
export function mediaLibraryPageSql(sort: MediaLibraryQuery['sort']): string {
  return `
    WITH selected AS MATERIALIZED (
      SELECT m.id,m.revision,m.site_id,m.original_name,m.alt_text,m.decorative,m.focal,
             m.width,m.height,m.bytes,m.mime_type,m.status,m.folder,m.attribution,m.source,m.tags,
             m.created_at,m.deleted_at
        FROM media m
       WHERE ${MEDIA_FILTER_SQL}
       ORDER BY ${ORDER_SQL[sort]}
       LIMIT $7 OFFSET $8
    )
    SELECT m.*,usage.used_on_items,usage.used_in_versions,
           variants.has_thumbnail,variants.has_card,variants.has_wide
      FROM selected m
      ${MEDIA_ASSET_DETAILS_SQL}
     ORDER BY ${ORDER_SQL[sort]}`
}

// Facets always cover the site library, even when the page is filtered.
// Read them together so each sees the same eligible assets and snapshot.
export const MEDIA_FACETS_SQL = `
  WITH eligible AS MATERIALIZED (
    SELECT folder,tags,status,site_id FROM media WHERE site_id=$1 OR site_id IS NULL
  ), folders AS (
    SELECT folder AS path,count(*)::text AS count FROM eligible GROUP BY folder
  ), tags AS (
    SELECT tag,count(*)::text AS count FROM eligible CROSS JOIN LATERAL unnest(tags) tag GROUP BY tag
  ), scopes AS (
    SELECT CASE WHEN site_id IS NULL THEN 'shared' ELSE 'site' END AS scope,count(*)::text AS count
      FROM eligible GROUP BY scope
  ), statuses AS (
    SELECT status,count(*)::text AS count FROM eligible GROUP BY status
  )
  SELECT
    coalesce((SELECT jsonb_agg(f ORDER BY path) FROM folders f),'[]'::jsonb) AS folders,
    coalesce((SELECT jsonb_agg(t ORDER BY tag) FROM tags t),'[]'::jsonb) AS tags,
    coalesce((SELECT jsonb_agg(s) FROM scopes s),'[]'::jsonb) AS scopes,
    coalesce((SELECT jsonb_agg(s) FROM statuses s),'[]'::jsonb) AS statuses`
