-- Content creators may create only the private article of their own Stories row.
-- General page creation, publication and site administration remain unchanged.
CREATE OR REPLACE FUNCTION app.read_story_draft_receipt(p_site uuid,p_collection uuid,p_request uuid,p_fingerprint text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE actor uuid:=app.require_actor();prior public.story_draft_receipts;
BEGIN
 IF NOT app.has_site_access(p_site) THEN RAISE EXCEPTION 'Stories unavailable' USING ERRCODE='CMS03';END IF;
 IF NOT(app.is_super_admin() OR EXISTS(SELECT 1 FROM public.site_memberships WHERE site_id=p_site AND user_id=actor AND role IN ('contributor','editor','site_admin'))) THEN RAISE EXCEPTION 'Story creation requires site editing access' USING ERRCODE='CMS02';END IF;
 IF NOT EXISTS(SELECT 1 FROM public.collections c JOIN public.sites s ON s.id=c.site_id WHERE c.site_id=p_site AND c.id=p_collection AND c.reader_key='stories' AND s.archived_at IS NULL) THEN RAISE EXCEPTION 'Stories unavailable' USING ERRCODE='CMS03';END IF;
 IF p_request IS NULL OR COALESCE(p_fingerprint,'')!~'^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'Invalid draft request' USING ERRCODE='CMS04';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_site::text||':'||actor::text||':'||p_request::text,181));
 SELECT * INTO prior FROM public.story_draft_receipts WHERE site_id=p_site AND created_by=actor AND request_id=p_request;
 IF prior.request_id IS NULL THEN RETURN NULL;END IF;
 IF prior.collection_id<>p_collection OR prior.fingerprint<>p_fingerprint THEN RAISE EXCEPTION 'This form already saved a different draft; open Stories before starting another' USING ERRCODE='CMS04';END IF;
 IF NOT EXISTS(SELECT 1 FROM public.collection_entries e JOIN public.pages p ON p.id=prior.page_id AND p.site_id=p_site WHERE e.id=prior.entry_id AND e.collection_id=p_collection AND e.archived_at IS NULL AND p.archived_at IS NULL) THEN RAISE EXCEPTION 'The saved story is no longer available; check Stories or History' USING ERRCODE='CMS03';END IF;
 RETURN to_jsonb(prior)||jsonb_build_object('entry_revision',prior.entry_revision::text);
END $$;

CREATE FUNCTION app.create_private_story_page(p_collection uuid,p_entry uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE actor uuid:=app.require_actor();head record;entry record;photo text[];slug text;new_page uuid;defect text;
BEGIN
 SELECT c.site_id,c.draft_schema_version_id INTO head FROM public.collections c
 JOIN public.sites s ON s.id=c.site_id
 WHERE c.id=p_collection AND c.reader_key='stories' AND s.archived_at IS NULL
 FOR UPDATE OF c;
 IF head IS NULL OR NOT app.has_site_access(head.site_id) THEN
  RAISE EXCEPTION 'Stories unavailable' USING ERRCODE='CMS03';END IF;
 IF NOT(app.is_super_admin() OR EXISTS(SELECT 1 FROM public.site_memberships
 WHERE site_id=head.site_id AND user_id=actor AND role IN('contributor','editor','site_admin'))) THEN
  RAISE EXCEPTION 'Story creation requires site editing access' USING ERRCODE='CMS02';END IF;
 SELECT e.id,v.values INTO entry FROM public.collection_entries e
 JOIN public.collection_entry_versions v ON v.id=e.draft_version_id
 WHERE e.id=p_entry AND e.collection_id=p_collection AND e.site_id=head.site_id
 AND e.archived_at IS NULL AND e.published_version_id IS NULL AND e.revision=1 AND v.revision=1 AND v.author_id=actor
 AND EXISTS(SELECT 1 FROM public.collection_entry_versions first_version
  WHERE first_version.entry_id=e.id AND first_version.revision=1 AND first_version.author_id=actor)
 FOR UPDATE OF e;
 IF entry IS NULL THEN RAISE EXCEPTION 'Choose your own private story draft' USING ERRCODE='CMS04';END IF;
 SELECT app.collection_entry_values_defect(head.site_id,v.fields,entry.values) INTO defect
 FROM public.collection_schema_versions v WHERE v.id=head.draft_schema_version_id;
 IF defect IS NOT NULL THEN RAISE EXCEPTION '%',defect USING ERRCODE='CMS04';END IF;
 IF COALESCE(entry.values->>'story_url','') !~ '^/stories/[a-z0-9]+(-[a-z0-9]+)*$'
 OR COALESCE(btrim(entry.values->>'title'),'')='' OR char_length(entry.values->>'title')>180
 OR COALESCE(btrim(entry.values->>'summary'),'')='' THEN
  RAISE EXCEPTION 'A private story needs a title, summary and story address' USING ERRCODE='CMS04';END IF;
 photo:=regexp_match(entry.values->'photo'->>'src','^/media/([0-9a-f-]{36})/wide$');
 IF photo IS NULL OR COALESCE(btrim(entry.values->'photo'->>'alt'),'')=''
 OR entry.values->'photo'->>'decorative' IS DISTINCT FROM 'false' THEN
  RAISE EXCEPTION 'Choose a ready story photo and describe it' USING ERRCODE='CMS04';END IF;
 IF NOT EXISTS(SELECT 1 FROM public.media m JOIN public.media_variants v ON v.media_id=m.id AND v.kind='wide'
 WHERE m.id=photo[1]::uuid AND (m.site_id=head.site_id OR m.site_id IS NULL)
 AND m.status='ready' AND m.deleted_at IS NULL) THEN
  RAISE EXCEPTION 'Choose a ready photo from this site Media' USING ERRCODE='CMS04';END IF;
 -- Keep the same site and address locks and row triggers as create_page.
 PERFORM 1 FROM public.sites WHERE id=head.site_id AND archived_at IS NULL FOR KEY SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'This site is unavailable for new pages' USING ERRCODE='CMS04';END IF;
 slug:=substring(entry.values->>'story_url' FROM 2);
 INSERT INTO public.pages(site_id,slug,title) VALUES(head.site_id,slug,entry.values->>'title') RETURNING id INTO new_page;
 PERFORM app.write_audit(head.site_id,'user',actor,'page.create','page',new_page,NULL,NULL,
  jsonb_build_object('slug',slug,'story_entry',p_entry));
 RETURN new_page;
END $$;
ALTER FUNCTION app.create_private_story_page(uuid,uuid) OWNER TO cms_migration_owner;
REVOKE ALL ON FUNCTION app.create_private_story_page(uuid,uuid) FROM PUBLIC,cms_authenticated_user,cms_public_renderer,cms_worker;
GRANT EXECUTE ON FUNCTION app.create_private_story_page(uuid,uuid) TO cms_authenticated_user;
