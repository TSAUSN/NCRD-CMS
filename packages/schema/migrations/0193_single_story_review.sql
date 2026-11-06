-- Page reviews pin one Story, never the complete Stories list. Public article
-- rendering remains dynamic; immutable review evidence is authenticated only.
CREATE TABLE public.story_review_pins (
 submission_id uuid PRIMARY KEY REFERENCES public.submissions(id),
 site_id uuid NOT NULL,collection_id uuid NOT NULL,entry_id uuid NOT NULL,
 entry_version_id uuid NOT NULL,schema_version_id uuid NOT NULL,
 page_version_id uuid NOT NULL UNIQUE REFERENCES public.page_versions(id),
 live_values jsonb,manifest jsonb NOT NULL CHECK(app.json_within(manifest,1800000)),
 FOREIGN KEY(site_id,collection_id) REFERENCES public.collections(site_id,id),
 FOREIGN KEY(entry_id,collection_id) REFERENCES public.collection_entries(id,collection_id),
 FOREIGN KEY(entry_id,entry_version_id) REFERENCES public.collection_entry_versions(entry_id,id),
 FOREIGN KEY(collection_id,schema_version_id) REFERENCES public.collection_schema_versions(collection_id,id)
);
ALTER TABLE public.story_review_pins OWNER TO cms_migration_owner;
ALTER TABLE public.story_review_pins ENABLE ROW LEVEL SECURITY;
CREATE POLICY story_review_pins_visible ON public.story_review_pins FOR SELECT TO cms_authenticated_user
 USING(EXISTS(SELECT 1 FROM public.submissions s WHERE s.id=submission_id
  AND app.has_site_access(s.site_id) AND (s.submitted_by=app.current_user_id() OR app.can_review(s.site_id))));
REVOKE ALL ON public.story_review_pins FROM PUBLIC,cms_authenticated_user,cms_public_renderer,cms_worker;
GRANT SELECT ON public.story_review_pins TO cms_authenticated_user;

CREATE FUNCTION app.capture_story_review() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE candidates uuid[];head public.collections%ROWTYPE;story record;schema_head public.collection_schema_versions%ROWTYPE;
 source public.page_versions%ROWTYPE;manifest jsonb;envelope jsonb;sections jsonb;matching integer;
