/** Current placements only: an unpublished addition and a still-live removal both matter. */
export const CURRENT_SECTION_USES_SQL = `
  SELECT p.id AS page_id, p.site_id, p.title AS page_title, s.name AS site_name,
         s.status AS site_status, current.mode, v.id AS page_version_id,
         section.value->>'section_def_id' AS section_def_id,
         section.value->>'section_def_version' AS definition_version,
         (section.ordinality - 1)::int AS section_index,
         COALESCE(section.value->'hidden' = 'true'::jsonb, false) AS hidden
    FROM pages p
    JOIN sites s ON s.id = p.site_id
    CROSS JOIN LATERAL (VALUES ('draft', p.draft_version_id), ('live', p.published_version_id)) current(mode, version_id)
    JOIN page_versions v ON v.id = current.version_id AND v.page_id = p.id AND v.site_id = p.site_id
    CROSS JOIN LATERAL jsonb_array_elements(
      CASE WHEN jsonb_typeof(v.content) = 'array' THEN v.content ELSE '[]'::jsonb END
    ) WITH ORDINALITY section(value, ordinality)
   WHERE p.archived_at IS NULL
`

/** Executed as the reader, under existing page/site/version RLS. $2 is a page cursor. */
export const SECTION_USAGE_SQL = `
  WITH current_uses AS (${CURRENT_SECTION_USES_SQL})
  SELECT page_id, site_id, page_title, site_name, site_status,
         array_agg(DISTINCT definition_version ORDER BY definition_version) FILTER (WHERE mode = 'draft') AS draft_versions,
         array_agg(DISTINCT definition_version ORDER BY definition_version) FILTER (WHERE mode = 'live') AS live_versions,
         min(section_index) FILTER (WHERE mode = 'draft') AS first_draft_index,
         max(page_version_id::text) FILTER (WHERE mode = 'live') AS live_version_id,
         count(*) FILTER (WHERE mode = 'draft')::int AS draft_instances,
         count(*) FILTER (WHERE mode = 'live')::int AS live_instances,
         count(*) FILTER (WHERE mode = 'draft' AND hidden)::int AS hidden_draft_instances,
         count(*) FILTER (WHERE mode = 'live' AND hidden)::int AS hidden_live_instances
    FROM current_uses
   WHERE section_def_id = $1 AND ($2::uuid IS NULL OR page_id > $2::uuid)
   GROUP BY page_id, site_id, page_title, site_name, site_status
   ORDER BY page_id
   LIMIT 51
`

export type SectionUsageRow = {
  page_id: string
  site_id: string
  page_title: string
  site_name: string
  site_status: string
  draft_versions: string[] | null
  live_versions: string[] | null
  first_draft_index: number | null
  live_version_id: string | null
  draft_instances: number
  live_instances: number
  hidden_draft_instances: number
  hidden_live_instances: number
}
