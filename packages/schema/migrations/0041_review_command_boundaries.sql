-- 0041 — close review command boundaries found by the post-implementation audit.
--
-- This is intentionally forward-only. The review commands were introduced in
-- 0037–0039; redefining their bodies here preserves applied migration history
-- while making the authorization and retry contracts explicit.

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

  IF head.revision <> p_expected_revision THEN
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

CREATE OR REPLACE FUNCTION app.add_page_comment(
  p_page_id uuid, p_version_id uuid, p_body text, p_mentions jsonb
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE actor uuid; page RECORD; request RECORD; clean_body text; comment_id uuid;
BEGIN
  actor := app.require_actor();
  clean_body := btrim(COALESCE(p_body, ''));
  IF clean_body = '' THEN
    RAISE EXCEPTION 'write a comment first' USING ERRCODE = 'CMS04';
  END IF;
  IF octet_length(clean_body) > 4000 THEN
    RAISE EXCEPTION 'comment is too long' USING ERRCODE = 'CMS04';
  END IF;
  IF p_mentions IS NULL OR jsonb_typeof(p_mentions) <> 'array'
     OR jsonb_array_length(p_mentions) > 20 THEN
    RAISE EXCEPTION 'mentions must be a list of at most 20 people' USING ERRCODE = 'CMS04';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_mentions) AS mention(value)
     WHERE jsonb_typeof(mention.value) <> 'string'
        -- PostgreSQL 15 has no pg_input_is_valid(). Accept the canonical form
        -- the product emits, while deliberately imposing no RFC version or
        -- variant nibble so imported/product UUIDs such as 0000...00a1 remain
        -- valid and the cast below is still provably safe.
        OR (mention.value #>> '{}') !~
           '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
  ) THEN
    RAISE EXCEPTION 'every mention must name one product user' USING ERRCODE = 'CMS04';
  END IF;

  SELECT p.id, p.site_id INTO page
    FROM public.pages p WHERE p.id = p_page_id AND app.has_site_access(p.site_id);
  IF page IS NULL THEN RAISE EXCEPTION 'no such page' USING ERRCODE = 'CMS03'; END IF;
  IF p_version_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.page_versions pv
     WHERE pv.id = p_version_id AND pv.page_id = page.id AND pv.site_id = page.site_id
  ) THEN
    RAISE EXCEPTION 'comment version does not belong to this page' USING ERRCODE = 'CMS04';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements_text(p_mentions) AS mention(user_id)
     WHERE NOT EXISTS (
       SELECT 1 FROM public.app_users u
        WHERE u.id = mention.user_id::uuid AND u.status = 'active'
          AND (
            EXISTS (SELECT 1 FROM public.global_roles g
                     WHERE g.user_id = u.id AND g.role = 'super_admin')
            OR EXISTS (SELECT 1 FROM public.site_memberships m
                       WHERE m.user_id = u.id AND m.site_id = page.site_id)
          )
     )
  ) THEN
    RAISE EXCEPTION 'a mentioned person is not an active member of this site'
      USING ERRCODE = 'CMS04';
  END IF;

  SELECT s.id INTO request
    FROM public.submissions s
   WHERE s.site_id = page.site_id
     AND s.item_type = 'page'
     AND s.item_id = page.id
     AND s.version_id = p_version_id
     AND s.status = 'open'
     AND (s.submitted_by = actor OR app.can_review(s.site_id));
  IF request IS NULL THEN
    RAISE EXCEPTION 'no such open review request' USING ERRCODE = 'CMS03';
  END IF;

  INSERT INTO public.comments (
    site_id, item_type, item_id, version_id, body, mentions, author_id
  ) VALUES (
    page.site_id, 'page', page.id, p_version_id, clean_body, p_mentions, actor
  ) RETURNING id INTO comment_id;

  PERFORM app.write_audit(
    page.site_id, 'user', actor, 'review.comment_added', 'comment', comment_id,
    NULL, p_version_id, jsonb_build_object(
      'page_id', page.id, 'submission_id', request.id, 'mentions', p_mentions
    )
  );
  RETURN comment_id;
END
$$;

CREATE OR REPLACE FUNCTION app.publish_page(
  p_page_id uuid, p_expected_revision bigint,
  p_readiness_policy_version int,
  p_override_reason text,
  p_readiness jsonb
) RETURNS TABLE (published_version_id uuid, revision bigint, path text, shell_revision bigint)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
#variable_conflict use_column
DECLARE actor uuid; head RECORD;
BEGIN
  actor := app.require_actor();
  IF p_expected_revision IS NULL THEN
    RAISE EXCEPTION 'publishing from the editor requires the revision you loaded'
      USING ERRCODE = 'CMS04';
  END IF;

  -- Resolve and authorize the page before consulting its workflow state. A
  -- foreign page therefore has one answer regardless of whether it is waiting
  -- for review. Holding the page lock also keeps the guard and publication core
  -- on one stable head.
  SELECT p.id, p.site_id, p.draft_version_id INTO head
    FROM public.pages p WHERE p.id = p_page_id FOR UPDATE;
  IF head IS NULL THEN RAISE EXCEPTION 'no such page' USING ERRCODE = 'CMS03'; END IF;
  IF NOT app.can_publish_as(actor, head.site_id) THEN
    RAISE EXCEPTION 'not permitted to publish on this site' USING ERRCODE = 'CMS02';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.submissions s
     WHERE s.item_type = 'page'
       AND s.item_id = p_page_id
       AND s.version_id = head.draft_version_id
       AND s.status = 'open'
  ) THEN
    RAISE EXCEPTION 'this exact version is waiting for review; approve or return the submission'
      USING ERRCODE = 'CMS04';
  END IF;

  RETURN QUERY SELECT * FROM app.publish_page_version(
    p_page_id, p_expected_revision, head.draft_version_id, 'user', actor,
    p_readiness_policy_version, p_override_reason, p_readiness, '{}'::jsonb
  );
END
$$;

-- Migrations run as a deploy login, but executable command ownership belongs to
-- the named non-login schema owner. Keep this invariant global so a later audit
-- cannot find one new definer function still owned by a human or superuser.
DO $$
DECLARE obj RECORD;
BEGIN
  FOR obj IN
    SELECT p.oid::regprocedure AS sig FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname IN ('app', 'public_api')
  LOOP
    EXECUTE format('ALTER FUNCTION %s OWNER TO cms_migration_owner', obj.sig);
  END LOOP;
END
$$;
