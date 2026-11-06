-- A release keeps the exact pre-apply state, not merely its selected drafts.
-- Recovery prepares ordinary new drafts. Publication still passes through the
-- normal reviewed, atomic release path; unpublished is an explicit intention.
CREATE TABLE public.site_release_recovery_captures (
  release_id uuid PRIMARY KEY REFERENCES public.site_releases(id),
  site_id uuid NOT NULL REFERENCES public.sites(id),
  before_items jsonb NOT NULL CHECK(app.json_within(before_items,4194304)),
  after_items jsonb CHECK(app.json_within(after_items,4194304)),
  was_private boolean NOT NULL,
  FOREIGN KEY(site_id,release_id) REFERENCES public.site_releases(site_id,id)
);
CREATE TABLE public.site_release_version_pins (
  release_id uuid NOT NULL REFERENCES public.site_releases(id),
  site_id uuid NOT NULL REFERENCES public.sites(id),
  kind text NOT NULL,
  version_id uuid NOT NULL,
  theme_version_id uuid REFERENCES public.theme_versions(id),
  navigation_version_id uuid REFERENCES public.navigation_versions(id),
  frame_version_id uuid REFERENCES public.global_element_versions(id),
  schema_version_id uuid REFERENCES public.collection_schema_versions(id),
  entry_version_id uuid REFERENCES public.collection_entry_versions(id),
  PRIMARY KEY(release_id,kind,version_id),
  FOREIGN KEY(site_id,release_id) REFERENCES public.site_releases(site_id,id),
  CHECK(num_nonnulls(theme_version_id,navigation_version_id,frame_version_id,schema_version_id,entry_version_id)=1),
  CHECK((CASE kind WHEN 'theme' THEN version_id=theme_version_id WHEN 'navigation' THEN version_id=navigation_version_id
    WHEN 'frame' THEN version_id=frame_version_id WHEN 'collection_schema' THEN version_id=schema_version_id
    WHEN 'collection_entries' THEN version_id=entry_version_id ELSE false END) IS TRUE)
);
CREATE TABLE public.site_release_recoveries (
  id uuid PRIMARY KEY,
  site_id uuid NOT NULL REFERENCES public.sites(id),
  source_release_id uuid NOT NULL REFERENCES public.site_release_recovery_captures(release_id),
  expected_state jsonb NOT NULL CHECK(app.json_within(expected_state,4194304)),
  items jsonb NOT NULL DEFAULT '[]' CHECK(app.json_within(items,262144)),
  prepared_state jsonb NOT NULL DEFAULT '[]' CHECK(app.json_within(prepared_state,4194304)),
  preserved_drafts jsonb NOT NULL DEFAULT '[]' CHECK(app.json_within(preserved_drafts,4194304)),
  prepared_by uuid NOT NULL REFERENCES public.app_users(id),
  prepared_at timestamptz NOT NULL DEFAULT now(),
  applying boolean NOT NULL DEFAULT false,
  applied_release_id uuid REFERENCES public.site_releases(id)
);
ALTER TABLE public.site_release_recovery_captures OWNER TO cms_migration_owner;
ALTER TABLE public.site_release_version_pins OWNER TO cms_migration_owner;
ALTER TABLE public.site_release_recoveries OWNER TO cms_migration_owner;
ALTER TABLE public.site_release_recovery_captures ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.site_release_version_pins ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.site_release_recoveries ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.site_release_recovery_captures,public.site_release_version_pins,public.site_release_recoveries TO cms_authenticated_user;
CREATE POLICY release_recovery_captures_read ON public.site_release_recovery_captures FOR SELECT TO cms_authenticated_user USING(app.has_site_access(site_id));
CREATE POLICY release_version_pins_read ON public.site_release_version_pins FOR SELECT TO cms_authenticated_user USING(app.has_site_access(site_id));
CREATE POLICY release_recoveries_read ON public.site_release_recoveries FOR SELECT TO cms_authenticated_user USING(app.has_site_access(site_id));

