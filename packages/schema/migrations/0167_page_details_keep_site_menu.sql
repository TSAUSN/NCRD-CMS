-- Native Page details preserves the site menu, including when its head changes in another tab.
-- Original-design callers retain their existing checkbox and atomic menu contract.
CREATE OR REPLACE FUNCTION app.save_page_details(p_page uuid,p_revision bigint,p_title text,p_address text,p_parent uuid,p_in_menu boolean,p_menu_revision bigint)
RETURNS TABLE(revision bigint,draft_version_id uuid,menu_revision bigint,title text,address text,parent_page_id uuid,in_menu boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
#variable_conflict use_column
DECLARE head RECORD; menu_head RECORD; renamed RECORD; parent_revision bigint; changed boolean; original_design boolean; wanted_menu boolean;
BEGIN
 PERFORM app.require_actor();SELECT * INTO head FROM public.pages WHERE id=p_page FOR UPDATE;
 IF head.id IS NULL OR head.archived_at IS NOT NULL THEN RAISE EXCEPTION 'This page is unavailable.' USING ERRCODE='CMS03';END IF;
 IF NOT app.can_publish(head.site_id) THEN RAISE EXCEPTION 'An editor can change page details on this site.' USING ERRCODE='CMS02';END IF;
 IF head.revision IS DISTINCT FROM p_revision THEN RAISE EXCEPTION 'The page changed.' USING ERRCODE='CMS01',DETAIL=head.revision::text;END IF;
 SELECT EXISTS(SELECT 1 FROM public.site_file_heads h JOIN public.site_file_versions v ON v.id=h.draft_version_id WHERE h.site_id=head.site_id AND v.bundle ? 'original') INTO original_design;
 IF original_design AND p_in_menu IS NULL THEN RAISE EXCEPTION 'Choose whether this page appears in the menu.' USING ERRCODE='CMS04';END IF;
 SELECT n.revision,v.tree INTO menu_head FROM public.navigations n JOIN public.navigation_versions v ON v.id=n.draft_version_id WHERE n.site_id=head.site_id FOR UPDATE OF n;
 wanted_menu:=app.page_menu_contains(menu_head.tree,p_page);
 IF NOT original_design AND p_in_menu IS NOT NULL AND p_in_menu IS DISTINCT FROM wanted_menu THEN RAISE EXCEPTION 'Use Header & menu to change where this page appears.' USING ERRCODE='CMS04';END IF;
 IF original_design THEN wanted_menu:=p_in_menu;END IF;
 changed:=app.page_menu_contains(menu_head.tree,p_page) IS DISTINCT FROM wanted_menu;
 IF changed AND menu_head.revision IS DISTINCT FROM p_menu_revision THEN RAISE EXCEPTION 'The menu changed. Reopen Page settings before saving.' USING ERRCODE='CMS01',DETAIL=head.revision::text;END IF;
 SELECT * INTO renamed FROM app.rename_page(p_page,p_revision,p_title,p_address);
 parent_revision:=app.set_page_parent(p_page,renamed.revision,p_parent);
 SELECT n.revision,v.tree INTO menu_head FROM public.navigations n JOIN public.navigation_versions v ON v.id=n.draft_version_id WHERE n.site_id=head.site_id;
 IF changed THEN
  SELECT n.revision INTO menu_revision FROM app.save_navigation_draft(head.site_id,menu_head.revision,app.page_menu_visibility(menu_head.tree,p_page,btrim(p_title),wanted_menu),'manual') n;
 ELSE menu_revision:=menu_head.revision;END IF;
 RETURN QUERY SELECT p.revision,p.draft_version_id,menu_revision,p.title,p.slug,p.parent_page_id,wanted_menu FROM public.pages p WHERE p.id=p_page;
END $$;
REVOKE ALL ON FUNCTION app.page_menu_contains(jsonb,uuid),app.page_menu_visibility(jsonb,uuid,text,boolean),app.save_page_details(uuid,bigint,text,text,uuid,boolean,bigint) FROM PUBLIC;
ALTER FUNCTION app.page_menu_contains(jsonb,uuid) OWNER TO cms_migration_owner;
ALTER FUNCTION app.page_menu_visibility(jsonb,uuid,text,boolean) OWNER TO cms_migration_owner;
ALTER FUNCTION app.save_page_details(uuid,bigint,text,text,uuid,boolean,bigint) OWNER TO cms_migration_owner;
GRANT EXECUTE ON FUNCTION app.save_page_details(uuid,bigint,text,text,uuid,boolean,bigint) TO cms_authenticated_user;

-- A native page rename never renames its existing automatic menu label on publish.
-- First-publication additions and removal of unavailable pages keep the existing engine.
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

  IF OLD.published_version_id IS NOT NULL AND NEW.published_version_id IS NOT NULL
     AND NEW.archived_at IS NULL AND NOT EXISTS(SELECT 1 FROM public.site_file_heads h
       JOIN public.site_file_versions v ON v.id=h.draft_version_id WHERE h.site_id=NEW.site_id AND v.bundle ? 'original') THEN
    RETURN NEW;
  END IF;

  next_tree := app.navigation_without_page(published.tree, NEW.id);
  IF NEW.published_version_id IS NOT NULL AND NEW.archived_at IS NULL THEN
    IF app.navigation_has_page(published.tree,NEW.id) THEN
      IF EXISTS(SELECT 1 FROM public.site_file_heads h JOIN public.site_file_versions v ON v.id=h.draft_version_id WHERE h.site_id=NEW.site_id AND v.bundle ? 'original') THEN
        next_tree:=app.navigation_refresh_page_label(published.tree,NEW.id,
          (SELECT left(page_title,80) FROM public.page_versions WHERE id=OLD.published_version_id),
          (SELECT left(page_title,80) FROM public.page_versions WHERE id=NEW.published_version_id));
      ELSE next_tree:=published.tree; END IF;
    ELSE
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
