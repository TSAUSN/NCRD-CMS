-- 0093 — future sites start privately; existing publication pointers are retained.
-- Mark only future sites. The first route cannot commit without deliberately
-- published design, frame and navigation, including when called outside the UI.
ALTER TABLE public.sites ADD COLUMN initial_release_required boolean NOT NULL DEFAULT false;
ALTER TABLE public.sites ALTER COLUMN initial_release_required SET DEFAULT true;

CREATE OR REPLACE FUNCTION app.create_site(
  p_slug text, p_name text, p_kind site_kind, p_staging_hostname text,
  p_theme_tokens jsonb, p_nav_tree jsonb
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE actor uuid; new_site uuid; theme_head uuid; nav_head uuid; v uuid;
BEGIN
  actor := app.require_actor();
  IF NOT app.is_super_admin() THEN
    RAISE EXCEPTION 'only a super admin may create sites' USING ERRCODE = 'CMS02';
  END IF;

  INSERT INTO public.sites (slug, name, kind, status, staging_hostname, created_by)
  VALUES (p_slug, p_name, p_kind, 'in_progress', lower(p_staging_hostname), actor)
  RETURNING id INTO new_site;

  -- Keep saved singleton drafts available for authenticated previews.
  -- Creation never opts these versions into public delivery.
  INSERT INTO public.themes (site_id) VALUES (new_site) RETURNING id INTO theme_head;
  INSERT INTO public.theme_versions (site_id, theme_id, revision, tokens, author_id)
  VALUES (new_site, theme_head, 1, p_theme_tokens, actor) RETURNING id INTO v;
  UPDATE public.themes SET revision = 1, draft_version_id = v WHERE id = theme_head;

  INSERT INTO public.navigations (site_id) VALUES (new_site) RETURNING id INTO nav_head;
  INSERT INTO public.navigation_versions (site_id, navigation_id, revision, tree, author_id)
  VALUES (new_site, nav_head, 1, COALESCE(p_nav_tree, '[]'::jsonb), actor) RETURNING id INTO v;
  UPDATE public.navigations SET revision = 1, draft_version_id = v WHERE id = nav_head;

  INSERT INTO public.site_settings (site_id) VALUES (new_site);

  PERFORM app.write_audit(new_site, 'user', actor, 'site.create', 'site', new_site, NULL, NULL,
                          jsonb_build_object('slug', p_slug, 'kind', p_kind));
  RETURN new_site;
END
$$;

CREATE OR REPLACE FUNCTION app.insert_default_global_elements()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE head_id uuid; version_id uuid;
BEGIN
  INSERT INTO public.global_elements (site_id, kind, use_on_live)
  VALUES (NEW.id, 'header', true) RETURNING id INTO head_id;
  INSERT INTO public.global_element_versions (site_id, global_element_id, revision, content, author_id)
  VALUES (NEW.id, head_id, 1, app.default_header_content(NEW.name), NEW.created_by) RETURNING id INTO version_id;
  UPDATE public.global_elements SET revision = 1, draft_version_id = version_id WHERE id = head_id;

  INSERT INTO public.global_elements (site_id, kind, use_on_live)
  VALUES (NEW.id, 'footer', true) RETURNING id INTO head_id;
  INSERT INTO public.global_element_versions (site_id, global_element_id, revision, content, author_id)
  VALUES (NEW.id, head_id, 1, app.default_footer_content(NEW.name), NEW.created_by) RETURNING id INTO version_id;
  UPDATE public.global_elements SET revision = 1, draft_version_id = version_id WHERE id = head_id;
  RETURN NEW;
END
$$;

-- The old insertion hook exposed a shell during setup. The shell is now built
-- by deliberate publication; private previews compose the saved heads directly.
DROP TRIGGER site_settings_publish_initial_shell ON public.site_settings;

CREATE FUNCTION app.check_initial_site_release() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE required boolean;
BEGIN
  SELECT initial_release_required INTO required FROM public.sites WHERE id=NEW.site_id FOR UPDATE;
  IF NOT COALESCE(required,false) OR NOT EXISTS(SELECT 1 FROM public.published_routes WHERE site_id=NEW.site_id) THEN RETURN NEW; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.themes WHERE site_id=NEW.site_id AND published_version_id IS NOT NULL)
    OR NOT EXISTS(SELECT 1 FROM public.navigations WHERE site_id=NEW.site_id AND published_version_id IS NOT NULL)
    OR (SELECT count(*) FROM public.global_elements WHERE site_id=NEW.site_id AND published_version_id IS NOT NULL)<>2 THEN
    RAISE EXCEPTION 'review the first site release with its theme, header, footer and navigation before publishing pages'
      USING ERRCODE='CMS04';
  END IF;
  UPDATE public.sites SET initial_release_required=false WHERE id=NEW.site_id;
  RETURN NEW;
