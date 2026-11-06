CREATE TABLE public.site_releases (
  id uuid PRIMARY KEY,
  site_id uuid NOT NULL REFERENCES public.sites(id),
  status text NOT NULL DEFAULT 'planned' CHECK(status IN ('planned','applied','cancelled')),
  snapshot jsonb NOT NULL CHECK(app.json_within(snapshot,262144)),
  context_hash text NOT NULL CHECK(context_hash ~ '^[0-9a-f]{64}$'),
  after_hash text NOT NULL CHECK(after_hash ~ '^[0-9a-f]{64}$'),
  preview_report jsonb NOT NULL CHECK(app.json_within(preview_report,1048576)),
  created_by uuid NOT NULL REFERENCES public.app_users(id),
  finished_by uuid REFERENCES public.app_users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  UNIQUE(site_id,id),
  CHECK((status='planned' AND finished_at IS NULL AND finished_by IS NULL)
    OR (status<>'planned' AND finished_at IS NOT NULL AND finished_by IS NOT NULL))
);
CREATE TABLE public.site_release_pages (
  release_id uuid NOT NULL,
  site_id uuid NOT NULL,
  page_id uuid NOT NULL,
  version_id uuid NOT NULL,
  PRIMARY KEY(release_id,version_id),
  FOREIGN KEY(site_id,release_id) REFERENCES public.site_releases(site_id,id) ON DELETE CASCADE,
  FOREIGN KEY(site_id,page_id) REFERENCES public.pages(site_id,id),
  FOREIGN KEY(page_id,version_id) REFERENCES public.page_versions(page_id,id)
);
CREATE INDEX site_release_pages_version ON public.site_release_pages(version_id);
ALTER TABLE public.site_releases OWNER TO cms_migration_owner;
ALTER TABLE public.site_release_pages OWNER TO cms_migration_owner;
ALTER TABLE public.site_releases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.site_release_pages ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.site_releases,public.site_release_pages TO cms_authenticated_user;
CREATE POLICY site_releases_read ON public.site_releases FOR SELECT TO cms_authenticated_user USING(app.has_site_access(site_id));
CREATE POLICY site_release_pages_read ON public.site_release_pages FOR SELECT TO cms_authenticated_user USING(app.has_site_access(site_id));

