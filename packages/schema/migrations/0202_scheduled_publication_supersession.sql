-- Never let a pinned timer silently roll back a newer manual publication.
-- The existing worker records this permanent refusal on the visible schedule.
CREATE OR REPLACE FUNCTION app.publish_page_version(
  p_page_id uuid, p_expected_revision bigint, p_version_id uuid,
  p_actor_type actor_type, p_authorizing_user uuid,
  p_readiness_policy_version int, p_override_reason text, p_readiness jsonb, p_detail jsonb
) RETURNS TABLE (published_version_id uuid, revision bigint, path text, shell_revision bigint)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
#variable_conflict use_column
DECLARE
  head RECORD; src RECORD; site RECORD;
  next_rev bigint; manifest jsonb; shell_rev bigint; page_path text; waived text[];
BEGIN
  IF p_authorizing_user IS NULL THEN
    RAISE EXCEPTION 'a publication must name the user who authorized it' USING ERRCODE = 'CMS02';
  END IF;

  SELECT p.id, p.site_id, p.revision, p.slug, p.draft_version_id, p.published_version_id, p.archived_at
    INTO head FROM public.pages p WHERE p.id = p_page_id FOR UPDATE;
  IF head IS NULL THEN RAISE EXCEPTION 'no such page' USING ERRCODE = 'CMS03'; END IF;

  IF NOT app.can_publish_page_as(p_authorizing_user, head.id) THEN
    RAISE EXCEPTION 'not permitted to publish on this site' USING ERRCODE = 'CMS02';
  END IF;
  IF head.archived_at IS NOT NULL THEN
    RAISE EXCEPTION 'page is archived' USING ERRCODE = 'CMS04';
  END IF;

  SELECT s.id, s.status INTO site FROM public.sites s WHERE s.id = head.site_id;
  IF site.status = 'archived' THEN
    RAISE EXCEPTION 'site is archived' USING ERRCODE = 'CMS04';
  END IF;

  -- After authorization, before any write: an unauthorized caller learns
  -- nothing about the page's readiness, and a refused publication leaves no
  -- trace of a half-applied one.
  waived := app.assert_publishable(p_readiness, p_readiness_policy_version, p_override_reason);

  -- NULL means the caller pinned a version instead of a revision. The row is
  -- already locked above, so serialization does not depend on this comparison.
  IF p_expected_revision IS NOT NULL AND head.revision <> p_expected_revision THEN
    RAISE EXCEPTION 'stale revision: expected %, head is at %', p_expected_revision, head.revision
      USING ERRCODE = 'CMS01', DETAIL = head.revision::text;
  END IF;

  IF p_version_id IS NULL THEN
    RAISE EXCEPTION 'page has no draft to publish' USING ERRCODE = 'CMS04';
  END IF;

  SELECT pv.id, pv.revision, pv.carries_trusted_code, pv.trusted_code_approved_by
    INTO src FROM public.page_versions pv
   WHERE pv.id = p_version_id AND pv.page_id = p_page_id;
  IF src IS NULL THEN
    RAISE EXCEPTION 'version % does not belong to page %', p_version_id, p_page_id
      USING ERRCODE = 'CMS03';
  END IF;

  IF src.carries_trusted_code AND src.trusted_code_approved_by IS NULL THEN
    RAISE EXCEPTION 'version carries raw markup and needs super-admin approval'
      USING ERRCODE = 'CMS05';
  END IF;

  -- The page row is already locked, so a concurrent manual publication either
  -- finishes before this comparison or waits until this publication commits.
  -- Later private drafts do not cancel the pinned intention; a newer *live*
  -- version does. Deliberate editor restores still create ordinary new drafts.
  IF p_actor_type = 'scheduler' AND EXISTS (
    SELECT 1 FROM public.page_versions live
     WHERE live.id = head.published_version_id
       AND live.page_id = head.id AND live.revision > src.revision
  ) THEN
    RAISE EXCEPTION 'A newer version is already live. This schedule was skipped; review the page before scheduling again.'
      USING ERRCODE = 'CMS04';
  END IF;

  manifest := app.build_render_manifest_internal(src.id);
  page_path := manifest->'page'->>'path';
  next_rev := head.revision + 1;

  UPDATE public.pages
     SET published_version_id = src.id, revision = next_rev, status = 'published'
   WHERE id = p_page_id;
  shell_rev := app.ensure_site_shell(head.site_id);

  INSERT INTO public.published_routes
    (site_id, path, page_id, page_version_id, shell_revision, render_manifest, updated_at)
  VALUES (head.site_id, page_path, p_page_id, src.id, shell_rev, manifest, now())
  ON CONFLICT (site_id, path) DO UPDATE
    SET page_id = EXCLUDED.page_id, page_version_id = EXCLUDED.page_version_id,
        shell_revision = EXCLUDED.shell_revision, render_manifest = EXCLUDED.render_manifest,
        updated_at = now();

  PERFORM app.write_audit(
    head.site_id, p_actor_type,
    CASE WHEN p_actor_type = 'user' THEN p_authorizing_user ELSE NULL END,
    'page.publish', 'page', p_page_id, head.published_version_id, src.id,
    COALESCE(p_detail, '{}'::jsonb) || jsonb_build_object(
      'revision', next_rev, 'path', page_path, 'version_id', src.id,
      'authorized_by', p_authorizing_user,
      'readiness_policy_version', p_readiness_policy_version,
      'override_reason', p_override_reason,
      -- Named separately from the full report so "what did this override let
      -- through" is answerable without re-deriving it.
      'overridden_blocking', to_jsonb(waived),
      'readiness', p_readiness));

  PERFORM app.emit_outbox(head.site_id, 'page.published',
                          jsonb_build_object('page_id', p_page_id, 'path', page_path,
                                             'revision', next_rev, 'shell_revision', shell_rev));

  RETURN QUERY SELECT src.id, next_rev, page_path, shell_rev;
END
$$;

-- Creation and explicit retries also refuse an intention already superseded.
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
  SELECT id,revision,carries_trusted_code,trusted_code_approved_by INTO version_row FROM public.page_versions WHERE id=p_version_id AND page_id=p_page_id;
  IF version_row IS NULL THEN RAISE EXCEPTION 'that version does not belong to this page' USING ERRCODE='CMS03'; END IF;
  IF p_action='publish' THEN
    IF EXISTS (SELECT 1 FROM public.page_versions live WHERE live.id=head.published_version_id
      AND live.page_id=head.id AND live.revision>version_row.revision) THEN
      RAISE EXCEPTION 'A newer version is already live. Review the page and schedule its current version.' USING ERRCODE='CMS04';
    END IF;
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

