-- 0039 — an open review request is decided through the review command.
--
-- Editors may publish ordinary drafts directly. Once a contributor has frozen
-- an exact version for review, publishing that same head through the ordinary
-- editor wrapper would leave the submission open after its content was live.
-- Approval calls publish_page_version directly, so this guard closes only the
-- bypass and does not create a second publication implementation.

CREATE OR REPLACE FUNCTION app.publish_page(
  p_page_id uuid, p_expected_revision bigint,
  p_readiness_policy_version int,
  p_override_reason text,
  p_readiness jsonb
) RETURNS TABLE (published_version_id uuid, revision bigint, path text, shell_revision bigint)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
#variable_conflict use_column
DECLARE actor uuid; draft uuid;
BEGIN
  actor := app.require_actor();
  IF p_expected_revision IS NULL THEN
    RAISE EXCEPTION 'publishing from the editor requires the revision you loaded'
      USING ERRCODE = 'CMS04';
  END IF;
  SELECT draft_version_id INTO draft FROM public.pages WHERE id = p_page_id;

  IF EXISTS (
    SELECT 1 FROM public.submissions s
     WHERE s.item_type = 'page'
       AND s.item_id = p_page_id
       AND s.version_id = draft
       AND s.status = 'open'
  ) THEN
    RAISE EXCEPTION 'this exact version is waiting for review; approve or return the submission'
      USING ERRCODE = 'CMS04';
  END IF;

  RETURN QUERY SELECT * FROM app.publish_page_version(
    p_page_id, p_expected_revision, draft, 'user', actor,
    p_readiness_policy_version, p_override_reason, p_readiness, '{}'::jsonb
  );
END
$$;

REVOKE ALL ON FUNCTION app.publish_page(uuid, bigint, int, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.publish_page(uuid, bigint, int, text, jsonb)
TO cms_authenticated_user;

