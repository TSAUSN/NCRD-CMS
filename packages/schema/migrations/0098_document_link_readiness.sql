-- Readiness recognizes governed PDF links using the same receipt and rendered
-- usage boundaries as public delivery. A local /assets/ prefix alone grants
-- nothing, and a candidate page is checked before its publication pointer moves.
CREATE FUNCTION app.readiness_document_paths_internal(p_version uuid,p_candidates uuid[])
RETURNS TABLE(path text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE candidate_site uuid; manifest jsonb;
BEGIN
  SELECT site_id INTO candidate_site FROM public.page_versions WHERE id=p_version;
  IF candidate_site IS NULL THEN RAISE EXCEPTION 'page version unavailable' USING ERRCODE='CMS03'; END IF;
  manifest:=app.build_render_manifest_internal(p_version);
  RETURN QUERY SELECT '/assets/'||a.id::text FROM public.site_assets a
    WHERE a.site_id=candidate_site AND a.kind='document' AND a.id=ANY(p_candidates)
      AND (
        EXISTS(SELECT 1 FROM public.site_asset_usage u
          WHERE u.asset_id=a.id AND u.site_id=candidate_site AND u.version_id=p_version)
        OR app.published_frame_uses_site_document(candidate_site,a.id)
        OR EXISTS(SELECT 1 FROM public.collection_entries e JOIN public.collections c
            ON c.id=e.collection_id AND c.site_id=e.site_id
          WHERE e.site_id=candidate_site AND e.published_version_id IS NOT NULL AND e.published_archived_at IS NULL
            AND app.render_manifest_uses_collection_document(manifest,c.id,e.id,a.id))
      );
END $$;

CREATE FUNCTION app.readiness_document_paths(p_version uuid,p_candidates uuid[])
RETURNS TABLE(path text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
  PERFORM app.require_actor();
  IF NOT EXISTS(SELECT 1 FROM public.page_versions v WHERE v.id=p_version AND app.has_site_access(v.site_id)) THEN
    RAISE EXCEPTION 'page version unavailable' USING ERRCODE='CMS03';
  END IF;
  RETURN QUERY SELECT * FROM app.readiness_document_paths_internal(p_version,p_candidates);
END $$;
REVOKE ALL ON FUNCTION app.readiness_document_paths_internal(uuid,uuid[]),app.readiness_document_paths(uuid,uuid[])
  FROM PUBLIC,cms_authenticated_user,cms_public_renderer,cms_worker;
ALTER FUNCTION app.readiness_document_paths_internal(uuid,uuid[]) OWNER TO cms_migration_owner;
ALTER FUNCTION app.readiness_document_paths(uuid,uuid[]) OWNER TO cms_migration_owner;
GRANT EXECUTE ON FUNCTION app.readiness_document_paths_internal(uuid,uuid[]) TO cms_worker;
GRANT EXECUTE ON FUNCTION app.readiness_document_paths(uuid,uuid[]) TO cms_authenticated_user;
