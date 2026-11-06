-- 0043 — a real navigation head/version command surface and page auto-sync.
--
-- Navigation existed in the normalized schema and public renderer from day one,
-- but nothing except the seed could author it. This migration makes the stored
-- tree bounded and validated, adds CAS save/publish commands, and preserves the
-- V1 behaviour Jon explicitly liked: publishing a page adds it to an auto-sync
-- navigation without making an unrelated navigation draft live.

ALTER TABLE public.navigations
  ADD COLUMN mode text NOT NULL DEFAULT 'auto'
    CHECK (mode IN ('auto', 'manual'));

CREATE OR REPLACE FUNCTION app.navigation_node_defect(p_node jsonb, p_allow_children boolean)
RETURNS text
LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog, public AS $$
DECLARE target jsonb; child jsonb; defect text; label text; url text;
BEGIN
  IF jsonb_typeof(p_node) IS DISTINCT FROM 'object' THEN RETURN 'a navigation item is not an object'; END IF;
  IF (p_node - ARRAY['label','target','visible','children']) <> '{}'::jsonb THEN
    RETURN 'a navigation item has an unknown property';
  END IF;

  label := p_node->>'label';
  IF jsonb_typeof(p_node->'label') IS DISTINCT FROM 'string'
     OR btrim(label) = '' OR char_length(label) > 80 THEN
    RETURN 'a navigation label must be between 1 and 80 characters';
  END IF;
  IF jsonb_typeof(p_node->'visible') IS DISTINCT FROM 'boolean' THEN
    RETURN 'a navigation item needs a visibility choice';
  END IF;

  target := p_node->'target';
  IF jsonb_typeof(target) IS DISTINCT FROM 'object' THEN RETURN 'a navigation target is not an object'; END IF;
  IF target->>'type' = 'page' THEN
    IF (target - ARRAY['type','page_id']) <> '{}'::jsonb
       OR jsonb_typeof(target->'page_id') IS DISTINCT FROM 'string'
       OR NOT (target->>'page_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$') THEN
      RETURN 'a page navigation target is invalid';
    END IF;
  ELSIF target->>'type' = 'url' THEN
    url := target->>'url';
    IF (target - ARRAY['type','url']) <> '{}'::jsonb
       OR jsonb_typeof(target->'url') IS DISTINCT FROM 'string'
       OR char_length(url) > 2048
       OR url ~ '[[:space:]\\]'
       OR url ~* '^https://[^/]*@'
       OR NOT ((starts_with(url, '/') AND NOT starts_with(url, '//')) OR url ~* '^https://') THEN
      RETURN 'an external navigation target must be an internal path or an https URL';
    END IF;
  ELSE
    RETURN 'a navigation target has an unknown type';
  END IF;

  IF p_node ? 'children' THEN
    IF NOT p_allow_children THEN RETURN 'navigation supports only one nested level'; END IF;
    IF jsonb_typeof(p_node->'children') IS DISTINCT FROM 'array'
       OR jsonb_array_length(p_node->'children') > 20 THEN
      RETURN 'a navigation item has too many children';
    END IF;
    FOR child IN SELECT value FROM jsonb_array_elements(p_node->'children') LOOP
      defect := app.navigation_node_defect(child, false);
      IF defect IS NOT NULL THEN RETURN defect; END IF;
    END LOOP;
  END IF;
  RETURN NULL;
END
$$;

CREATE OR REPLACE FUNCTION app.navigation_tree_defect(p_tree jsonb)
RETURNS text
LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog, public AS $$
DECLARE node jsonb; defect text; node_count integer := 0;
BEGIN
  IF jsonb_typeof(p_tree) IS DISTINCT FROM 'array' THEN RETURN 'navigation must be a list'; END IF;
  IF jsonb_array_length(p_tree) > 50 THEN RETURN 'navigation has more than 50 top-level items'; END IF;
  FOR node IN SELECT value FROM jsonb_array_elements(p_tree) LOOP
    node_count := node_count + 1 + CASE
      WHEN jsonb_typeof(node->'children') = 'array' THEN jsonb_array_length(node->'children') ELSE 0 END;
    IF node_count > 100 THEN RETURN 'navigation has more than 100 items'; END IF;
    defect := app.navigation_node_defect(node, true);
    IF defect IS NOT NULL THEN RETURN defect; END IF;
  END LOOP;
  RETURN NULL;
END
$$;

CREATE OR REPLACE FUNCTION app.navigation_without_page(p_tree jsonb, p_page_id uuid)
RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, public AS $$
  SELECT COALESCE(jsonb_agg(
    CASE WHEN node.value ? 'children' THEN
      jsonb_set(node.value, '{children}', COALESCE((
        SELECT jsonb_agg(child.value ORDER BY child.ordinality)
          FROM jsonb_array_elements(node.value->'children') WITH ORDINALITY child(value, ordinality)
         WHERE child.value->'target'->>'type' <> 'page'
            OR child.value->'target'->>'page_id' <> p_page_id::text
      ), '[]'::jsonb), false)
    ELSE node.value END
    ORDER BY node.ordinality
  ) FILTER (WHERE node.value->'target'->>'type' <> 'page'
                 OR node.value->'target'->>'page_id' <> p_page_id::text), '[]'::jsonb)
  FROM jsonb_array_elements(p_tree) WITH ORDINALITY node(value, ordinality)