CREATE FUNCTION app.capture_release_recovery_items(p_site uuid,p_targets jsonb) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE target jsonb; head RECORD; footer RECORD; item jsonb; result jsonb:='[]';
BEGIN
  IF jsonb_typeof(p_targets) IS DISTINCT FROM 'array' OR jsonb_array_length(p_targets)>201 THEN
    RAISE EXCEPTION 'invalid release recovery scope' USING ERRCODE='CMS04';
  END IF;
  FOR target IN SELECT value FROM jsonb_array_elements(p_targets) ORDER BY value->>'key' LOOP
    item:=NULL;
    CASE target->>'type'
      WHEN 'page' THEN
        SELECT * INTO head FROM public.pages WHERE site_id=p_site AND id=(target->>'id')::uuid;
        IF head.id IS NOT NULL THEN item:=jsonb_build_object('revision',head.revision::text,'draft',head.draft_version_id,
          'published',head.published_version_id,'label',head.title,'archived',head.archived_at); END IF;
      WHEN 'theme' THEN
        SELECT * INTO head FROM public.themes WHERE site_id=p_site AND id=(target->>'id')::uuid;
        IF head.id IS NOT NULL THEN item:=jsonb_build_object('revision',head.revision::text,'draft',head.draft_version_id,'published',head.published_version_id,'label','Theme'); END IF;
      WHEN 'navigation' THEN
        SELECT * INTO head FROM public.navigations WHERE site_id=p_site AND id=(target->>'id')::uuid;
        IF head.id IS NOT NULL THEN item:=jsonb_build_object('revision',head.revision::text,'draft',head.draft_version_id,'published',head.published_version_id,'label','Navigation','mode',head.mode); END IF;
      WHEN 'frame' THEN
        IF (target->>'id')::uuid=p_site THEN
          SELECT * INTO head FROM public.global_elements WHERE site_id=p_site AND kind='header';
          SELECT * INTO footer FROM public.global_elements WHERE site_id=p_site AND kind='footer';
          IF head.id IS NOT NULL AND footer.id IS NOT NULL THEN item:=jsonb_build_object('revision',head.revision::text,'draft',head.draft_version_id,'published',head.published_version_id,
            'secondaryRevision',footer.revision::text,'secondaryDraft',footer.draft_version_id,'secondaryPublished',footer.published_version_id,'label','Header & footer'); END IF;
        END IF;
      WHEN 'collection_schema' THEN
        SELECT * INTO head FROM public.collections WHERE site_id=p_site AND id=(target->>'id')::uuid;
        IF head.id IS NOT NULL THEN item:=jsonb_build_object('revision',head.revision::text,'draft',head.draft_schema_version_id,'published',head.published_schema_version_id,'label',head.name||' schema'); END IF;
      WHEN 'collection_entries' THEN
        SELECT * INTO head FROM public.collections WHERE site_id=p_site AND id=(target->>'id')::uuid;
        IF head.id IS NOT NULL THEN item:=jsonb_build_object('revision',head.entry_revision::text,'draft',head.draft_schema_version_id,'published',head.published_schema_version_id,
          'publishedRevision',head.published_entry_revision::text,'label',head.name||' records','entries',COALESCE((SELECT jsonb_agg(jsonb_build_object(
            'id',e.id,'stableKey',e.stable_key,'draft',e.draft_version_id,'published',e.published_version_id,'revision',e.revision::text,
            'sort',e.sort_index,'archived',e.archived_at,'publishedSort',e.published_sort_index,'publishedArchived',e.published_archived_at) ORDER BY e.id)
            FROM public.collection_entries e WHERE e.collection_id=head.id),'[]'::jsonb)); END IF;
      ELSE RAISE EXCEPTION 'unsupported release recovery item' USING ERRCODE='CMS04';
    END CASE;
    IF item IS NULL THEN RAISE EXCEPTION 'a recovery item is missing or belongs to another site' USING ERRCODE='CMS04'; END IF;
    result:=result||jsonb_build_array(item||jsonb_build_object('key',target->>'key','type',target->>'type','id',target->>'id','implicit',COALESCE((target->>'implicit')::boolean,false)));
  END LOOP;
  RETURN result;
END $$;

