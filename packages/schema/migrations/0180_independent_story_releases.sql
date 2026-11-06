-- Independent single-Story reviews keep exact saved targets while other Stories
-- progress. Whole-site releases keep their original fingerprint and safety rules.
CREATE TABLE public.site_release_story_scopes (
 release_id uuid PRIMARY KEY REFERENCES public.site_releases(id),
 site_id uuid NOT NULL REFERENCES public.sites(id),
 before_hash text NOT NULL CHECK(before_hash ~ '^[0-9a-f]{64}$'),
 after_hash text NOT NULL CHECK(after_hash ~ '^[0-9a-f]{64}$'),
 FOREIGN KEY(site_id,release_id) REFERENCES public.site_releases(site_id,id)
);
ALTER TABLE public.site_release_story_scopes OWNER TO cms_migration_owner;
ALTER TABLE public.site_release_story_scopes ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.site_release_story_scopes TO cms_authenticated_user;
CREATE POLICY story_scope_read ON public.site_release_story_scopes FOR SELECT TO cms_authenticated_user USING(app.has_site_access(site_id));

-- Classify the actual shared Story article, not an arbitrary page mentioned
-- by an editable URL. Only the registered first Story-detail section qualifies.
CREATE FUNCTION app.is_native_story_article(p_site uuid,p_page uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT NOT EXISTS(SELECT 1 FROM public.site_file_heads h JOIN public.site_file_versions f ON f.id=h.draft_version_id WHERE h.site_id=p_site AND f.bundle ? 'original')
 AND EXISTS(SELECT 1 FROM public.pages p JOIN public.page_versions pv ON pv.id=p.draft_version_id
  JOIN public.section_defs d ON d.id=(pv.content->0->>'section_def_id')::uuid
  JOIN public.collections c ON c.site_id=p.site_id AND c.reader_key='stories'
  JOIN public.collection_entries e ON e.collection_id=c.id
  JOIN public.collection_entry_versions v ON v.entry_id=e.id AND v.collection_id=c.id AND (v.id=e.draft_version_id OR v.id=e.published_version_id)
  WHERE p.id=p_page AND p.site_id=p_site AND d.scope='global' AND d.slug='core-story-detail'
   AND v."values"->>'story_url'=app.page_path(p.slug)
   AND pv.content->0#>>'{values,story,readerKey}'='stories'
   AND pv.content->0#>>'{values,story,selection,mode}'='manual'
   AND pv.content->0#>'{values,story,selection,stableKeys}' @> jsonb_build_array(e.stable_key))
$$;
ALTER FUNCTION app.is_native_story_article(uuid,uuid) OWNER TO cms_migration_owner;
REVOKE ALL ON FUNCTION app.is_native_story_article(uuid,uuid) FROM PUBLIC,cms_authenticated_user,cms_public_renderer,cms_worker;

CREATE FUNCTION app.story_release_scope_valid(p_site uuid,p_snapshot jsonb) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE item jsonb; entries jsonb; page_item jsonb; target record; list record;
BEGIN
 IF jsonb_typeof(p_snapshot) IS DISTINCT FROM 'array' OR jsonb_array_length(p_snapshot) NOT BETWEEN 1 AND 2 THEN RETURN false;END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(p_snapshot) LOOP
  IF item ? 'action' OR item ? 'recoveryId' OR item->>'requiresAdmin'='true' THEN RETURN false;END IF;
  IF item->>'type'='collection_entries' AND entries IS NULL THEN entries:=item;
  ELSIF item->>'type'='page' AND page_item IS NULL THEN page_item:=item;
  ELSE RETURN false;END IF;
 END LOOP;
 IF entries IS NULL OR jsonb_typeof(entries->'entryIds') IS DISTINCT FROM 'array' OR jsonb_array_length(entries->'entryIds')<>1
  OR NOT(entries->'entryIds'->>0 ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$') THEN RETURN false;END IF;
 SELECT * INTO list FROM public.collections WHERE id=(entries->>'id')::uuid AND site_id=p_site AND reader_key='stories';
 IF list.id IS NULL OR list.published_schema_version_id IS NULL OR list.draft_schema_version_id IS DISTINCT FROM list.published_schema_version_id OR entries->>'versionId' IS DISTINCT FROM list.draft_schema_version_id::text THEN RETURN false;END IF;
 SELECT e.*,v."values" AS fields,v.schema_version_id INTO target FROM public.collection_entries e JOIN public.collection_entry_versions v ON v.id=e.draft_version_id
 WHERE e.id=(entries->'entryIds'->>0)::uuid AND e.collection_id=list.id AND e.site_id=p_site AND e.archived_at IS NULL;
 IF target.id IS NULL OR target.schema_version_id IS DISTINCT FROM list.published_schema_version_id THEN RETURN false;END IF;
 IF NOT EXISTS(SELECT 1 FROM public.pages p WHERE p.site_id=p_site AND p.archived_at IS NULL AND app.page_path(p.slug)=target.fields->>'story_url' AND app.is_native_story_article(p_site,p.id)) THEN RETURN false;END IF;
 IF page_item IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.pages p WHERE p.id=(page_item->>'id')::uuid AND p.site_id=p_site AND p.archived_at IS NULL AND p.draft_version_id::text=page_item->>'versionId' AND app.page_path(p.slug)=target.fields->>'story_url') THEN RETURN false;END IF;
 RETURN EXISTS(SELECT 1 FROM public.sites WHERE id=p_site AND NOT initial_release_required AND status<>'archived');
EXCEPTION WHEN invalid_text_representation THEN RETURN false;
END $$;

CREATE FUNCTION app.story_release_fingerprint(p_site uuid,p_snapshot jsonb) RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE target_collection uuid;target_entry uuid;target_page uuid;state jsonb;
BEGIN
 PERFORM app.require_actor();IF NOT app.has_site_access(p_site) THEN RAISE EXCEPTION 'site not available' USING ERRCODE='CMS02';END IF;
 IF NOT app.story_release_scope_valid(p_site,p_snapshot) THEN RETURN NULL;END IF;
 SELECT (value->>'id')::uuid,(value->'entryIds'->>0)::uuid INTO target_collection,target_entry FROM jsonb_array_elements(p_snapshot) WHERE value->>'type'='collection_entries';
 SELECT p.id INTO target_page FROM public.pages p JOIN public.collection_entries e ON e.id=target_entry JOIN public.collection_entry_versions v ON v.id=e.draft_version_id WHERE p.site_id=p_site AND app.page_path(p.slug)=v."values"->>'story_url' AND app.is_native_story_article(p_site,p.id);
 WITH ordinary_pages AS (SELECT p.* FROM public.pages p WHERE p.site_id=p_site AND NOT app.is_native_story_article(p_site,p.id)),
 media_versions AS (
  SELECT draft_version_id AS id FROM ordinary_pages UNION SELECT published_version_id FROM ordinary_pages
  UNION SELECT draft_version_id FROM public.pages WHERE id=target_page UNION SELECT published_version_id FROM public.pages WHERE id=target_page
  UNION SELECT draft_version_id FROM public.global_elements WHERE site_id=p_site UNION SELECT published_version_id FROM public.global_elements WHERE site_id=p_site
  UNION SELECT e.draft_version_id FROM public.collection_entries e JOIN public.collections c ON c.id=e.collection_id WHERE c.site_id=p_site AND (c.reader_key<>'stories' OR e.id=target_entry)
  UNION SELECT e.published_version_id FROM public.collection_entries e JOIN public.collections c ON c.id=e.collection_id WHERE c.site_id=p_site AND (c.reader_key<>'stories' OR e.id=target_entry)
 )
 SELECT jsonb_build_object(
  'site',(SELECT jsonb_build_object('name',name,'slug',slug,'kind',kind,'status',status,'private',initial_release_required,'staging',staging_hostname) FROM public.sites WHERE id=p_site),
  'shell',(SELECT payload FROM public.published_site_shells WHERE site_id=p_site),
  'theme',(SELECT jsonb_build_object('revision',h.revision,'published_revision',v.revision,'current',h.draft_version_id=h.published_version_id) FROM public.themes h LEFT JOIN public.theme_versions v ON v.id=h.published_version_id WHERE h.site_id=p_site),
  'navigation',(SELECT jsonb_build_object('revision',h.revision,'published_revision',v.revision,'current',h.draft_version_id=h.published_version_id) FROM public.navigations h LEFT JOIN public.navigation_versions v ON v.id=h.published_version_id WHERE h.site_id=p_site),
  'frame',(SELECT jsonb_agg(jsonb_build_object('kind',h.kind,'revision',h.revision,'published_revision',v.revision,'current',h.draft_version_id=h.published_version_id) ORDER BY h.kind) FROM public.global_elements h LEFT JOIN public.global_element_versions v ON v.id=h.published_version_id WHERE h.site_id=p_site),
  'ordinary_pages',(SELECT jsonb_agg(jsonb_build_object('id',id,'slug',slug,'title',title,'revision',revision,'draft',draft_version_id,'published',published_version_id,'archived',archived_at) ORDER BY id) FROM ordinary_pages),
  'article',(SELECT jsonb_build_object('id',id,'slug',slug,'title',title,'revision',revision,'draft',draft_version_id,'published',published_version_id,'archived',archived_at) FROM public.pages WHERE id=target_page),
  'story',(SELECT to_jsonb(e) FROM public.collection_entries e WHERE id=target_entry),
  'catalogs',(SELECT jsonb_agg(jsonb_build_object('id',id,'revision',revision,'draft',draft_schema_version_id,'published',published_schema_version_id) ORDER BY id) FROM public.collections WHERE site_id=p_site AND reader_key='stories'),
  'ordinary_lists',(SELECT jsonb_agg(jsonb_build_object('head',to_jsonb(c),'entries',(SELECT jsonb_agg(to_jsonb(e) ORDER BY e.id) FROM public.collection_entries e WHERE e.collection_id=c.id)) ORDER BY c.id) FROM public.collections c WHERE c.site_id=p_site AND c.reader_key<>'stories'),
  'settings',(SELECT jsonb_agg(to_jsonb(s) ORDER BY s.id) FROM public.site_settings s WHERE s.site_id=p_site),
  'files',(SELECT to_jsonb(f) FROM public.site_file_heads f WHERE f.site_id=p_site),
  'chapters',(SELECT jsonb_agg(to_jsonb(c) ORDER BY c.id) FROM public.chapters c WHERE c.site_id=p_site),
  'domains',(SELECT jsonb_agg(jsonb_build_object('host',hostname_normalized,'kind',kind,'status',status,'target',redirect_to_domain_id) ORDER BY hostname_normalized) FROM public.domains WHERE site_id=p_site),
  'media',(SELECT jsonb_agg(jsonb_build_object('id',m.id,'status',m.status,'revision',m.revision,'deleted',m.deleted_at,'variants',(SELECT jsonb_agg(jsonb_build_object('kind',v.kind,'hash',v.content_hash) ORDER BY v.kind) FROM public.media_variants v WHERE v.media_id=m.id)) ORDER BY m.id) FROM public.media m WHERE m.id IN(SELECT u.media_id FROM public.media_usage u WHERE u.site_id=p_site AND u.version_id IN(SELECT id FROM media_versions)))
 ) INTO state;
 RETURN encode(sha256(convert_to(state::text,'UTF8')),'hex');
END $$;

CREATE FUNCTION app.record_story_release_scope(p_release uuid,p_after text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE actor uuid;receipt public.site_releases;before_state text;
BEGIN
 actor:=app.require_actor();SELECT * INTO receipt FROM public.site_releases WHERE id=p_release; 
 IF receipt.id IS NULL OR NOT app.can_publish(receipt.site_id) THEN RAISE EXCEPTION 'release not available' USING ERRCODE='CMS02';END IF;
 PERFORM app.lock_release_site(receipt.site_id);SELECT * INTO receipt FROM public.site_releases WHERE id=p_release FOR UPDATE;
 IF receipt.status<>'planned' OR receipt.created_by<>actor OR app.release_fingerprint(receipt.site_id) IS DISTINCT FROM receipt.context_hash THEN RAISE EXCEPTION 'The story changed before review finished. Save and review it again.' USING ERRCODE='CMS01';END IF;
 before_state:=app.story_release_fingerprint(receipt.site_id,receipt.snapshot);
 IF before_state IS NULL OR p_after IS NULL OR p_after !~ '^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'This story cannot use individual review. Save it and review publishing again.' USING ERRCODE='CMS04';END IF;
 INSERT INTO public.site_release_story_scopes(release_id,site_id,before_hash,after_hash) VALUES(receipt.id,receipt.site_id,before_state,p_after) ON CONFLICT(release_id) DO NOTHING;
END $$;

CREATE FUNCTION app.refresh_story_release_recovery(p_release uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE receipt public.site_releases;scope public.site_release_story_scopes;capture public.site_release_recovery_captures;current_before jsonb;
BEGIN
 PERFORM app.require_actor();SELECT * INTO receipt FROM public.site_releases WHERE id=p_release;
 IF receipt.id IS NULL OR NOT app.can_publish(receipt.site_id) THEN RAISE EXCEPTION 'release not available' USING ERRCODE='CMS02';END IF;
 PERFORM app.lock_release_site(receipt.site_id);SELECT * INTO receipt FROM public.site_releases WHERE id=p_release FOR UPDATE;
 SELECT * INTO scope FROM public.site_release_story_scopes WHERE release_id=p_release;
 IF scope.release_id IS NULL OR receipt.status<>'planned' OR app.story_release_fingerprint(receipt.site_id,receipt.snapshot) IS DISTINCT FROM scope.before_hash THEN RAISE EXCEPTION 'the story or required settings changed; review again' USING ERRCODE='CMS01';END IF;
 SELECT * INTO capture FROM public.site_release_recovery_captures WHERE release_id=p_release FOR UPDATE;
 current_before:=app.capture_release_recovery_items(receipt.site_id,capture.before_items);
 UPDATE public.site_release_recovery_captures SET before_items=current_before WHERE release_id=p_release;
 PERFORM app.pin_release_recovery_items(p_release,receipt.site_id,current_before);
END $$;

CREATE OR REPLACE FUNCTION app.finish_site_release_before_recovery(p_id uuid,p_cancel boolean,p_detail jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE actor uuid; release RECORD;
BEGIN
  actor:=app.require_actor();
  SELECT * INTO release FROM public.site_releases WHERE id=p_id FOR UPDATE;
  IF release IS NULL THEN RAISE EXCEPTION 'release not found' USING ERRCODE='CMS03'; END IF;
  IF NOT app.can_publish(release.site_id) THEN RAISE EXCEPTION 'only an editor may finish a release' USING ERRCODE='CMS02'; END IF;
  IF p_cancel IS NULL THEN RAISE EXCEPTION 'choose publish or cancel explicitly' USING ERRCODE='CMS04'; END IF;
  IF p_cancel AND release.status='cancelled' THEN RETURN; END IF;
  IF release.status<>'planned' THEN RAISE EXCEPTION 'release already finished' USING ERRCODE='CMS04'; END IF;
  IF p_cancel IS NOT TRUE AND (CASE WHEN EXISTS(SELECT 1 FROM public.site_release_story_scopes WHERE release_id=p_id) THEN app.story_release_fingerprint(release.site_id,release.snapshot) ELSE app.release_fingerprint(release.site_id) END) IS DISTINCT FROM COALESCE((SELECT after_hash FROM public.site_release_story_scopes WHERE release_id=p_id),release.after_hash) THEN
    RAISE EXCEPTION 'the published site does not match the reviewed release outcome' USING ERRCODE='CMS04';
  END IF;
  UPDATE public.site_releases SET status=CASE WHEN p_cancel THEN 'cancelled' ELSE 'applied' END,
    finished_by=actor,finished_at=now() WHERE id=p_id;
  PERFORM app.write_audit(release.site_id,'user',actor,CASE WHEN p_cancel THEN 'release.cancel' ELSE 'release.publish' END,
    'site_release',p_id,NULL,NULL,COALESCE(p_detail,'{}'));
END $$;

CREATE OR REPLACE FUNCTION app.schedule_release_action(
 p_release_id uuid,p_run_at timestamptz,p_override text,p_samples_confirmed boolean,p_request_id uuid,p_policy int
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE actor uuid; plan RECORD; old RECORD; created uuid; check_row jsonb; findings jsonb;
BEGIN
 actor:=app.require_actor();
 SELECT * INTO plan FROM public.site_releases WHERE id=p_release_id;
 IF plan.id IS NULL THEN RAISE EXCEPTION 'release not found' USING ERRCODE='CMS03'; END IF;
 PERFORM app.lock_release_site(plan.site_id);
 SELECT * INTO plan FROM public.site_releases WHERE id=p_release_id FOR UPDATE;
 IF (EXISTS(SELECT 1 FROM jsonb_array_elements(plan.snapshot) item WHERE item->>'type'='site_files') AND NOT app.is_super_admin()) OR NOT app.can_publish(plan.site_id) OR (EXISTS(SELECT 1 FROM jsonb_array_elements(plan.snapshot) item WHERE item->>'requiresAdmin'='true') AND NOT app.can_administer_site(plan.site_id)) THEN
  RAISE EXCEPTION 'you cannot schedule these changes' USING ERRCODE='CMS02';
 END IF;
 IF p_request_id IS NULL OR p_policy IS NULL OR p_policy<1 OR p_samples_confirmed IS NULL OR length(COALESCE(p_override,''))>2000 THEN
  RAISE EXCEPTION 'a schedule needs an explicit review and request reference' USING ERRCODE='CMS04';
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_request_id::text,56));
 SELECT * INTO old FROM public.scheduled_actions WHERE request_id=p_request_id;
 IF old.id IS NOT NULL THEN
  IF old.created_by<>actor OR old.item_type<>'release' OR old.item_id<>p_release_id OR old.run_at IS DISTINCT FROM p_run_at
   OR old.override_reason IS DISTINCT FROM NULLIF(btrim(p_override),'') OR old.samples_confirmed IS DISTINCT FROM p_samples_confirmed OR old.readiness_policy_version IS DISTINCT FROM p_policy THEN
   RAISE EXCEPTION 'this schedule request was used for different choices' USING ERRCODE='CMS04';
  END IF;
  RETURN old.id;
 END IF;
 IF plan.status<>'planned' OR EXISTS(SELECT 1 FROM public.sites WHERE id=plan.site_id AND status='archived') THEN
  RAISE EXCEPTION 'only a pending release on an active site can be scheduled' USING ERRCODE='CMS04';
 END IF;
 IF (CASE WHEN EXISTS(SELECT 1 FROM public.site_release_story_scopes WHERE release_id=plan.id) THEN app.story_release_fingerprint(plan.site_id,plan.snapshot) ELSE app.release_fingerprint(plan.site_id) END) IS DISTINCT FROM COALESCE((SELECT before_hash FROM public.site_release_story_scopes WHERE release_id=plan.id),plan.context_hash) THEN
  RAISE EXCEPTION 'the site changed; review these changes again' USING ERRCODE='CMS01';
 END IF;
 IF NOT app.scheduling_available() THEN RAISE EXCEPTION 'no healthy scheduling worker is available' USING ERRCODE='CMS04'; END IF;
 IF p_run_at IS NULL OR p_run_at<clock_timestamp()+interval '1 minute' OR p_run_at>clock_timestamp()+interval '2 years' THEN
  RAISE EXCEPTION 'choose a time at least a minute from now and within two years' USING ERRCODE='CMS04';
 END IF;
 FOR check_row IN SELECT value FROM jsonb_array_elements(plan.preview_report) LOOP
  IF (check_row->'report'->>'policyVersion')::int IS DISTINCT FROM p_policy THEN
   RAISE EXCEPTION 'the publishing checks changed; review these changes again' USING ERRCODE='CMS04';
  END IF;
  findings:=check_row->'report'->'findings';
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(findings) finding WHERE finding->>'rule'='sample_content' AND finding->>'severity'='blocking') AND NOT p_samples_confirmed THEN
   RAISE EXCEPTION 'confirm the sample content before scheduling' USING ERRCODE='CMS04';
  END IF;
  IF p_samples_confirmed THEN SELECT COALESCE(jsonb_agg(value),'[]') INTO findings FROM jsonb_array_elements(findings) WHERE value->>'rule'<>'sample_content'; END IF;
  PERFORM app.assert_publishable(findings,(check_row->'report'->>'policyVersion')::int,p_override);
 END LOOP;
 INSERT INTO public.scheduled_actions(site_id,item_type,item_id,version_id,action,run_at,created_by,readiness_policy_version,request_id,override_reason,authorized_findings,samples_confirmed)
 VALUES(plan.site_id,'release',plan.id,plan.id,'publish',p_run_at,actor,p_policy,p_request_id,NULLIF(btrim(p_override),''),plan.preview_report,p_samples_confirmed) RETURNING id INTO created;
 PERFORM app.write_audit(plan.site_id,'user',actor,'schedule.create','scheduled_action',created,NULL,plan.id,
  jsonb_build_object('release_id',plan.id,'run_at',p_run_at,'samples_confirmed',p_samples_confirmed,'override_reason',NULLIF(btrim(p_override),'')));
 RETURN created;
END $$;

ALTER FUNCTION app.story_release_scope_valid(uuid,jsonb) OWNER TO cms_migration_owner;
REVOKE ALL ON FUNCTION app.story_release_scope_valid(uuid,jsonb) FROM PUBLIC,cms_authenticated_user,cms_public_renderer,cms_worker;

ALTER FUNCTION app.story_release_fingerprint(uuid,jsonb) OWNER TO cms_migration_owner;
REVOKE ALL ON FUNCTION app.story_release_fingerprint(uuid,jsonb) FROM PUBLIC,cms_authenticated_user,cms_public_renderer,cms_worker;
GRANT EXECUTE ON FUNCTION app.story_release_fingerprint(uuid,jsonb) TO cms_authenticated_user;

ALTER FUNCTION app.record_story_release_scope(uuid,text) OWNER TO cms_migration_owner;
REVOKE ALL ON FUNCTION app.record_story_release_scope(uuid,text) FROM PUBLIC,cms_authenticated_user,cms_public_renderer,cms_worker;
GRANT EXECUTE ON FUNCTION app.record_story_release_scope(uuid,text) TO cms_authenticated_user;

ALTER FUNCTION app.refresh_story_release_recovery(uuid) OWNER TO cms_migration_owner;
REVOKE ALL ON FUNCTION app.refresh_story_release_recovery(uuid) FROM PUBLIC,cms_authenticated_user,cms_public_renderer,cms_worker;
GRANT EXECUTE ON FUNCTION app.refresh_story_release_recovery(uuid) TO cms_authenticated_user;

REVOKE ALL ON FUNCTION app.finish_site_release_before_recovery(uuid,boolean,jsonb) FROM PUBLIC,cms_authenticated_user,cms_public_renderer,cms_worker;

-- Story publication must not introduce an unreviewed header change.
CREATE OR REPLACE FUNCTION app.sync_navigation_after_page_publication()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE head RECORD; published RECORD; next_tree jsonb; next_rev bigint; created uuid;
        actor uuid; audit_actor actor_type; shell_rev bigint; node_count integer;
BEGIN
  IF NEW.published_version_id IS NOT DISTINCT FROM OLD.published_version_id
     AND NEW.archived_at IS NOT DISTINCT FROM OLD.archived_at THEN RETURN NEW; END IF;

  SELECT n.id, n.site_id, n.revision, n.draft_version_id, n.published_version_id, n.mode
    INTO head FROM public.navigations n WHERE n.site_id = NEW.site_id FOR UPDATE;
  IF head IS NULL OR head.mode <> 'auto' OR head.published_version_id IS NULL THEN RETURN NEW; END IF;
  -- A Story is added to feeds, never implicitly to the site's header menu.
  -- Explicit links and original imported-site behavior retain their commands.
  IF OLD.published_version_id IS NULL AND NEW.published_version_id IS NOT NULL AND NEW.archived_at IS NULL AND app.is_native_story_article(NEW.site_id,NEW.id) THEN RETURN NEW;END IF;
  SELECT nv.tree INTO published FROM public.navigation_versions nv
   WHERE nv.id = head.published_version_id AND nv.navigation_id = head.id;
  IF published IS NULL THEN RETURN NEW; END IF;

  IF OLD.published_version_id IS NOT NULL AND NEW.published_version_id IS NOT NULL
     AND NEW.archived_at IS NULL AND NOT EXISTS(SELECT 1 FROM public.site_file_heads h
       JOIN public.site_file_versions v ON v.id=h.draft_version_id WHERE h.site_id=NEW.site_id AND v.bundle ? 'original') THEN
    RETURN NEW;
  END IF;

  next_tree := app.navigation_without_page(published.tree, NEW.id);
  IF NEW.published_version_id IS NOT NULL AND NEW.archived_at IS NULL THEN
    IF app.navigation_has_page(published.tree,NEW.id) THEN
      IF EXISTS(SELECT 1 FROM public.site_file_heads h JOIN public.site_file_versions v ON v.id=h.draft_version_id WHERE h.site_id=NEW.site_id AND v.bundle ? 'original') THEN
        next_tree:=app.navigation_refresh_page_label(published.tree,NEW.id,
          (SELECT left(page_title,80) FROM public.page_versions WHERE id=OLD.published_version_id),
          (SELECT left(page_title,80) FROM public.page_versions WHERE id=NEW.published_version_id));
      ELSE next_tree:=published.tree; END IF;
    ELSE
    SELECT COALESCE(sum(1 + CASE WHEN jsonb_typeof(node->'children') = 'array'
      THEN jsonb_array_length(node->'children') ELSE 0 END), 0)::integer INTO node_count
      FROM jsonb_array_elements(next_tree) node;
    IF jsonb_array_length(next_tree) >= 50 OR node_count >= 100 THEN
      actor := app.current_user_id();
      audit_actor := CASE WHEN actor IS NULL THEN 'system'::actor_type ELSE 'user'::actor_type END;
      PERFORM app.write_audit(NEW.site_id, audit_actor, actor, 'navigation.auto_sync_skipped',
                              'navigation', head.id, head.published_version_id, head.published_version_id,
                              jsonb_build_object('page_id', NEW.id, 'reason', 'navigation_at_capacity'));
      RETURN NEW;
    END IF;
    next_tree := next_tree || jsonb_build_array(jsonb_build_object(
      'label', left((SELECT page_title FROM public.page_versions WHERE id = NEW.published_version_id), 80),
      'target', jsonb_build_object('type','page','page_id',NEW.id),
      'visible', true));
    END IF;
  END IF;
  IF next_tree = published.tree THEN RETURN NEW; END IF;

  next_rev := head.revision + 1;
  actor := app.current_user_id();
  INSERT INTO public.navigation_versions (site_id, navigation_id, revision, tree, author_id)
  VALUES (NEW.site_id, head.id, next_rev, next_tree, actor) RETURNING id INTO created;
  UPDATE public.navigations SET revision = next_rev, published_version_id = created,
    draft_version_id = CASE WHEN draft_version_id = head.published_version_id THEN created ELSE draft_version_id END
   WHERE id = head.id;
  shell_rev := app.rebuild_site_shell(NEW.site_id);
  audit_actor := CASE WHEN actor IS NULL THEN 'system'::actor_type ELSE 'user'::actor_type END;
  PERFORM app.write_audit(NEW.site_id, audit_actor, actor, 'navigation.auto_sync', 'navigation', head.id,
                          head.published_version_id, created,
                          jsonb_build_object('page_id', NEW.id, 'shell_revision', shell_rev));
  PERFORM app.emit_outbox(NEW.site_id, 'site_shell.published',
                          jsonb_build_object(
                            'site_id', NEW.site_id, 'revision', shell_rev,
                            'paths', COALESCE((SELECT jsonb_agg(r.path ORDER BY r.path)
                              FROM public.published_routes r WHERE r.site_id = NEW.site_id), '[]'::jsonb)));
  RETURN NEW;
END
$$;

