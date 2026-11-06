-- Correct nullable-record retry checks. A row IS NOT NULL tests every field;
-- these receipts intentionally contain null optional fields. Test the primary key.


CREATE OR REPLACE FUNCTION app.begin_site_setup(
  p_request_id uuid,p_fingerprint text,p_slug text,p_name text,p_kind site_kind,p_host text,p_theme jsonb
) RETURNS TABLE(site_id uuid,created boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE actor uuid; existing RECORD; target uuid; defect text;
BEGIN
  actor:=app.require_actor();
  IF NOT app.is_super_admin() THEN RAISE EXCEPTION 'only a super admin may create sites' USING ERRCODE='CMS02'; END IF;
  IF p_request_id IS NULL OR COALESCE(p_fingerprint,'') !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'site creation needs a valid request reference' USING ERRCODE='CMS04';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_request_id::text,54));
  SELECT * INTO existing FROM public.sites WHERE creation_request_id=p_request_id;
  IF existing.id IS NOT NULL THEN
    IF existing.created_by IS DISTINCT FROM actor OR existing.creation_fingerprint IS DISTINCT FROM p_fingerprint THEN
      RAISE EXCEPTION 'this creation request was already used for different settings' USING ERRCODE='CMS04';
    END IF;
    RETURN QUERY SELECT existing.id,false; RETURN;
  END IF;
  IF char_length(COALESCE(p_slug,'')) NOT BETWEEN 1 AND 40 OR p_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$'
    OR char_length(btrim(COALESCE(p_name,''))) NOT BETWEEN 1 AND 120
    OR COALESCE(p_kind::text,'') NOT IN ('resource','event')
    OR char_length(COALESCE(p_host,'')) NOT BETWEEN 1 AND 253
    OR p_host !~ '^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$' OR p_host<>lower(p_host) THEN
    RAISE EXCEPTION 'the site name, address or starter type is invalid' USING ERRCODE='CMS04';
  END IF;
  IF EXISTS(SELECT 1 FROM regexp_split_to_table(p_host,'\.') label
    WHERE label !~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$') THEN
    RAISE EXCEPTION 'the staging hostname is invalid' USING ERRCODE='CMS04';
  END IF;
  defect:=app.theme_tokens_defect(p_theme);
  IF defect IS NOT NULL THEN RAISE EXCEPTION '%',defect USING ERRCODE='CMS04'; END IF;
  target:=app.create_site(p_slug,btrim(p_name),p_kind,p_host,p_theme,'[]');
  UPDATE public.sites SET creation_request_id=p_request_id,creation_fingerprint=p_fingerprint WHERE id=target;
  RETURN QUERY SELECT target,true;
END $$;

CREATE OR REPLACE FUNCTION app.schedule_page_action(
  p_page_id uuid,p_expected_revision bigint,p_version_id uuid,p_action scheduled_action_kind,p_run_at timestamptz,
  p_policy int,p_readiness jsonb,p_override text,p_request_id uuid
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE actor uuid; head RECORD; version_row RECORD; existing RECORD; created uuid;
BEGIN
  actor:=app.require_actor();
  SELECT * INTO head FROM public.pages WHERE id=p_page_id FOR UPDATE;
  IF head IS NULL THEN RAISE EXCEPTION 'page not found' USING ERRCODE='CMS03'; END IF;
  IF NOT app.can_publish(head.site_id) THEN RAISE EXCEPTION 'only an editor may schedule this page' USING ERRCODE='CMS02'; END IF;
  IF head.archived_at IS NOT NULL OR EXISTS(SELECT 1 FROM public.sites WHERE id=head.site_id AND status='archived') THEN
    RAISE EXCEPTION 'archived content cannot be scheduled' USING ERRCODE='CMS04';
  END IF;
  IF p_request_id IS NULL THEN RAISE EXCEPTION 'a schedule needs a request reference' USING ERRCODE='CMS04'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_request_id::text,56));
  SELECT * INTO existing FROM public.scheduled_actions WHERE request_id=p_request_id;
  IF existing.id IS NOT NULL THEN
    IF existing.created_by<>actor OR existing.item_id<>p_page_id OR existing.version_id<>p_version_id
       OR existing.action IS DISTINCT FROM p_action OR existing.run_at IS DISTINCT FROM p_run_at
       OR existing.override_reason IS DISTINCT FROM NULLIF(btrim(p_override),'') THEN
      RAISE EXCEPTION 'this schedule request was already used for a different intention' USING ERRCODE='CMS04';
    END IF;
    RETURN existing.id;
  END IF;
  IF head.revision IS DISTINCT FROM p_expected_revision THEN RAISE EXCEPTION 'this page changed; reload before scheduling' USING ERRCODE='CMS01',DETAIL=head.revision::text; END IF;
  IF NOT app.scheduling_available() THEN RAISE EXCEPTION 'no healthy scheduling worker is available' USING ERRCODE='CMS04'; END IF;
  IF p_run_at IS NULL OR p_run_at<clock_timestamp()+interval '1 minute' OR p_run_at>clock_timestamp()+interval '2 years' THEN
    RAISE EXCEPTION 'choose a time at least a minute from now and within two years' USING ERRCODE='CMS04';
  END IF;
  SELECT id,carries_trusted_code,trusted_code_approved_by INTO version_row FROM public.page_versions WHERE id=p_version_id AND page_id=p_page_id;
  IF version_row IS NULL THEN RAISE EXCEPTION 'that version does not belong to this page' USING ERRCODE='CMS03'; END IF;
  IF p_action='publish' THEN
    PERFORM app.assert_publishable(p_readiness,p_policy,p_override);
    IF version_row.carries_trusted_code AND version_row.trusted_code_approved_by IS NULL THEN
      RAISE EXCEPTION 'approve this version’s custom code before scheduling it' USING ERRCODE='CMS05';
    END IF;
  ELSIF p_action='unpublish' THEN
    IF head.published_version_id IS DISTINCT FROM p_version_id THEN RAISE EXCEPTION 'choose the currently live version to unpublish' USING ERRCODE='CMS04'; END IF;
    IF NULLIF(btrim(p_override),'') IS NOT NULL THEN RAISE EXCEPTION 'unpublishing does not use a readiness override' USING ERRCODE='CMS04'; END IF;
  ELSE RAISE EXCEPTION 'choose publish or unpublish' USING ERRCODE='CMS04'; END IF;
  INSERT INTO public.scheduled_actions(site_id,item_type,item_id,version_id,action,run_at,created_by,
    readiness_policy_version,request_id,override_reason,authorized_findings)
  VALUES(head.site_id,'page',p_page_id,p_version_id,p_action,p_run_at,actor,p_policy,p_request_id,NULLIF(btrim(p_override),''),COALESCE(p_readiness,'[]'))
  RETURNING id INTO created;
  PERFORM app.write_audit(head.site_id,'user',actor,'schedule.create','scheduled_action',created,NULL,p_version_id,
    jsonb_build_object('page_id',p_page_id,'version_id',p_version_id,'action',p_action,'run_at',p_run_at,'override_reason',NULLIF(btrim(p_override),'')));
  RETURN created;