CREATE FUNCTION app.prepare_site_release_recovery(p_request uuid,p_release uuid,p_expected jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
<<recovery_prepare>>
DECLARE actor uuid; receipt public.site_releases; capture public.site_release_recovery_captures; previous public.site_release_recoveries;
  review jsonb; before_item jsonb; current_item jsonb; current_items jsonb; src RECORD; head RECORD; saved RECORD;
  entries jsonb; checkpoints jsonb:='[]'; items jsonb:='[]'; item jsonb; checkpoint uuid; was_unpublished boolean;
BEGIN
  actor:=app.require_actor();
  IF p_request IS NULL THEN RAISE EXCEPTION 'recovery needs a request reference' USING ERRCODE='CMS04'; END IF;
  SELECT * INTO receipt FROM public.site_releases WHERE id=p_release;
  IF receipt.id IS NULL THEN RAISE EXCEPTION 'release not found' USING ERRCODE='CMS03'; END IF;
  PERFORM app.lock_release_site(receipt.site_id);
  PERFORM pg_advisory_xact_lock(hashtextextended(p_request::text,102));
  SELECT * INTO previous FROM public.site_release_recoveries WHERE id=p_request;
  IF previous.id IS NOT NULL THEN
    IF previous.source_release_id IS DISTINCT FROM p_release OR previous.prepared_by IS DISTINCT FROM actor
      OR previous.expected_state IS DISTINCT FROM p_expected THEN
      RAISE EXCEPTION 'this recovery request was already used for another intention' USING ERRCODE='CMS04';
    END IF;
    RETURN jsonb_build_object('recoveryId',previous.id,'siteId',previous.site_id,'sourceReleaseId',previous.source_release_id,
      'items',previous.items,'preservedDrafts',previous.preserved_drafts);
  END IF;
  review:=app.review_site_release_recovery(p_release);
  IF (review->>'available')::boolean IS NOT TRUE THEN RAISE EXCEPTION '%',review->>'reason' USING ERRCODE='CMS04'; END IF;
  IF review->'expectedState' IS DISTINCT FROM p_expected THEN RAISE EXCEPTION 'the recovery targets changed; review their current state again' USING ERRCODE='CMS01'; END IF;
  SELECT * INTO capture FROM public.site_release_recovery_captures WHERE release_id=p_release;
  IF capture.was_private AND EXISTS(SELECT 1 FROM public.published_routes r WHERE r.site_id=receipt.site_id
      AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(capture.before_items) b WHERE b->>'type'='page' AND b->>'id'=r.page_id::text)) THEN
    RAISE EXCEPTION 'This first release can return to private only after later, unrelated published pages are reviewed and unpublished separately.' USING ERRCODE='CMS04';
  END IF;
  current_items:=p_expected->'items';
  PERFORM app.pin_release_recovery_items(p_release,receipt.site_id,current_items);
  INSERT INTO public.site_release_recoveries(id,site_id,source_release_id,expected_state,prepared_by)
    VALUES(p_request,receipt.site_id,p_release,p_expected,actor);
  -- Schemas precede record batches so restored records pin the newly created
  -- recovery schema. All mutations are rolled back together on any blocker.
  FOR before_item IN SELECT value FROM jsonb_array_elements(capture.before_items)
    ORDER BY CASE value->>'type' WHEN 'collection_schema' THEN 0 WHEN 'collection_entries' THEN 2 ELSE 1 END,value->>'key'
  LOOP
    SELECT value INTO current_item FROM jsonb_array_elements(current_items) WHERE value->>'key'=before_item->>'key';
    checkpoints:=checkpoints||jsonb_build_array(jsonb_build_object('key',current_item->>'key','type',current_item->>'type','id',current_item->>'id','label',current_item->>'label',
      'versionId',current_item->'draft','secondaryVersionId',current_item->'secondaryDraft','entryVersionIds',CASE WHEN current_item->>'type'='collection_entries'
        THEN (SELECT COALESCE(jsonb_agg(e->'draft' ORDER BY e->>'id'),'[]'::jsonb) FROM jsonb_array_elements(current_item->'entries') e WHERE e->>'draft' IS NOT NULL) ELSE NULL END));
    was_unpublished:=CASE WHEN before_item->>'type'='collection_entries' THEN before_item->>'publishedRevision'='0' ELSE before_item->>'published' IS NULL END;
    -- A content-policy refusal (deleted media, archived page, incomplete pair)
    -- aborts the whole preparation; name the affected item so the author can
    -- repair that blocker instead of guessing which part of the release failed.
    BEGIN
    CASE before_item->>'type'
      WHEN 'page' THEN
        SELECT * INTO head FROM public.pages WHERE id=(before_item->>'id')::uuid;
        IF head.archived_at IS NOT NULL THEN RAISE EXCEPTION 'restore this archived page before preparing release recovery' USING ERRCODE='CMS04'; END IF;
        IF head.draft_version_id IS NOT NULL THEN
          SELECT * INTO src FROM public.page_versions WHERE id=head.draft_version_id;
          SELECT * INTO saved FROM app.save_page_draft(head.id,head.revision,src.content,src.meta,'checkpoint','Draft preserved before coordinated release recovery');
          checkpoint:=saved.version_id;
          INSERT INTO public.site_release_pages(release_id,site_id,page_id,version_id) VALUES(p_release,receipt.site_id,head.id,checkpoint) ON CONFLICT DO NOTHING;
          checkpoints:=jsonb_set(checkpoints,ARRAY[(jsonb_array_length(checkpoints)-1)::text,'versionId'],to_jsonb(checkpoint));
          head.revision:=saved.revision;
        END IF;
        IF NOT was_unpublished THEN
          PERFORM app.restore_version_as_draft(head.id,head.revision,(before_item->>'published')::uuid,'Recover state before release '||p_release::text);
        END IF;
      WHEN 'theme' THEN
        IF NOT app.can_administer_site(receipt.site_id) THEN RAISE EXCEPTION 'a site admin must recover theme changes' USING ERRCODE='CMS02'; END IF;
        IF NOT was_unpublished THEN
          SELECT * INTO src FROM public.theme_versions WHERE id=(before_item->>'published')::uuid;
          IF src.id IS NULL THEN RAISE EXCEPTION 'the retained theme version is missing' USING ERRCODE='CMS04'; END IF;
          PERFORM app.save_theme_draft(receipt.site_id,(current_item->>'revision')::bigint,src.tokens);
        END IF;
      WHEN 'navigation' THEN
        IF NOT was_unpublished THEN
          SELECT * INTO src FROM public.navigation_versions WHERE id=(before_item->>'published')::uuid;
          IF src.id IS NULL THEN RAISE EXCEPTION 'the retained navigation version is missing' USING ERRCODE='CMS04'; END IF;
          PERFORM app.save_navigation_draft(receipt.site_id,(current_item->>'revision')::bigint,src.tree,before_item->>'mode');
        END IF;
      WHEN 'frame' THEN
        IF (before_item->>'published' IS NULL) IS DISTINCT FROM (before_item->>'secondaryPublished' IS NULL) THEN
          RAISE EXCEPTION 'this historical frame does not retain a complete published pair' USING ERRCODE='CMS04';
        END IF;
        IF NOT was_unpublished THEN
          SELECT h.content AS header,f.content AS footer INTO src FROM public.global_element_versions h,public.global_element_versions f
            WHERE h.id=(before_item->>'published')::uuid AND f.id=(before_item->>'secondaryPublished')::uuid;
          IF src.header IS NULL OR src.footer IS NULL THEN RAISE EXCEPTION 'a retained frame version is missing' USING ERRCODE='CMS04'; END IF;
          PERFORM app.save_global_elements_draft(receipt.site_id,(current_item->>'revision')::bigint,(current_item->>'secondaryRevision')::bigint,src.header,src.footer);
        END IF;
      WHEN 'collection_schema' THEN
        IF NOT app.can_administer_site(receipt.site_id) THEN RAISE EXCEPTION 'a site admin must recover collection schema changes' USING ERRCODE='CMS02'; END IF;
        IF NOT was_unpublished THEN
          SELECT * INTO src FROM public.collection_schema_versions WHERE id=(before_item->>'published')::uuid;
          IF src.id IS NULL THEN RAISE EXCEPTION 'the retained collection schema is missing' USING ERRCODE='CMS04'; END IF;
          PERFORM app.save_collection_schema((before_item->>'id')::uuid,(current_item->>'revision')::bigint,src.fields,src.sort);
        END IF;
      WHEN 'collection_entries' THEN
        IF NOT was_unpublished THEN
          SELECT * INTO head FROM public.collections WHERE id=(before_item->>'id')::uuid;
          IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(capture.before_items) b WHERE b->>'type'='collection_schema' AND b->>'id'=before_item->>'id')
            AND (head.draft_schema_version_id IS DISTINCT FROM head.published_schema_version_id
              OR head.published_schema_version_id IS DISTINCT FROM (before_item->>'published')::uuid) THEN
            RAISE EXCEPTION 'The collection schema changed outside this release. Review that schema separately before recovering these records.' USING ERRCODE='CMS04';
          END IF;
          SELECT COALESCE(jsonb_agg(jsonb_build_object('id',e->'id','stableKey',e->'stableKey','values',v."values") ORDER BY (e->>'publishedSort')::int,e->>'id'),'[]')
            INTO entries FROM jsonb_array_elements(before_item->'entries') e JOIN public.collection_entry_versions v ON v.id=(e->>'published')::uuid
            WHERE e->>'published' IS NOT NULL AND e->>'publishedArchived' IS NULL;
          PERFORM app.save_collection_entries(head.id,head.entry_revision,entries);
        END IF;
    END CASE;
    EXCEPTION WHEN SQLSTATE 'CMS04' THEN
      RAISE EXCEPTION 'Recovery is blocked for “%”: %',COALESCE(current_item->>'label',before_item->>'label','an affected item'),SQLERRM
        USING ERRCODE='CMS04';
    END;
  END LOOP;
  -- Pin every new recovery version and create the only permitted release scope.
  current_items:=app.capture_release_recovery_items(receipt.site_id,capture.before_items);
  PERFORM app.pin_release_recovery_items(p_release,receipt.site_id,current_items);
  FOR current_item IN SELECT value FROM jsonb_array_elements(current_items) LOOP
    SELECT value INTO before_item FROM jsonb_array_elements(capture.before_items) WHERE value->>'key'=current_item->>'key';
    was_unpublished:=CASE WHEN before_item->>'type'='collection_entries' THEN before_item->>'publishedRevision'='0' ELSE before_item->>'published' IS NULL END;
    item:=jsonb_build_object('key',current_item->>'key','type',current_item->>'type','id',current_item->>'id','label',current_item->>'label',
      'revision',current_item->>'revision','versionId',current_item->'draft','action',CASE WHEN was_unpublished THEN 'unpublish' ELSE 'publish' END,'recoveryId',p_request);
    IF current_item->>'type'='frame' THEN item:=item||jsonb_build_object('secondaryRevision',current_item->>'secondaryRevision','secondaryVersionId',current_item->'secondaryDraft'); END IF;
    IF current_item->>'type' IN ('theme','collection_schema') THEN item:=item||'{"requiresAdmin":true}'::jsonb; END IF;
    items:=items||jsonb_build_array(item);
  END LOOP;
  UPDATE public.site_release_recoveries SET items=recovery_prepare.items,prepared_state=current_items,preserved_drafts=checkpoints WHERE id=p_request;
  PERFORM app.write_audit(receipt.site_id,'user',actor,'release.recovery.prepare','site_release',p_release,NULL,NULL,
    jsonb_build_object('recovery_id',p_request,'affected_items',jsonb_array_length(items),'preserved_drafts',jsonb_array_length(checkpoints)));
  RETURN jsonb_build_object('recoveryId',p_request,'siteId',receipt.site_id,'sourceReleaseId',p_release,'items',items,'preservedDrafts',checkpoints);
