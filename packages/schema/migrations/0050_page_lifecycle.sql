-- 0050 — complete the ordinary page lifecycle.
--
-- Page creation, saving and publishing were governed, but the everyday list
-- actions were absent. These commands keep the same rules: derive the actor,
-- lock one head, compare the revision, preserve immutable content, write audit
-- and invalidate public output in the same transaction.

-- Existing installations may contain older address formats. Validate new
-- authoring commands without imposing a breaking constraint on those rows.
ALTER TABLE public.page_versions ADD COLUMN page_title text, ADD COLUMN page_slug text;
UPDATE public.page_versions pv SET page_title = p.title, page_slug = p.slug
  FROM public.pages p WHERE p.id = pv.page_id;
ALTER TABLE public.page_versions ALTER COLUMN page_title SET NOT NULL,
  ALTER COLUMN page_slug SET NOT NULL;

CREATE FUNCTION app.snapshot_page_identity() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  SELECT COALESCE(NEW.page_title, p.title), COALESCE(NEW.page_slug, p.slug)
    INTO NEW.page_title, NEW.page_slug FROM public.pages p WHERE p.id = NEW.page_id;
  RETURN NEW;
END
$$;
CREATE TRIGGER page_versions_snapshot_identity BEFORE INSERT ON public.page_versions
  FOR EACH ROW EXECUTE FUNCTION app.snapshot_page_identity();

-- Keep the renderer's policy/collection checks and replace only mutable head
-- identity with the exact saved version's identity, including scheduled work.
ALTER FUNCTION app.build_render_manifest_internal(uuid) RENAME TO build_render_manifest_before_identity;
CREATE FUNCTION app.build_render_manifest_internal(p_page_version_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE manifest jsonb; identity RECORD;
BEGIN
  manifest := app.build_render_manifest_before_identity(p_page_version_id);
  SELECT page_title, page_slug INTO identity FROM public.page_versions WHERE id = p_page_version_id;
  RETURN jsonb_set(manifest, '{page}', (manifest->'page') || jsonb_build_object(
    'title', identity.page_title, 'path', app.page_path(identity.page_slug)));
END
$$;

-- A draft cannot take the still-live address of another page. Conversely a
-- pinned historical publication cannot take another page's reserved address.
CREATE FUNCTION app.reserve_page_address() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.site_id::text, 50));
  IF EXISTS (SELECT 1 FROM public.published_routes
    WHERE site_id = NEW.site_id AND path = app.page_path(NEW.slug) AND page_id <> NEW.id) THEN
    RAISE EXCEPTION 'another live page still uses that address' USING ERRCODE = '23505';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER pages_reserve_address BEFORE INSERT OR UPDATE OF slug ON public.pages
  FOR EACH ROW EXECUTE FUNCTION app.reserve_page_address();

-- Publishing after a draft address change must retire the old route. The
-- public projection is intentionally keyed by path, so an UPSERT at the new
-- path alone would leave the previous URL serving forever.
CREATE OR REPLACE FUNCTION app.keep_one_published_route_per_page() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE retired RECORD; page_revision bigint;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.site_id::text, 50));
  IF EXISTS (SELECT 1 FROM public.published_routes
    WHERE site_id = NEW.site_id AND path = NEW.path AND page_id <> NEW.page_id)
    OR EXISTS (SELECT 1 FROM public.pages
      WHERE site_id = NEW.site_id AND app.page_path(slug) = NEW.path AND id <> NEW.page_id) THEN
    RAISE EXCEPTION 'another page already uses that address' USING ERRCODE = '23505';
  END IF;
  SELECT revision INTO page_revision FROM public.pages WHERE id = NEW.page_id;
  FOR retired IN DELETE FROM public.published_routes
    WHERE site_id = NEW.site_id AND page_id = NEW.page_id AND path <> NEW.path RETURNING path
  LOOP
    PERFORM app.emit_outbox(NEW.site_id, 'page.unpublished', jsonb_build_object(
      'page_id', NEW.page_id, 'path', retired.path, 'revision', page_revision));
  END LOOP;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS published_routes_one_path_per_page ON public.published_routes;
