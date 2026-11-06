-- 0037 — turn the review tables into one governed page-review workflow.
--
-- The tables existed from 0001, but authenticated users had no commands that
-- could write a submission and no approval path reused the publication core.
-- This migration deliberately starts with pages: every command below derives
-- its actor, locks the page head, checks site/version ownership, and keeps the
-- reviewed immutable version as the thing that is either published or returned.

-- A decision is either absent or complete. The original pairing constraint did
-- not require decided_by, so a terminal row could name no reviewer at all.
ALTER TABLE public.submissions
  DROP CONSTRAINT submissions_decision_pairing;

ALTER TABLE public.submissions
  ADD COLUMN decision_note text NOT NULL DEFAULT '',
  ADD CONSTRAINT submissions_decision_pairing CHECK (
    (status IN ('open', 'superseded') AND decided_by IS NULL AND decided_at IS NULL)
    OR
    (status IN ('approved', 'rejected') AND decided_by IS NOT NULL AND decided_at IS NOT NULL)
  ),
  ADD CONSTRAINT submissions_note_size CHECK (octet_length(note) <= 4096),
  ADD CONSTRAINT submissions_decision_note_size CHECK (octet_length(decision_note) <= 4096),
  ADD CONSTRAINT submissions_rejection_has_reason CHECK (
    status <> 'rejected' OR length(btrim(decision_note)) > 0
  );

CREATE INDEX submissions_submitter_status
  ON public.submissions(submitted_by, status, created_at DESC);

-- Resolving a comment is a decision too. Record who made it and keep the two
-- fields paired, rather than accepting an arbitrary timestamp from a browser.
ALTER TABLE public.comments
  ADD COLUMN resolved_by uuid REFERENCES public.app_users(id),
  ADD CONSTRAINT comments_resolution_pairing CHECK (
    (resolved_at IS NULL AND resolved_by IS NULL)
    OR
    (resolved_at IS NOT NULL AND resolved_by IS NOT NULL)
  );