END $$;

CREATE FUNCTION app.pin_release_recovery_items(p_release uuid,p_site uuid,p_items jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE item jsonb; entry jsonb; pin uuid; kind text;
BEGIN
  FOR item IN SELECT value FROM jsonb_array_elements(p_items) LOOP
    kind:=item->>'type';
    IF kind='page' THEN
      FOR pin IN SELECT DISTINCT value::uuid FROM jsonb_array_elements_text(jsonb_build_array(item->'draft',item->'published')) WHERE value IS NOT NULL LOOP
        INSERT INTO public.site_release_pages(release_id,site_id,page_id,version_id) VALUES(p_release,p_site,(item->>'id')::uuid,pin) ON CONFLICT DO NOTHING;
      END LOOP;
      CONTINUE;
    END IF;
    FOR pin IN SELECT DISTINCT value::uuid FROM jsonb_array_elements_text(jsonb_build_array(item->'draft',item->'published',item->'secondaryDraft',item->'secondaryPublished')) WHERE value IS NOT NULL LOOP
      INSERT INTO public.site_release_version_pins(release_id,site_id,kind,version_id,theme_version_id,navigation_version_id,frame_version_id,schema_version_id)
      VALUES(p_release,p_site,CASE WHEN kind='collection_entries' THEN 'collection_schema' ELSE kind END,pin,
        CASE WHEN kind='theme' THEN pin END,CASE WHEN kind='navigation' THEN pin END,CASE WHEN kind='frame' THEN pin END,
        CASE WHEN kind IN ('collection_schema','collection_entries') THEN pin END) ON CONFLICT DO NOTHING;
    END LOOP;
    IF kind='collection_entries' THEN
      FOR entry IN SELECT value FROM jsonb_array_elements(item->'entries') LOOP
        FOR pin IN SELECT DISTINCT value::uuid FROM jsonb_array_elements_text(jsonb_build_array(entry->'draft',entry->'published')) WHERE value IS NOT NULL LOOP
          INSERT INTO public.site_release_version_pins(release_id,site_id,kind,version_id,entry_version_id) VALUES(p_release,p_site,kind,pin,pin) ON CONFLICT DO NOTHING;
        END LOOP;
      END LOOP;
    END IF;
  END LOOP;
END $$;

CREATE FUNCTION app.check_release_recovery_selection(p_site uuid,p_items jsonb) RETURNS uuid
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE recovery public.site_release_recoveries; current_items jsonb; item jsonb; current_item jsonb; recovery_id uuid;
BEGIN
  PERFORM app.require_actor();
  IF NOT app.can_publish(p_site) THEN RAISE EXCEPTION 'only an editor may release this site' USING ERRCODE='CMS02'; END IF;
  recovery_id:=(p_items->0->>'recoveryId')::uuid;
  SELECT * INTO recovery FROM public.site_release_recoveries WHERE id=recovery_id AND site_id=p_site;
  IF recovery.id IS NULL OR recovery.items IS DISTINCT FROM p_items THEN
    RAISE EXCEPTION 'recovery choices must match the exact server-prepared scope' USING ERRCODE='CMS04';
  END IF;
  IF recovery.applied_release_id IS NOT NULL THEN RAISE EXCEPTION 'this recovery already has an applied release' USING ERRCODE='CMS04'; END IF;
  current_items:=app.capture_release_recovery_items(p_site,p_items);
  FOR item IN SELECT value FROM jsonb_array_elements(p_items) LOOP
    SELECT value INTO current_item FROM jsonb_array_elements(current_items) WHERE value->>'key'=item->>'key';
    IF current_item->>'revision' IS DISTINCT FROM item->>'revision' OR current_item->>'draft' IS DISTINCT FROM item->>'versionId'
      OR current_item->>'secondaryRevision' IS DISTINCT FROM item->>'secondaryRevision'
      OR current_item->>'secondaryDraft' IS DISTINCT FROM item->>'secondaryVersionId' THEN
      RAISE EXCEPTION 'a recovery draft changed; review and prepare recovery again' USING ERRCODE='CMS01';
    END IF;
  END LOOP;
  RETURN recovery_id;
END $$;

CREATE FUNCTION app.read_prepared_site_release_recovery(p_source uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE site uuid; recovery public.site_release_recoveries; plan uuid;
BEGIN
  PERFORM app.require_actor();
  SELECT site_id INTO site FROM public.site_releases WHERE id=p_source;
  IF site IS NULL THEN RAISE EXCEPTION 'release not found' USING ERRCODE='CMS03'; END IF;
  IF NOT app.can_publish(site) THEN RAISE EXCEPTION 'only an editor may read recovery preparations' USING ERRCODE='CMS02'; END IF;
  SELECT * INTO recovery FROM public.site_release_recoveries WHERE source_release_id=p_source AND applied_release_id IS NULL ORDER BY prepared_at DESC,id DESC LIMIT 1;
  IF recovery.id IS NULL THEN RETURN NULL; END IF;
  SELECT id INTO plan FROM public.site_releases WHERE site_id=site AND status='planned' AND snapshot->0->>'recoveryId'=recovery.id::text ORDER BY created_at DESC,id DESC LIMIT 1;
  RETURN jsonb_build_object('recoveryId',recovery.id,'siteId',recovery.site_id,'sourceReleaseId',recovery.source_release_id,
    'items',recovery.items,'preservedDrafts',recovery.preserved_drafts,'plannedReleaseId',plan);
END $$;

CREATE FUNCTION app.review_site_release_recovery(p_release uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE receipt public.site_releases; capture public.site_release_recovery_captures; before_item jsonb; current_item jsonb;
  current_items jsonb; items jsonb:='[]'; current_private boolean;
BEGIN
  PERFORM app.require_actor();
  SELECT * INTO receipt FROM public.site_releases WHERE id=p_release;
  IF receipt.id IS NULL THEN RAISE EXCEPTION 'release not found' USING ERRCODE='CMS03'; END IF;
  IF NOT app.can_publish(receipt.site_id) THEN RAISE EXCEPTION 'only an editor may review recovery' USING ERRCODE='CMS02'; END IF;
  SELECT * INTO capture FROM public.site_release_recovery_captures WHERE release_id=p_release;
  IF receipt.status<>'applied' OR capture.after_items IS NULL THEN
    RETURN jsonb_build_object('releaseId',p_release,'siteId',receipt.site_id,'available',false,
      'reason','This release does not retain a complete pre-publication recovery receipt. Its ordinary content history remains available.');
  END IF;
  current_items:=app.capture_release_recovery_items(receipt.site_id,capture.before_items);
  SELECT initial_release_required INTO current_private FROM public.sites WHERE id=receipt.site_id;
  FOR before_item IN SELECT value FROM jsonb_array_elements(capture.before_items) LOOP
    SELECT value INTO current_item FROM jsonb_array_elements(current_items) WHERE value->>'key'=before_item->>'key';
    items:=items||jsonb_build_array(jsonb_build_object('key',before_item->>'key','type',before_item->>'type','id',before_item->>'id','label',current_item->>'label',
      'wasUnpublished',CASE WHEN before_item->>'type'='collection_entries' THEN before_item->>'publishedRevision'='0' ELSE before_item->>'published' IS NULL END,
      'beforeVersionId',before_item->'published','beforeSecondaryVersionId',before_item->'secondaryPublished',
      'currentRevision',current_item->'revision','currentDraftVersionId',current_item->'draft','publishedVersionId',current_item->'published',
      'laterDraft',CASE WHEN before_item->>'type'='collection_entries' THEN current_item->>'revision' IS DISTINCT FROM current_item->>'publishedRevision'
        ELSE current_item->'draft' IS DISTINCT FROM current_item->'published' OR current_item->'secondaryDraft' IS DISTINCT FROM current_item->'secondaryPublished' END));
  END LOOP;
  RETURN jsonb_build_object('releaseId',p_release,'siteId',receipt.site_id,'available',true,'wasPrivate',capture.was_private,'items',items,
    'expectedState',jsonb_build_object('items',current_items,'initialPrivate',current_private));
END $$;

ALTER FUNCTION app.record_site_release(uuid,uuid,jsonb,text,text,jsonb) RENAME TO record_site_release_before_recovery;
CREATE FUNCTION app.record_site_release(p_id uuid,p_site_id uuid,p_snapshot jsonb,p_context_hash text,p_after_hash text,p_report jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE targets jsonb:=p_snapshot; before_items jsonb; recorded uuid; nav uuid;
BEGIN
  PERFORM app.lock_release_site(p_site_id);
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_snapshot) i WHERE i ? 'recoveryId' OR i ? 'action') THEN
    PERFORM app.check_release_recovery_selection(p_site_id,p_snapshot);
  END IF;
  recorded:=app.record_site_release_before_recovery(p_id,p_site_id,p_snapshot,p_context_hash,p_after_hash,p_report);
  IF EXISTS(SELECT 1 FROM public.site_release_recovery_captures WHERE release_id=recorded) THEN RETURN recorded; END IF;
  IF app.release_fingerprint(p_site_id) IS DISTINCT FROM p_context_hash THEN RAISE EXCEPTION 'the site changed before its release receipt was captured' USING ERRCODE='CMS01'; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(targets) i WHERE i->>'type'='page')
    AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(targets) i WHERE i->>'type'='navigation') THEN
    SELECT id INTO nav FROM public.navigations WHERE site_id=p_site_id;
    IF nav IS NOT NULL THEN targets:=targets||jsonb_build_array(jsonb_build_object('key','navigation:'||nav::text,'type','navigation','id',nav,'implicit',true)); END IF;
  END IF;
  before_items:=app.capture_release_recovery_items(p_site_id,targets);
  INSERT INTO public.site_release_recovery_captures(release_id,site_id,before_items,was_private)
    SELECT recorded,p_site_id,before_items,initial_release_required FROM public.sites WHERE id=p_site_id;
  PERFORM app.pin_release_recovery_items(recorded,p_site_id,before_items);
  RETURN recorded;