CREATE FUNCTION app.release_fingerprint(p_site_id uuid) RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE state jsonb;
BEGIN
  PERFORM app.require_actor();
  IF NOT app.has_site_access(p_site_id) THEN RAISE EXCEPTION 'site not available' USING ERRCODE='CMS02'; END IF;
  SELECT jsonb_build_object(
    'site',(SELECT jsonb_build_object('name',name,'status',status,'revision',revision) FROM public.sites WHERE id=p_site_id),
    'shell',(SELECT payload FROM public.published_site_shells WHERE site_id=p_site_id),
    'theme',(SELECT jsonb_build_object('revision',h.revision,'published_revision',v.revision,'current',h.draft_version_id=h.published_version_id)
      FROM public.themes h LEFT JOIN public.theme_versions v ON v.id=h.published_version_id WHERE h.site_id=p_site_id),
    'navigation',(SELECT jsonb_build_object('revision',h.revision,'published_revision',v.revision,'current',h.draft_version_id=h.published_version_id)
      FROM public.navigations h LEFT JOIN public.navigation_versions v ON v.id=h.published_version_id WHERE h.site_id=p_site_id),
    'frame',(SELECT jsonb_agg(jsonb_build_object('kind',h.kind,'revision',h.revision,'published_revision',v.revision,'current',h.draft_version_id=h.published_version_id) ORDER BY h.kind)
      FROM public.global_elements h LEFT JOIN public.global_element_versions v ON v.id=h.published_version_id WHERE h.site_id=p_site_id),
    'collections',(SELECT jsonb_agg(jsonb_build_object('id',c.id,'schema',c.published_schema_version_id,'revision',c.revision,
      'entries_revision',c.entry_revision,'published_entries_revision',c.published_entry_revision,
      'entries',(SELECT jsonb_agg(jsonb_build_object('id',e.id,'key',e.stable_key,'schema',v.schema_version_id,'values',v."values",'order',e.published_sort_index,'archived',e.published_archived_at) ORDER BY e.id)
        FROM public.collection_entries e LEFT JOIN public.collection_entry_versions v ON v.id=e.published_version_id WHERE e.collection_id=c.id)) ORDER BY c.id)
      FROM public.collections c WHERE c.site_id=p_site_id),
    'routes',(SELECT jsonb_agg(jsonb_build_object('path',path,'page',page_id,'version',page_version_id,'manifest',render_manifest) ORDER BY path)
      FROM public.published_routes WHERE site_id=p_site_id),
    'domains',(SELECT jsonb_agg(jsonb_build_object('host',hostname_normalized,'kind',kind,'status',status,'target',redirect_to_domain_id) ORDER BY hostname_normalized)
      FROM public.domains WHERE site_id=p_site_id),
    'media',(SELECT jsonb_agg(jsonb_build_object('id',m.id,'status',m.status,'revision',m.revision,'variants',
      (SELECT jsonb_agg(jsonb_build_object('kind',v.kind,'hash',v.content_hash) ORDER BY v.kind) FROM public.media_variants v WHERE v.media_id=m.id)) ORDER BY m.id)
      FROM public.media m WHERE m.id IN(SELECT media_id FROM public.media_usage WHERE site_id=p_site_id))
  ) INTO state;
  RETURN encode(sha256(convert_to(state::text,'UTF8')),'hex');
END $$;