CREATE OR REPLACE FUNCTION app.can_review(site uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT app.can_publish_as(app.current_user_id(), site)
$$;

-- Contributors may see the submissions they made; reviewers may see the site
-- queue. A site membership by itself is not permission to inspect everybody's
-- review requests.
DROP POLICY submissions_member ON public.submissions;
CREATE POLICY submissions_member ON public.submissions FOR SELECT TO cms_authenticated_user
  USING (
    app.has_site_access(site_id)
    AND (submitted_by = app.current_user_id() OR app.can_review(site_id))
  );

-- Any command that moves the draft head makes an older open review stale. Do
-- this at the pointer, not at individual save call sites, so restore and future
-- draft-producing commands cannot forget it.
CREATE OR REPLACE FUNCTION app.supersede_stale_page_submissions() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE stale RECORD; actor uuid;
BEGIN
  IF NEW.draft_version_id IS NOT DISTINCT FROM OLD.draft_version_id THEN
    RETURN NEW;
  END IF;

  actor := app.current_user_id();
  FOR stale IN
    UPDATE public.submissions
       SET status = 'superseded'
     WHERE item_type = 'page'
       AND item_id = NEW.id
       AND status = 'open'
       AND version_id IS DISTINCT FROM NEW.draft_version_id
    RETURNING id, version_id
  LOOP
    PERFORM app.write_audit(
      NEW.site_id,
      CASE WHEN actor IS NULL THEN 'system'::public.actor_type ELSE 'user'::public.actor_type END,
      actor,
      'submission.superseded', 'submission', stale.id,
      stale.version_id, NEW.draft_version_id,
      jsonb_build_object('page_id', NEW.id)
    );
  END LOOP;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS pages_supersede_stale_submissions ON public.pages;
CREATE TRIGGER pages_supersede_stale_submissions
AFTER UPDATE OF draft_version_id ON public.pages
FOR EACH ROW EXECUTE FUNCTION app.supersede_stale_page_submissions();

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
  IF head.revision <> p_expected_revision THEN
    RAISE EXCEPTION 'stale revision: expected %, head is at %', p_expected_revision, head.revision
      USING ERRCODE = 'CMS01', DETAIL = head.revision::text;
  END IF;
  IF head.draft_version_id IS NULL THEN
    RAISE EXCEPTION 'page has no draft to submit' USING ERRCODE = 'CMS04';
  END IF;

  -- A repeated transport request for the same already-submitted head is
  -- idempotent. It creates neither another version nor another audit event.
  SELECT s.id, s.version_id INTO existing
    FROM public.submissions s
   WHERE s.item_type = 'page' AND s.item_id = p_page_id
     AND s.status = 'open' AND s.version_id = head.draft_version_id;
  IF existing IS NOT NULL THEN
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

  -- The trigger supersedes any older open request before this one is inserted.
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

CREATE OR REPLACE FUNCTION app.approve_page_submission(
  p_submission_id uuid,
  p_readiness_policy_version int,
  p_override_reason text,
  p_readiness jsonb
) RETURNS TABLE (published_version_id uuid, revision bigint, path text, shell_revision bigint)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
#variable_conflict use_column
DECLARE
  actor uuid; visible RECORD; head RECORD; request RECORD; src RECORD; published RECORD;
BEGIN
  actor := app.require_actor();

  -- First scope the identifier to this session. A guessed id from another site
  -- gets the same answer as an id that does not exist.
  SELECT s.item_id, s.site_id INTO visible
    FROM public.submissions s
   WHERE s.id = p_submission_id AND app.has_site_access(s.site_id);
  IF visible IS NULL THEN RAISE EXCEPTION 'no such submission' USING ERRCODE = 'CMS03'; END IF;

  -- Page before submission is the global lock order. Saving holds the page and
  -- may supersede a submission from its trigger; using the opposite order here
  -- would turn an ordinary save/review race into a deadlock.
  SELECT p.id, p.site_id, p.revision, p.draft_version_id, p.archived_at
    INTO head FROM public.pages p WHERE p.id = visible.item_id FOR UPDATE;
  IF head IS NULL OR head.site_id <> visible.site_id THEN
    RAISE EXCEPTION 'submission does not name a page in its site' USING ERRCODE = 'CMS04';
  END IF;
  IF NOT app.can_review(head.site_id) THEN
    RAISE EXCEPTION 'not permitted to review this site' USING ERRCODE = 'CMS02';
  END IF;

  SELECT s.id, s.site_id, s.item_type, s.item_id, s.version_id, s.status
    INTO request FROM public.submissions s WHERE s.id = p_submission_id FOR UPDATE;
  IF request.item_type <> 'page' OR request.item_id <> head.id OR request.site_id <> head.site_id THEN
    RAISE EXCEPTION 'submission does not match this page' USING ERRCODE = 'CMS04';
  END IF;
  IF request.status <> 'open' THEN
    RAISE EXCEPTION 'submission is no longer waiting for review' USING ERRCODE = 'CMS04';
  END IF;
  IF head.archived_at IS NOT NULL THEN
    RAISE EXCEPTION 'page is archived' USING ERRCODE = 'CMS04';
  END IF;
  IF head.draft_version_id IS DISTINCT FROM request.version_id THEN
    RAISE EXCEPTION 'the page changed after it was submitted'
      USING ERRCODE = 'CMS01', DETAIL = head.revision::text;
  END IF;

  SELECT pv.id, pv.carries_trusted_code, pv.trusted_code_approved_by
    INTO src FROM public.page_versions pv
   WHERE pv.id = request.version_id AND pv.page_id = head.id AND pv.site_id = head.site_id;
  IF src IS NULL THEN
    RAISE EXCEPTION 'submitted version does not belong to this page' USING ERRCODE = 'CMS04';
  END IF;

  -- The queue is where a super admin can approve the exact raw-code version
  -- they are reviewing. An editor cannot turn an approval decision into a way
  -- around that boundary.
  IF src.carries_trusted_code AND src.trusted_code_approved_by IS NULL THEN
    IF NOT app.is_super_admin() THEN
      RAISE EXCEPTION 'version carries raw markup and needs super-admin approval'
        USING ERRCODE = 'CMS05';
    END IF;
    UPDATE public.page_versions
       SET trusted_code_approved_by = actor, trusted_code_approved_at = now()
     WHERE id = src.id;
    PERFORM app.write_audit(
      head.site_id, 'user', actor, 'page.approve_trusted_code', 'page', head.id,
      NULL, src.id, jsonb_build_object('submission_id', request.id)
    );
  END IF;

  SELECT * INTO published FROM app.publish_page_version(
    head.id, head.revision, request.version_id, 'user', actor,
    p_readiness_policy_version, NULLIF(btrim(COALESCE(p_override_reason, '')), ''),
    p_readiness, jsonb_build_object('submission_id', request.id)
  );

  UPDATE public.submissions
     SET status = 'approved', decided_by = actor, decided_at = now(), decision_note = ''
   WHERE id = request.id;

  PERFORM app.write_audit(
    head.site_id, 'user', actor, 'submission.approved', 'submission', request.id,
    request.version_id, published.published_version_id,
    jsonb_build_object('page_id', head.id, 'revision', published.revision)
  );

  RETURN QUERY SELECT published.published_version_id, published.revision,
                      published.path, published.shell_revision;
END
$$;

CREATE OR REPLACE FUNCTION app.reject_page_submission(
  p_submission_id uuid, p_decision_note text
) RETURNS submission_status
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE actor uuid; visible RECORD; head RECORD; request RECORD; reason text;
BEGIN
  actor := app.require_actor();
  reason := btrim(COALESCE(p_decision_note, ''));
  IF reason = '' THEN
    RAISE EXCEPTION 'explain what needs to change' USING ERRCODE = 'CMS04';
  END IF;
  IF octet_length(reason) > 4096 THEN
    RAISE EXCEPTION 'review decision note is too long' USING ERRCODE = 'CMS04';
  END IF;

  SELECT s.item_id, s.site_id INTO visible
    FROM public.submissions s
   WHERE s.id = p_submission_id AND app.has_site_access(s.site_id);
  IF visible IS NULL THEN RAISE EXCEPTION 'no such submission' USING ERRCODE = 'CMS03'; END IF;

  SELECT p.id, p.site_id, p.draft_version_id
    INTO head FROM public.pages p WHERE p.id = visible.item_id FOR UPDATE;
  IF head IS NULL OR head.site_id <> visible.site_id THEN
    RAISE EXCEPTION 'submission does not name a page in its site' USING ERRCODE = 'CMS04';
  END IF;
  IF NOT app.can_review(head.site_id) THEN
    RAISE EXCEPTION 'not permitted to review this site' USING ERRCODE = 'CMS02';
  END IF;

  SELECT s.id, s.site_id, s.item_type, s.item_id, s.version_id, s.status
    INTO request FROM public.submissions s WHERE s.id = p_submission_id FOR UPDATE;
  IF request.item_type <> 'page' OR request.item_id <> head.id OR request.site_id <> head.site_id THEN
    RAISE EXCEPTION 'submission does not match this page' USING ERRCODE = 'CMS04';
  END IF;
  IF request.status <> 'open' THEN
    RAISE EXCEPTION 'submission is no longer waiting for review' USING ERRCODE = 'CMS04';
  END IF;
  IF head.draft_version_id IS DISTINCT FROM request.version_id THEN
    RAISE EXCEPTION 'the page changed after it was submitted' USING ERRCODE = 'CMS01';
  END IF;

  UPDATE public.submissions
     SET status = 'rejected', decided_by = actor, decided_at = now(), decision_note = reason
   WHERE id = request.id;

  PERFORM app.write_audit(
    head.site_id, 'user', actor, 'submission.rejected', 'submission', request.id,
    request.version_id, NULL, jsonb_build_object('page_id', head.id, 'reason', reason)
  );
  RETURN 'rejected';
END
$$;

CREATE OR REPLACE FUNCTION app.add_page_comment(
  p_page_id uuid, p_version_id uuid, p_body text, p_mentions jsonb
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE actor uuid; page RECORD; clean_body text; comment_id uuid;
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
        OR (mention.value #>> '{}') !~
           '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$'
  ) THEN
    RAISE EXCEPTION 'every mention must name one product user' USING ERRCODE = 'CMS04';
  END IF;

  SELECT p.id, p.site_id INTO page
    FROM public.pages p WHERE p.id = p_page_id AND app.has_site_access(p.site_id);
  IF page IS NULL THEN RAISE EXCEPTION 'no such page' USING ERRCODE = 'CMS03'; END IF;
  IF p_version_id IS NOT NULL AND NOT EXISTS (
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

  INSERT INTO public.comments (
    site_id, item_type, item_id, version_id, body, mentions, author_id
  ) VALUES (
    page.site_id, 'page', page.id, p_version_id, clean_body, p_mentions, actor
  ) RETURNING id INTO comment_id;

  PERFORM app.write_audit(
    page.site_id, 'user', actor, 'review.comment_added', 'comment', comment_id,
    NULL, p_version_id, jsonb_build_object('page_id', page.id, 'mentions', p_mentions)
  );
  RETURN comment_id;
END
$$;

CREATE OR REPLACE FUNCTION app.resolve_page_comment(
  p_comment_id uuid, p_resolved boolean
) RETURNS timestamptz
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE actor uuid; comment RECORD; resolved timestamptz;
BEGIN
  actor := app.require_actor();
  SELECT c.id, c.site_id, c.item_type, c.item_id, c.author_id
    INTO comment FROM public.comments c
   WHERE c.id = p_comment_id AND app.has_site_access(c.site_id)
   FOR UPDATE;
  IF comment IS NULL THEN RAISE EXCEPTION 'no such comment' USING ERRCODE = 'CMS03'; END IF;
  IF comment.item_type <> 'page' OR NOT EXISTS (
    SELECT 1 FROM public.pages p WHERE p.id = comment.item_id AND p.site_id = comment.site_id
  ) THEN
    RAISE EXCEPTION 'comment does not belong to a page in its site' USING ERRCODE = 'CMS04';
  END IF;
  IF actor <> comment.author_id AND NOT app.can_review(comment.site_id) THEN
    RAISE EXCEPTION 'not permitted to resolve this comment' USING ERRCODE = 'CMS02';
  END IF;

  resolved := CASE WHEN p_resolved THEN now() ELSE NULL END;
  UPDATE public.comments
     SET resolved_at = resolved,
         resolved_by = CASE WHEN p_resolved THEN actor ELSE NULL END
   WHERE id = comment.id;

  PERFORM app.write_audit(
    comment.site_id, 'user', actor,
    CASE WHEN p_resolved THEN 'review.comment_resolved' ELSE 'review.comment_reopened' END,
    'comment', comment.id, NULL, NULL, jsonb_build_object('page_id', comment.item_id)
  );
  RETURN resolved;
END
$$;

-- Workflow tables remain read-only outside narrow commands. The original
-- comment grants were useful as an RLS example, but they are not a safe
-- product write surface because they accepted caller-supplied authors and
-- arbitrary resolution timestamps.
REVOKE INSERT ON public.comments FROM cms_authenticated_user;
REVOKE UPDATE (resolved_at) ON public.comments FROM cms_authenticated_user;

REVOKE ALL ON FUNCTION app.can_review(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.submit_page_for_review(uuid, bigint, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.approve_page_submission(uuid, int, text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.reject_page_submission(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.add_page_comment(uuid, uuid, text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.resolve_page_comment(uuid, boolean) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION
  app.can_review(uuid),
  app.submit_page_for_review(uuid, bigint, text),
  app.approve_page_submission(uuid, int, text, jsonb),
  app.reject_page_submission(uuid, text),
  app.add_page_comment(uuid, uuid, text, jsonb),
  app.resolve_page_comment(uuid, boolean)
TO cms_authenticated_user;