END $$;

CREATE FUNCTION app.recovery_application_must_finish() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
  IF EXISTS(SELECT 1 FROM public.site_release_recoveries WHERE id=NEW.id AND applying AND applied_release_id IS NULL) THEN
    RAISE EXCEPTION 'recovery publication must finish its complete reviewed release in the same transaction' USING ERRCODE='CMS04';
  END IF;
  RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER recovery_application_complete AFTER INSERT OR UPDATE ON public.site_release_recoveries
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION app.recovery_application_must_finish();

-- The preview and real execution invoke this same command. The deferred guard
-- prevents a caller committing only these unpublishes outside a full receipt.
CREATE FUNCTION app.apply_release_recovery_unpublishes(p_recovery uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE recovery public.site_release_recoveries; capture public.site_release_recovery_captures; actor uuid; item jsonb; target uuid; rev bigint;
BEGIN
  actor:=app.require_actor();
  SELECT * INTO recovery FROM public.site_release_recoveries WHERE id=p_recovery FOR UPDATE;
  IF recovery.id IS NULL THEN RAISE EXCEPTION 'recovery not found' USING ERRCODE='CMS03'; END IF;
  PERFORM app.lock_release_site(recovery.site_id);
  PERFORM app.check_release_recovery_selection(recovery.site_id,recovery.items);
  SELECT * INTO capture FROM public.site_release_recovery_captures WHERE release_id=recovery.source_release_id;
  IF capture.was_private AND EXISTS(SELECT 1 FROM public.published_routes r WHERE r.site_id=recovery.site_id
      AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(recovery.items) i WHERE i->>'type'='page' AND i->>'action'='unpublish' AND i->>'id'=r.page_id::text)) THEN
    RAISE EXCEPTION 'Later, unrelated published pages must be reviewed and unpublished before this first release can return to private.' USING ERRCODE='CMS04';
  END IF;
  UPDATE public.site_release_recoveries SET applying=true WHERE id=p_recovery;
  -- A coordinated old-schema/old-record restoration may remove a field present
  -- in the current live records. Stage those record pointers out of the way
  -- before the ordinary schema publisher validates them; its paired ordinary
  -- records publisher installs the reviewed batch immediately afterwards.
  -- No revisions are rewound or consumed for this transaction-local staging.
  -- The deferred guard forbids committing it without the complete receipt.
  UPDATE public.collection_entries e SET published_version_id=NULL
    WHERE e.site_id=recovery.site_id AND EXISTS(SELECT 1 FROM jsonb_array_elements(recovery.items) schema_item
      JOIN LATERAL jsonb_array_elements(recovery.items) record_item ON record_item->>'id'=schema_item->>'id'
      WHERE schema_item->>'type'='collection_schema' AND schema_item->>'action'='publish'
        AND record_item->>'type'='collection_entries' AND record_item->>'action'='publish'
        AND schema_item->>'id'=e.collection_id::text);
  FOR item IN SELECT value FROM jsonb_array_elements(recovery.items) WHERE value->>'action'='unpublish'
    ORDER BY CASE value->>'type' WHEN 'page' THEN 0 WHEN 'collection_entries' THEN 1 ELSE 2 END,value->>'key'
  LOOP
    target:=(item->>'id')::uuid;
    CASE item->>'type'
      WHEN 'page' THEN PERFORM app.unpublish_page(target,(item->>'revision')::bigint);
      WHEN 'theme' THEN
        IF NOT app.can_administer_site(recovery.site_id) THEN RAISE EXCEPTION 'a site admin must unpublish this theme' USING ERRCODE='CMS02'; END IF;
        UPDATE public.themes SET published_version_id=NULL,revision=revision+1 WHERE id=target AND site_id=recovery.site_id;
      WHEN 'navigation' THEN
        UPDATE public.navigations SET published_version_id=NULL,revision=revision+1 WHERE id=target AND site_id=recovery.site_id;
      WHEN 'frame' THEN
        UPDATE public.global_elements SET published_version_id=NULL,revision=revision+1 WHERE site_id=recovery.site_id;
      WHEN 'collection_entries' THEN
        UPDATE public.collection_entries SET published_version_id=NULL,published_archived_at=NULL,published_sort_index=0,revision=revision+1
          WHERE collection_id=target AND site_id=recovery.site_id;
        UPDATE public.collections SET entry_revision=entry_revision+1,published_entry_revision=0 WHERE id=target AND site_id=recovery.site_id;
      WHEN 'collection_schema' THEN
        IF NOT app.can_administer_site(recovery.site_id) THEN RAISE EXCEPTION 'a site admin must unpublish this collection schema' USING ERRCODE='CMS02'; END IF;
        UPDATE public.collections SET published_schema_version_id=NULL,revision=revision+1 WHERE id=target AND site_id=recovery.site_id;
      ELSE RAISE EXCEPTION 'unsupported recovery action' USING ERRCODE='CMS04';
    END CASE;
    IF item->>'type'<>'page' THEN
      PERFORM app.write_audit(recovery.site_id,'user',actor,'release.recovery.unpublish','site_release',recovery.source_release_id,NULL,NULL,
        jsonb_build_object('recovery_id',p_recovery,'key',item->>'key'));
      PERFORM app.emit_outbox(recovery.site_id,'site.recovery.changed',jsonb_build_object('recovery_id',p_recovery,'key',item->>'key'));
    END IF;
  END LOOP;
  IF capture.was_private THEN
    IF EXISTS(SELECT 1 FROM public.published_routes WHERE site_id=recovery.site_id) THEN RAISE EXCEPTION 'recovery would hide unrelated published pages' USING ERRCODE='CMS04'; END IF;
    UPDATE public.sites SET initial_release_required=true WHERE id=recovery.site_id;
  END IF;
  PERFORM app.rebuild_site_shell(recovery.site_id);
