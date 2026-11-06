-- Row locks require write privileges, which the application deliberately does not hold.
-- Keep the merge lock behind a narrow identity-scoped command instead of broadening grants.
CREATE FUNCTION app.lock_story_source_check(p_site uuid,p_collection uuid,p_request uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE actor uuid:=app.require_actor(); source record;
BEGIN
 IF NOT app.can_administer_site(p_site) THEN RAISE EXCEPTION 'Site admin access required' USING ERRCODE='CMS02'; END IF;
 SELECT c.entry_revision,v.fields,v.sort INTO source FROM public.collections c JOIN public.collection_schema_versions v ON v.id=c.draft_schema_version_id
  WHERE c.id=p_collection AND c.site_id=p_site AND c.reader_key='stories' FOR UPDATE OF c;
 IF source IS NULL THEN RAISE EXCEPTION 'Stories unavailable' USING ERRCODE='CMS03'; END IF;
 IF source.sort#>>'{stories,source}' IS DISTINCT FROM 'sawso' OR NOT EXISTS(SELECT 1 FROM public.story_source_checks WHERE id=p_request AND collection_id=p_collection AND created_by=actor AND status='checking' AND lease_until>clock_timestamp()) THEN RAISE EXCEPTION 'Check expired or source changed; try again' USING ERRCODE='CMS01'; END IF;
 RETURN jsonb_build_object('entry_revision',source.entry_revision::text,'fields',source.fields,'sort',source.sort);
END $$;
REVOKE ALL ON FUNCTION app.lock_story_source_check(uuid,uuid,uuid) FROM PUBLIC;
ALTER FUNCTION app.lock_story_source_check(uuid,uuid,uuid) OWNER TO cms_migration_owner;
GRANT EXECUTE ON FUNCTION app.lock_story_source_check(uuid,uuid,uuid) TO cms_authenticated_user;