BEGIN
 IF NEW.item_type<>'page' THEN RETURN NEW;END IF;
 SELECT array_agg(e.id) INTO candidates FROM public.pages p
 JOIN public.collections c ON c.site_id=p.site_id AND c.reader_key='stories'
 JOIN public.collection_entries e ON e.collection_id=c.id AND e.archived_at IS NULL
 JOIN public.collection_entry_versions v ON v.id=e.draft_version_id
 WHERE p.id=NEW.item_id AND p.site_id=NEW.site_id AND v.values->>'story_url'=app.page_path(p.slug);
 IF candidates IS NULL THEN RETURN NEW;END IF;
 IF cardinality(candidates)<>1 THEN RAISE EXCEPTION 'More than one story uses this article address. Ask an administrator to check Stories.' USING ERRCODE='CMS04';END IF;
 SELECT c.* INTO head FROM public.collections c JOIN public.collection_entries e ON e.collection_id=c.id WHERE e.id=candidates[1] FOR UPDATE OF c;
 SELECT e.id,e.stable_key,e.draft_version_id,v.schema_version_id,v.values,live.values AS live_values
 INTO story FROM public.collection_entries e JOIN public.collection_entry_versions v ON v.id=e.draft_version_id
 LEFT JOIN public.collection_entry_versions live ON live.id=e.published_version_id
 WHERE e.id=candidates[1] AND e.archived_at IS NULL FOR UPDATE OF e;
 SELECT * INTO source FROM public.page_versions WHERE id=NEW.version_id AND page_id=NEW.item_id AND site_id=NEW.site_id;
 IF story.id IS NULL OR story.values->>'story_url' IS DISTINCT FROM app.page_path(source.page_slug) THEN RAISE EXCEPTION 'The story changed. Save it and submit again.' USING ERRCODE='CMS01';END IF;
 SELECT count(*) INTO matching FROM jsonb_array_elements(source.content) part JOIN public.section_defs d ON d.id=(part->>'section_def_id')::uuid
 WHERE d.slug='core-story-detail' AND part#>>'{values,story,readerKey}'='stories'
 AND part#>>'{values,story,selection,mode}'='manual'
 AND part#>'{values,story,selection,stableKeys}'=jsonb_build_array(story.stable_key);
 IF matching<>1 THEN RAISE EXCEPTION 'This article needs its shared Story section before review. Ask a site editor to check it.' USING ERRCODE='CMS04';END IF;
 SELECT * INTO schema_head FROM public.collection_schema_versions WHERE id=story.schema_version_id AND collection_id=head.id;
 envelope:=app.with_story_catalog(jsonb_build_object('kind','collection','collectionId',head.id,'readerKey','stories',
 'publishedSchemaVersionId',schema_head.id,'publishedSchemaRevision',schema_head.revision::text,'publishedEntryRevision',head.entry_revision::text,
 'schemas',jsonb_build_array(jsonb_build_object('id',schema_head.id,'revision',schema_head.revision::text,'fields',schema_head.fields)),
 'entries',jsonb_build_array(jsonb_build_object('id',story.id,'stableKey',story.stable_key,'schemaVersionId',schema_head.id,'values',story.values))),false);
 manifest:=app.build_initial_preview_manifest(NEW.version_id);
 SELECT jsonb_agg(CASE WHEN part#>>'{def,slug}'='core-story-detail'
 THEN jsonb_set(part,'{instance,values,story}',envelope) ELSE part END ORDER BY position) INTO sections
 FROM jsonb_array_elements(manifest->'sections') WITH ORDINALITY item(part,position);
 manifest:=jsonb_set(manifest,'{sections}',sections);
 INSERT INTO public.story_review_pins(submission_id,site_id,collection_id,entry_id,entry_version_id,schema_version_id,page_version_id,live_values,manifest)
 VALUES(NEW.id,NEW.site_id,head.id,story.id,story.draft_version_id,schema_head.id,NEW.version_id,story.live_values,manifest);
 RETURN NEW;
END $$;
CREATE TRIGGER submissions_capture_story_review AFTER INSERT ON public.submissions FOR EACH ROW EXECUTE FUNCTION app.capture_story_review();

-- Only this command may take protected list locks for a Story submission.
CREATE FUNCTION app.submit_story_for_review(p_site uuid,p_collection uuid,p_entry uuid,p_page uuid,p_revision bigint,p_entry_version uuid,p_note text)
RETURNS TABLE(submission_id uuid,version_id uuid,revision bigint)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE actor uuid:=app.require_actor();page_head public.pages%ROWTYPE;head public.collections%ROWTYPE;story record;expected record;
BEGIN
 IF NOT app.has_site_access(p_site) THEN RAISE EXCEPTION 'Story unavailable' USING ERRCODE='CMS03';END IF;
 IF NOT(app.is_super_admin() OR EXISTS(SELECT 1 FROM public.site_memberships WHERE site_id=p_site AND user_id=actor AND role IN('contributor','editor','site_admin'))) THEN
  RAISE EXCEPTION 'Your role cannot submit this story' USING ERRCODE='CMS02';END IF;
 SELECT * INTO page_head FROM public.pages WHERE id=p_page AND site_id=p_site AND archived_at IS NULL FOR UPDATE;
 IF page_head.id IS NULL THEN RAISE EXCEPTION 'Story article unavailable' USING ERRCODE='CMS03';END IF;
 SELECT * INTO head FROM public.collections WHERE id=p_collection AND site_id=p_site AND reader_key='stories' FOR UPDATE;
 IF head.id IS NULL THEN RAISE EXCEPTION 'Stories unavailable' USING ERRCODE='CMS03';END IF;
 SELECT e.id,v.values,v.schema_version_id INTO story FROM public.collection_entries e
 JOIN public.collection_entry_versions v ON v.id=e.draft_version_id
 WHERE e.id=p_entry AND e.collection_id=head.id AND e.archived_at IS NULL FOR UPDATE OF e;
 SELECT v.values,v.schema_version_id INTO expected FROM public.collection_entry_versions v WHERE v.id=p_entry_version AND v.entry_id=p_entry;
 IF story.id IS NULL OR expected IS NULL OR story.values->>'story_url' IS DISTINCT FROM app.page_path(page_head.slug)
 OR story.values IS DISTINCT FROM expected.values OR story.schema_version_id IS DISTINCT FROM expected.schema_version_id THEN
  RAISE EXCEPTION 'The story changed after you opened its review. Check the saved story and try again.' USING ERRCODE='CMS01';END IF;
 RETURN QUERY SELECT * FROM app.submit_page_for_review(page_head.id,p_revision,p_note);
