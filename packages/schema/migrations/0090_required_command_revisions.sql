-- 0090 — a required compare-and-set revision cannot be SQL NULL.
--
-- PostgreSQL's `revision <> NULL` is unknown, so an IF using it silently skips
-- its conflict branch. An authenticated caller could omit the loaded revision
-- while overwriting drafts, publishing site settings, or changing media.
-- Real-role regressions reproduce each public command before this migration.
--
-- Re-emit the current bodies, changing only the mandatory revision comparisons
-- to IS DISTINCT FROM. Preserve all locks, authorization, versioning, audit,
-- review guards and grants. CREATE OR REPLACE retains each existing owner/ACL.
-- The collection publication cores were renamed by 0072; their wrappers still
-- enforce the review gate. Worker publication cores intentionally allow NULL
-- for pinned scheduled versions and are not changed. Historical page restore
-- and page publication already reject a missing revision and are not changed.

-- Current body: 0034_history_uses_trustworthy_version_kinds.sql.
CREATE OR REPLACE FUNCTION app.save_page_draft(
  p_page_id uuid, p_expected_revision bigint, p_content jsonb, p_meta jsonb,
  p_kind version_kind DEFAULT 'autosave', p_note text DEFAULT ''
) RETURNS TABLE (version_id uuid, revision bigint, carries_trusted_code boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE actor uuid; head RECORD; next_rev bigint; new_version uuid; trusted boolean;
BEGIN
  actor := app.require_actor();
  IF p_kind NOT IN ('autosave'::version_kind, 'checkpoint'::version_kind) THEN
    RAISE EXCEPTION 'save kind must be autosave or checkpoint' USING ERRCODE = 'CMS04';
  END IF;

  SELECT p.id, p.site_id, p.revision, p.archived_at INTO head
    FROM public.pages p WHERE p.id = p_page_id FOR UPDATE;
  IF head IS NULL THEN RAISE EXCEPTION 'no such page' USING ERRCODE = 'CMS03'; END IF;
  IF NOT app.has_site_access(head.site_id) THEN
    RAISE EXCEPTION 'not permitted to edit this page' USING ERRCODE = 'CMS02';
  END IF;
  IF head.archived_at IS NOT NULL THEN
    RAISE EXCEPTION 'page is archived' USING ERRCODE = 'CMS04';
  END IF;
  IF head.revision IS DISTINCT FROM p_expected_revision THEN
    RAISE EXCEPTION 'stale revision: expected %, head is at %', p_expected_revision, head.revision
      USING ERRCODE = 'CMS01', DETAIL = head.revision::text;
  END IF;

  trusted := app.content_carries_trusted_code(p_content);
  next_rev := head.revision + 1;
  INSERT INTO public.page_versions (site_id, page_id, revision, content, meta,
                                    carries_trusted_code, kind, note, author_id)
  VALUES (head.site_id, p_page_id, next_rev, p_content, COALESCE(p_meta, '{}'::jsonb),
          trusted, p_kind, COALESCE(p_note, ''), actor)
  RETURNING id INTO new_version;

  UPDATE public.pages SET revision = next_rev, draft_version_id = new_version WHERE id = p_page_id;
  PERFORM app.write_audit(head.site_id, 'user', actor, 'page.save_draft', 'page', p_page_id,
                          NULL, new_version,
                          jsonb_build_object('revision', next_rev, 'kind', p_kind,
                                             'carries_trusted_code', trusted));
  RETURN QUERY SELECT new_version, next_rev, trusted;
END
$$;

-- Current body: 0036_media_upload_lifecycle.sql.
CREATE OR REPLACE FUNCTION app.update_media_metadata(
  p_media_id uuid, p_expected_revision bigint, p_alt_text text,
  p_decorative boolean, p_focal jsonb, p_folder text, p_attribution text,
  p_source text, p_tags text[]
) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE actor uuid; row public.media%ROWTYPE; next_revision bigint; before_value jsonb;
BEGIN
  actor := app.require_actor();
  SELECT * INTO row FROM public.media m WHERE m.id = p_media_id FOR UPDATE;
  IF row.id IS NULL THEN RAISE EXCEPTION 'no such media' USING ERRCODE = 'CMS03'; END IF;
  IF (row.site_id IS NULL AND NOT app.is_super_admin())
     OR (row.site_id IS NOT NULL AND NOT app.has_site_access(row.site_id)) THEN
    RAISE EXCEPTION 'not permitted to edit this media' USING ERRCODE = 'CMS02';
  END IF;
  IF row.status <> 'ready' THEN
    RAISE EXCEPTION 'only ready media can be edited' USING ERRCODE = 'CMS04';
  END IF;
  IF row.revision IS DISTINCT FROM p_expected_revision THEN
    RAISE EXCEPTION 'stale revision: expected %, media is at %', p_expected_revision, row.revision
      USING ERRCODE = 'CMS01', DETAIL = row.revision::text;
  END IF;
  IF NOT app.media_authoring_metadata_is_valid(
      p_alt_text, p_decorative, p_focal, p_folder, p_attribution, p_source, p_tags) THEN
    RAISE EXCEPTION 'media metadata is invalid; supply alt text or mark the image decorative'
      USING ERRCODE = 'CMS04';
  END IF;

  before_value := jsonb_build_object(
    'alt_text', row.alt_text, 'decorative', row.decorative, 'focal', row.focal,
    'folder', row.folder, 'attribution', row.attribution,
    'source', row.source, 'tags', row.tags, 'revision', row.revision);
  next_revision := row.revision + 1;
  UPDATE public.media
     SET alt_text = p_alt_text, decorative = p_decorative, focal = p_focal,
         folder = p_folder, attribution = p_attribution, source = p_source,
         tags = p_tags, revision = next_revision
   WHERE id = row.id;

  PERFORM app.write_audit(
    row.site_id, 'user', actor, 'media.metadata.update', 'media', row.id,
    row.id, row.id,
    jsonb_build_object('before', before_value, 'after', jsonb_build_object(
      'alt_text', p_alt_text, 'decorative', p_decorative, 'focal', p_focal,
      'folder', p_folder, 'attribution', p_attribution,
      'source', p_source, 'tags', p_tags, 'revision', next_revision)));
  RETURN next_revision;
END
$$;

-- Current body: 0036_media_upload_lifecycle.sql.
CREATE OR REPLACE FUNCTION app.soft_delete_media(
  p_media_id uuid, p_expected_revision bigint,
  p_break_references boolean, p_reason text
) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  actor uuid; row public.media%ROWTYPE; usage_count bigint;
  next_revision bigint; deleted timestamptz; retention_until timestamptz; event_id bigint;
BEGIN
  actor := app.require_actor();
  SELECT * INTO row FROM public.media m WHERE m.id = p_media_id FOR UPDATE;
  IF row.id IS NULL THEN RAISE EXCEPTION 'no such media' USING ERRCODE = 'CMS03'; END IF;
  IF (row.site_id IS NULL AND NOT app.is_super_admin())
     OR (row.site_id IS NOT NULL AND NOT app.can_administer_site(row.site_id)) THEN
    RAISE EXCEPTION 'only a site admin may delete media' USING ERRCODE = 'CMS02';
  END IF;
  IF row.status <> 'ready' THEN
    RAISE EXCEPTION 'only ready media can be deleted' USING ERRCODE = 'CMS04';
  END IF;
  IF row.revision IS DISTINCT FROM p_expected_revision THEN
    RAISE EXCEPTION 'stale revision: expected %, media is at %', p_expected_revision, row.revision
      USING ERRCODE = 'CMS01', DETAIL = row.revision::text;
  END IF;

  SELECT count(*) INTO usage_count FROM public.media_usage u WHERE u.media_id = row.id;
  IF p_reason IS NOT NULL AND p_reason <> ''
     AND (p_reason <> btrim(p_reason) OR char_length(p_reason) > 1000
          OR p_reason ~ '[[:cntrl:]]') THEN
    RAISE EXCEPTION 'media deletion reason is invalid' USING ERRCODE = 'CMS04';
  END IF;
  IF usage_count > 0 AND NOT COALESCE(p_break_references, false) THEN
    RAISE EXCEPTION 'media is referenced by % immutable page version(s)', usage_count
      USING ERRCODE = 'CMS04', DETAIL = usage_count::text;
  END IF;
  IF usage_count > 0 AND (p_reason IS NULL OR p_reason <> btrim(p_reason)
      OR char_length(p_reason) NOT BETWEEN 8 AND 1000 OR p_reason ~ '[[:cntrl:]]') THEN
    RAISE EXCEPTION 'breaking media references requires a bounded reason'
      USING ERRCODE = 'CMS04';
  END IF;

  deleted := statement_timestamp();
  retention_until := deleted + interval '30 days';
  next_revision := row.revision + 1;
  UPDATE public.media SET status = 'deleted', deleted_at = deleted, purged_at = NULL,
                          revision = next_revision WHERE id = row.id;

  PERFORM app.write_audit(
    row.site_id, 'user', actor, 'media.delete', 'media', row.id,
    row.id, NULL,
    jsonb_build_object('revision', next_revision, 'usage_count', usage_count,
      'break_references', COALESCE(p_break_references, false),
      'reason', COALESCE(p_reason, ''), 'deleted_at', deleted,
      'retention_until', retention_until));
  PERFORM app.emit_outbox(row.site_id, 'media.deleted',
    jsonb_build_object('media_id', row.id, 'revision', next_revision));
  event_id := app.emit_outbox(row.site_id, 'media.cleanup_requested',
    jsonb_build_object('media_id', row.id, 'deleted_revision', next_revision,
      'not_before', retention_until));
  UPDATE public.outbox SET next_attempt_at = retention_until WHERE id = event_id;
  RETURN next_revision;
END
$$;

-- Current body: 0036_media_upload_lifecycle.sql.
CREATE OR REPLACE FUNCTION app.restore_media(
  p_media_id uuid, p_expected_revision bigint
) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE actor uuid; row public.media%ROWTYPE; next_revision bigint;
BEGIN
  actor := app.require_actor();
  SELECT * INTO row FROM public.media m WHERE m.id = p_media_id FOR UPDATE;
  IF row.id IS NULL THEN RAISE EXCEPTION 'no such media' USING ERRCODE = 'CMS03'; END IF;
  IF (row.site_id IS NULL AND NOT app.is_super_admin())
     OR (row.site_id IS NOT NULL AND NOT app.can_administer_site(row.site_id)) THEN
    RAISE EXCEPTION 'only a site admin may restore media' USING ERRCODE = 'CMS02';
  END IF;
  IF row.status <> 'deleted' OR row.deleted_at IS NULL THEN
    RAISE EXCEPTION 'media is not deleted' USING ERRCODE = 'CMS04';
  END IF;
  IF row.purged_at IS NOT NULL THEN
    RAISE EXCEPTION 'media objects have already left retention'
      USING ERRCODE = 'CMS04';
  END IF;
  IF EXISTS (SELECT 1 FROM app.media_cleanup_claims c
              WHERE c.media_id = row.id AND c.completed_at IS NULL) THEN
    RAISE EXCEPTION 'media object cleanup has already begun'
      USING ERRCODE = 'CMS04';
  END IF;
  IF row.revision IS DISTINCT FROM p_expected_revision THEN
    RAISE EXCEPTION 'stale revision: expected %, media is at %', p_expected_revision, row.revision
      USING ERRCODE = 'CMS01', DETAIL = row.revision::text;
  END IF;
  IF row.deleted_at + interval '30 days' <= statement_timestamp() THEN
    RAISE EXCEPTION 'media retention window has elapsed' USING ERRCODE = 'CMS04';
  END IF;

  next_revision := row.revision + 1;
  UPDATE public.media SET status = 'ready', deleted_at = NULL,
                          revision = next_revision WHERE id = row.id;
  PERFORM app.write_audit(
    row.site_id, 'user', actor, 'media.restore', 'media', row.id,
    NULL, row.id, jsonb_build_object('revision', next_revision));
  PERFORM app.emit_outbox(row.site_id, 'media.restored',
    jsonb_build_object('media_id', row.id, 'revision', next_revision));
  RETURN next_revision;
END
$$;

-- Current body: 0041_review_command_boundaries.sql.
CREATE OR REPLACE FUNCTION app.submit_page_for_review(
  p_page_id uuid, p_expected_revision bigint, p_note text
) RETURNS TABLE (submission_id uuid, version_id uuid, revision bigint)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
#variable_conflict use_column
DECLARE
  actor uuid; head RECORD; src RECORD; existing RECORD;
  next_rev bigint; submitted_version uuid; opened uuid; clean_note text;
BEGIN
  actor := app.require_actor();
  clean_note := btrim(COALESCE(p_note, ''));
  IF octet_length(clean_note) > 4096 THEN
    RAISE EXCEPTION 'review note is too long' USING ERRCODE = 'CMS04';
  END IF;

  SELECT p.id, p.site_id, p.revision, p.draft_version_id, p.archived_at
    INTO head FROM public.pages p WHERE p.id = p_page_id FOR UPDATE;
  IF head IS NULL THEN RAISE EXCEPTION 'no such page' USING ERRCODE = 'CMS03'; END IF;
  IF NOT app.has_site_access(head.site_id) THEN
    RAISE EXCEPTION 'not permitted to submit this page' USING ERRCODE = 'CMS02';
  END IF;
  IF head.archived_at IS NOT NULL THEN
    RAISE EXCEPTION 'page is archived' USING ERRCODE = 'CMS04';
  END IF;
  IF head.draft_version_id IS NULL THEN
    RAISE EXCEPTION 'page has no draft to submit' USING ERRCODE = 'CMS04';
  END IF;

  SELECT s.id, s.version_id, s.submitted_by, s.note, pv.revision AS version_revision
    INTO existing
    FROM public.submissions s
    JOIN public.page_versions pv
      ON pv.id = s.version_id AND pv.page_id = head.id AND pv.site_id = head.site_id
   WHERE s.item_type = 'page' AND s.item_id = p_page_id
     AND s.status = 'open' AND s.version_id = head.draft_version_id;

  -- A response-lost retry repeats the original arguments. The first call moved
  -- the page from revision N to the immutable submission at N+1, so that exact
  -- relationship, actor, and normalized note identify the retry without making
  -- an arbitrary stale revision succeed.
  IF existing IS NOT NULL
     AND existing.submitted_by = actor
     AND existing.note = clean_note
     AND existing.version_revision = head.revision
     AND p_expected_revision = head.revision - 1 THEN
    RETURN QUERY SELECT existing.id, existing.version_id, head.revision;
    RETURN;
  END IF;

  IF head.revision IS DISTINCT FROM p_expected_revision THEN
    RAISE EXCEPTION 'stale revision: expected %, head is at %', p_expected_revision, head.revision
      USING ERRCODE = 'CMS01', DETAIL = head.revision::text;
  END IF;

  -- A caller who loaded the current already-submitted head gets the existing
  -- request only when it is their own. This preserves the useful same-head
  -- behavior without disclosing another contributor's hidden submission id.
  IF existing IS NOT NULL THEN
    IF existing.submitted_by <> actor THEN
      RAISE EXCEPTION 'the current version is already waiting for review'
        USING ERRCODE = 'CMS04';
    END IF;
    RETURN QUERY SELECT existing.id, existing.version_id, head.revision;
    RETURN;
  END IF;

  SELECT pv.content, pv.meta, pv.carries_trusted_code
    INTO src FROM public.page_versions pv
   WHERE pv.id = head.draft_version_id AND pv.page_id = head.id AND pv.site_id = head.site_id;
  IF src IS NULL THEN
    RAISE EXCEPTION 'the draft version does not belong to this page' USING ERRCODE = 'CMS04';
  END IF;

  next_rev := head.revision + 1;
  INSERT INTO public.page_versions (
    site_id, page_id, revision, content, meta, carries_trusted_code,
    kind, note, author_id
  ) VALUES (
    head.site_id, head.id, next_rev, src.content, src.meta, src.carries_trusted_code,
    'submission', clean_note, actor
  ) RETURNING id INTO submitted_version;

  UPDATE public.pages
     SET revision = next_rev, draft_version_id = submitted_version
   WHERE id = head.id;

  INSERT INTO public.submissions (
    site_id, item_type, item_id, version_id, submitted_by, note
  ) VALUES (
    head.site_id, 'page', head.id, submitted_version, actor, clean_note
  ) RETURNING id INTO opened;

  PERFORM app.write_audit(
    head.site_id, 'user', actor, 'submission.opened', 'submission', opened,
    head.draft_version_id, submitted_version,
    jsonb_build_object('page_id', head.id, 'revision', next_rev)
  );

  RETURN QUERY SELECT opened, submitted_version, next_rev;
END
$$;

-- Current body: 0043_navigation_workspace.sql.
CREATE OR REPLACE FUNCTION app.save_navigation_draft(
  p_site_id uuid, p_expected_revision bigint, p_tree jsonb, p_mode text
) RETURNS TABLE (version_id uuid, revision bigint)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
#variable_conflict use_column
DECLARE actor uuid; head RECORD; next_rev bigint; created uuid; defect text; missing uuid;
BEGIN
  actor := app.require_actor();
  SELECT n.id, n.site_id, n.revision, n.mode INTO head
    FROM public.navigations n WHERE n.site_id = p_site_id FOR UPDATE;
  IF head IS NULL THEN RAISE EXCEPTION 'no navigation for that site' USING ERRCODE = 'CMS03'; END IF;
  IF NOT app.can_publish(p_site_id) THEN
    RAISE EXCEPTION 'not permitted to manage navigation on this site' USING ERRCODE = 'CMS02';
  END IF;
  IF head.revision IS DISTINCT FROM p_expected_revision THEN
    RAISE EXCEPTION 'stale revision: expected %, head is at %', p_expected_revision, head.revision
      USING ERRCODE = 'CMS01', DETAIL = head.revision::text;
  END IF;
  IF p_mode NOT IN ('auto','manual') THEN RAISE EXCEPTION 'invalid navigation mode' USING ERRCODE = 'CMS04'; END IF;
  defect := app.navigation_tree_defect(p_tree);
  IF defect IS NOT NULL THEN RAISE EXCEPTION '%', defect USING ERRCODE = 'CMS04'; END IF;

  WITH RECURSIVE nodes(node) AS (
    SELECT value FROM jsonb_array_elements(p_tree)
    UNION ALL
    SELECT child.value FROM nodes parent
    CROSS JOIN LATERAL jsonb_array_elements(
      CASE WHEN jsonb_typeof(parent.node->'children') = 'array' THEN parent.node->'children' ELSE '[]'::jsonb END
    ) child
  )
  SELECT (node->'target'->>'page_id')::uuid INTO missing FROM nodes
   WHERE node->'target'->>'type' = 'page'
     AND NOT EXISTS (
       SELECT 1 FROM public.pages p
        WHERE p.id = (node->'target'->>'page_id')::uuid
          AND p.site_id = p_site_id AND p.archived_at IS NULL
     ) LIMIT 1;
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'a navigation item names a page outside this site' USING ERRCODE = 'CMS04';
  END IF;

  next_rev := head.revision + 1;
  INSERT INTO public.navigation_versions (site_id, navigation_id, revision, tree, author_id)
  VALUES (p_site_id, head.id, next_rev, p_tree, actor) RETURNING id INTO created;
  UPDATE public.navigations
     SET revision = next_rev, draft_version_id = created, mode = p_mode
   WHERE id = head.id;
  PERFORM app.write_audit(p_site_id, 'user', actor, 'navigation.save', 'navigation', head.id,
                          NULL, created, jsonb_build_object('revision', next_rev, 'mode', p_mode));
  RETURN QUERY SELECT created, next_rev;
END
$$;

-- Current body: 0044_theme_workspace.sql.
CREATE OR REPLACE FUNCTION app.save_theme_draft(
  p_site_id uuid, p_expected_revision bigint, p_tokens jsonb
) RETURNS TABLE (version_id uuid, revision bigint)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
#variable_conflict use_column
DECLARE actor uuid; head RECORD; next_rev bigint; created uuid; defect text;
BEGIN
  actor := app.require_actor();
  SELECT t.id, t.site_id, t.revision INTO head
    FROM public.themes t WHERE t.site_id = p_site_id FOR UPDATE;
  IF head IS NULL THEN RAISE EXCEPTION 'no theme for that site' USING ERRCODE = 'CMS03'; END IF;
  IF NOT app.can_administer_site(p_site_id) THEN
    RAISE EXCEPTION 'not permitted to manage theme on this site' USING ERRCODE = 'CMS02';
  END IF;
  IF head.revision IS DISTINCT FROM p_expected_revision THEN
    RAISE EXCEPTION 'stale revision: expected %, head is at %', p_expected_revision, head.revision
      USING ERRCODE = 'CMS01', DETAIL = head.revision::text;
  END IF;
  defect := app.theme_tokens_defect(p_tokens);
  IF defect IS NOT NULL THEN RAISE EXCEPTION '%', defect USING ERRCODE = 'CMS04'; END IF;

  next_rev := head.revision + 1;
  INSERT INTO public.theme_versions (site_id, theme_id, revision, tokens, author_id)
  VALUES (p_site_id, head.id, next_rev, p_tokens, actor) RETURNING id INTO created;
  UPDATE public.themes SET revision = next_rev, draft_version_id = created WHERE id = head.id;
  PERFORM app.write_audit(p_site_id, 'user', actor, 'theme.save', 'theme', head.id,
                          NULL, created, jsonb_build_object('revision', next_rev));
  RETURN QUERY SELECT created, next_rev;
END
$$;

-- Current body: 0044_theme_workspace.sql.
CREATE OR REPLACE FUNCTION app.publish_theme(
  p_site_id uuid, p_expected_revision bigint
) RETURNS TABLE (version_id uuid, revision bigint, shell_revision bigint)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
#variable_conflict use_column
DECLARE actor uuid; head RECORD; draft RECORD; next_rev bigint; created uuid;
        shell_rev bigint; defect text;
BEGIN
  actor := app.require_actor();
  SELECT t.id, t.site_id, t.revision, t.draft_version_id, t.published_version_id
    INTO head FROM public.themes t WHERE t.site_id = p_site_id FOR UPDATE;
  IF head IS NULL THEN RAISE EXCEPTION 'no theme for that site' USING ERRCODE = 'CMS03'; END IF;
  IF NOT app.can_administer_site(p_site_id) THEN
    RAISE EXCEPTION 'not permitted to publish theme on this site' USING ERRCODE = 'CMS02';
  END IF;
  IF head.revision IS DISTINCT FROM p_expected_revision THEN
    RAISE EXCEPTION 'stale revision: expected %, head is at %', p_expected_revision, head.revision
      USING ERRCODE = 'CMS01', DETAIL = head.revision::text;
  END IF;
  SELECT tv.tokens INTO draft FROM public.theme_versions tv
   WHERE tv.id = head.draft_version_id AND tv.theme_id = head.id;
  IF draft.tokens IS NULL THEN RAISE EXCEPTION 'theme has no draft' USING ERRCODE = 'CMS04'; END IF;
  defect := app.theme_tokens_defect(draft.tokens);
  IF defect IS NOT NULL THEN RAISE EXCEPTION '%', defect USING ERRCODE = 'CMS04'; END IF;

  IF app.theme_contrast_ratio(draft.tokens->'colors'->>'ink', draft.tokens->'colors'->>'surface') < 4.5 THEN
    RAISE EXCEPTION 'body text and surface contrast must be at least 4.5:1' USING ERRCODE = 'CMS04';
  END IF;
  IF app.theme_contrast_ratio(draft.tokens->'colors'->>'primaryContrast', draft.tokens->'colors'->>'primary') < 4.5 THEN
    RAISE EXCEPTION 'primary foreground and background contrast must be at least 4.5:1' USING ERRCODE = 'CMS04';
  END IF;
  IF app.theme_contrast_ratio(draft.tokens->'colors'->>'accentContrast', draft.tokens->'colors'->>'accent') < 4.5 THEN
    RAISE EXCEPTION 'accent foreground and background contrast must be at least 4.5:1' USING ERRCODE = 'CMS04';
  END IF;

  next_rev := head.revision + 1;
  INSERT INTO public.theme_versions (site_id, theme_id, revision, tokens, author_id)
  VALUES (p_site_id, head.id, next_rev, draft.tokens, actor) RETURNING id INTO created;
  UPDATE public.themes
     SET revision = next_rev, draft_version_id = created, published_version_id = created
   WHERE id = head.id;
  shell_rev := app.rebuild_site_shell(p_site_id);
  PERFORM app.write_audit(p_site_id, 'user', actor, 'theme.publish', 'theme', head.id,
                          head.published_version_id, created,
                          jsonb_build_object('revision', next_rev, 'shell_revision', shell_rev));
  PERFORM app.emit_outbox(p_site_id, 'site_shell.published',
                          jsonb_build_object(
                            'site_id', p_site_id, 'revision', shell_rev,
                            'paths', COALESCE((SELECT jsonb_agg(r.path ORDER BY r.path)
                              FROM public.published_routes r WHERE r.site_id = p_site_id), '[]'::jsonb)));
  RETURN QUERY SELECT created, next_rev, shell_rev;
END
$$;

-- Current body: 0044_theme_workspace.sql.
CREATE OR REPLACE FUNCTION app.revert_theme_to_live(
  p_site_id uuid, p_expected_revision bigint
) RETURNS TABLE (version_id uuid, revision bigint)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
#variable_conflict use_column
DECLARE actor uuid; head RECORD; live_tokens jsonb; next_rev bigint; created uuid;
BEGIN
  actor := app.require_actor();
  SELECT t.id, t.site_id, t.revision, t.published_version_id INTO head
    FROM public.themes t WHERE t.site_id = p_site_id FOR UPDATE;
  IF head IS NULL THEN RAISE EXCEPTION 'no theme for that site' USING ERRCODE = 'CMS03'; END IF;
  IF NOT app.can_administer_site(p_site_id) THEN
    RAISE EXCEPTION 'not permitted to manage theme on this site' USING ERRCODE = 'CMS02';
  END IF;
  IF head.revision IS DISTINCT FROM p_expected_revision THEN
    RAISE EXCEPTION 'stale revision: expected %, head is at %', p_expected_revision, head.revision
      USING ERRCODE = 'CMS01', DETAIL = head.revision::text;
  END IF;
  SELECT tv.tokens INTO live_tokens FROM public.theme_versions tv
   WHERE tv.id = head.published_version_id AND tv.theme_id = head.id;
  IF live_tokens IS NULL THEN RAISE EXCEPTION 'theme has no published version' USING ERRCODE = 'CMS04'; END IF;

  next_rev := head.revision + 1;
  INSERT INTO public.theme_versions (site_id, theme_id, revision, tokens, author_id)
  VALUES (p_site_id, head.id, next_rev, live_tokens, actor) RETURNING id INTO created;
  UPDATE public.themes SET revision = next_rev, draft_version_id = created WHERE id = head.id;
  PERFORM app.write_audit(p_site_id, 'user', actor, 'theme.revert_to_live', 'theme', head.id,
                          NULL, created, jsonb_build_object('revision', next_rev));
  RETURN QUERY SELECT created, next_rev;
END
$$;

-- Current body: 0045_global_elements_workspace.sql.
CREATE OR REPLACE FUNCTION app.save_global_elements_draft(
  p_site_id uuid, p_expected_header_revision bigint, p_expected_footer_revision bigint,
  p_header_content jsonb, p_footer_content jsonb
) RETURNS TABLE (
  header_version_id uuid, header_revision bigint,
  footer_version_id uuid, footer_revision bigint
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
#variable_conflict use_column
DECLARE actor uuid; header_head RECORD; footer_head RECORD; header_id uuid; footer_id uuid;
        next_header bigint; next_footer bigint; defect text;
BEGIN
  actor := app.require_actor();
  SELECT g.id, g.revision INTO header_head FROM public.global_elements g
   WHERE g.site_id = p_site_id AND g.kind = 'header' FOR UPDATE;
  SELECT g.id, g.revision INTO footer_head FROM public.global_elements g
   WHERE g.site_id = p_site_id AND g.kind = 'footer' FOR UPDATE;
  IF header_head IS NULL OR footer_head IS NULL THEN
    RAISE EXCEPTION 'site does not have both global-element heads' USING ERRCODE = 'CMS03';
  END IF;
  IF NOT app.can_publish(p_site_id) THEN
    RAISE EXCEPTION 'not permitted to manage global elements on this site' USING ERRCODE = 'CMS02';
  END IF;
  IF header_head.revision IS DISTINCT FROM p_expected_header_revision THEN
    RAISE EXCEPTION 'stale header revision: expected %, head is at %',
      p_expected_header_revision, header_head.revision
      USING ERRCODE = 'CMS01', DETAIL = header_head.revision::text;
  END IF;
  IF footer_head.revision IS DISTINCT FROM p_expected_footer_revision THEN
    RAISE EXCEPTION 'stale footer revision: expected %, head is at %',
      p_expected_footer_revision, footer_head.revision
      USING ERRCODE = 'CMS01', DETAIL = footer_head.revision::text;
  END IF;
  defect := app.global_header_defect(p_header_content);
  IF defect IS NOT NULL THEN RAISE EXCEPTION '%', defect USING ERRCODE = 'CMS04'; END IF;
  defect := app.global_footer_defect(p_footer_content);
  IF defect IS NOT NULL THEN RAISE EXCEPTION '%', defect USING ERRCODE = 'CMS04'; END IF;

  next_header := header_head.revision + 1;
  next_footer := footer_head.revision + 1;
  INSERT INTO public.global_element_versions (site_id, global_element_id, revision, content, author_id)
  VALUES (p_site_id, header_head.id, next_header, p_header_content, actor) RETURNING id INTO header_id;
  INSERT INTO public.global_element_versions (site_id, global_element_id, revision, content, author_id)
  VALUES (p_site_id, footer_head.id, next_footer, p_footer_content, actor) RETURNING id INTO footer_id;
  UPDATE public.global_elements SET revision = next_header, draft_version_id = header_id
   WHERE id = header_head.id;
  UPDATE public.global_elements SET revision = next_footer, draft_version_id = footer_id
   WHERE id = footer_head.id;
  PERFORM app.write_audit(p_site_id, 'user', actor, 'global_elements.save', 'site', p_site_id,
    NULL, NULL, jsonb_build_object(
      'header_version_id', header_id, 'header_revision', next_header,
      'footer_version_id', footer_id, 'footer_revision', next_footer));
  RETURN QUERY SELECT header_id, next_header, footer_id, next_footer;
END
$$;

-- Current body: 0045_global_elements_workspace.sql.
CREATE OR REPLACE FUNCTION app.publish_global_elements(
  p_site_id uuid, p_expected_header_revision bigint, p_expected_footer_revision bigint
) RETURNS TABLE (
  header_version_id uuid, header_revision bigint,
  footer_version_id uuid, footer_revision bigint, shell_revision bigint
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
#variable_conflict use_column
DECLARE actor uuid; header_head RECORD; footer_head RECORD; header_draft jsonb; footer_draft jsonb;
        header_id uuid; footer_id uuid; next_header bigint; next_footer bigint; shell_rev bigint; defect text;
BEGIN
  actor := app.require_actor();
  SELECT g.id, g.revision, g.draft_version_id, g.published_version_id INTO header_head
    FROM public.global_elements g WHERE g.site_id = p_site_id AND g.kind = 'header' FOR UPDATE;
  SELECT g.id, g.revision, g.draft_version_id, g.published_version_id INTO footer_head
    FROM public.global_elements g WHERE g.site_id = p_site_id AND g.kind = 'footer' FOR UPDATE;
  IF header_head IS NULL OR footer_head IS NULL THEN
    RAISE EXCEPTION 'site does not have both global-element heads' USING ERRCODE = 'CMS03';
  END IF;
  IF NOT app.can_publish(p_site_id) THEN
    RAISE EXCEPTION 'not permitted to publish global elements on this site' USING ERRCODE = 'CMS02';
  END IF;
  IF header_head.revision IS DISTINCT FROM p_expected_header_revision THEN
    RAISE EXCEPTION 'stale header revision: expected %, head is at %',
      p_expected_header_revision, header_head.revision
      USING ERRCODE = 'CMS01', DETAIL = header_head.revision::text;
  END IF;
  IF footer_head.revision IS DISTINCT FROM p_expected_footer_revision THEN
    RAISE EXCEPTION 'stale footer revision: expected %, head is at %',
      p_expected_footer_revision, footer_head.revision
      USING ERRCODE = 'CMS01', DETAIL = footer_head.revision::text;
  END IF;
  SELECT v.content INTO header_draft FROM public.global_element_versions v
   WHERE v.id = header_head.draft_version_id AND v.global_element_id = header_head.id;
  SELECT v.content INTO footer_draft FROM public.global_element_versions v
   WHERE v.id = footer_head.draft_version_id AND v.global_element_id = footer_head.id;
  IF header_draft IS NULL OR footer_draft IS NULL THEN
    RAISE EXCEPTION 'global elements do not have complete drafts' USING ERRCODE = 'CMS04';
  END IF;
  defect := app.global_elements_readiness_defect(p_site_id, 'header', header_draft);
  IF defect IS NOT NULL THEN RAISE EXCEPTION '%', defect USING ERRCODE = 'CMS04'; END IF;
  defect := app.global_elements_readiness_defect(p_site_id, 'footer', footer_draft);
  IF defect IS NOT NULL THEN RAISE EXCEPTION '%', defect USING ERRCODE = 'CMS04'; END IF;
  IF (NOT (footer_draft->>'enabled')::boolean
      OR NOT (footer_draft->'brand'->>'showFoundation')::boolean)
     AND NOT app.is_super_admin() THEN
    RAISE EXCEPTION 'only a super admin may hide the shared foundation' USING ERRCODE = 'CMS02';
  END IF;

  next_header := header_head.revision + 1;
  next_footer := footer_head.revision + 1;
  INSERT INTO public.global_element_versions (site_id, global_element_id, revision, content, author_id)
  VALUES (p_site_id, header_head.id, next_header, header_draft, actor) RETURNING id INTO header_id;
  INSERT INTO public.global_element_versions (site_id, global_element_id, revision, content, author_id)
  VALUES (p_site_id, footer_head.id, next_footer, footer_draft, actor) RETURNING id INTO footer_id;
  UPDATE public.global_elements SET revision = next_header, draft_version_id = header_id,
    published_version_id = header_id WHERE id = header_head.id;
  UPDATE public.global_elements SET revision = next_footer, draft_version_id = footer_id,
    published_version_id = footer_id WHERE id = footer_head.id;
  shell_rev := app.rebuild_site_shell(p_site_id);
  PERFORM app.write_audit(p_site_id, 'user', actor, 'global_elements.publish', 'site', p_site_id,
    NULL, NULL, jsonb_build_object(
      'before_header_version_id', header_head.published_version_id,
      'header_version_id', header_id, 'header_revision', next_header,
      'before_footer_version_id', footer_head.published_version_id,
      'footer_version_id', footer_id, 'footer_revision', next_footer,
      'shell_revision', shell_rev));
  PERFORM app.emit_outbox(p_site_id, 'site_shell.published', jsonb_build_object(
    'site_id', p_site_id, 'revision', shell_rev,
    'paths', COALESCE((SELECT jsonb_agg(r.path ORDER BY r.path)
      FROM public.published_routes r WHERE r.site_id = p_site_id), '[]'::jsonb)));
  RETURN QUERY SELECT header_id, next_header, footer_id, next_footer, shell_rev;
END
$$;

-- Current body: 0045_global_elements_workspace.sql.
CREATE OR REPLACE FUNCTION app.revert_global_elements_to_live(
  p_site_id uuid, p_expected_header_revision bigint, p_expected_footer_revision bigint
) RETURNS TABLE (
  header_version_id uuid, header_revision bigint,
  footer_version_id uuid, footer_revision bigint
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
#variable_conflict use_column
DECLARE actor uuid; header_head RECORD; footer_head RECORD; header_live jsonb; footer_live jsonb;
        header_id uuid; footer_id uuid; next_header bigint; next_footer bigint; defect text;
BEGIN
  actor := app.require_actor();
  SELECT g.id, g.revision, g.published_version_id INTO header_head
    FROM public.global_elements g WHERE g.site_id = p_site_id AND g.kind = 'header' FOR UPDATE;
  SELECT g.id, g.revision, g.published_version_id INTO footer_head
    FROM public.global_elements g WHERE g.site_id = p_site_id AND g.kind = 'footer' FOR UPDATE;
  IF header_head IS NULL OR footer_head IS NULL THEN
    RAISE EXCEPTION 'site does not have both global-element heads' USING ERRCODE = 'CMS03';
  END IF;
  IF NOT app.can_publish(p_site_id) THEN
    RAISE EXCEPTION 'not permitted to revert global elements on this site' USING ERRCODE = 'CMS02';
  END IF;
  IF header_head.revision IS DISTINCT FROM p_expected_header_revision
     OR footer_head.revision IS DISTINCT FROM p_expected_footer_revision THEN
    RAISE EXCEPTION 'stale global-element revision' USING ERRCODE = 'CMS01',
      DETAIL = jsonb_build_object('header_revision',header_head.revision,
                                  'footer_revision',footer_head.revision)::text;
  END IF;
  SELECT v.content INTO header_live FROM public.global_element_versions v
   WHERE v.id = header_head.published_version_id AND v.global_element_id = header_head.id;
  SELECT v.content INTO footer_live FROM public.global_element_versions v
   WHERE v.id = footer_head.published_version_id AND v.global_element_id = footer_head.id;
  IF header_live IS NULL OR footer_live IS NULL THEN
    RAISE EXCEPTION 'global elements do not have complete live versions' USING ERRCODE = 'CMS04';
  END IF;
  defect := app.global_header_defect(header_live);
  IF defect IS NOT NULL THEN RAISE EXCEPTION 'live header is not a current safe version: %', defect USING ERRCODE = 'CMS04'; END IF;
  defect := app.global_footer_defect(footer_live);
  IF defect IS NOT NULL THEN RAISE EXCEPTION 'live footer is not a current safe version: %', defect USING ERRCODE = 'CMS04'; END IF;

  next_header := header_head.revision + 1;
  next_footer := footer_head.revision + 1;
  INSERT INTO public.global_element_versions (site_id, global_element_id, revision, content, author_id)
  VALUES (p_site_id, header_head.id, next_header, header_live, actor) RETURNING id INTO header_id;
  INSERT INTO public.global_element_versions (site_id, global_element_id, revision, content, author_id)
  VALUES (p_site_id, footer_head.id, next_footer, footer_live, actor) RETURNING id INTO footer_id;
  UPDATE public.global_elements SET revision = next_header, draft_version_id = header_id
   WHERE id = header_head.id;
  UPDATE public.global_elements SET revision = next_footer, draft_version_id = footer_id
   WHERE id = footer_head.id;
  PERFORM app.write_audit(p_site_id, 'user', actor, 'global_elements.revert', 'site', p_site_id,
    NULL, NULL, jsonb_build_object(
      'header_version_id', header_id, 'header_revision', next_header,
      'footer_version_id', footer_id, 'footer_revision', next_footer));
  RETURN QUERY SELECT header_id, next_header, footer_id, next_footer;
END
$$;

-- Current body: 0046_collections_workspace.sql.
CREATE OR REPLACE FUNCTION app.save_collection_schema(
  p_collection_id uuid, p_expected_revision bigint, p_fields jsonb, p_presentation jsonb
) RETURNS TABLE(schema_version_id uuid, revision bigint)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE actor uuid; head public.collections%ROWTYPE; defect text; normalized_fields jsonb; before_id uuid;
BEGIN
  actor := app.require_actor();
  SELECT * INTO head FROM public.collections WHERE id=p_collection_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'collection not found' USING ERRCODE='CMS03'; END IF;
  IF NOT app.can_administer_site(head.site_id) THEN RAISE EXCEPTION 'not permitted to change this collection schema' USING ERRCODE='CMS02'; END IF;
  IF head.revision IS DISTINCT FROM p_expected_revision THEN RAISE EXCEPTION 'stale collection revision' USING ERRCODE='CMS01', DETAIL=jsonb_build_object('revision',head.revision)::text; END IF;
  defect := app.collection_model_defect(p_fields,p_presentation);
  IF defect IS NOT NULL THEN RAISE EXCEPTION 'invalid collection schema: %', defect USING ERRCODE='CMS04'; END IF;
  normalized_fields := app.normalize_collection_fields(p_fields); before_id := head.draft_schema_version_id;
  revision := head.revision+1; schema_version_id := gen_random_uuid();
  INSERT INTO public.collection_schema_versions(id,site_id,collection_id,revision,fields,sort,author_id)
  VALUES(schema_version_id,head.site_id,head.id,revision,normalized_fields,p_presentation,actor);
  UPDATE public.collections SET revision=save_collection_schema.revision,draft_schema_version_id=schema_version_id WHERE id=head.id;
  PERFORM app.write_audit(head.site_id,'user',actor,'collection.schema.save','collection',head.id,
    before_id,schema_version_id,jsonb_build_object('revision',revision));
  RETURN NEXT;
END
$$;

-- Current body: 0046_collections_workspace.sql; renamed by 0072.
CREATE OR REPLACE FUNCTION app.publish_collection_schema_core(
  p_collection_id uuid, p_expected_revision bigint
) RETURNS TABLE(schema_version_id uuid, revision bigint)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE actor uuid; head public.collections%ROWTYPE; candidate public.collection_schema_versions%ROWTYPE;
        live_entry record; defect text; before_id uuid;
BEGIN
  actor := app.require_actor();
  SELECT * INTO head FROM public.collections WHERE id=p_collection_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'collection not found' USING ERRCODE='CMS03'; END IF;
  IF NOT app.can_administer_site(head.site_id) THEN RAISE EXCEPTION 'not permitted to publish this collection schema' USING ERRCODE='CMS02'; END IF;
  IF head.revision IS DISTINCT FROM p_expected_revision THEN RAISE EXCEPTION 'stale collection revision' USING ERRCODE='CMS01',DETAIL=jsonb_build_object('revision',head.revision)::text; END IF;
  SELECT * INTO candidate FROM public.collection_schema_versions WHERE id=head.draft_schema_version_id AND collection_id=head.id;
  IF NOT FOUND THEN RAISE EXCEPTION 'collection has no draft schema' USING ERRCODE='CMS04'; END IF;
  FOR live_entry IN
    SELECT version."values" FROM public.collection_entries entry
    JOIN public.collection_entry_versions version ON version.id=entry.published_version_id AND version.entry_id=entry.id
    WHERE entry.collection_id=head.id AND entry.published_archived_at IS NULL
  LOOP
    defect := app.collection_entry_values_defect(head.site_id,candidate.fields,live_entry."values");
    IF defect IS NOT NULL THEN RAISE EXCEPTION 'schema is incompatible with live entries: %',defect USING ERRCODE='CMS04'; END IF;
  END LOOP;
  before_id := head.published_schema_version_id; schema_version_id := candidate.id; revision := head.revision+1;
  UPDATE public.collections SET revision=publish_collection_schema_core.revision,published_schema_version_id=schema_version_id WHERE id=head.id;
  PERFORM app.write_audit(head.site_id,'user',actor,'collection.schema.publish','collection',head.id,
    before_id,schema_version_id,jsonb_build_object('revision',revision));
  PERFORM app.emit_outbox(head.site_id,'collection.schema.published',
    jsonb_build_object('collection_id',head.id,'schema_version_id',schema_version_id,'revision',revision));
  RETURN NEXT;
END
$$;

-- Current body: 0046_collections_workspace.sql.
CREATE OR REPLACE FUNCTION app.save_collection_entries(
  p_collection_id uuid, p_expected_entry_revision bigint, p_entries jsonb
) RETURNS TABLE(entry_revision bigint)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE actor uuid; head public.collections%ROWTYPE; schema_head public.collection_schema_versions%ROWTYPE;
        entry_json jsonb; position bigint; entry_id uuid; entry_head public.collection_entries%ROWTYPE;
        version_id uuid; normalized_values jsonb; defect text; now_at timestamptz := clock_timestamp();
BEGIN
  actor := app.require_actor();
  SELECT * INTO head FROM public.collections WHERE id=p_collection_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'collection not found' USING ERRCODE='CMS03'; END IF;
  IF COALESCE(app.site_role(head.site_id) IN ('contributor','editor','site_admin'),false) IS NOT TRUE THEN
    RAISE EXCEPTION 'not permitted to save entries for this collection' USING ERRCODE='CMS02';
  END IF;
  IF head.entry_revision IS DISTINCT FROM p_expected_entry_revision THEN RAISE EXCEPTION 'stale collection entry revision' USING ERRCODE='CMS01',DETAIL=jsonb_build_object('entry_revision',head.entry_revision)::text; END IF;
  SELECT * INTO schema_head FROM public.collection_schema_versions WHERE id=head.draft_schema_version_id AND collection_id=head.id;
  IF NOT FOUND THEN RAISE EXCEPTION 'collection has no draft schema' USING ERRCODE='CMS04'; END IF;
  IF jsonb_typeof(p_entries) IS DISTINCT FROM 'array' OR jsonb_array_length(p_entries)>2000 THEN
    RAISE EXCEPTION 'entries must be an array of at most 2000 items' USING ERRCODE='CMS04';
  END IF;
  FOR entry_json,position IN SELECT value,ordinality FROM jsonb_array_elements(p_entries) WITH ORDINALITY LOOP
    IF jsonb_typeof(entry_json) IS DISTINCT FROM 'object'
       OR (entry_json-ARRAY['id','stableKey','values'])<>'{}'::jsonb
       OR NOT(entry_json ?& ARRAY['id','stableKey','values'])
       OR jsonb_typeof(entry_json->'id') NOT IN ('null','string')
       OR (jsonb_typeof(entry_json->'id')='string' AND NOT(entry_json->>'id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'))
       OR jsonb_typeof(entry_json->'stableKey') IS DISTINCT FROM 'string'
       OR NOT(entry_json->>'stableKey' ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$')
       OR char_length(entry_json->>'stableKey')>80
       OR jsonb_typeof(entry_json->'values') IS DISTINCT FROM 'object' THEN
      RAISE EXCEPTION 'a collection entry has invalid or unknown properties' USING ERRCODE='CMS04';
    END IF;
  END LOOP;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_entries) GROUP BY value->>'stableKey' HAVING count(*)>1)
     OR EXISTS(SELECT 1 FROM jsonb_array_elements(p_entries) WHERE jsonb_typeof(value->'id')='string' GROUP BY value->>'id' HAVING count(*)>1) THEN
    RAISE EXCEPTION 'entry ids and stable keys must be unique in the batch' USING ERRCODE='CMS04';
  END IF;

  FOR entry_json,position IN SELECT value,ordinality FROM jsonb_array_elements(p_entries) WITH ORDINALITY LOOP
    defect := app.collection_entry_values_defect(head.site_id,schema_head.fields,entry_json->'values');
    IF defect IS NOT NULL THEN RAISE EXCEPTION 'invalid collection entry %: %',entry_json->>'stableKey',defect USING ERRCODE='CMS04'; END IF;
    normalized_values := app.normalize_collection_entry_values(schema_head.fields,entry_json->'values');
    IF jsonb_typeof(entry_json->'id')='null' THEN
      entry_id := gen_random_uuid();
      INSERT INTO public.collection_entries(id,site_id,collection_id,stable_key,sort_index,revision,archived_at)
      VALUES(entry_id,head.site_id,head.id,entry_json->>'stableKey',(position-1)::integer,0,NULL);
      entry_head.revision := 0;
    ELSE
      entry_id := (entry_json->>'id')::uuid;
      SELECT * INTO entry_head FROM public.collection_entries WHERE id=entry_id AND collection_id=head.id FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION 'entry does not belong to this collection' USING ERRCODE='CMS04'; END IF;
    END IF;
    version_id := gen_random_uuid();
    INSERT INTO public.collection_entry_versions(id,site_id,collection_id,entry_id,schema_version_id,revision,"values",author_id)
    VALUES(version_id,head.site_id,head.id,entry_id,schema_head.id,entry_head.revision+1,normalized_values,actor);
    UPDATE public.collection_entries SET stable_key=entry_json->>'stableKey',sort_index=(position-1)::integer,
      revision=entry_head.revision+1,draft_version_id=version_id,archived_at=NULL WHERE id=entry_id;
    PERFORM app.index_collection_entry_media(version_id,head.site_id,entry_id,schema_head.fields,normalized_values);
  END LOOP;

  UPDATE public.collection_entries entry SET archived_at=now_at,revision=entry.revision+1
   WHERE entry.collection_id=head.id AND entry.archived_at IS NULL
     AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p_entries) supplied
                     WHERE (jsonb_typeof(supplied->'id')='string' AND supplied->>'id'=entry.id::text)
                        OR supplied->>'stableKey'=entry.stable_key);
  entry_revision := head.entry_revision+1;
  UPDATE public.collections SET entry_revision=save_collection_entries.entry_revision WHERE id=head.id;
  PERFORM app.write_audit(head.site_id,'user',actor,'collection.entries.save','collection',head.id,NULL,NULL,
    jsonb_build_object('entry_revision',entry_revision,'entry_count',jsonb_array_length(p_entries)));
  RETURN NEXT;
EXCEPTION WHEN unique_violation THEN
  RAISE EXCEPTION 'entry stable keys conflict with this collection' USING ERRCODE='CMS04';
END
$$;

-- Current body: 0046_collections_workspace.sql; renamed by 0072.
CREATE OR REPLACE FUNCTION app.publish_collection_entries_core(
  p_collection_id uuid, p_expected_entry_revision bigint
) RETURNS TABLE(entry_revision bigint, published_entry_revision bigint, published_count integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE actor uuid; head public.collections%ROWTYPE; schema_head public.collection_schema_versions%ROWTYPE;
        draft_entry record; defect text;
BEGIN
  actor:=app.require_actor();
  SELECT * INTO head FROM public.collections WHERE id=p_collection_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'collection not found' USING ERRCODE='CMS03'; END IF;
  IF NOT app.can_publish(head.site_id) THEN RAISE EXCEPTION 'not permitted to publish entries for this collection' USING ERRCODE='CMS02'; END IF;
  IF head.entry_revision IS DISTINCT FROM p_expected_entry_revision THEN RAISE EXCEPTION 'stale collection entry revision' USING ERRCODE='CMS01',DETAIL=jsonb_build_object('entry_revision',head.entry_revision)::text; END IF;
  SELECT * INTO schema_head FROM public.collection_schema_versions WHERE id=head.published_schema_version_id AND collection_id=head.id;
  IF NOT FOUND THEN RAISE EXCEPTION 'publish the collection schema before its entries' USING ERRCODE='CMS04'; END IF;
  FOR draft_entry IN
    SELECT entry.id,version.schema_version_id,version."values" FROM public.collection_entries entry
    JOIN public.collection_entry_versions version ON version.id=entry.draft_version_id AND version.entry_id=entry.id
    WHERE entry.collection_id=head.id AND entry.archived_at IS NULL ORDER BY entry.sort_index
  LOOP
    IF draft_entry.schema_version_id<>schema_head.id THEN RAISE EXCEPTION 'entry drafts must be saved against the published collection schema' USING ERRCODE='CMS04'; END IF;
    defect:=app.collection_entry_values_defect(head.site_id,schema_head.fields,draft_entry."values");
    IF defect IS NOT NULL THEN RAISE EXCEPTION 'entry is not publishable: %',defect USING ERRCODE='CMS04'; END IF;
  END LOOP;
  UPDATE public.collection_entries SET published_version_id=draft_version_id,
    published_sort_index=sort_index,published_archived_at=archived_at,revision=revision+1
   WHERE collection_id=head.id;
  SELECT count(*)::integer INTO published_count FROM public.collection_entries
   WHERE collection_id=head.id AND published_version_id IS NOT NULL AND published_archived_at IS NULL;
  entry_revision:=head.entry_revision+1; published_entry_revision:=entry_revision;
  UPDATE public.collections SET entry_revision=publish_collection_entries_core.entry_revision,
    published_entry_revision=publish_collection_entries_core.published_entry_revision WHERE id=head.id;
  PERFORM app.write_audit(head.site_id,'user',actor,'collection.entries.publish','collection',head.id,NULL,NULL,
    jsonb_build_object('entry_revision',entry_revision,'published_count',published_count));
  PERFORM app.emit_outbox(head.site_id,'collection.entries.published',
    jsonb_build_object('collection_id',head.id,'entry_revision',entry_revision,'entry_count',published_count));
  RETURN NEXT;
END
$$;

-- Current body: 0049_media_organization.sql.
CREATE OR REPLACE FUNCTION app.bulk_organize_media(
  p_media_ids uuid[], p_expected_revisions bigint[], p_folder text,
  p_add_tags text[], p_remove_tags text[]
) RETURNS TABLE(media_id uuid, revision bigint)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE actor uuid; n integer; i integer; row public.media%ROWTYPE;
        next_tags text[]; next_revision bigint;
BEGIN
  actor := app.require_actor();
  n := cardinality(p_media_ids);
  IF p_media_ids IS NULL OR p_expected_revisions IS NULL
     OR n IS NULL OR n NOT BETWEEN 1 AND 100
     OR cardinality(p_expected_revisions) <> n
     OR (SELECT count(DISTINCT id) FROM unnest(p_media_ids) id) <> n
     OR p_add_tags IS NULL OR p_remove_tags IS NULL
     OR NOT app.media_tags_are_valid(p_add_tags)
     OR NOT app.media_tags_are_valid(p_remove_tags)
     OR EXISTS (SELECT 1 FROM unnest(p_add_tags) tag WHERE tag = ANY(p_remove_tags)) THEN
    RAISE EXCEPTION 'bulk media organization input is invalid' USING ERRCODE = 'CMS04';
  END IF;
  IF p_folder IS NOT NULL AND (
       p_folder <> btrim(p_folder) OR char_length(p_folder) > 200
       OR (p_folder <> '' AND p_folder !~ '^[A-Za-z0-9][A-Za-z0-9 _-]{0,63}(/[A-Za-z0-9][A-Za-z0-9 _-]{0,63})*$')) THEN
    RAISE EXCEPTION 'bulk media folder is invalid' USING ERRCODE = 'CMS04';
  END IF;

  -- Lock in a canonical order before inspecting any row. Concurrent bulk
  -- commands cannot deadlock merely because the browser selected in a
  -- different order.
  PERFORM 1 FROM public.media m WHERE m.id = ANY(p_media_ids) ORDER BY m.id FOR UPDATE;
  IF (SELECT count(*) FROM public.media m WHERE m.id = ANY(p_media_ids)) <> n THEN
    RAISE EXCEPTION 'one or more media items do not exist' USING ERRCODE = 'CMS03';
  END IF;

  FOR i IN 1..n LOOP
    SELECT * INTO row FROM public.media m WHERE m.id = p_media_ids[i];
    IF (row.site_id IS NULL AND NOT app.is_super_admin())
       OR (row.site_id IS NOT NULL AND NOT app.has_site_access(row.site_id)) THEN
      RAISE EXCEPTION 'not permitted to organize one or more media items' USING ERRCODE = 'CMS02';
    END IF;
    IF row.status <> 'ready' THEN
      RAISE EXCEPTION 'only ready media can be organized' USING ERRCODE = 'CMS04';
    END IF;
    IF row.revision IS DISTINCT FROM p_expected_revisions[i] THEN
      RAISE EXCEPTION 'stale revision: expected %, media is at %', p_expected_revisions[i], row.revision
        USING ERRCODE = 'CMS01', DETAIL = row.revision::text;
    END IF;
    SELECT coalesce(array_agg(DISTINCT tag ORDER BY tag), '{}'::text[]) INTO next_tags
      FROM unnest(row.tags || p_add_tags) tag WHERE NOT tag = ANY(p_remove_tags);
    IF NOT app.media_tags_are_valid(next_tags) THEN
      RAISE EXCEPTION 'bulk media tags exceed the governed limit' USING ERRCODE = 'CMS04';
    END IF;
    SELECT app.update_media_metadata(
      row.id, row.revision, row.alt_text, row.decorative, row.focal,
      coalesce(p_folder, row.folder), row.attribution, row.source, next_tags
    ) INTO next_revision;
    media_id := row.id; revision := next_revision; RETURN NEXT;
  END LOOP;
END
$$;
