-- Atomic private-story receipts. Existing page/list commands still create content.
CREATE TABLE story_draft_receipts (
 site_id uuid NOT NULL,collection_id uuid NOT NULL,created_by uuid NOT NULL REFERENCES app_users(id),request_id uuid NOT NULL,
 fingerprint text NOT NULL CHECK(fingerprint ~ '^[0-9a-f]{64}$'),entry_id uuid NOT NULL,page_id uuid NOT NULL,
 entry_revision bigint NOT NULL CHECK(entry_revision>=0),created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(site_id,created_by,request_id),
 FOREIGN KEY(site_id,collection_id) REFERENCES collections(site_id,id),
 FOREIGN KEY(entry_id,collection_id) REFERENCES collection_entries(id,collection_id),
 FOREIGN KEY(site_id,page_id) REFERENCES pages(site_id,id)
);
ALTER TABLE story_draft_receipts OWNER TO cms_migration_owner;
ALTER TABLE story_draft_receipts ENABLE ROW LEVEL SECURITY;
CREATE POLICY story_draft_receipts_author ON story_draft_receipts FOR SELECT TO cms_authenticated_user
 USING(created_by=app.current_user_id() AND app.has_site_access(site_id));
REVOKE ALL ON story_draft_receipts FROM PUBLIC,cms_authenticated_user,cms_public_renderer,cms_worker;
GRANT SELECT ON story_draft_receipts TO cms_authenticated_user;
CREATE FUNCTION app.read_story_draft_receipt(p_site uuid,p_collection uuid,p_request uuid,p_fingerprint text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE actor uuid:=app.require_actor();prior public.story_draft_receipts;
BEGIN
 IF NOT app.has_site_access(p_site) THEN RAISE EXCEPTION 'Stories unavailable' USING ERRCODE='CMS03';END IF;
 IF NOT(app.is_super_admin() OR EXISTS(SELECT 1 FROM public.site_memberships WHERE site_id=p_site AND user_id=actor AND role IN ('editor','site_admin'))) THEN RAISE EXCEPTION 'Story creation requires site editing access' USING ERRCODE='CMS02';END IF;
 IF NOT EXISTS(SELECT 1 FROM public.collections c JOIN public.sites s ON s.id=c.site_id WHERE c.site_id=p_site AND c.id=p_collection AND c.reader_key='stories' AND s.archived_at IS NULL) THEN RAISE EXCEPTION 'Stories unavailable' USING ERRCODE='CMS03';END IF;
 IF p_request IS NULL OR COALESCE(p_fingerprint,'')!~'^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'Invalid draft request' USING ERRCODE='CMS04';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_site::text||':'||actor::text||':'||p_request::text,181));
 SELECT * INTO prior FROM public.story_draft_receipts WHERE site_id=p_site AND created_by=actor AND request_id=p_request;
 IF prior.request_id IS NULL THEN RETURN NULL;END IF;
 IF prior.collection_id<>p_collection OR prior.fingerprint<>p_fingerprint THEN RAISE EXCEPTION 'This form already saved a different draft; open Stories before starting another' USING ERRCODE='CMS04';END IF;
 IF NOT EXISTS(SELECT 1 FROM public.collection_entries e JOIN public.pages p ON p.id=prior.page_id AND p.site_id=p_site WHERE e.id=prior.entry_id AND e.collection_id=p_collection AND e.archived_at IS NULL AND p.archived_at IS NULL) THEN RAISE EXCEPTION 'The saved story is no longer available; check Stories or History' USING ERRCODE='CMS03';END IF;
 RETURN to_jsonb(prior)||jsonb_build_object('entry_revision',prior.entry_revision::text);
END $$;
CREATE FUNCTION app.record_story_draft_receipt(p_site uuid,p_collection uuid,p_request uuid,p_fingerprint text,p_entry uuid,p_page uuid,p_revision bigint)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE prior jsonb;actor uuid:=app.require_actor();
BEGIN
 prior:=app.read_story_draft_receipt(p_site,p_collection,p_request,p_fingerprint);
 IF prior IS NOT NULL THEN
  IF prior->>'entry_id'<>p_entry::text OR prior->>'page_id'<>p_page::text THEN RAISE EXCEPTION 'Draft result cannot change' USING ERRCODE='CMS04';END IF;RETURN;
 END IF;
 IF NOT EXISTS(SELECT 1 FROM public.collections c JOIN public.collection_entries e ON e.collection_id=c.id AND e.site_id=c.site_id JOIN public.collection_entry_versions v ON v.id=e.draft_version_id JOIN public.pages p ON p.id=p_page AND p.site_id=c.site_id WHERE c.id=p_collection AND c.site_id=p_site AND c.entry_revision=p_revision AND e.id=p_entry AND e.archived_at IS NULL AND e.published_version_id IS NULL AND v.author_id=actor AND p.archived_at IS NULL AND p.published_version_id IS NULL AND v.values->>'story_url'=app.page_path(p.slug)) THEN RAISE EXCEPTION 'Invalid private draft result' USING ERRCODE='CMS04';END IF;
 INSERT INTO public.story_draft_receipts(site_id,collection_id,created_by,request_id,fingerprint,entry_id,page_id,entry_revision) VALUES(p_site,p_collection,actor,p_request,p_fingerprint,p_entry,p_page,p_revision);
END $$;
REVOKE ALL ON FUNCTION app.read_story_draft_receipt(uuid,uuid,uuid,text),app.record_story_draft_receipt(uuid,uuid,uuid,text,uuid,uuid,bigint) FROM PUBLIC;
ALTER FUNCTION app.read_story_draft_receipt(uuid,uuid,uuid,text) OWNER TO cms_migration_owner;
ALTER FUNCTION app.record_story_draft_receipt(uuid,uuid,uuid,text,uuid,uuid,bigint) OWNER TO cms_migration_owner;
GRANT EXECUTE ON FUNCTION app.read_story_draft_receipt(uuid,uuid,uuid,text),app.record_story_draft_receipt(uuid,uuid,uuid,text,uuid,uuid,bigint) TO cms_authenticated_user;