-- Acquire publishing dependencies before any simulation writes. Page heads
-- precede navigation, matching the ordinary page-publication command's order.
CREATE FUNCTION app.lock_release_site(p_site_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE status text;
BEGIN
  PERFORM app.require_actor();
  IF NOT app.can_publish(p_site_id) THEN RAISE EXCEPTION 'only an editor may release this site' USING ERRCODE='CMS02'; END IF;
  SELECT s.status::text INTO status FROM public.sites s WHERE s.id=p_site_id FOR UPDATE;
  IF status IS NULL OR status='archived' THEN RAISE EXCEPTION 'this site is unavailable for publication' USING ERRCODE='CMS04'; END IF;
  PERFORM 1 FROM public.pages WHERE site_id=p_site_id ORDER BY id FOR UPDATE;
  PERFORM 1 FROM public.navigations WHERE site_id=p_site_id ORDER BY id FOR UPDATE;
  PERFORM 1 FROM public.themes WHERE site_id=p_site_id ORDER BY id FOR UPDATE;
  PERFORM 1 FROM public.global_elements WHERE site_id=p_site_id ORDER BY kind,id FOR UPDATE;
  PERFORM 1 FROM public.collections WHERE site_id=p_site_id ORDER BY id FOR UPDATE;
  PERFORM 1 FROM public.site_settings WHERE site_id=p_site_id ORDER BY id FOR UPDATE;
  PERFORM 1 FROM public.domains WHERE site_id=p_site_id ORDER BY id FOR UPDATE;
  PERFORM 1 FROM public.media WHERE site_id=p_site_id OR id IN(
    SELECT media_id FROM public.media_usage WHERE site_id=p_site_id) ORDER BY id FOR UPDATE;
END $$;

CREATE FUNCTION app.record_site_release(p_id uuid,p_site_id uuid,p_snapshot jsonb,p_context_hash text,p_after_hash text,p_report jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE actor uuid; old RECORD; item jsonb; page uuid; version uuid;
BEGIN
  actor:=app.require_actor();
  IF NOT app.can_publish(p_site_id) THEN RAISE EXCEPTION 'only an editor may plan a release' USING ERRCODE='CMS02'; END IF;
  SELECT * INTO old FROM public.site_releases WHERE id=p_id FOR UPDATE;
  IF old IS NOT NULL THEN
    IF old.site_id<>p_site_id OR old.created_by<>actor OR old.snapshot<>p_snapshot OR old.context_hash<>p_context_hash OR old.after_hash<>p_after_hash THEN
      RAISE EXCEPTION 'this release request was used for a different plan' USING ERRCODE='CMS04';
    END IF;
    RETURN old.id;
  END IF;
  IF jsonb_typeof(p_snapshot) IS DISTINCT FROM 'array' OR jsonb_typeof(p_report) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'a release needs an item list and readiness reports' USING ERRCODE='CMS04';
  END IF;
  IF jsonb_array_length(p_snapshot) NOT BETWEEN 1 AND 200 THEN
    RAISE EXCEPTION 'select between 1 and 200 release items' USING ERRCODE='CMS04';
  END IF;
  INSERT INTO public.site_releases(id,site_id,snapshot,context_hash,after_hash,preview_report,created_by)
    VALUES(p_id,p_site_id,p_snapshot,p_context_hash,p_after_hash,p_report,actor);
  -- Keep both the before-publication pages and every selected draft reachable
  -- from history, including autosaves that would otherwise become prunable.
  INSERT INTO public.site_release_pages(release_id,site_id,page_id,version_id)
    SELECT p_id,p_site_id,id,published_version_id FROM public.pages
     WHERE site_id=p_site_id AND published_version_id IS NOT NULL ON CONFLICT DO NOTHING;
  FOR item IN SELECT value FROM jsonb_array_elements(p_snapshot) LOOP
    IF item->>'type'='page' THEN
      page:=(item->>'id')::uuid; version:=(item->>'versionId')::uuid;
      INSERT INTO public.site_release_pages(release_id,site_id,page_id,version_id)
        VALUES(p_id,p_site_id,page,version) ON CONFLICT DO NOTHING;
    END IF;
  END LOOP;
  PERFORM app.write_audit(p_site_id,'user',actor,'release.plan','site_release',p_id,NULL,NULL,
    jsonb_build_object('items',jsonb_array_length(p_snapshot),'context_hash',p_context_hash));
  RETURN p_id;
END $$;

CREATE FUNCTION app.lock_site_release(p_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE release RECORD;
BEGIN
  PERFORM app.require_actor();
  SELECT * INTO release FROM public.site_releases WHERE id=p_id FOR UPDATE;
  IF release IS NULL THEN RAISE EXCEPTION 'release not found' USING ERRCODE='CMS03'; END IF;
  IF NOT app.can_publish(release.site_id) THEN RAISE EXCEPTION 'only an editor may execute this release' USING ERRCODE='CMS02'; END IF;
  RETURN to_jsonb(release);
END $$;

CREATE FUNCTION app.finish_site_release(p_id uuid,p_cancel boolean,p_detail jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE actor uuid; release RECORD;
BEGIN
  actor:=app.require_actor();
  SELECT * INTO release FROM public.site_releases WHERE id=p_id FOR UPDATE;
  IF release IS NULL THEN RAISE EXCEPTION 'release not found' USING ERRCODE='CMS03'; END IF;
  IF NOT app.can_publish(release.site_id) THEN RAISE EXCEPTION 'only an editor may finish a release' USING ERRCODE='CMS02'; END IF;
  IF p_cancel IS NULL THEN RAISE EXCEPTION 'choose publish or cancel explicitly' USING ERRCODE='CMS04'; END IF;
  IF p_cancel AND release.status='cancelled' THEN RETURN; END IF;
  IF release.status<>'planned' THEN RAISE EXCEPTION 'release already finished' USING ERRCODE='CMS04'; END IF;
  IF p_cancel IS NOT TRUE AND app.release_fingerprint(release.site_id) IS DISTINCT FROM release.after_hash THEN
    RAISE EXCEPTION 'the published site does not match the reviewed release outcome' USING ERRCODE='CMS04';
  END IF;
  UPDATE public.site_releases SET status=CASE WHEN p_cancel THEN 'cancelled' ELSE 'applied' END,
    finished_by=actor,finished_at=now() WHERE id=p_id;
  PERFORM app.write_audit(release.site_id,'user',actor,CASE WHEN p_cancel THEN 'release.cancel' ELSE 'release.publish' END,
    'site_release',p_id,NULL,NULL,COALESCE(p_detail,'{}'));
END $$;

REVOKE ALL ON FUNCTION app.release_fingerprint(uuid),app.lock_release_site(uuid),app.record_site_release(uuid,uuid,jsonb,text,text,jsonb),app.lock_site_release(uuid),app.finish_site_release(uuid,boolean,jsonb) FROM PUBLIC;
ALTER FUNCTION app.release_fingerprint(uuid) OWNER TO cms_migration_owner;
ALTER FUNCTION app.lock_release_site(uuid) OWNER TO cms_migration_owner;
ALTER FUNCTION app.record_site_release(uuid,uuid,jsonb,text,text,jsonb) OWNER TO cms_migration_owner;
ALTER FUNCTION app.lock_site_release(uuid) OWNER TO cms_migration_owner;
ALTER FUNCTION app.finish_site_release(uuid,boolean,jsonb) OWNER TO cms_migration_owner;
GRANT EXECUTE ON FUNCTION app.release_fingerprint(uuid),app.lock_release_site(uuid),app.record_site_release(uuid,uuid,jsonb,text,text,jsonb),app.lock_site_release(uuid),app.finish_site_release(uuid,boolean,jsonb) TO cms_authenticated_user;

CREATE FUNCTION app.navigation_has_page(p_tree jsonb,p_page_id uuid) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,public AS $$
  WITH RECURSIVE nodes(node) AS (
    SELECT value FROM jsonb_array_elements(p_tree)
    UNION ALL SELECT child.value FROM nodes
      CROSS JOIN LATERAL jsonb_array_elements(COALESCE(nodes.node->'children','[]')) child
  ) SELECT EXISTS(SELECT 1 FROM nodes WHERE node->'target'->>'type'='page' AND node->'target'->>'page_id'=p_page_id::text)
$$;

CREATE FUNCTION app.navigation_refresh_page_label(p_tree jsonb,p_page_id uuid,p_old text,p_new text) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,public AS $$
DECLARE node jsonb; result jsonb:='[]';
BEGIN
  FOR node IN SELECT value FROM jsonb_array_elements(p_tree) LOOP
    IF node->'target'->>'type'='page' AND node->'target'->>'page_id'=p_page_id::text
       AND p_old IS NOT NULL AND node->>'label'=p_old THEN node:=jsonb_set(node,'{label}',to_jsonb(p_new)); END IF;
    IF node ? 'children' THEN
      node:=jsonb_set(node,'{children}',app.navigation_refresh_page_label(node->'children',p_page_id,p_old,p_new));
    END IF;
    result:=result||jsonb_build_array(node);
  END LOOP;
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION app.navigation_has_page(jsonb,uuid),app.navigation_refresh_page_label(jsonb,uuid,text,text) FROM PUBLIC;
ALTER FUNCTION app.navigation_has_page(jsonb,uuid) OWNER TO cms_migration_owner;
ALTER FUNCTION app.navigation_refresh_page_label(jsonb,uuid,text,text) OWNER TO cms_migration_owner;

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
    IF app.navigation_has_page(published.tree,NEW.id) THEN
      next_tree:=app.navigation_refresh_page_label(published.tree,NEW.id,
        (SELECT left(page_title,80) FROM public.page_versions WHERE id=OLD.published_version_id),
        (SELECT left(page_title,80) FROM public.page_versions WHERE id=NEW.published_version_id));
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