$$;

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
  IF head.revision <> p_expected_revision THEN
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
  IF head.revision <> p_expected_revision THEN
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
          'label', (SELECT p.title FROM public.pages p WHERE p.id = page_to_add),
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
      'label', NEW.title,
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

CREATE TRIGGER pages_sync_navigation
  AFTER UPDATE OF published_version_id, archived_at ON public.pages
  FOR EACH ROW EXECUTE FUNCTION app.sync_navigation_after_page_publication();

-- Sites that already existed when this capability arrived have published
-- pages but no automatic page-publication event left to fire. Bring only
-- automatic menus forward, preserve an unrelated private draft, and use the
-- same capacity limits as future syncs.
DO $$
DECLARE head RECORD; page_row RECORD; next_tree jsonb; node_count integer;
        next_rev bigint; created uuid; shell_rev bigint;
BEGIN
  FOR head IN
    SELECT n.id, n.site_id, n.revision, n.draft_version_id, n.published_version_id, live.tree
      FROM public.navigations n
      JOIN public.navigation_versions live ON live.id = n.published_version_id
     WHERE n.mode = 'auto'
     FOR UPDATE OF n
  LOOP
    next_tree := head.tree;
    SELECT COALESCE(sum(1 + CASE WHEN jsonb_typeof(node->'children') = 'array'
      THEN jsonb_array_length(node->'children') ELSE 0 END), 0)::integer INTO node_count
      FROM jsonb_array_elements(next_tree) node;
    FOR page_row IN
      SELECT p.id, p.title FROM public.pages p
       WHERE p.site_id = head.site_id AND p.published_version_id IS NOT NULL AND p.archived_at IS NULL
       ORDER BY p.sort_index, p.title
    LOOP
      IF NOT EXISTS (
        WITH RECURSIVE nodes(node) AS (
          SELECT value FROM jsonb_array_elements(next_tree)
          UNION ALL
          SELECT child.value FROM nodes parent CROSS JOIN LATERAL
            jsonb_array_elements(CASE WHEN jsonb_typeof(parent.node->'children') = 'array'
              THEN parent.node->'children' ELSE '[]'::jsonb END) child
        ) SELECT 1 FROM nodes WHERE node->'target'->>'type' = 'page'
          AND node->'target'->>'page_id' = page_row.id::text
      ) THEN
        IF jsonb_array_length(next_tree) >= 50 OR node_count >= 100 THEN EXIT; END IF;
        next_tree := next_tree || jsonb_build_array(jsonb_build_object(
          'label', page_row.title,
          'target', jsonb_build_object('type','page','page_id',page_row.id),
          'visible', true));
        node_count := node_count + 1;
      END IF;
    END LOOP;
    IF next_tree <> head.tree THEN
      next_rev := head.revision + 1;
      INSERT INTO public.navigation_versions (site_id, navigation_id, revision, tree, author_id)
      VALUES (head.site_id, head.id, next_rev, next_tree, NULL) RETURNING id INTO created;
      UPDATE public.navigations SET revision = next_rev, published_version_id = created,
        draft_version_id = CASE WHEN draft_version_id = head.published_version_id THEN created ELSE draft_version_id END
       WHERE id = head.id;
      shell_rev := app.rebuild_site_shell(head.site_id);
      PERFORM app.write_audit(head.site_id, 'system', NULL, 'navigation.backfill', 'navigation', head.id,
                              head.published_version_id, created,
                              jsonb_build_object('shell_revision', shell_rev));
      PERFORM app.emit_outbox(head.site_id, 'site_shell.published',
                              jsonb_build_object(
                                'site_id', head.site_id, 'revision', shell_rev,
                                'paths', COALESCE((SELECT jsonb_agg(r.path ORDER BY r.path)
                                  FROM public.published_routes r WHERE r.site_id = head.site_id), '[]'::jsonb)));
    END IF;
  END LOOP;
END
$$;

REVOKE ALL ON FUNCTION app.navigation_node_defect(jsonb, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.navigation_tree_defect(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.navigation_without_page(jsonb, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.save_navigation_draft(uuid, bigint, jsonb, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.publish_navigation(uuid, bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.sync_navigation_after_page_publication() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION app.save_navigation_draft(uuid, bigint, jsonb, text) TO cms_authenticated_user;
GRANT EXECUTE ON FUNCTION app.publish_navigation(uuid, bigint) TO cms_authenticated_user;

ALTER FUNCTION app.navigation_node_defect(jsonb, boolean) OWNER TO cms_migration_owner;
ALTER FUNCTION app.navigation_tree_defect(jsonb) OWNER TO cms_migration_owner;
ALTER FUNCTION app.navigation_without_page(jsonb, uuid) OWNER TO cms_migration_owner;
ALTER FUNCTION app.save_navigation_draft(uuid, bigint, jsonb, text) OWNER TO cms_migration_owner;
ALTER FUNCTION app.publish_navigation(uuid, bigint) OWNER TO cms_migration_owner;
ALTER FUNCTION app.sync_navigation_after_page_publication() OWNER TO cms_migration_owner;
