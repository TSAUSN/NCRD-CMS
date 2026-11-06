-- Governed shared starters are new curated copies. Promoting an existing head
-- would expose its older private versions, so scope never changes in place.
ALTER TABLE public.page_recipes ADD COLUMN scope text NOT NULL DEFAULT 'site' CHECK(scope IN ('site','global'));
DROP POLICY page_recipes_member ON public.page_recipes;
CREATE POLICY page_recipes_member ON public.page_recipes FOR SELECT TO cms_authenticated_user
  USING(app.has_site_access(site_id) OR (scope='global' AND app.current_user_id() IS NOT NULL));
DROP POLICY page_recipe_versions_member ON public.page_recipe_versions;
CREATE POLICY page_recipe_versions_member ON public.page_recipe_versions FOR SELECT TO cms_authenticated_user
  USING(EXISTS(SELECT 1 FROM public.page_recipes r WHERE r.id=recipe_id));

-- Inspect exact pinned definition output, including literal HTML/CSS URLs and
-- URL-attribute bindings. Inert labels, source notes and text are not assets.
CREATE FUNCTION app.page_recipe_definition_references(p_content jsonb)
RETURNS TABLE(kind text,asset_id uuid,variant text,defect text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE section jsonb; component jsonb; candidate text; rendition text; pattern text;
BEGIN
  FOR section IN SELECT value FROM jsonb_array_elements(p_content) LOOP
    SELECT jsonb_build_object('compiled_ast',v.compiled_ast,'css',v.compiled_css,
      'definition_kind',v.definition_kind,'structured_doc',v.structured_doc) INTO component
      FROM public.section_def_versions v WHERE v.section_def_id::text=section->>'section_def_id'
        AND v.version::text=section->>'section_def_version';
    IF component IS NULL THEN CONTINUE; END IF;
    pattern:='^/media/(?![0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/(original|thumbnail|card|wide)([?#][^[:space:]]*)?$)';
    IF app.frame_component_uses_url_pattern(component,section->'values',pattern)
      OR app.frame_css_uses_url_pattern(component->>'css',pattern) THEN
      kind:='media'; asset_id:=NULL;variant:=NULL;defect:='a pinned definition contains an invalid Media address';RETURN NEXT;
    END IF;
    pattern:='^/assets/(?![0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}([?#][^[:space:]]*)?$)';
    IF app.frame_component_uses_url_pattern(component,section->'values',pattern)
      OR app.frame_css_uses_url_pattern(component->>'css',pattern) THEN
      kind:='site_asset';asset_id:=NULL;variant:=NULL;defect:='a pinned definition contains an invalid document or font address';RETURN NEXT;
    END IF;
    FOR candidate IN SELECT DISTINCT lower(match[1]) FROM regexp_matches(
      jsonb_build_object('definition',component,'values',section->'values')::text,
      '([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})','g') AS matches(match)
    LOOP
      FOREACH rendition IN ARRAY ARRAY['original','thumbnail','card','wide'] LOOP
        pattern:='^/media/'||candidate||'/'||rendition||'([?#][^[:space:]]*)?$';
        IF app.frame_component_uses_url_pattern(component,section->'values',pattern)
          OR app.frame_css_uses_url_pattern(component->>'css',pattern) THEN
          kind:='media';asset_id:=candidate::uuid;variant:=rendition;defect:=NULL;RETURN NEXT;
        END IF;
      END LOOP;
      pattern:='^/assets/'||candidate||'([?#][^[:space:]]*)?$';
      IF app.frame_component_uses_url_pattern(component,section->'values',pattern)
        OR app.frame_css_uses_url_pattern(component->>'css',pattern) THEN
        kind:='site_asset';asset_id:=candidate::uuid;variant:=NULL;defect:=NULL;RETURN NEXT;
      END IF;
    END LOOP;
  END LOOP;
END $$;

CREATE FUNCTION app.assert_recipe_definition_assets(p_site uuid,p_content jsonb,p_shared boolean DEFAULT false) RETURNS void
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE reference record;
BEGIN
  FOR reference IN SELECT DISTINCT * FROM app.page_recipe_definition_references(p_content) LOOP
    IF reference.defect IS NOT NULL THEN RAISE EXCEPTION '%',reference.defect USING ERRCODE='CMS04'; END IF;
    IF reference.kind='media' AND NOT EXISTS(SELECT 1 FROM public.media m WHERE m.id=reference.asset_id
      AND (m.site_id IS NULL OR (NOT p_shared AND m.site_id=p_site)) AND m.status='ready' AND m.deleted_at IS NULL
      AND (reference.variant='original' OR EXISTS(SELECT 1 FROM public.media_variants v WHERE v.media_id=m.id AND v.kind=reference.variant AND v.mime_type IS NOT NULL AND v.content_hash IS NOT NULL))) THEN
      RAISE EXCEPTION 'a pinned definition uses unavailable media or media not permitted for this destination' USING ERRCODE='CMS04';
    ELSIF reference.kind='site_asset' AND (p_shared OR NOT EXISTS(SELECT 1 FROM public.site_assets a WHERE a.id=reference.asset_id AND a.site_id=p_site)) THEN
      RAISE EXCEPTION 'a pinned definition uses a site-owned document or font that cannot be reused here' USING ERRCODE='CMS04';
    END IF;
  END LOOP;
END $$;

ALTER FUNCTION app.assert_page_recipe_content(uuid,jsonb) RENAME TO assert_page_recipe_content_before_definition_assets;
CREATE FUNCTION app.assert_page_recipe_content(p_site uuid,p_content jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
  PERFORM app.assert_page_recipe_content_before_definition_assets(p_site,p_content);
  PERFORM app.assert_recipe_definition_assets(p_site,p_content);
END $$;

-- A copied draft must retain definition-owned assets as well as its field
-- values. Invalid historical/draft references remain repairable; readiness
-- separately refuses their publication. Hidden sections still retain assets.
CREATE FUNCTION app.index_new_page_definition_assets() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
  INSERT INTO public.media_usage(media_id,site_id,item_type,item_id,version_id)
    SELECT DISTINCT m.id,NEW.site_id,'page'::public.reviewable_type,NEW.page_id,NEW.id
    FROM app.page_recipe_definition_references(NEW.content) r JOIN public.media m ON m.id=r.asset_id
    WHERE r.kind='media' AND r.defect IS NULL AND (m.site_id=NEW.site_id OR m.site_id IS NULL)
    ON CONFLICT(media_id,version_id) DO NOTHING;
  INSERT INTO public.site_asset_usage(asset_id,site_id,page_id,version_id)
    SELECT DISTINCT a.id,NEW.site_id,NEW.page_id,NEW.id
    FROM app.page_recipe_definition_references(NEW.content) r JOIN public.site_assets a ON a.id=r.asset_id AND a.site_id=NEW.site_id
    WHERE r.kind='site_asset' AND r.defect IS NULL
      -- The existing instance/meta trigger inserts these without ON CONFLICT.
      -- Leave its references to that trigger regardless of trigger ordering.
      AND NOT EXISTS(SELECT 1 FROM app.site_asset_references(jsonb_build_object('content',NEW.content,'meta',NEW.meta)) instance_asset WHERE instance_asset=a.id)
    ON CONFLICT(asset_id,version_id) DO NOTHING;
  RETURN NEW;
END $$;
CREATE TRIGGER page_versions_definition_assets AFTER INSERT ON public.page_versions
  FOR EACH ROW EXECUTE FUNCTION app.index_new_page_definition_assets();
INSERT INTO public.media_usage(media_id,site_id,item_type,item_id,version_id)
  SELECT DISTINCT m.id,p.site_id,'page'::public.reviewable_type,p.page_id,p.id FROM public.page_versions p
  CROSS JOIN LATERAL app.page_recipe_definition_references(p.content) r JOIN public.media m ON m.id=r.asset_id
  WHERE r.kind='media' AND r.defect IS NULL AND (m.site_id=p.site_id OR m.site_id IS NULL)
  ON CONFLICT(media_id,version_id) DO NOTHING;
INSERT INTO public.site_asset_usage(asset_id,site_id,page_id,version_id)
  SELECT DISTINCT a.id,p.site_id,p.page_id,p.id FROM public.page_versions p
  CROSS JOIN LATERAL app.page_recipe_definition_references(p.content) r JOIN public.site_assets a ON a.id=r.asset_id AND a.site_id=p.site_id
  WHERE r.kind='site_asset' AND r.defect IS NULL ON CONFLICT(asset_id,version_id) DO NOTHING;
ALTER FUNCTION app.assert_page_version_media_ready(uuid) RENAME TO assert_page_version_media_ready_before_definition_assets;
CREATE FUNCTION app.assert_page_version_media_ready(p_version uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE page public.page_versions;
BEGIN
  PERFORM app.assert_page_version_media_ready_before_definition_assets(p_version);
  SELECT * INTO page FROM public.page_versions WHERE id=p_version;
  PERFORM app.assert_recipe_definition_assets(page.site_id,page.content);
END $$;
REVOKE ALL ON FUNCTION app.page_recipe_definition_references(jsonb),app.assert_recipe_definition_assets(uuid,jsonb,boolean),
  app.assert_page_recipe_content(uuid,jsonb),app.assert_page_recipe_content_before_definition_assets(uuid,jsonb),
  app.index_new_page_definition_assets(),app.assert_page_version_media_ready(uuid),app.assert_page_version_media_ready_before_definition_assets(uuid)
  FROM PUBLIC,cms_authenticated_user,cms_public_renderer,cms_worker;
ALTER FUNCTION app.page_recipe_definition_references(jsonb) OWNER TO cms_migration_owner;
ALTER FUNCTION app.assert_recipe_definition_assets(uuid,jsonb,boolean) OWNER TO cms_migration_owner;
ALTER FUNCTION app.assert_page_recipe_content(uuid,jsonb) OWNER TO cms_migration_owner;
ALTER FUNCTION app.index_new_page_definition_assets() OWNER TO cms_migration_owner;
ALTER FUNCTION app.assert_page_version_media_ready(uuid) OWNER TO cms_migration_owner;

CREATE FUNCTION app.assert_global_page_recipe_content(p_content jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE section jsonb; reference record; slot jsonb;
BEGIN
  PERFORM app.assert_recipe_definition_assets(NULL,p_content,true);
  FOR section IN SELECT value FROM jsonb_array_elements(p_content) LOOP
    IF NOT EXISTS(SELECT 1 FROM public.section_defs WHERE id::text=section->>'section_def_id' AND scope='global' AND placement='page') THEN
      RAISE EXCEPTION 'shared starters require shared section definitions' USING ERRCODE='CMS04'; END IF;
    FOR slot IN SELECT value FROM jsonb_each(section->'values') LOOP
      IF slot ? 'readerKey' AND (slot#>>'{selection,mode}' IS DISTINCT FROM 'automatic' OR slot#>'{selection,stableKeys}' IS NOT NULL) THEN
        RAISE EXCEPTION 'shared starters cannot retain private record selections' USING ERRCODE='CMS04'; END IF;
    END LOOP;
  END LOOP;
  FOR reference IN SELECT * FROM app.page_recipe_media_references(p_content) LOOP
    IF NOT EXISTS(SELECT 1 FROM public.media WHERE id=reference.media_id AND site_id IS NULL AND status='ready' AND deleted_at IS NULL) THEN
      RAISE EXCEPTION 'shared starters require shared media; replace site-owned images first' USING ERRCODE='CMS04'; END IF;
  END LOOP;
  IF EXISTS(SELECT 1 FROM app.site_asset_references(p_content)) THEN
    RAISE EXCEPTION 'shared starters cannot carry site-owned document or font links' USING ERRCODE='CMS04'; END IF;
END $$;

CREATE FUNCTION app.guard_global_page_recipe() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
  IF TG_OP='UPDATE' AND OLD.scope IS DISTINCT FROM NEW.scope THEN
    RAISE EXCEPTION 'create a new shared starter rather than exposing private recipe history' USING ERRCODE='CMS04'; END IF;
  IF NEW.scope='global' AND NOT app.is_super_admin() THEN
    RAISE EXCEPTION 'only a super admin may manage shared starters' USING ERRCODE='CMS02'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER page_recipes_global_author BEFORE INSERT OR UPDATE ON public.page_recipes
  FOR EACH ROW EXECUTE FUNCTION app.guard_global_page_recipe();
CREATE FUNCTION app.guard_global_page_recipe_version() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
  IF EXISTS(SELECT 1 FROM public.page_recipes WHERE id=NEW.recipe_id AND scope='global') THEN
    IF NOT app.is_super_admin() THEN RAISE EXCEPTION 'only a super admin may manage shared starters' USING ERRCODE='CMS02'; END IF;
    PERFORM app.assert_global_page_recipe_content(NEW.content);
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER page_recipe_versions_global_author BEFORE INSERT ON public.page_recipe_versions
  FOR EACH ROW EXECUTE FUNCTION app.guard_global_page_recipe_version();

CREATE FUNCTION app.share_page_recipe(p_recipe uuid,p_expected bigint,p_name text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE actor uuid; head public.page_recipes; version public.page_recipe_versions; section jsonb; field record; content jsonb:='[]'; created uuid; saved uuid;
BEGIN
  actor:=app.require_actor();
  IF NOT app.is_super_admin() THEN RAISE EXCEPTION 'only a super admin may curate shared starters' USING ERRCODE='CMS02'; END IF;
  SELECT * INTO head FROM public.page_recipes WHERE id=p_recipe FOR SHARE;
  IF NOT FOUND OR head.retired_at IS NOT NULL THEN RAISE EXCEPTION 'recipe is unavailable' USING ERRCODE='CMS03'; END IF;
  PERFORM 1 FROM public.sites WHERE id=head.site_id AND status<>'archived' FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'authoring site is unavailable' USING ERRCODE='CMS03'; END IF;
  IF head.revision IS DISTINCT FROM p_expected THEN RAISE EXCEPTION 'recipe changed; reload its saved version' USING ERRCODE='CMS01'; END IF;
  IF p_name IS NULL OR char_length(btrim(p_name)) NOT BETWEEN 1 AND 120 THEN RAISE EXCEPTION 'enter a shared starter name' USING ERRCODE='CMS04'; END IF;
  SELECT * INTO version FROM public.page_recipe_versions WHERE id=head.current_version_id;
  FOR section IN SELECT value FROM jsonb_array_elements(version.content) LOOP
    FOR field IN SELECT key,value FROM jsonb_each(section->'values') WHERE value ? 'readerKey' LOOP
      -- A shared starter names a binding requirement, never private selected
      -- stable keys. Every recipient must map it deliberately before use.
      section:=jsonb_set(section,ARRAY['values',field.key],jsonb_build_object('readerKey',field.value->'readerKey',
        'selection',jsonb_build_object('mode','automatic','limit',10)));
    END LOOP;
    content:=content||jsonb_build_array(section);
  END LOOP;
  PERFORM app.assert_page_recipe_content(head.site_id,content);
  PERFORM app.assert_global_page_recipe_content(content);
  INSERT INTO public.page_recipes(site_id,name,scope,revision) VALUES(head.site_id,btrim(p_name),'global',1) RETURNING id INTO created;
  INSERT INTO public.page_recipe_versions(recipe_id,site_id,revision,source_version_id,content,created_by)
    VALUES(created,head.site_id,1,version.source_version_id,content,actor) RETURNING id INTO saved;
  UPDATE public.page_recipes SET current_version_id=saved WHERE id=created;
  PERFORM app.write_audit(head.site_id,'user',actor,'recipe.share','page_recipe',created,head.current_version_id,saved,'{}');
  RETURN created;
END $$;

-- Return validated independent content for either an unsaved editor insertion
-- or the create/append command below. No page is changed by preparation.
CREATE FUNCTION app.prepare_page_recipe(p_recipe uuid,p_expected bigint,p_target uuid,p_bindings jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE head public.page_recipes; content jsonb; section jsonb; result jsonb:='[]'; slot record; mapping jsonb; remaining jsonb; selection jsonb;
BEGIN
  PERFORM app.require_actor();
  IF NOT app.has_site_access(p_target) THEN RAISE EXCEPTION 'target site is unavailable' USING ERRCODE='CMS02'; END IF;
  PERFORM 1 FROM public.sites WHERE id=p_target AND status<>'archived' FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'target site is unavailable' USING ERRCODE='CMS03'; END IF;
  SELECT * INTO head FROM public.page_recipes WHERE id=p_recipe FOR SHARE;
  IF NOT FOUND OR (head.scope<>'global' AND NOT app.has_site_access(head.site_id)) THEN RAISE EXCEPTION 'recipe is unavailable' USING ERRCODE='CMS03'; END IF;
  IF head.retired_at IS NOT NULL THEN RAISE EXCEPTION 'recipe is retired' USING ERRCODE='CMS04'; END IF;
  IF head.revision IS DISTINCT FROM p_expected THEN RAISE EXCEPTION 'recipe changed; reload before using it' USING ERRCODE='CMS01'; END IF;
  IF jsonb_typeof(p_bindings) IS DISTINCT FROM 'object' OR NOT app.json_within(p_bindings,65536) THEN
    RAISE EXCEPTION 'choose target collection bindings' USING ERRCODE='CMS04'; END IF;
  SELECT v.content INTO content FROM public.page_recipe_versions v WHERE v.id=head.current_version_id;
  remaining:=p_bindings;
  FOR section IN SELECT value FROM jsonb_array_elements(content) LOOP
    FOR slot IN SELECT key,value FROM jsonb_each(section->'values') WHERE value ? 'readerKey' LOOP
      mapping:=p_bindings->(slot.value->>'readerKey');
      remaining:=remaining-(slot.value->>'readerKey');
      IF mapping IS NULL AND (head.scope='global' OR head.site_id<>p_target) THEN
        RAISE EXCEPTION 'map collection % to the target site before using this recipe',slot.value->>'readerKey' USING ERRCODE='CMS04'; END IF;
      IF mapping IS NOT NULL THEN
        IF jsonb_typeof(mapping) IS DISTINCT FROM 'object' OR (mapping-ARRAY['readerKey','selection'])<>'{}'::jsonb
          OR NOT(mapping ?& ARRAY['readerKey','selection']) THEN RAISE EXCEPTION 'invalid target collection mapping' USING ERRCODE='CMS04'; END IF;
        section:=jsonb_set(section,ARRAY['values',slot.key],mapping);
      END IF;
      selection:=COALESCE(mapping,slot.value)->'selection';
      IF selection->>'mode'='automatic' THEN
        IF jsonb_typeof(selection->'limit') IS DISTINCT FROM 'number' THEN RAISE EXCEPTION 'collection limit must be a number' USING ERRCODE='CMS04'; END IF;
      ELSIF selection->>'mode'='manual' THEN
        IF jsonb_typeof(selection->'stableKeys') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'choose a list of target records' USING ERRCODE='CMS04'; END IF;
        IF EXISTS(SELECT 1 FROM jsonb_array_elements(selection->'stableKeys') value WHERE jsonb_typeof(value)<>'string')
          OR EXISTS(SELECT 1 FROM jsonb_array_elements(selection->'stableKeys') value GROUP BY value HAVING count(*)>1) THEN
          RAISE EXCEPTION 'choose each target record only once' USING ERRCODE='CMS04'; END IF;
      END IF;
    END LOOP;
    result:=result||jsonb_build_array(section);
  END LOOP;
  IF remaining<>'{}'::jsonb THEN RAISE EXCEPTION 'a mapping does not match a recipe collection' USING ERRCODE='CMS04'; END IF;
  PERFORM app.assert_page_recipe_content(p_target,result);
  RETURN result;
END $$;

CREATE OR REPLACE FUNCTION app.use_page_recipe(p_recipe uuid,p_expected bigint,p_page uuid,p_page_revision bigint,p_title text,p_slug text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE site uuid;
BEGIN
  SELECT site_id INTO site FROM public.page_recipes WHERE id=p_recipe;
  IF site IS NULL OR NOT app.has_site_access(site) THEN RAISE EXCEPTION 'recipe is unavailable' USING ERRCODE='CMS03'; END IF;
  RETURN app.use_mapped_page_recipe(p_recipe,p_expected,site,'{}',p_page,p_page_revision,p_title,p_slug);
END $$;

CREATE FUNCTION app.use_mapped_page_recipe(p_recipe uuid,p_expected bigint,p_target uuid,p_bindings jsonb,p_page uuid,p_page_revision bigint,p_title text,p_slug text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE content jsonb; target public.pages; previous public.page_versions; created uuid; recipe public.page_recipes;
BEGIN
  content:=app.prepare_page_recipe(p_recipe,p_expected,p_target,p_bindings);
  SELECT * INTO recipe FROM public.page_recipes WHERE id=p_recipe;
  IF p_page IS NULL THEN
    IF p_title IS NULL OR char_length(btrim(p_title)) NOT BETWEEN 1 AND 200 OR p_slug IS NULL OR char_length(p_slug)>160
      OR (p_slug<>'' AND p_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$') THEN RAISE EXCEPTION 'enter a page name and a valid address' USING ERRCODE='CMS04'; END IF;
    created:=app.create_page(p_target,p_slug,p_title);
    PERFORM app.save_page_draft(created,0,content,jsonb_build_object('title',p_title,'description',''),'checkpoint','Created from recipe: '||recipe.name);
  ELSE
    SELECT * INTO target FROM public.pages WHERE id=p_page AND site_id=p_target FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'choose an existing page on the target site' USING ERRCODE='CMS03'; END IF;
    IF target.revision IS DISTINCT FROM p_page_revision THEN RAISE EXCEPTION 'page changed; reload before adding the recipe' USING ERRCODE='CMS01'; END IF;
    SELECT * INTO previous FROM public.page_versions WHERE id=target.draft_version_id;
    PERFORM app.save_page_draft(target.id,p_page_revision,COALESCE(previous.content,'[]'::jsonb)||content,
      COALESCE(previous.meta,jsonb_build_object('title',target.title,'description','')),'checkpoint','Added recipe: '||recipe.name);
    created:=target.id;
  END IF;
  PERFORM app.write_audit(p_target,'user',app.require_actor(),'recipe.use','page',created,NULL,recipe.current_version_id,
    jsonb_build_object('recipe_id',p_recipe,'bindings',p_bindings));
  RETURN created;
END $$;

-- Preview's existing source context remains private. A recipient may request
-- the manifest of a shared starter; the route supplies their target shell.
ALTER FUNCTION app.preview_page_recipe(uuid,uuid) RENAME TO preview_page_recipe_site;
CREATE FUNCTION app.preview_page_recipe(p_recipe uuid,p_version uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE head public.page_recipes; recipe public.page_recipe_versions; sections jsonb;
BEGIN
  PERFORM app.require_actor();
  SELECT * INTO head FROM public.page_recipes WHERE id=p_recipe;
  IF NOT FOUND OR (head.scope<>'global' AND NOT app.has_site_access(head.site_id)) THEN RAISE EXCEPTION 'recipe is unavailable' USING ERRCODE='CMS03'; END IF;
  IF head.scope<>'global' THEN RETURN app.preview_page_recipe_site(p_recipe,p_version); END IF;
  SELECT * INTO recipe FROM public.page_recipe_versions WHERE id=p_version AND recipe_id=head.id;
  IF NOT FOUND THEN RAISE EXCEPTION 'recipe version is unavailable' USING ERRCODE='CMS03'; END IF;
  SELECT jsonb_agg(jsonb_build_object('instance',i.value,'def',jsonb_build_object(
    'section_def_id',d.id,'version',v.version,'slug',d.slug,'compiled_ast',v.compiled_ast,'css',v.compiled_css,'slots',v.slots,
    'sanitizer_policy_version',v.sanitizer_policy_version,'css_policy_version',v.css_policy_version,
    'definition_kind',v.definition_kind,'structured_doc',v.structured_doc,'structured_schema_version',v.structured_schema_version)) ORDER BY i.ord)
    INTO sections FROM jsonb_array_elements(recipe.content) WITH ORDINALITY i(value,ord)
    JOIN public.section_defs d ON d.id=(i.value->>'section_def_id')::uuid
    JOIN public.section_def_versions v ON v.section_def_id=d.id AND v.version=(i.value->>'section_def_version')::int;
  RETURN jsonb_build_object('page',jsonb_build_object('id',head.id,'version_id',recipe.id,'title',head.name,'path','/'),
    'meta',jsonb_build_object('title',head.name,'noindex',true),'sections',COALESCE(sections,'[]'::jsonb));
END $$;

-- Site archives contain site-owned recipes. Restoring a site must never
-- duplicate or grant governance over the organization's shared starter library.
ALTER FUNCTION app.export_site_content(uuid) RENAME TO export_site_content_before_shared_recipes;
CREATE FUNCTION app.export_site_content(p_site uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE bundle jsonb; recipes jsonb;
BEGIN
  bundle:=app.export_site_content_before_shared_recipes(p_site);
  -- Qualify every element: a bare "value" inside the nested EXISTS would bind
  -- to the inner recipe list and silently drop every recipe version.
  SELECT COALESCE(jsonb_agg(kept.value),'[]'::jsonb) INTO recipes FROM jsonb_array_elements(bundle#>'{content,page_recipes}') kept
    WHERE EXISTS(SELECT 1 FROM public.page_recipes r WHERE r.id::text=kept.value->>'id' AND r.scope='site');
  bundle:=jsonb_set(bundle,'{content,page_recipes}',recipes);
  RETURN jsonb_set(bundle,'{content,page_recipe_versions}',COALESCE((SELECT jsonb_agg(recipe_version.value)
    FROM jsonb_array_elements(bundle#>'{content,page_recipe_versions}') recipe_version
    WHERE EXISTS(SELECT 1 FROM jsonb_array_elements(recipes) recipe WHERE recipe.value->>'id'=recipe_version.value->>'recipe_id')),'[]'::jsonb));
END $$;

REVOKE ALL ON FUNCTION app.assert_global_page_recipe_content(jsonb),app.guard_global_page_recipe(),app.guard_global_page_recipe_version(),
  app.share_page_recipe(uuid,bigint,text),app.prepare_page_recipe(uuid,bigint,uuid,jsonb),app.use_mapped_page_recipe(uuid,bigint,uuid,jsonb,uuid,bigint,text,text),
  app.preview_page_recipe(uuid,uuid),app.preview_page_recipe_site(uuid,uuid),app.export_site_content(uuid),app.export_site_content_before_shared_recipes(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.preview_page_recipe_site(uuid,uuid),app.export_site_content_before_shared_recipes(uuid) FROM cms_authenticated_user;
ALTER FUNCTION app.assert_global_page_recipe_content(jsonb) OWNER TO cms_migration_owner;
ALTER FUNCTION app.guard_global_page_recipe() OWNER TO cms_migration_owner;
ALTER FUNCTION app.guard_global_page_recipe_version() OWNER TO cms_migration_owner;
ALTER FUNCTION app.share_page_recipe(uuid,bigint,text) OWNER TO cms_migration_owner;
ALTER FUNCTION app.prepare_page_recipe(uuid,bigint,uuid,jsonb) OWNER TO cms_migration_owner;
ALTER FUNCTION app.use_mapped_page_recipe(uuid,bigint,uuid,jsonb,uuid,bigint,text,text) OWNER TO cms_migration_owner;
ALTER FUNCTION app.preview_page_recipe(uuid,uuid) OWNER TO cms_migration_owner;
ALTER FUNCTION app.export_site_content(uuid) OWNER TO cms_migration_owner;
GRANT EXECUTE ON FUNCTION app.share_page_recipe(uuid,bigint,text),app.prepare_page_recipe(uuid,bigint,uuid,jsonb),
  app.use_mapped_page_recipe(uuid,bigint,uuid,jsonb,uuid,bigint,text,text),app.preview_page_recipe(uuid,uuid),app.export_site_content(uuid) TO cms_authenticated_user;
