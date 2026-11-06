-- 0034 — history labels come from operations, not from caller-supplied names.
--
-- `version_kind` includes internal values such as `restore`, but the public
-- save command used to accept every enum member. A direct authenticated caller
-- could therefore create an ordinary draft labelled "restore" or "publish".
-- History must never turn that caller-controlled label into a claim that an
-- operation happened, so the save surface is narrowed to its two real inputs.

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
  IF head.revision <> p_expected_revision THEN
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

-- Restoring an archived page would create a new draft that the ordinary save
-- command then refuses to edit. Refuse it at the operation that would create
-- that dead-end state.
CREATE OR REPLACE FUNCTION app.restore_version_as_draft(
  p_page_id uuid, p_expected_revision bigint, p_source_version_id uuid, p_note text DEFAULT ''
) RETURNS TABLE (version_id uuid, revision bigint)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE actor uuid; head RECORD; src RECORD; next_rev bigint; new_version uuid;
BEGIN
  actor := app.require_actor();
  SELECT p.id, p.site_id, p.revision, p.archived_at INTO head
    FROM public.pages p WHERE p.id = p_page_id FOR UPDATE;
  IF head IS NULL THEN RAISE EXCEPTION 'no such page' USING ERRCODE = 'CMS03'; END IF;
  IF NOT app.has_site_access(head.site_id) THEN
    RAISE EXCEPTION 'not permitted to edit this page' USING ERRCODE = 'CMS02';
  END IF;
  IF head.archived_at IS NOT NULL THEN
    RAISE EXCEPTION 'page is archived' USING ERRCODE = 'CMS04';
  END IF;
  IF head.revision <> p_expected_revision THEN
    RAISE EXCEPTION 'stale revision: expected %, head is at %', p_expected_revision, head.revision
      USING ERRCODE = 'CMS01', DETAIL = head.revision::text;
  END IF;

  SELECT pv.id, pv.content, pv.meta INTO src
    FROM public.page_versions pv WHERE pv.id = p_source_version_id AND pv.page_id = p_page_id;
  IF src IS NULL THEN
    RAISE EXCEPTION 'version does not belong to this page' USING ERRCODE = 'CMS03';
  END IF;

  next_rev := head.revision + 1;
  INSERT INTO public.page_versions (site_id, page_id, revision, content, meta,
                                    carries_trusted_code, kind, note, author_id)
  VALUES (head.site_id, p_page_id, next_rev, src.content, src.meta,
          app.content_carries_trusted_code(src.content), 'restore', COALESCE(p_note, ''), actor)
  RETURNING id INTO new_version;

  UPDATE public.pages SET revision = next_rev, draft_version_id = new_version WHERE id = p_page_id;
  PERFORM app.write_audit(head.site_id, 'user', actor, 'page.restore', 'page', p_page_id,
                          p_source_version_id, new_version, jsonb_build_object('revision', next_rev));
  RETURN QUERY SELECT new_version, next_rev;
END
$$;

-- The history query asks this exact trustworthy question for each version.
CREATE INDEX audit_log_page_publish_version
  ON public.audit_log(item_id, after_ref, created_at DESC)
  WHERE action = 'page.publish' AND item_type = 'page';
