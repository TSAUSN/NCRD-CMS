-- 0038 — the review inbox read model.
--
-- Reviewers need the submitter's name and the exact submitted/live documents,
-- but ordinary app_users RLS deliberately exposes only one's own identity.
-- These functions return the small, product-safe join the inbox needs after
-- independently applying the same submitter-or-reviewer scope as the table.

CREATE OR REPLACE FUNCTION app.review_queue(
  p_site_id uuid,
  p_include_decided boolean,
  p_limit integer
) RETURNS TABLE (
  submission_id uuid,
  site_id uuid,
  site_name text,
  page_id uuid,
  page_title text,
  page_slug text,
  version_id uuid,
  version_revision bigint,
  status submission_status,
  request_note text,
  decision_note text,
  submitted_by uuid,
  submitted_by_name text,
  submitted_by_email text,
  decided_by_name text,
  submitted_at timestamptz,
  decided_at timestamptz,
  page_revision bigint,
  current_draft_version_id uuid,
  published_version_id uuid,
  submitted_content jsonb,
  submitted_meta jsonb,
  live_content jsonb,
  live_meta jsonb,
  carries_trusted_code boolean,
  trusted_code_approved_by uuid,
  can_review boolean,
  comment_count integer,
  unresolved_comment_count integer
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE actor uuid; bounded_limit integer;
BEGIN
  actor := app.require_actor();
  bounded_limit := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 100);

  RETURN QUERY
  SELECT
    sub.id,
    sub.site_id,
    site.name,
    page.id,
    page.title,
    page.slug,
    submitted.id,
    submitted.revision,
    sub.status,
    sub.note,
    sub.decision_note,
    sub.submitted_by,
    COALESCE(NULLIF(author.display_name, ''), author.email),
    author.email,
    COALESCE(NULLIF(reviewer.display_name, ''), reviewer.email),
    sub.created_at,
    sub.decided_at,
    page.revision,
    page.draft_version_id,
    page.published_version_id,
    submitted.content,
    submitted.meta,
    live.content,
    live.meta,
    submitted.carries_trusted_code,
    submitted.trusted_code_approved_by,
    app.can_review(sub.site_id),
    COALESCE(discussion.total, 0)::integer,
    COALESCE(discussion.unresolved, 0)::integer
  FROM public.submissions sub
  JOIN public.sites site ON site.id = sub.site_id
  JOIN public.pages page
    ON page.id = sub.item_id AND page.site_id = sub.site_id
  JOIN public.page_versions submitted
    ON submitted.id = sub.version_id
   AND submitted.page_id = page.id
   AND submitted.site_id = sub.site_id
  JOIN public.app_users author ON author.id = sub.submitted_by
  LEFT JOIN public.app_users reviewer ON reviewer.id = sub.decided_by
  LEFT JOIN public.page_versions live ON live.id = page.published_version_id
  LEFT JOIN LATERAL (
    SELECT count(*) AS total,
           count(*) FILTER (WHERE c.resolved_at IS NULL) AS unresolved
      FROM public.comments c
     WHERE c.site_id = sub.site_id
       AND c.item_type = 'page'
       AND c.item_id = page.id
       AND c.version_id = sub.version_id
  ) discussion ON true
  WHERE sub.item_type = 'page'
    AND app.has_site_access(sub.site_id)
    AND (sub.submitted_by = actor OR app.can_review(sub.site_id))
    AND (p_site_id IS NULL OR sub.site_id = p_site_id)
    AND (COALESCE(p_include_decided, false) OR sub.status = 'open')
  ORDER BY (sub.status = 'open') DESC, sub.created_at DESC
  LIMIT bounded_limit;
END
$$;

CREATE OR REPLACE FUNCTION app.review_comments(p_submission_id uuid)
RETURNS TABLE (
  id uuid,
  body text,
  mentions jsonb,
  author_id uuid,
  author_name text,
  author_email text,
  created_at timestamptz,
  resolved_at timestamptz,
  resolved_by uuid,
  resolved_by_name text
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE actor uuid; request RECORD;
BEGIN
  actor := app.require_actor();
  SELECT s.id, s.site_id, s.item_id, s.version_id, s.submitted_by
    INTO request
    FROM public.submissions s
   WHERE s.id = p_submission_id
     AND s.item_type = 'page'
     AND app.has_site_access(s.site_id)
     AND (s.submitted_by = actor OR app.can_review(s.site_id));
  IF request IS NULL THEN
    RAISE EXCEPTION 'no such submission' USING ERRCODE = 'CMS03';
  END IF;

  RETURN QUERY
  SELECT c.id, c.body, c.mentions, c.author_id,
         COALESCE(NULLIF(author.display_name, ''), author.email), author.email,
         c.created_at, c.resolved_at, c.resolved_by,
         COALESCE(NULLIF(resolver.display_name, ''), resolver.email)
    FROM public.comments c
    JOIN public.app_users author ON author.id = c.author_id
    LEFT JOIN public.app_users resolver ON resolver.id = c.resolved_by
   WHERE c.site_id = request.site_id
     AND c.item_type = 'page'
     AND c.item_id = request.item_id
     AND c.version_id = request.version_id
   ORDER BY c.created_at;
END
$$;

CREATE OR REPLACE FUNCTION app.review_people(p_site_id uuid)
RETURNS TABLE (id uuid, display_name text, email text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF NOT app.has_site_access(p_site_id) THEN
    RAISE EXCEPTION 'no such site' USING ERRCODE = 'CMS03';
  END IF;

  RETURN QUERY
  SELECT DISTINCT u.id, COALESCE(NULLIF(u.display_name, ''), u.email), u.email
    FROM public.app_users u
   WHERE u.status = 'active'
     AND (
       EXISTS (SELECT 1 FROM public.site_memberships m
                WHERE m.site_id = p_site_id AND m.user_id = u.id)
       OR EXISTS (SELECT 1 FROM public.global_roles g
                  WHERE g.user_id = u.id AND g.role = 'super_admin')
     )
   ORDER BY 2, 3;
END
$$;

REVOKE ALL ON FUNCTION app.review_queue(uuid, boolean, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.review_comments(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.review_people(uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION
  app.review_queue(uuid, boolean, integer),
  app.review_comments(uuid),
  app.review_people(uuid)
TO cms_authenticated_user;