END $$;

CREATE OR REPLACE FUNCTION app.record_site_release(p_id uuid,p_site_id uuid,p_snapshot jsonb,p_context_hash text,p_after_hash text,p_report jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE actor uuid; old RECORD; item jsonb; page uuid; version uuid;
BEGIN
  actor:=app.require_actor();
  IF NOT app.can_publish(p_site_id) THEN RAISE EXCEPTION 'only an editor may plan a release' USING ERRCODE='CMS02'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_id::text,57));
  SELECT * INTO old FROM public.site_releases WHERE id=p_id FOR UPDATE;
  IF old.id IS NOT NULL THEN
    IF old.site_id<>p_site_id OR old.created_by<>actor OR old.snapshot<>p_snapshot OR old.context_hash<>p_context_hash OR old.after_hash<>p_after_hash THEN
      RAISE EXCEPTION 'this release request was used for a different plan' USING ERRCODE='CMS04';
    END IF;
    RETURN old.id;
  END IF;
  IF jsonb_typeof(p_snapshot) IS DISTINCT FROM 'array' OR jsonb_typeof(p_report) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'a release needs an item list and readiness reports' USING ERRCODE='CMS04';
  END IF;
  IF jsonb_array_length(p_snapshot) NOT BETWEEN 1 AND 200 THEN
    RAISE EXCEPTION 'select between 1 and 200 release items' USING ERRCODE='CMS04';
  END IF;
  INSERT INTO public.site_releases(id,site_id,snapshot,context_hash,after_hash,preview_report,created_by)
    VALUES(p_id,p_site_id,p_snapshot,p_context_hash,p_after_hash,p_report,actor);
  -- Keep both the before-publication pages and every selected draft reachable
  -- from history, including autosaves that would otherwise become prunable.
  INSERT INTO public.site_release_pages(release_id,site_id,page_id,version_id)
    SELECT p_id,p_site_id,id,published_version_id FROM public.pages
     WHERE site_id=p_site_id AND published_version_id IS NOT NULL ON CONFLICT DO NOTHING;
  FOR item IN SELECT value FROM jsonb_array_elements(p_snapshot) LOOP
    IF item->>'type'='page' THEN
      page:=(item->>'id')::uuid; version:=(item->>'versionId')::uuid;
      INSERT INTO public.site_release_pages(release_id,site_id,page_id,version_id)
        VALUES(p_id,p_site_id,page,version) ON CONFLICT DO NOTHING;
    END IF;
  END LOOP;
  PERFORM app.write_audit(p_site_id,'user',actor,'release.plan','site_release',p_id,NULL,NULL,
    jsonb_build_object('items',jsonb_array_length(p_snapshot),'context_hash',p_context_hash));
  RETURN p_id;
