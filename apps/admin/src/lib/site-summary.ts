/**
 * One RLS-scoped editorial summary per visible site.
 *
 * Exported separately from the server-only query adapter so the exact SQL the
 * dashboard runs can be exercised against disposable databases as real roles.
 */
export const ORDINARY_PAGE_SQL = `p.slug NOT LIKE 'stories/%' AND NOT EXISTS (
  SELECT 1 FROM collections sc JOIN collection_entries se ON se.collection_id=sc.id
  JOIN collection_entry_versions sv ON sv.id=se.draft_version_id
  WHERE sc.site_id=p.site_id AND sc.reader_key='stories' AND se.archived_at IS NULL
    AND sv.values->>'story_url'=CASE WHEN p.slug='' THEN '/' ELSE '/'||p.slug END
)`
function siteSummary(homepageVersion: string) {
  return `
  SELECT s.id, s.slug, s.name, s.status, s.staging_hostname, s.kind, EXISTS(SELECT 1 FROM collections c WHERE c.site_id=s.id AND c.reader_key='stories') AS has_stories, CASE WHEN app.has_site_access(s.id) THEN app.site_hosting_status(s.id) ELSE 'ready' END AS hosting_status,
         (SELECT d.hostname_normalized FROM domains d WHERE d.site_id=s.id AND d.kind='primary'
           AND d.status='live' AND d.removed_at IS NULL LIMIT 1) AS primary_hostname,
         count(p.id) FILTER (WHERE ${ORDINARY_PAGE_SQL}) AS page_count,
         (SELECT count(*) FROM collections sc JOIN collection_entries se ON se.collection_id=sc.id
          WHERE sc.site_id=s.id AND sc.reader_key='stories' AND se.archived_at IS NULL) AS story_count,
         (SELECT COALESCE(
            CASE WHEN m.id IS NOT NULL THEN '/media/'||m.id::text||'/'||
              CASE WHEN EXISTS(SELECT 1 FROM media_variants mv WHERE mv.media_id=m.id AND mv.kind='card') THEN 'card' ELSE 'original' END END,
            CASE WHEN sf.id IS NOT NULL THEN '/site-files/'||sf.id::text||'/'||sf.sha256||'/'||sf.name END)
          ${homepageVersion}
          CROSS JOIN LATERAL jsonb_path_query(hv.content,'$[*] ? (!exists(@.hidden) || @.hidden != true).values.* ? (@.src != null || @.media_id != null)') WITH ORDINALITY pic(value,position)
          LEFT JOIN media m ON m.site_id=s.id AND m.status='ready' AND m.deleted_at IS NULL
            AND (m.id::text=pic.value->>'media_id' OR pic.value->>'src' LIKE '/media/'||m.id::text||'/%')
          LEFT JOIN site_file_heads fh ON fh.site_id=s.id
          LEFT JOIN site_file_versions fv ON fv.id=fh.draft_version_id
          LEFT JOIN LATERAL jsonb_array_elements(COALESCE(fv.bundle->'paths','[]'::jsonb)) mount(value) ON mount.value->>'path'=pic.value->>'src'
          LEFT JOIN site_files sf ON sf.site_id=s.id AND sf.id::text=mount.value->>'fileId' AND sf.kind='image'
            AND fv.bundle->'files' ? sf.id::text
          WHERE hp.site_id=s.id AND hp.slug='' AND hp.archived_at IS NULL AND (m.id IS NOT NULL OR sf.id IS NOT NULL)
          ORDER BY pic.position LIMIT 1) AS preview_image,
         count(p.published_version_id) AS published_count,
         count(p.id) FILTER (WHERE p.published_version_id IS NULL) AS draft_only_count,
         count(p.id) FILTER (
           WHERE p.published_version_id IS NULL
              OR (p.draft_version_id IS NOT NULL
                  AND p.draft_version_id <> p.published_version_id)
         ) AS changed_count
    FROM sites s
    LEFT JOIN pages p ON p.site_id = s.id AND p.archived_at IS NULL
   GROUP BY s.id, s.slug, s.name, s.status, s.staging_hostname, s.kind
   ORDER BY CASE s.slug WHEN 'sawso' THEN 0 WHEN 'echelon-chapters' THEN 1 WHEN 'bt2027-r8' THEN 2 ELSE 3 END,s.name`
}

export const SITE_SUMMARY_SQL = siteSummary(`FROM pages hp
          -- The page/version foreign key guarantees this belongs to the homepage.
          JOIN LATERAL (
            SELECT v.content FROM page_versions v
            WHERE v.page_id=hp.id AND v.id=COALESCE(hp.draft_version_id,hp.published_version_id)
            LIMIT 1
          ) hv ON true`)

// The sidebar has its own read path. It can switch to a narrower query
// without coupling the dashboard lookup to unrelated screens.
export const SIDEBAR_SITE_SUMMARY_SQL = siteSummary(
  `FROM pages hp JOIN page_versions hv ON hv.id=COALESCE(hp.draft_version_id,hp.published_version_id)`,
)