END $$;

ALTER FUNCTION app.finish_site_release(uuid,boolean,jsonb) RENAME TO finish_site_release_before_recovery;
CREATE FUNCTION app.release_recovery_payload(p_item jsonb,p_draft boolean) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE version_key text:=CASE WHEN p_draft THEN 'draft' ELSE 'published' END; version uuid; result jsonb;
BEGIN
  version:=(p_item->>version_key)::uuid;
  CASE p_item->>'type'
    WHEN 'page' THEN RETURN p_item->version_key;
    WHEN 'collection_schema' THEN RETURN p_item->version_key;
    WHEN 'theme' THEN SELECT tokens INTO result FROM public.theme_versions WHERE id=version;
    WHEN 'navigation' THEN SELECT jsonb_build_object('tree',tree,'mode',p_item->>'mode') INTO result FROM public.navigation_versions WHERE id=version;
    WHEN 'frame' THEN SELECT jsonb_build_object('header',h.content,'footer',f.content) INTO result
      FROM public.global_element_versions h,public.global_element_versions f
      WHERE h.id=version AND f.id=(p_item->>CASE WHEN p_draft THEN 'secondaryDraft' ELSE 'secondaryPublished' END)::uuid;
    WHEN 'collection_entries' THEN
      SELECT COALESCE(jsonb_agg(jsonb_build_object('id',e->'id','version',e->version_key,
        'sort',e->CASE WHEN p_draft THEN 'sort' ELSE 'publishedSort' END,
        'archived',e->CASE WHEN p_draft THEN 'archived' ELSE 'publishedArchived' END) ORDER BY e->>'id'),'[]')
        INTO result FROM jsonb_array_elements(p_item->'entries') e WHERE e->>version_key IS NOT NULL;
  END CASE;
  RETURN result;
