/** A site with reviewed source files needs its own preview origin in the editor. */
export const REVIEWED_PAGE_CANVAS_SQL = `EXISTS(SELECT 1 FROM site_file_heads h JOIN site_file_versions v ON v.id IN(h.draft_version_id,h.published_version_id) WHERE h.site_id=s.id AND (jsonb_array_length(v.bundle->'files')>0 OR jsonb_array_length(COALESCE(v.bundle->'native','[]'))>0 OR v.bundle ? 'original'))`