END $$;

CREATE FUNCTION app.story_review_manifest(p_version uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE result jsonb;actor uuid:=app.require_actor();
BEGIN
 SELECT p.manifest INTO result FROM public.story_review_pins p JOIN public.submissions s ON s.id=p.submission_id
 WHERE p.page_version_id=p_version AND app.has_site_access(s.site_id)
 AND (s.submitted_by=actor OR app.can_review(s.site_id));
 RETURN result;
END $$;

CREATE FUNCTION app.supersede_changed_story_reviews() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE changed uuid;
BEGIN
 IF NEW.draft_version_id IS NOT DISTINCT FROM OLD.draft_version_id AND NEW.archived_at IS NOT DISTINCT FROM OLD.archived_at THEN RETURN NEW;END IF;
 FOR changed IN UPDATE public.submissions s SET status='superseded'
 FROM public.story_review_pins pin JOIN public.collection_entry_versions submitted ON submitted.id=pin.entry_version_id
 WHERE pin.entry_id=NEW.id AND s.id=pin.submission_id AND s.status='open'
 AND (NEW.archived_at IS NOT NULL OR NOT EXISTS(SELECT 1 FROM public.collection_entry_versions current
 WHERE current.id=NEW.draft_version_id AND current.schema_version_id=pin.schema_version_id AND current.values=submitted.values))
 RETURNING s.id LOOP
  PERFORM app.write_audit(NEW.site_id,CASE WHEN app.current_user_id() IS NULL THEN 'system'::public.actor_type ELSE 'user'::public.actor_type END,
   app.current_user_id(),'submission.superseded','submission',changed,OLD.draft_version_id,NEW.draft_version_id,jsonb_build_object('story_entry',NEW.id));
 END LOOP;
 RETURN NEW;
END $$;
CREATE TRIGGER collection_entries_supersede_story_reviews AFTER UPDATE OF draft_version_id,archived_at ON public.collection_entries
 FOR EACH ROW EXECUTE FUNCTION app.supersede_changed_story_reviews();

CREATE FUNCTION app.supersede_story_settings_reviews() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF NEW.draft_schema_version_id IS DISTINCT FROM OLD.draft_schema_version_id THEN
  UPDATE public.submissions s SET status='superseded' FROM public.story_review_pins pin
  WHERE pin.collection_id=NEW.id AND pin.schema_version_id IS DISTINCT FROM NEW.draft_schema_version_id
   AND s.id=pin.submission_id AND s.status='open';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER collections_supersede_story_settings_reviews AFTER UPDATE OF draft_schema_version_id ON public.collections
 FOR EACH ROW EXECUTE FUNCTION app.supersede_story_settings_reviews();

-- Preserve the existing page approval, trusted-code/readiness and first-release
-- guards. Lock collection/entry before submission, matching list-save triggers.
DO $patch$
DECLARE definition text;updated text;
BEGIN
 definition:=pg_get_functiondef('app.approve_page_submission(uuid,integer,text,jsonb)'::regprocedure);
 updated:=replace(definition,'actor uuid; visible RECORD; head RECORD; request RECORD; src RECORD; published RECORD;',
 'actor uuid; visible RECORD; head RECORD; request RECORD; src RECORD; published RECORD; story_pin public.story_review_pins%ROWTYPE; story_head public.collections%ROWTYPE; current_story RECORD;');
 IF updated=definition THEN RAISE EXCEPTION 'Page approval declarations changed';END IF;definition:=updated;
 updated:=replace(definition,'  SELECT s.id, s.site_id, s.item_type, s.item_id, s.version_id, s.status',
 $insert$  SELECT * INTO story_pin FROM public.story_review_pins WHERE submission_id=p_submission_id;
  IF story_pin.submission_id IS NOT NULL THEN
   SELECT * INTO story_head FROM public.collections WHERE id=story_pin.collection_id AND site_id=head.site_id AND reader_key='stories' FOR UPDATE;
   SELECT e.archived_at,v.schema_version_id,v.values INTO current_story FROM public.collection_entries e
   JOIN public.collection_entry_versions v ON v.id=e.draft_version_id WHERE e.id=story_pin.entry_id AND e.collection_id=story_head.id FOR UPDATE OF e;
  END IF;

  SELECT s.id, s.site_id, s.item_type, s.item_id, s.version_id, s.status$insert$);
 IF updated=definition THEN RAISE EXCEPTION 'Page approval lock point changed';END IF;definition:=updated;
 updated:=replace(definition,'  SELECT * INTO published FROM app.publish_page_version(',
 $insert$  IF story_pin.submission_id IS NOT NULL THEN
   IF story_pin.page_version_id<>request.version_id OR current_story IS NULL OR current_story.archived_at IS NOT NULL
    OR story_head.draft_schema_version_id IS DISTINCT FROM story_pin.schema_version_id
    OR current_story.schema_version_id IS DISTINCT FROM story_pin.schema_version_id
    OR current_story.values IS DISTINCT FROM (SELECT v.values FROM public.collection_entry_versions v WHERE v.id=story_pin.entry_version_id) THEN
    RAISE EXCEPTION 'The story changed after review. Ask its author to submit again.' USING ERRCODE='CMS01';END IF;
   IF story_head.published_schema_version_id IS DISTINCT FROM story_pin.schema_version_id THEN
    RAISE EXCEPTION 'Publish the saved Stories settings first, then review this story again.' USING ERRCODE='CMS04';END IF;
   IF COALESCE(current_story.values->>'published_date','')='' THEN
    RAISE EXCEPTION 'Choose a story date, save and submit again before publication.' USING ERRCODE='CMS04';END IF;
   PERFORM * FROM app.publish_story_entries(story_head.id,story_head.entry_revision,ARRAY[story_pin.entry_id]);
  ELSIF EXISTS(SELECT 1 FROM public.collections c JOIN public.collection_entries e ON e.collection_id=c.id
   JOIN public.collection_entry_versions v ON v.id=e.draft_version_id JOIN public.pages p ON p.id=head.id
   WHERE c.site_id=head.site_id AND c.reader_key='stories' AND e.archived_at IS NULL AND v.values->>'story_url'=app.page_path(p.slug)) THEN
   RAISE EXCEPTION 'Submit this story again so its saved text can be reviewed with its article.' USING ERRCODE='CMS04';
  END IF;

  SELECT * INTO published FROM app.publish_page_version($insert$);
 IF updated=definition THEN RAISE EXCEPTION 'Page approval publication point changed';END IF;
 EXECUTE updated;
END $patch$;

ALTER FUNCTION app.capture_story_review() OWNER TO cms_migration_owner;
ALTER FUNCTION app.story_review_manifest(uuid) OWNER TO cms_migration_owner;
ALTER FUNCTION app.supersede_changed_story_reviews() OWNER TO cms_migration_owner;
REVOKE ALL ON FUNCTION app.capture_story_review(),app.story_review_manifest(uuid),app.supersede_changed_story_reviews() FROM PUBLIC,cms_authenticated_user,cms_public_renderer,cms_worker;
GRANT EXECUTE ON FUNCTION app.story_review_manifest(uuid) TO cms_authenticated_user;

ALTER FUNCTION app.supersede_story_settings_reviews() OWNER TO cms_migration_owner;
REVOKE ALL ON FUNCTION app.supersede_story_settings_reviews() FROM PUBLIC,cms_authenticated_user,cms_public_renderer,cms_worker;

ALTER FUNCTION app.submit_story_for_review(uuid,uuid,uuid,uuid,bigint,uuid,text) OWNER TO cms_migration_owner;
REVOKE ALL ON FUNCTION app.submit_story_for_review(uuid,uuid,uuid,uuid,bigint,uuid,text) FROM PUBLIC,cms_authenticated_user,cms_public_renderer,cms_worker;
GRANT EXECUTE ON FUNCTION app.submit_story_for_review(uuid,uuid,uuid,uuid,bigint,uuid,text) TO cms_authenticated_user;