END $$;

CREATE OR REPLACE FUNCTION app.request_custom_section(p_id uuid,p_site_id uuid,p_title text,p_body text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE actor uuid; old RECORD; site_status text;
BEGIN
  actor:=app.require_actor();
  IF NOT app.has_site_access(p_site_id) THEN RAISE EXCEPTION 'site not available' USING ERRCODE='CMS02'; END IF;
  SELECT status::text INTO site_status FROM public.sites WHERE id=p_site_id FOR SHARE;
  IF site_status IS NULL OR site_status='archived' THEN RAISE EXCEPTION 'new requests are not available for an archived site' USING ERRCODE='CMS04'; END IF;
  p_title:=btrim(p_title); p_body:=btrim(p_body);
  IF p_id IS NULL OR p_title IS NULL OR length(p_title) NOT BETWEEN 1 AND 160 OR p_body IS NULL OR length(p_body) NOT BETWEEN 10 AND 5000 THEN
    RAISE EXCEPTION 'add a short title and describe the section in 10 to 5000 characters' USING ERRCODE='CMS04';
  END IF;
  -- Serialize an idempotency key without requiring access to a foreign row.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_id::text,60));
  SELECT * INTO old FROM public.section_requests WHERE id=p_id;
  IF old.id IS NOT NULL THEN
    IF old.site_id<>p_site_id OR old.requested_by<>actor OR old.title<>p_title OR old.body<>p_body THEN
      RAISE EXCEPTION 'this request reference was used for different content' USING ERRCODE='CMS04';
    END IF;
    RETURN old.id;
  END IF;
  INSERT INTO public.section_requests(id,site_id,title,body,requested_by) VALUES(p_id,p_site_id,p_title,p_body,actor);
  PERFORM app.write_audit(p_site_id,'user',actor,'section_request.create','section_request',p_id,NULL,NULL,jsonb_build_object('title',p_title));
  RETURN p_id;
END $$;

-- Release planning calls this pure path formatter under the application role.
GRANT EXECUTE ON FUNCTION app.page_path(text) TO cms_authenticated_user;
