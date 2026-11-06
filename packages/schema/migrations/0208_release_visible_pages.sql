-- A hidden registered Story article intentionally becomes a public 404. Reuse
-- the public resolver's exact visibility rule when judging a future release;
-- an absent stored route still needs all ordinary readiness checks.
CREATE FUNCTION app.release_readiness_pages(p_site uuid)
RETURNS TABLE(page_id uuid)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
  PERFORM app.require_actor();
  IF NOT app.can_publish(p_site) THEN
    RAISE EXCEPTION 'not permitted to review publication for this site' USING ERRCODE='CMS02';
  END IF;
  RETURN QUERY
    SELECT p.id FROM public.pages p
    LEFT JOIN public.published_routes r ON r.site_id=p.site_id AND r.page_id=p.id
      AND r.page_version_id=p.published_version_id
    WHERE p.site_id=p_site AND p.archived_at IS NULL AND p.published_version_id IS NOT NULL
      AND (r.page_id IS NULL OR app.story_article_visible(p_site,p.published_version_id,r.path));
END $$;
ALTER FUNCTION app.release_readiness_pages(uuid) OWNER TO cms_migration_owner;
REVOKE ALL ON FUNCTION app.release_readiness_pages(uuid) FROM PUBLIC,cms_public_renderer,cms_worker;
GRANT EXECUTE ON FUNCTION app.release_readiness_pages(uuid) TO cms_authenticated_user;