END $$;
CREATE FUNCTION app.finish_site_release(p_id uuid,p_cancel boolean,p_detail jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
<<recovery_finish>>
DECLARE receipt public.site_releases; capture public.site_release_recovery_captures; after_items jsonb; kept_before jsonb; recovery_id uuid;
  recovery public.site_release_recoveries; item jsonb; current_item jsonb; prepared_item jsonb; current_items jsonb;
BEGIN
  PERFORM app.finish_site_release_before_recovery(p_id,p_cancel,p_detail);
  IF p_cancel THEN RETURN; END IF;
  SELECT * INTO receipt FROM public.site_releases WHERE id=p_id;
  SELECT * INTO capture FROM public.site_release_recovery_captures WHERE release_id=p_id;
  IF capture.release_id IS NOT NULL THEN
    after_items:=app.capture_release_recovery_items(receipt.site_id,capture.before_items);
    -- A page release captures potential auto-navigation changes up front, but
    -- the recovery scope retains it only when its published pointer changed.
    SELECT COALESCE(jsonb_agg(b ORDER BY b->>'key'),'[]') INTO kept_before FROM jsonb_array_elements(capture.before_items) b
      WHERE (b->>'implicit')::boolean IS NOT TRUE OR EXISTS(SELECT 1 FROM jsonb_array_elements(after_items) a
        WHERE a->>'key'=b->>'key' AND a->'published' IS DISTINCT FROM b->'published');
    SELECT COALESCE(jsonb_agg(a ORDER BY a->>'key'),'[]') INTO after_items FROM jsonb_array_elements(after_items) a
      WHERE EXISTS(SELECT 1 FROM jsonb_array_elements(kept_before) b WHERE b->>'key'=a->>'key');
    UPDATE public.site_release_recovery_captures SET before_items=kept_before,after_items=recovery_finish.after_items WHERE release_id=p_id;
    PERFORM app.pin_release_recovery_items(p_id,receipt.site_id,after_items);
  END IF;
  recovery_id:=(receipt.snapshot->0->>'recoveryId')::uuid;
  IF recovery_id IS NOT NULL THEN
    SELECT * INTO recovery FROM public.site_release_recoveries WHERE id=recovery_id;
    current_items:=app.capture_release_recovery_items(receipt.site_id,recovery.items);
    FOR item IN SELECT value FROM jsonb_array_elements(recovery.items) LOOP
      SELECT value INTO current_item FROM jsonb_array_elements(current_items) WHERE value->>'key'=item->>'key';
      SELECT value INTO prepared_item FROM jsonb_array_elements(recovery.prepared_state) WHERE value->>'key'=item->>'key';
      IF item->>'action'='unpublish' THEN
        IF (item->>'type'='collection_entries' AND EXISTS(SELECT 1 FROM jsonb_array_elements(current_item->'entries') e WHERE e->>'published' IS NOT NULL))
          OR (item->>'type'<>'collection_entries' AND (current_item->>'published' IS NOT NULL OR current_item->>'secondaryPublished' IS NOT NULL)) THEN
          RAISE EXCEPTION 'the release did not apply every reviewed recovery unpublish intention' USING ERRCODE='CMS04';
        END IF;
      ELSIF prepared_item IS NULL OR app.release_recovery_payload(current_item,false) IS DISTINCT FROM app.release_recovery_payload(prepared_item,true) THEN
        RAISE EXCEPTION 'the release did not publish the exact prepared recovery content' USING ERRCODE='CMS04';
      END IF;
    END LOOP;
    UPDATE public.site_release_recoveries SET applied_release_id=p_id WHERE id=recovery_id AND site_id=receipt.site_id AND items=receipt.snapshot AND applying;
    IF NOT FOUND THEN RAISE EXCEPTION 'this release did not apply its exact recovery intention' USING ERRCODE='CMS04'; END IF;
  END IF;
END $$;

REVOKE ALL ON FUNCTION app.record_site_release_before_recovery(uuid,uuid,jsonb,text,text,jsonb),app.finish_site_release_before_recovery(uuid,boolean,jsonb)
  FROM PUBLIC,cms_authenticated_user,cms_public_renderer,cms_worker;
REVOKE ALL ON FUNCTION app.capture_release_recovery_items(uuid,jsonb),app.pin_release_recovery_items(uuid,uuid,jsonb),app.recovery_application_must_finish(),app.release_recovery_payload(jsonb,boolean)
  FROM PUBLIC,cms_authenticated_user,cms_public_renderer,cms_worker;
REVOKE ALL ON FUNCTION app.check_release_recovery_selection(uuid,jsonb),app.review_site_release_recovery(uuid),app.prepare_site_release_recovery(uuid,uuid,jsonb),app.read_prepared_site_release_recovery(uuid),
  app.apply_release_recovery_unpublishes(uuid),app.record_site_release(uuid,uuid,jsonb,text,text,jsonb),app.finish_site_release(uuid,boolean,jsonb) FROM PUBLIC;
ALTER FUNCTION app.capture_release_recovery_items(uuid,jsonb) OWNER TO cms_migration_owner;
ALTER FUNCTION app.pin_release_recovery_items(uuid,uuid,jsonb) OWNER TO cms_migration_owner;
ALTER FUNCTION app.check_release_recovery_selection(uuid,jsonb) OWNER TO cms_migration_owner;
ALTER FUNCTION app.review_site_release_recovery(uuid) OWNER TO cms_migration_owner;
ALTER FUNCTION app.prepare_site_release_recovery(uuid,uuid,jsonb) OWNER TO cms_migration_owner;
ALTER FUNCTION app.read_prepared_site_release_recovery(uuid) OWNER TO cms_migration_owner;
ALTER FUNCTION app.recovery_application_must_finish() OWNER TO cms_migration_owner;
ALTER FUNCTION app.release_recovery_payload(jsonb,boolean) OWNER TO cms_migration_owner;
ALTER FUNCTION app.apply_release_recovery_unpublishes(uuid) OWNER TO cms_migration_owner;
ALTER FUNCTION app.record_site_release(uuid,uuid,jsonb,text,text,jsonb) OWNER TO cms_migration_owner;
ALTER FUNCTION app.finish_site_release(uuid,boolean,jsonb) OWNER TO cms_migration_owner;
GRANT EXECUTE ON FUNCTION app.check_release_recovery_selection(uuid,jsonb),app.review_site_release_recovery(uuid),app.prepare_site_release_recovery(uuid,uuid,jsonb),app.read_prepared_site_release_recovery(uuid),
  app.apply_release_recovery_unpublishes(uuid),app.record_site_release(uuid,uuid,jsonb,text,text,jsonb),app.finish_site_release(uuid,boolean,jsonb) TO cms_authenticated_user;