END
$$;
-- Dependencies may refer to newly published pages, so validate the complete
-- transaction rather than requiring an impossible command order. Rollback-only
-- release previews leave this pending check and every publication rolled back.
CREATE CONSTRAINT TRIGGER published_routes_initial_release
  AFTER INSERT OR UPDATE ON public.published_routes DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION app.check_initial_site_release();
REVOKE ALL ON FUNCTION app.check_initial_site_release() FROM PUBLIC,cms_authenticated_user,cms_public_renderer,cms_worker;
ALTER FUNCTION app.check_initial_site_release() OWNER TO cms_migration_owner;

-- Every anonymous delivery path (pages, site-owned images, shared frame media
-- and documents) starts with host resolution. Partial publication may prepare a
-- shell internally, but it does not expose even its media before the first
-- complete release commits. Authenticated previews use their separate readers.
CREATE OR REPLACE FUNCTION public_api.resolve_host(p_host text)
RETURNS TABLE(site_id uuid,canonical_host text,is_staging boolean,redirect_to text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT d.site_id,COALESCE(target.hostname_normalized,d.hostname_normalized),false,
    CASE WHEN d.kind='redirect' THEN target.hostname_normalized END
  FROM public.domains d JOIN public.sites s ON s.id=d.site_id
  LEFT JOIN public.domains target ON target.id=d.redirect_to_domain_id
  WHERE d.hostname_normalized=p_host AND d.status='live' AND s.status<>'archived' AND s.archived_at IS NULL
    AND NOT s.initial_release_required
    AND (d.kind<>'redirect' OR target.status='live')
  UNION ALL
  SELECT s.id,s.staging_hostname,true,NULL FROM public.sites s
  WHERE s.staging_hostname=p_host AND s.status<>'archived' AND s.archived_at IS NULL
    AND NOT s.initial_release_required
    AND NOT EXISTS(SELECT 1 FROM public.domains d WHERE d.hostname_normalized=p_host AND d.status='live')
  LIMIT 1
$$;

-- Private initial previews may show an unpublished collection's empty layout.
-- They never expose draft records or change a schema's publication pointer.
-- Existing published schemas continue through the complete ordinary resolver.
CREATE FUNCTION app.resolve_initial_preview_repeat(p_site_id uuid,p_reader_key text,p_selection jsonb,p_item jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE collection_row RECORD; defect text;
BEGIN
  IF EXISTS(SELECT 1 FROM public.collections WHERE site_id=p_site_id AND reader_key=p_reader_key AND published_schema_version_id IS NOT NULL) THEN
    RETURN app.resolve_collection_repeat(p_site_id,p_reader_key,p_selection,p_item);
  END IF;
  SELECT c.id,c.reader_key,v.id AS schema_id,v.revision,v.fields INTO collection_row
    FROM public.collections c JOIN public.collection_schema_versions v ON v.id=c.draft_schema_version_id AND v.collection_id=c.id
    WHERE c.site_id=p_site_id AND c.reader_key=p_reader_key;
  IF collection_row.id IS NULL THEN RAISE EXCEPTION 'collection binding is missing or belongs to another site' USING ERRCODE='CMS04'; END IF;
  defect:=app.collection_repeat_item_defect(p_item,collection_row.fields);
  IF defect IS NOT NULL THEN RAISE EXCEPTION 'collection binding is incompatible: %',defect USING ERRCODE='CMS04'; END IF;
  IF jsonb_typeof(p_selection) IS DISTINCT FROM 'object' OR (
    (p_selection->>'mode'='automatic' AND (p_selection-ARRAY['mode','limit'])='{}'::jsonb
      AND jsonb_typeof(p_selection->'limit')='number' AND p_selection->>'limit' ~ '^(100|[1-9][0-9]?)$')
    OR (p_selection->>'mode'='manual' AND (p_selection-ARRAY['mode','stableKeys'])='{}'::jsonb
      AND jsonb_typeof(p_selection->'stableKeys')='array' AND jsonb_array_length(p_selection->'stableKeys')<=100)
  ) IS NOT TRUE THEN RAISE EXCEPTION 'collection selection is invalid' USING ERRCODE='CMS04'; END IF;
  -- This private, empty renderer envelope uses its existing schema keys. The
  -- schema pin is a draft; it is never written to a public route or receipt.
  RETURN jsonb_build_object('kind','collection','collectionId',collection_row.id,'readerKey',collection_row.reader_key,
    'publishedSchemaVersionId',collection_row.schema_id,'publishedSchemaRevision',collection_row.revision::text,
    'publishedEntryRevision','0','schemas','[]'::jsonb,'entries','[]'::jsonb);
END $$;

CREATE FUNCTION app.resolve_initial_preview_repeat_values(
  p_site_id uuid,p_doc jsonb,p_values jsonb
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public AS $$
DECLARE result jsonb:=p_values; repeat_node jsonb; binding jsonb; field_name text;
BEGIN
  IF jsonb_typeof(result)<>'object' THEN RAISE EXCEPTION 'section values are not an object' USING ERRCODE='CMS04'; END IF;
  FOR repeat_node IN
    WITH RECURSIVE walk(node) AS (
      SELECT value FROM jsonb_array_elements(p_doc->'nodes')
      UNION ALL
      SELECT child.value FROM walk CROSS JOIN LATERAL jsonb_array_elements(
        CASE WHEN walk.node->>'type'='element' AND jsonb_typeof(walk.node->'children')='array'
             THEN walk.node->'children' ELSE '[]'::jsonb END) child)
    SELECT node FROM walk WHERE node->>'type'='repeat'
  LOOP
    field_name:=repeat_node->>'field'; binding:=result->field_name;
    IF jsonb_typeof(binding)<>'object'
       OR (binding-ARRAY['readerKey','selection'])<>'{}'::jsonb
       OR NOT(binding ?& ARRAY['readerKey','selection'])
       OR jsonb_typeof(binding->'readerKey')<>'string' THEN
      RAISE EXCEPTION 'repeat field % has no valid collection binding',field_name USING ERRCODE='CMS04';
    END IF;
    result:=jsonb_set(result,ARRAY[field_name],app.resolve_initial_preview_repeat(
      p_site_id,binding->>'readerKey',binding->'selection',repeat_node->'item'),false);
  END LOOP;
  RETURN result;
END
$$;

CREATE FUNCTION app.build_render_manifest_core(p_page_version_id uuid, p_initial_preview boolean) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v record; sections jsonb; resolved_sections jsonb; expected int; resolved int; stale text;
BEGIN
  SELECT pv.id,pv.content,pv.meta,pv.page_id,pv.site_id,p.title,p.slug INTO v
    FROM public.page_versions pv JOIN public.pages p ON p.id=pv.page_id WHERE pv.id=p_page_version_id;
  IF v IS NULL THEN RAISE EXCEPTION 'no such page version' USING ERRCODE='CMS03'; END IF;
  SELECT count(*) INTO expected FROM jsonb_array_elements(v.content);
  SELECT jsonb_agg(jsonb_build_object(
    'def',jsonb_build_object('section_def_id',d.id,'version',dv.version,'slug',d.slug,
      'compiled_ast',dv.compiled_ast,'css',dv.compiled_css,'slots',dv.slots,'render_hash',dv.render_hash,
      'sanitizer_policy_version',dv.sanitizer_policy_version,'css_policy_version',dv.css_policy_version,
      'definition_kind',dv.definition_kind,'structured_doc',dv.structured_doc,
      'structured_schema_version',dv.structured_schema_version),
    'instance',jsonb_build_object('label',item.value->>'label',
      'hidden',COALESCE((item.value->>'hidden')::boolean,false),
      'hidden_at',COALESCE(item.value->'hidden_at','[]'::jsonb),
      'values',COALESCE(item.value->'values','{}'::jsonb),
      'custom_css',COALESCE(item.value->>'custom_css',''),'raw_html',COALESCE(item.value->>'raw_html','')))
    ORDER BY item.ordinality) INTO sections
   FROM jsonb_array_elements(v.content) WITH ORDINALITY item(value,ordinality)
   JOIN public.section_defs d ON d.id=(item.value->>'section_def_id')::uuid
   JOIN public.section_def_versions dv ON dv.section_def_id=d.id AND dv.version=(item.value->>'section_def_version')::int;
  resolved:=COALESCE(jsonb_array_length(sections),0);
  IF resolved<>expected THEN RAISE EXCEPTION 'page version refers to unresolved sections' USING ERRCODE='CMS04'; END IF;
  SELECT string_agg(DISTINCT (section->'def'->>'slug')||' ('||defect||')','; ') INTO stale
   FROM jsonb_array_elements(COALESCE(sections,'[]'::jsonb)) section
   CROSS JOIN LATERAL (SELECT COALESCE(
     app.structured_section_defect(section->'def'->>'definition_kind',section->'def'->'structured_doc',(section->'def'->>'structured_schema_version')::int),
     app.render_ast_defect(section->'def'->'compiled_ast',(section->'def'->>'sanitizer_policy_version')::int),
     app.compiled_css_defect(section->'def'->>'css',(section->'def'->>'css_policy_version')::int,'.cms-section--'||(section->'def'->>'slug'))) defect) check_result
   WHERE defect IS NOT NULL;
  IF stale IS NOT NULL THEN RAISE EXCEPTION 'this page uses a section that needs revalidating: %',stale USING ERRCODE='CMS04'; END IF;
  SELECT COALESCE(jsonb_agg(jsonb_set(section,ARRAY['instance','values'],
    CASE WHEN section->'def'->>'definition_kind'='structured' THEN CASE WHEN p_initial_preview THEN app.resolve_initial_preview_repeat_values(
      v.site_id,section->'def'->'structured_doc',section->'instance'->'values') ELSE app.resolve_collection_repeat_values(
      v.site_id,section->'def'->'structured_doc',section->'instance'->'values') END
      ELSE section->'instance'->'values' END,false) ORDER BY ordinality),'[]'::jsonb)
    INTO resolved_sections FROM jsonb_array_elements(COALESCE(sections,'[]'::jsonb)) WITH ORDINALITY item(section,ordinality);
  IF NOT app.json_within(resolved_sections,1800000) THEN RAISE EXCEPTION 'resolved collection content makes this page manifest too large' USING ERRCODE='CMS04'; END IF;
  RETURN jsonb_build_object('page',jsonb_build_object('id',v.page_id,'version_id',v.id,'title',v.title,'path',app.page_path(v.slug)),
    'meta',COALESCE(v.meta,'{}'::jsonb),'sections',resolved_sections,
    'dependency_revision',md5(resolved_sections::text));
END
$$;


-- One core still supplies both paths; every ordinary publication remains strict.
CREATE OR REPLACE FUNCTION app.build_render_manifest_before_identity(p_page_version_id uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
  SELECT app.build_render_manifest_core(p_page_version_id,false)
$$;

CREATE FUNCTION app.build_initial_preview_manifest(p_page_version_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE version RECORD; manifest jsonb; sections jsonb;
BEGIN
  PERFORM app.require_actor();
  SELECT v.*,s.initial_release_required INTO version FROM public.page_versions v JOIN public.sites s ON s.id=v.site_id WHERE v.id=p_page_version_id;
  IF version.id IS NULL OR NOT app.has_site_access(version.site_id) THEN RAISE EXCEPTION 'page preview is not available' USING ERRCODE='CMS03'; END IF;
  IF NOT version.initial_release_required THEN RETURN app.build_render_manifest_internal(p_page_version_id); END IF;
  manifest:=app.build_render_manifest_core(p_page_version_id,true);
  manifest:=jsonb_set(manifest,'{page}',manifest->'page'||jsonb_build_object('title',version.page_title,'path',app.page_path(version.page_slug)));
  SELECT COALESCE(jsonb_agg(CASE WHEN (version.content->((ordinality-1)::int)) ? 'appearance'
    THEN jsonb_set(value,'{instance,appearance}',version.content->((ordinality-1)::int)->'appearance',true)
    ELSE value END ORDER BY ordinality),'[]'::jsonb) INTO sections
    FROM jsonb_array_elements(manifest->'sections') WITH ORDINALITY;
  RETURN jsonb_set(manifest,'{sections}',sections)||jsonb_build_object('fonts',COALESCE((SELECT jsonb_agg(jsonb_build_object('assetId',a.id,'fontKey',a.font_key) ORDER BY a.font_key)
    FROM public.site_assets a JOIN public.site_asset_usage u ON u.asset_id=a.id WHERE u.version_id=p_page_version_id AND a.kind='font'),'[]'::jsonb));
END $$;
REVOKE ALL ON FUNCTION app.resolve_initial_preview_repeat(uuid,text,jsonb,jsonb),app.resolve_initial_preview_repeat_values(uuid,jsonb,jsonb),
  app.build_render_manifest_core(uuid,boolean),app.build_initial_preview_manifest(uuid) FROM PUBLIC,cms_authenticated_user,cms_public_renderer,cms_worker;
ALTER FUNCTION app.resolve_initial_preview_repeat(uuid,text,jsonb,jsonb) OWNER TO cms_migration_owner;
ALTER FUNCTION app.resolve_initial_preview_repeat_values(uuid,jsonb,jsonb) OWNER TO cms_migration_owner;
ALTER FUNCTION app.build_render_manifest_core(uuid,boolean) OWNER TO cms_migration_owner;
ALTER FUNCTION app.build_initial_preview_manifest(uuid) OWNER TO cms_migration_owner;
GRANT EXECUTE ON FUNCTION app.build_initial_preview_manifest(uuid) TO cms_authenticated_user;
