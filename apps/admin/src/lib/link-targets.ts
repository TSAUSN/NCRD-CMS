/**
 * Published pages that are safe to offer as same-site link destinations.
 *
 * The query deliberately excludes drafts: offering a draft-only page in a
 * picker would let an editor create a link that works in neither preview nor
 * production. RLS still decides which site's rows the reader may see.
 */
export const LINK_TARGETS_SQL = `
  SELECT p.id,
         r.render_manifest->'page'->>'title' AS title,
         r.path,
         COALESCE((SELECT jsonb_agg(jsonb_build_object('id',part#>>'{instance,values,__cms_anchor}','label',COALESCE(NULLIF(part#>>'{instance,label}',''),NULLIF(part#>>'{instance,values,heading}',''),part#>>'{instance,values,__cms_anchor}')) ORDER BY ordinal)
           FROM jsonb_array_elements(COALESCE(r.render_manifest->'sections','[]'::jsonb)) WITH ORDINALITY AS sections(part,ordinal)
           WHERE NULLIF(part#>>'{instance,values,__cms_anchor}','') IS NOT NULL
             AND COALESCE((part#>>'{instance,hidden}')::boolean,false)=false),'[]'::jsonb) AS anchors
    FROM pages p
    JOIN published_routes r ON r.page_id = p.id AND r.site_id = p.site_id
   WHERE p.site_id = $1
     AND p.archived_at IS NULL
     AND p.published_version_id IS NOT NULL
   ORDER BY CASE WHEN r.path = '/' THEN 0 ELSE 1 END, title, r.path
`
