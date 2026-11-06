-- A link to one of the site's own pictures (a gallery thumbnail that opens the
-- full-size image, "Download the poster") is a real destination, as a link to
-- one of its PDF documents already is (0098). The publish check treated it as a
-- link to a page that does not exist, so an imported gallery could never go
-- live. Public delivery already authorizes a rendition a published page links
-- to (0103); this lets the check agree, for this site's ready images only.
CREATE FUNCTION app.readiness_media_paths_internal(p_version uuid,p_candidates uuid[])
RETURNS TABLE(path text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE candidate_site uuid;
BEGIN
  SELECT site_id INTO candidate_site FROM public.page_versions WHERE id=p_version;
  IF candidate_site IS NULL THEN RAISE EXCEPTION 'page version unavailable' USING ERRCODE='CMS03'; END IF;
  RETURN QUERY
    SELECT '/media/'||m.id::text||'/original' FROM public.media m
     WHERE m.site_id=candidate_site AND m.id=ANY(p_candidates) AND m.status='ready' AND m.purged_at IS NULL
    UNION ALL
    SELECT '/media/'||v.media_id::text||'/'||v.kind::text FROM public.media_variants v JOIN public.media m ON m.id=v.media_id
     WHERE m.site_id=candidate_site AND m.id=ANY(p_candidates) AND m.status='ready' AND m.purged_at IS NULL
       AND v.kind::text<>'original';
END $$;

CREATE FUNCTION app.readiness_media_paths(p_version uuid,p_candidates uuid[])
RETURNS TABLE(path text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
  PERFORM app.require_actor();
  IF NOT EXISTS(SELECT 1 FROM public.page_versions v WHERE v.id=p_version AND app.has_site_access(v.site_id)) THEN
    RAISE EXCEPTION 'page version unavailable' USING ERRCODE='CMS03';
  END IF;
  RETURN QUERY SELECT * FROM app.readiness_media_paths_internal(p_version,p_candidates);
END $$;
REVOKE ALL ON FUNCTION app.readiness_media_paths_internal(uuid,uuid[]),app.readiness_media_paths(uuid,uuid[])
  FROM PUBLIC,cms_authenticated_user,cms_public_renderer,cms_worker;
ALTER FUNCTION app.readiness_media_paths_internal(uuid,uuid[]) OWNER TO cms_migration_owner;
ALTER FUNCTION app.readiness_media_paths(uuid,uuid[]) OWNER TO cms_migration_owner;
GRANT EXECUTE ON FUNCTION app.readiness_media_paths_internal(uuid,uuid[]) TO cms_worker;
GRANT EXECUTE ON FUNCTION app.readiness_media_paths(uuid,uuid[]) TO cms_authenticated_user;