CREATE TRIGGER published_routes_one_path_per_page
  BEFORE INSERT OR UPDATE OF site_id, page_id, path ON public.published_routes
  FOR EACH ROW EXECUTE FUNCTION app.keep_one_published_route_per_page();

CREATE OR REPLACE FUNCTION app.rename_page(
  p_page_id uuid, p_expected_revision bigint, p_title text, p_slug text
) RETURNS TABLE (revision bigint, draft_version_id uuid, old_path text, new_path text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
#variable_conflict use_column
DECLARE actor uuid; head RECORD; source RECORD; next_rev bigint; created uuid := NULL;
        clean_title text; clean_slug text;
BEGIN
  actor := app.require_actor();
  SELECT p.id, p.site_id, p.revision, p.slug, p.title, p.draft_version_id,
         p.published_version_id, p.archived_at
    INTO head FROM public.pages p WHERE p.id = p_page_id FOR UPDATE;
  IF head IS NULL THEN RAISE EXCEPTION 'no such page' USING ERRCODE = 'CMS03'; END IF;
  IF NOT app.can_publish(head.site_id) THEN
    RAISE EXCEPTION 'not permitted to manage pages on this site' USING ERRCODE = 'CMS02';
  END IF;
  IF head.archived_at IS NOT NULL THEN
    RAISE EXCEPTION 'page is archived' USING ERRCODE = 'CMS04';
  END IF;
  IF head.revision IS DISTINCT FROM p_expected_revision THEN
    RAISE EXCEPTION 'stale revision: expected %, head is at %', p_expected_revision, head.revision
      USING ERRCODE = 'CMS01', DETAIL = head.revision::text;
  END IF;

  clean_title := btrim(COALESCE(p_title, ''));
  clean_slug := lower(btrim(COALESCE(p_slug, '')));
  IF char_length(clean_title) NOT BETWEEN 1 AND 200 THEN
    RAISE EXCEPTION 'a page title must be between 1 and 200 characters' USING ERRCODE = 'CMS04';
  END IF;
  IF char_length(clean_slug) > 160
     OR (clean_slug <> '' AND clean_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$') THEN
    RAISE EXCEPTION 'a page address uses lowercase letters, numbers and single dashes' USING ERRCODE = 'CMS04';
  END IF;
  IF clean_title = head.title AND clean_slug = head.slug THEN
    RETURN QUERY SELECT head.revision, head.draft_version_id,
      app.page_path(head.slug), app.page_path(head.slug);
    RETURN;
  END IF;

  next_rev := head.revision + 1;
  IF head.draft_version_id IS NOT NULL THEN
    SELECT pv.* INTO source FROM public.page_versions pv
     WHERE pv.id = head.draft_version_id AND pv.page_id = head.id;
    IF source IS NULL THEN
      RAISE EXCEPTION 'page draft points at no version' USING ERRCODE = 'CMS04';
    END IF;
    INSERT INTO public.page_versions (
      site_id, page_id, revision, content, meta, carries_trusted_code,
      kind, note, author_id, page_title, page_slug
    ) VALUES (
      head.site_id, head.id, next_rev, source.content, source.meta,
      source.carries_trusted_code, 'checkpoint', 'Page name or address changed', actor,
      clean_title, clean_slug
    ) RETURNING id INTO created;
  END IF;

  UPDATE public.pages
     SET title = clean_title, slug = clean_slug, revision = next_rev,
         draft_version_id = COALESCE(created, draft_version_id)
   WHERE id = head.id;

  PERFORM app.write_audit(
    head.site_id, 'user', actor, 'page.rename', 'page', head.id,
    head.draft_version_id, COALESCE(created, head.draft_version_id),
    jsonb_build_object(
      'revision', next_rev,
      'old_path', app.page_path(head.slug),
      'new_path', app.page_path(clean_slug),
      'old_title', head.title,
      'new_title', clean_title
    )
  );
  RETURN QUERY SELECT next_rev, COALESCE(created, head.draft_version_id),
    app.page_path(head.slug), app.page_path(clean_slug);
END
$$;

CREATE OR REPLACE FUNCTION app.archive_page(p_page_id uuid, p_expected_revision bigint)
RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE actor uuid; head RECORD; next_rev bigint; page_path text; stale RECORD; retired RECORD;
BEGIN
  actor := app.require_actor();
  SELECT p.id, p.site_id, p.revision, p.slug, p.draft_version_id,
         p.published_version_id, p.archived_at
    INTO head FROM public.pages p WHERE p.id = p_page_id FOR UPDATE;
  IF head IS NULL THEN RAISE EXCEPTION 'no such page' USING ERRCODE = 'CMS03'; END IF;
  IF NOT app.can_publish(head.site_id) THEN
    RAISE EXCEPTION 'not permitted to manage pages on this site' USING ERRCODE = 'CMS02';
  END IF;
  IF head.archived_at IS NOT NULL THEN
    RAISE EXCEPTION 'page is already archived' USING ERRCODE = 'CMS04';
  END IF;
  IF head.revision IS DISTINCT FROM p_expected_revision THEN
    RAISE EXCEPTION 'stale revision: expected %, head is at %', p_expected_revision, head.revision
      USING ERRCODE = 'CMS01', DETAIL = head.revision::text;
  END IF;

  next_rev := head.revision + 1;
  page_path := app.page_path(head.slug);
  FOR retired IN DELETE FROM public.published_routes
    WHERE site_id = head.site_id AND page_id = head.id RETURNING path
  LOOP
    PERFORM app.emit_outbox(head.site_id, 'page.unpublished', jsonb_build_object(
      'page_id', head.id, 'path', retired.path, 'revision', next_rev));
  END LOOP;
  UPDATE public.pages SET archived_at = clock_timestamp(), status = 'archived',
         published_version_id = NULL, revision = next_rev WHERE id = head.id;

  FOR stale IN
    UPDATE public.submissions SET status = 'superseded'
     WHERE item_type = 'page' AND item_id = head.id AND status = 'open'
     RETURNING id, version_id
  LOOP
    PERFORM app.write_audit(head.site_id, 'user', actor, 'submission.superseded',
      'submission', stale.id, stale.version_id, stale.version_id,
      jsonb_build_object('page_id', head.id, 'reason', 'page_archived'));
  END LOOP;

  PERFORM app.write_audit(head.site_id, 'user', actor, 'page.archive', 'page', head.id,
    head.published_version_id, NULL,
    jsonb_build_object('revision', next_rev, 'path', page_path, 'recoverable', true));
  RETURN next_rev;
END
$$;

CREATE OR REPLACE FUNCTION app.restore_archived_page(p_page_id uuid, p_expected_revision bigint)
RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE actor uuid; head RECORD; next_rev bigint;
BEGIN
  actor := app.require_actor();
  SELECT p.id, p.site_id, p.revision, p.draft_version_id, p.archived_at
    INTO head FROM public.pages p WHERE p.id = p_page_id FOR UPDATE;
  IF head IS NULL THEN RAISE EXCEPTION 'no such page' USING ERRCODE = 'CMS03'; END IF;
  IF NOT app.can_publish(head.site_id) THEN
    RAISE EXCEPTION 'not permitted to manage pages on this site' USING ERRCODE = 'CMS02';
  END IF;
  IF head.archived_at IS NULL THEN
    RAISE EXCEPTION 'page is not archived' USING ERRCODE = 'CMS04';
  END IF;
  IF EXISTS (SELECT 1 FROM public.sites WHERE id = head.site_id AND status = 'archived') THEN
    RAISE EXCEPTION 'restore the site before restoring its pages' USING ERRCODE = 'CMS04';
  END IF;
  IF head.revision IS DISTINCT FROM p_expected_revision THEN
    RAISE EXCEPTION 'stale revision: expected %, head is at %', p_expected_revision, head.revision
      USING ERRCODE = 'CMS01', DETAIL = head.revision::text;
  END IF;
  next_rev := head.revision + 1;
  UPDATE public.pages SET archived_at = NULL, status = 'draft', revision = next_rev
   WHERE id = head.id;
  PERFORM app.write_audit(head.site_id, 'user', actor, 'page.restore_archived', 'page', head.id,
    head.draft_version_id, head.draft_version_id,
    jsonb_build_object('revision', next_rev, 'live_unchanged', true));
  RETURN next_rev;
END
$$;

REVOKE ALL ON FUNCTION app.keep_one_published_route_per_page() FROM PUBLIC;
REVOKE ALL ON FUNCTION app.snapshot_page_identity() FROM PUBLIC;
REVOKE ALL ON FUNCTION app.reserve_page_address() FROM PUBLIC;
REVOKE ALL ON FUNCTION app.build_render_manifest_internal(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.rename_page(uuid, bigint, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.archive_page(uuid, bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.restore_archived_page(uuid, bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.rename_page(uuid, bigint, text, text) TO cms_authenticated_user;
GRANT EXECUTE ON FUNCTION app.archive_page(uuid, bigint) TO cms_authenticated_user;
GRANT EXECUTE ON FUNCTION app.restore_archived_page(uuid, bigint) TO cms_authenticated_user;

ALTER FUNCTION app.keep_one_published_route_per_page() OWNER TO cms_migration_owner;
ALTER FUNCTION app.snapshot_page_identity() OWNER TO cms_migration_owner;
ALTER FUNCTION app.reserve_page_address() OWNER TO cms_migration_owner;
ALTER FUNCTION app.build_render_manifest_internal(uuid) OWNER TO cms_migration_owner;
ALTER FUNCTION app.rename_page(uuid, bigint, text, text) OWNER TO cms_migration_owner;
ALTER FUNCTION app.archive_page(uuid, bigint) OWNER TO cms_migration_owner;
ALTER FUNCTION app.restore_archived_page(uuid, bigint) OWNER TO cms_migration_owner;

CREATE OR REPLACE FUNCTION app.publish_navigation(
  p_site_id uuid, p_expected_revision bigint
) RETURNS TABLE (version_id uuid, revision bigint, shell_revision bigint)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
#variable_conflict use_column
DECLARE actor uuid; head RECORD; draft RECORD; next_rev bigint; created uuid; shell_rev bigint;
        page_to_add uuid; node_count integer; defect text;
BEGIN
  actor := app.require_actor();
  SELECT n.id, n.site_id, n.revision, n.draft_version_id, n.published_version_id, n.mode
    INTO head FROM public.navigations n WHERE n.site_id = p_site_id FOR UPDATE;
  IF head IS NULL THEN RAISE EXCEPTION 'no navigation for that site' USING ERRCODE = 'CMS03'; END IF;
  IF NOT app.can_publish(p_site_id) THEN
    RAISE EXCEPTION 'not permitted to publish navigation on this site' USING ERRCODE = 'CMS02';
  END IF;
  IF head.revision IS DISTINCT FROM p_expected_revision THEN
    RAISE EXCEPTION 'stale revision: expected %, head is at %', p_expected_revision, head.revision
      USING ERRCODE = 'CMS01', DETAIL = head.revision::text;
  END IF;
  SELECT nv.tree INTO draft FROM public.navigation_versions nv
   WHERE nv.id = head.draft_version_id AND nv.navigation_id = head.id;
  IF draft.tree IS NULL THEN RAISE EXCEPTION 'navigation has no draft' USING ERRCODE = 'CMS04'; END IF;

  -- Auto mode cannot publish stale links or accidentally omit a newly live
  -- page merely because the page went live while this draft was open.
  IF head.mode = 'auto' THEN
    SELECT COALESCE(sum(1 + CASE WHEN jsonb_typeof(node->'children') = 'array'
      THEN jsonb_array_length(node->'children') ELSE 0 END), 0)::integer INTO node_count
      FROM jsonb_array_elements(draft.tree) node;
    FOR page_to_add IN SELECT p.id FROM public.pages p
      WHERE p.site_id = p_site_id AND p.published_version_id IS NOT NULL AND p.archived_at IS NULL
      ORDER BY p.sort_index, p.title
    LOOP
      IF NOT EXISTS (
        WITH RECURSIVE nodes(node) AS (
          SELECT value FROM jsonb_array_elements(draft.tree)
          UNION ALL
          SELECT child.value FROM nodes parent CROSS JOIN LATERAL
            jsonb_array_elements(CASE WHEN jsonb_typeof(parent.node->'children') = 'array'
              THEN parent.node->'children' ELSE '[]'::jsonb END) child
        ) SELECT 1 FROM nodes WHERE node->'target'->>'type' = 'page'
          AND node->'target'->>'page_id' = page_to_add::text
      ) THEN
        -- A page publication must never manufacture a tree the authoring
        -- boundary would refuse. At capacity, the page still goes live and an
        -- editor can deliberately make room in this menu.
        IF jsonb_array_length(draft.tree) >= 50 OR node_count >= 100 THEN EXIT; END IF;
        draft.tree := draft.tree || jsonb_build_array(jsonb_build_object(
          'label', (SELECT left(pv.page_title, 80) FROM public.pages p
            JOIN public.page_versions pv ON pv.id = p.published_version_id WHERE p.id = page_to_add),
          'target', jsonb_build_object('type','page','page_id',page_to_add), 'visible', true));
        node_count := node_count + 1;
      END IF;
    END LOOP;
  END IF;
  defect := app.navigation_tree_defect(draft.tree);
  IF defect IS NOT NULL THEN RAISE EXCEPTION '%', defect USING ERRCODE = 'CMS04'; END IF;

  next_rev := head.revision + 1;
  INSERT INTO public.navigation_versions (site_id, navigation_id, revision, tree, author_id)
  VALUES (p_site_id, head.id, next_rev, draft.tree, actor) RETURNING id INTO created;
  UPDATE public.navigations
     SET revision = next_rev, draft_version_id = created, published_version_id = created
   WHERE id = head.id;
  shell_rev := app.rebuild_site_shell(p_site_id);
  PERFORM app.write_audit(p_site_id, 'user', actor, 'navigation.publish', 'navigation', head.id,
                          head.published_version_id, created,
                          jsonb_build_object('revision', next_rev, 'mode', head.mode, 'shell_revision', shell_rev));
  PERFORM app.emit_outbox(p_site_id, 'site_shell.published',
                          jsonb_build_object(
                            'site_id', p_site_id, 'revision', shell_rev,
                            'paths', COALESCE((SELECT jsonb_agg(r.path ORDER BY r.path)
                              FROM public.published_routes r WHERE r.site_id = p_site_id), '[]'::jsonb)));
  RETURN QUERY SELECT created, next_rev, shell_rev;
END
$$;

CREATE OR REPLACE FUNCTION app.restore_version_as_draft(
  p_page_id uuid, p_expected_revision bigint, p_source_version_id uuid, p_note text DEFAULT ''
) RETURNS TABLE (version_id uuid, revision bigint)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE actor uuid; head RECORD; src RECORD; next_rev bigint; new_version uuid;
BEGIN
  actor := app.require_actor();
  SELECT p.id, p.site_id, p.revision, p.archived_at, p.title, p.slug INTO head
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

  SELECT pv.id, pv.content, pv.meta, pv.page_title, pv.page_slug INTO src
    FROM public.page_versions pv WHERE pv.id = p_source_version_id AND pv.page_id = p_page_id;
  IF src IS NULL THEN
    RAISE EXCEPTION 'version does not belong to this page' USING ERRCODE = 'CMS03';
  END IF;

  IF (head.title IS DISTINCT FROM src.page_title OR head.slug IS DISTINCT FROM src.page_slug)
     AND NOT app.can_publish(head.site_id) THEN
    RAISE EXCEPTION 'an editor must restore a version that changes the page name or address' USING ERRCODE = 'CMS02';
  END IF;
  next_rev := head.revision + 1;
  INSERT INTO public.page_versions (site_id, page_id, revision, content, meta,
                                    carries_trusted_code, kind, note, author_id, page_title, page_slug)
  VALUES (head.site_id, p_page_id, next_rev, src.content, src.meta,
          app.content_carries_trusted_code(src.content), 'restore', COALESCE(p_note, ''), actor, src.page_title, src.page_slug)
  RETURNING id INTO new_version;

  UPDATE public.pages SET revision = next_rev, draft_version_id = new_version,
    title = src.page_title, slug = src.page_slug WHERE id = p_page_id;
  PERFORM app.write_audit(head.site_id, 'user', actor, 'page.restore', 'page', p_page_id,
                          p_source_version_id, new_version, jsonb_build_object('revision', next_rev));
  RETURN QUERY SELECT new_version, next_rev;
END
$$;

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

  IF NOT app.can_publish_as(p_authorizing_user, head.site_id) THEN
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

  SELECT pv.id, pv.carries_trusted_code, pv.trusted_code_approved_by
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
CREATE OR REPLACE FUNCTION app.unpublish_page_internal(
  p_page_id uuid, p_expected_revision bigint, p_actor_type actor_type,
  p_authorizing_user uuid, p_scheduled_action_id uuid
) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE head RECORD; next_rev bigint; page_path text; retired RECORD;
BEGIN
  SELECT p.id, p.site_id, p.revision, p.slug, p.published_version_id, p.archived_at INTO head
    FROM public.pages p WHERE p.id = p_page_id FOR UPDATE;
  IF head IS NULL THEN RAISE EXCEPTION 'no such page' USING ERRCODE = 'CMS03'; END IF;
  IF NOT app.can_publish_as(p_authorizing_user, head.site_id) THEN
    RAISE EXCEPTION 'not permitted to publish on this site' USING ERRCODE = 'CMS02';
  END IF;
  IF p_expected_revision IS NOT NULL AND head.revision <> p_expected_revision THEN
    RAISE EXCEPTION 'stale revision: expected %, head is at %', p_expected_revision, head.revision
      USING ERRCODE = 'CMS01', DETAIL = head.revision::text;
  END IF;

  IF head.archived_at IS NOT NULL THEN
    RAISE EXCEPTION 'page is archived' USING ERRCODE = 'CMS04';
  END IF;
  page_path := COALESCE((SELECT path FROM public.published_routes
    WHERE site_id = head.site_id AND page_id = head.id LIMIT 1), app.page_path(head.slug));
  next_rev := head.revision + 1;

  FOR retired IN DELETE FROM public.published_routes
    WHERE site_id = head.site_id AND page_id = head.id AND path <> page_path RETURNING path
  LOOP
    PERFORM app.emit_outbox(head.site_id, 'page.unpublished', jsonb_build_object(
      'page_id', head.id, 'path', retired.path, 'revision', next_rev));
  END LOOP;
  DELETE FROM public.published_routes WHERE site_id = head.site_id AND page_id = head.id;
  UPDATE public.pages SET published_version_id = NULL, revision = next_rev, status = 'draft'
   WHERE id = p_page_id;

  PERFORM app.write_audit(head.site_id, p_actor_type,
                          CASE WHEN p_actor_type = 'user' THEN p_authorizing_user ELSE NULL END,
                          'page.unpublish', 'page', p_page_id, head.published_version_id, NULL,
                          jsonb_build_object('revision', next_rev, 'path', page_path,
                                             'authorized_by', p_authorizing_user,
                                             'scheduled_action_id', p_scheduled_action_id));
  PERFORM app.emit_outbox(head.site_id, 'page.unpublished',
                          jsonb_build_object('page_id', p_page_id, 'path', page_path,
                                             'revision', next_rev));
  RETURN next_rev;
END
$$;

--

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
  SELECT nv.tree INTO published FROM public.navigation_versions nv
   WHERE nv.id = head.published_version_id AND nv.navigation_id = head.id;
  IF published IS NULL THEN RETURN NEW; END IF;

  next_tree := app.navigation_without_page(published.tree, NEW.id);
  IF NEW.published_version_id IS NOT NULL AND NEW.archived_at IS NULL THEN
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
