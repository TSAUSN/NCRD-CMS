-- Site recipes retain only an explicitly selected composition, never a page's
-- identity, metadata, approvals or publication pointers. Instances are copied
-- into ordinary page drafts through the existing save command.
CREATE TABLE public.page_recipes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id uuid NOT NULL REFERENCES public.sites(id),
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 120),
  revision bigint NOT NULL DEFAULT 0,
  current_version_id uuid,
  retired_at timestamptz,
  UNIQUE(id,site_id)
);
ALTER TABLE public.page_versions ADD CONSTRAINT page_versions_site_identity UNIQUE(site_id,id);
CREATE TABLE public.page_recipe_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recipe_id uuid NOT NULL,
  site_id uuid NOT NULL,
  revision bigint NOT NULL,
  source_version_id uuid NOT NULL,
  content jsonb NOT NULL CHECK(jsonb_typeof(content)='array' AND app.json_within(content,1000000)),
  created_by uuid NOT NULL REFERENCES public.app_users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(id,recipe_id,site_id),
  UNIQUE(recipe_id,revision),
  FOREIGN KEY(recipe_id,site_id) REFERENCES public.page_recipes(id,site_id),
  FOREIGN KEY(site_id,source_version_id) REFERENCES public.page_versions(site_id,id)
);
CREATE INDEX page_recipe_versions_source ON public.page_recipe_versions(source_version_id);
CREATE TRIGGER page_recipe_versions_immutable BEFORE UPDATE OR DELETE ON public.page_recipe_versions
  FOR EACH ROW EXECUTE FUNCTION app.audit_log_is_append_only();
ALTER TABLE public.page_recipes ADD FOREIGN KEY(current_version_id,id,site_id)
  REFERENCES public.page_recipe_versions(id,recipe_id,site_id);
ALTER TABLE public.page_recipes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.page_recipe_versions ENABLE ROW LEVEL SECURITY;
CREATE POLICY page_recipes_member ON public.page_recipes FOR SELECT TO cms_authenticated_user USING(app.has_site_access(site_id));
CREATE POLICY page_recipe_versions_member ON public.page_recipe_versions FOR SELECT TO cms_authenticated_user USING(app.has_site_access(site_id));
REVOKE ALL ON public.page_recipes,public.page_recipe_versions FROM PUBLIC,cms_authenticated_user,cms_public_renderer,cms_worker;
GRANT SELECT ON public.page_recipes,public.page_recipe_versions TO cms_authenticated_user;

CREATE FUNCTION app.page_recipe_media_references(p_content jsonb) RETURNS TABLE(media_id uuid,variant text)
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,public AS $$
  WITH RECURSIVE walk(value) AS (
    SELECT p_content UNION ALL SELECT child.value FROM walk CROSS JOIN LATERAL (
      SELECT value FROM jsonb_array_elements(CASE WHEN jsonb_typeof(walk.value)='array' THEN walk.value ELSE '[]'::jsonb END)
      UNION ALL SELECT value FROM jsonb_each(CASE WHEN jsonb_typeof(walk.value)='object' THEN walk.value ELSE '{}'::jsonb END)
    ) child
  )
  SELECT * FROM app.media_references_in_page_content(p_content)
  UNION SELECT matched.parts[1]::uuid,lower(matched.parts[2]) FROM walk
    CROSS JOIN LATERAL regexp_matches(CASE WHEN jsonb_typeof(walk.value)='string' THEN walk.value#>>'{}' ELSE '' END,
      '/media/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/(original|thumbnail|card|wide)(?:[^a-z]|$)','gi') matched(parts)
$$;

-- Recipe references pin their retained source version's assets too, including
-- governed URLs inside rich text. This also runs for private archive restores.
CREATE FUNCTION app.index_page_recipe_media() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE reference record; source_page uuid;
BEGIN
  SELECT page_id INTO source_page FROM public.page_versions WHERE id=NEW.source_version_id AND site_id=NEW.site_id;
  FOR reference IN SELECT * FROM app.page_recipe_media_references(NEW.content) LOOP
    IF NOT EXISTS(SELECT 1 FROM public.media WHERE id=reference.media_id AND (site_id=NEW.site_id OR site_id IS NULL)) THEN
      RAISE EXCEPTION 'recipe media belongs to another site or is missing' USING ERRCODE='CMS04'; END IF;
    INSERT INTO public.media_usage(media_id,site_id,item_type,item_id,version_id)
      VALUES(reference.media_id,NEW.site_id,'page',source_page,NEW.source_version_id) ON CONFLICT(media_id,version_id) DO NOTHING;
  END LOOP;
  RETURN NEW;
END $$;
CREATE TRIGGER page_recipe_versions_index_media AFTER INSERT ON public.page_recipe_versions
  FOR EACH ROW EXECUTE FUNCTION app.index_page_recipe_media();

CREATE FUNCTION app.assert_page_recipe_content(p_site uuid,p_content jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE section jsonb; definition record; reference record; asset uuid; node jsonb; binding jsonb; fields jsonb; defect text;
BEGIN
  IF jsonb_typeof(p_content) IS DISTINCT FROM 'array' OR jsonb_array_length(p_content) NOT BETWEEN 1 AND 100
    OR NOT app.json_within(p_content,1000000) THEN
    RAISE EXCEPTION 'choose between 1 and 100 sections for a recipe' USING ERRCODE='CMS04';
  END IF;
  FOR section IN SELECT value FROM jsonb_array_elements(p_content) LOOP
    SELECT d.*,v.structured_doc,v.slots INTO definition FROM public.section_defs d
      JOIN public.section_def_versions v ON v.section_def_id=d.id
      WHERE d.id::text=section->>'section_def_id' AND v.version=(section->>'section_def_version')::int
        AND d.placement='page' AND d.status='active' AND (d.scope='global' OR d.site_id=p_site);
    IF NOT FOUND THEN RAISE EXCEPTION 'a pinned section is unavailable for this site' USING ERRCODE='CMS04'; END IF;
    -- Stored bindings contain reader keys/selections, never resolved records.
    -- Validate against the site's saved schema, so private starter collections
    -- can be reused before their first publication.
    FOR node IN WITH RECURSIVE nodes(value) AS (
      SELECT value FROM jsonb_array_elements(COALESCE(definition.structured_doc->'nodes','[]'::jsonb))
      UNION ALL SELECT child.value FROM nodes n CROSS JOIN LATERAL jsonb_array_elements(
        CASE WHEN n.value->>'type'='element' THEN COALESCE(n.value->'children','[]'::jsonb) ELSE '[]'::jsonb END) child
    ) SELECT value FROM nodes WHERE value->>'type'='repeat' LOOP
      binding:=section->'values'->(node->>'field');
      IF binding IS NULL THEN RAISE EXCEPTION 'configure the source section’s collection binding before saving a recipe' USING ERRCODE='CMS04'; END IF;
      IF jsonb_typeof(binding) IS DISTINCT FROM 'object' OR NOT(binding ?& ARRAY['readerKey','selection'])
        OR (binding-ARRAY['readerKey','selection'])<>'{}'::jsonb THEN
        RAISE EXCEPTION 'recipes retain collection bindings, not resolved records' USING ERRCODE='CMS04';
      END IF;
      SELECT v.fields INTO fields FROM public.collections c JOIN public.collection_schema_versions v ON v.id=c.draft_schema_version_id
        WHERE c.site_id=p_site AND c.reader_key=binding->>'readerKey';
      IF NOT FOUND THEN RAISE EXCEPTION 'a collection binding does not belong to this site' USING ERRCODE='CMS04'; END IF;
      defect:=app.collection_repeat_item_defect(node->'item',fields);
      IF defect IS NOT NULL THEN RAISE EXCEPTION 'incompatible collection binding: %',defect USING ERRCODE='CMS04'; END IF;
      IF binding#>>'{selection,mode}'='automatic' THEN
        IF ((binding->'selection')-ARRAY['mode','limit'])<>'{}'::jsonb
          OR COALESCE(binding#>>'{selection,limit}','') !~ '^[0-9]{1,3}$'
          OR (binding#>>'{selection,limit}')::int NOT BETWEEN 1 AND 100 THEN
          RAISE EXCEPTION 'invalid automatic collection selection' USING ERRCODE='CMS04'; END IF;
      ELSIF binding#>>'{selection,mode}'='manual' THEN
        IF ((binding->'selection')-ARRAY['mode','stableKeys'])<>'{}'::jsonb
          OR jsonb_typeof(binding#>'{selection,stableKeys}') IS DISTINCT FROM 'array' THEN
          RAISE EXCEPTION 'invalid manual collection selection' USING ERRCODE='CMS04'; END IF;
        IF jsonb_array_length(binding#>'{selection,stableKeys}')>100 OR EXISTS(
          SELECT 1 FROM jsonb_array_elements_text(binding#>'{selection,stableKeys}') chosen WHERE NOT EXISTS(
            SELECT 1 FROM public.collection_entries e JOIN public.collections c ON c.id=e.collection_id
            WHERE c.site_id=p_site AND c.reader_key=binding->>'readerKey' AND e.stable_key=chosen.value AND e.archived_at IS NULL)) THEN
          RAISE EXCEPTION 'a selected collection record is unavailable on this site' USING ERRCODE='CMS04'; END IF;
      ELSE RAISE EXCEPTION 'choose an automatic or manual collection selection' USING ERRCODE='CMS04'; END IF;
    END LOOP;
  END LOOP;
  FOR reference IN SELECT * FROM app.page_recipe_media_references(p_content) LOOP
    IF NOT EXISTS(SELECT 1 FROM public.media m WHERE m.id=reference.media_id AND (m.site_id=p_site OR m.site_id IS NULL)
      AND m.status='ready' AND m.deleted_at IS NULL AND (reference.variant='original' OR EXISTS(
        SELECT 1 FROM public.media_variants v WHERE v.media_id=m.id AND v.kind=reference.variant AND v.mime_type IS NOT NULL AND v.content_hash IS NOT NULL))) THEN
      RAISE EXCEPTION 'recipe media is unavailable or belongs to another site' USING ERRCODE='CMS04';
    END IF;
  END LOOP;
  FOR asset IN SELECT app.site_asset_references(p_content) LOOP
    IF NOT EXISTS(SELECT 1 FROM public.site_assets WHERE id=asset AND site_id=p_site) THEN
      RAISE EXCEPTION 'recipe document is unavailable or belongs to another site' USING ERRCODE='CMS04';
    END IF;
  END LOOP;
END $$;

CREATE FUNCTION app.save_page_recipe(p_site uuid,p_recipe uuid,p_expected bigint,p_name text,p_source uuid,p_selection jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE actor uuid; head public.page_recipes; source public.page_versions; choice jsonb; section jsonb; selected jsonb:='[]'; next_id uuid; vals jsonb;
BEGIN
  actor:=app.require_actor();
  IF NOT app.can_publish(p_site) THEN RAISE EXCEPTION 'only editors can manage recipes' USING ERRCODE='CMS02'; END IF;
  PERFORM 1 FROM public.sites WHERE id=p_site AND status<>'archived' FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'site is unavailable' USING ERRCODE='CMS03'; END IF;
  IF p_name IS NULL OR char_length(btrim(p_name)) NOT BETWEEN 1 AND 120 THEN RAISE EXCEPTION 'enter a recipe name up to 120 characters' USING ERRCODE='CMS04'; END IF;
  IF p_recipe IS NULL THEN
    IF p_expected IS DISTINCT FROM 0::bigint THEN RAISE EXCEPTION 'reload before saving the recipe' USING ERRCODE='CMS01'; END IF;
    INSERT INTO public.page_recipes(site_id,name) VALUES(p_site,btrim(p_name)) RETURNING * INTO head;
  ELSE
    SELECT * INTO head FROM public.page_recipes WHERE id=p_recipe AND site_id=p_site FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'recipe is unavailable' USING ERRCODE='CMS03'; END IF;
    IF head.revision IS DISTINCT FROM p_expected THEN RAISE EXCEPTION 'recipe changed; reload before saving' USING ERRCODE='CMS01'; END IF;
    IF head.retired_at IS NOT NULL THEN RAISE EXCEPTION 'retired recipes cannot be updated' USING ERRCODE='CMS04'; END IF;
  END IF;
  SELECT * INTO source FROM public.page_versions WHERE id=p_source AND site_id=p_site;
  IF NOT FOUND THEN RAISE EXCEPTION 'choose a saved page from this site' USING ERRCODE='CMS03'; END IF;
  IF jsonb_typeof(p_selection) IS DISTINCT FROM 'array' OR jsonb_array_length(p_selection) NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'choose between 1 and 100 sections' USING ERRCODE='CMS04'; END IF;
  FOR choice IN SELECT value FROM jsonb_array_elements(p_selection) LOOP
    IF jsonb_typeof(choice->'index') IS DISTINCT FROM 'number' OR (choice->>'index') !~ '^[0-9]{1,6}$'
      OR jsonb_typeof(choice->'sample') IS DISTINCT FROM 'boolean' THEN RAISE EXCEPTION 'invalid section selection' USING ERRCODE='CMS04'; END IF;
    section:=source.content->(choice->>'index')::int;
    IF section IS NULL THEN RAISE EXCEPTION 'source section is unavailable' USING ERRCODE='CMS04'; END IF;
    IF COALESCE(section->>'raw_html','')<>'' OR COALESCE(section->>'custom_css','')<>'' THEN
      RAISE EXCEPTION 'save this section as a governed definition before including it in a recipe' USING ERRCODE='CMS04'; END IF;
    -- Only declared fields are reusable. Required repeat bindings are part of
    -- the composition, not sample records; dropping them produces a page that
    -- cannot render. Ordinary sample values require the explicit checkbox.
    SELECT COALESCE(jsonb_object_agg(s->>'id',section->'values'->(s->>'id')),'{}'::jsonb) INTO vals
      FROM public.section_def_versions v CROSS JOIN LATERAL jsonb_array_elements(v.slots) s
      WHERE v.section_def_id=(section->>'section_def_id')::uuid AND v.version=(section->>'section_def_version')::int
        AND section->'values' ? (s->>'id') AND s->>'kind'<>'navigation'
        AND ((choice->>'sample')::boolean OR s->>'kind'='repeat');
    selected:=selected||jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
      'section_def_id',section->'section_def_id','section_def_version',section->'section_def_version',
      'values',vals,'hidden',COALESCE(section->'hidden','false'::jsonb),'hidden_at',COALESCE(section->'hidden_at','[]'::jsonb),
      'label',COALESCE(section->'label','""'::jsonb),'appearance',section->'appearance')));
  END LOOP;
  PERFORM app.assert_page_recipe_content(p_site,selected);
  INSERT INTO public.page_recipe_versions(recipe_id,site_id,revision,source_version_id,content,created_by)
    VALUES(head.id,p_site,head.revision+1,p_source,selected,actor) RETURNING id INTO next_id;
  UPDATE public.page_recipes SET name=btrim(p_name),revision=head.revision+1,current_version_id=next_id WHERE id=head.id;
  PERFORM app.write_audit(p_site,'user',actor,'recipe.save','page_recipe',head.id,head.current_version_id,next_id,'{}');
  RETURN head.id;
END $$;

CREATE FUNCTION app.manage_page_recipe(p_recipe uuid,p_expected bigint,p_name text,p_retire boolean) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE actor uuid; head public.page_recipes;
BEGIN
  actor:=app.require_actor();
  SELECT * INTO head FROM public.page_recipes WHERE id=p_recipe FOR UPDATE;
  IF NOT FOUND OR NOT app.has_site_access(head.site_id) THEN RAISE EXCEPTION 'recipe is unavailable' USING ERRCODE='CMS03'; END IF;
  IF NOT app.can_publish(head.site_id) THEN RAISE EXCEPTION 'only editors can manage recipes' USING ERRCODE='CMS02'; END IF;
  PERFORM 1 FROM public.sites WHERE id=head.site_id AND status<>'archived' FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'site is unavailable' USING ERRCODE='CMS03'; END IF;
  IF head.revision IS DISTINCT FROM p_expected THEN RAISE EXCEPTION 'recipe changed; reload before saving' USING ERRCODE='CMS01'; END IF;
  IF p_name IS NULL OR char_length(btrim(p_name)) NOT BETWEEN 1 AND 120 OR p_retire IS NULL THEN RAISE EXCEPTION 'enter a recipe name up to 120 characters' USING ERRCODE='CMS04'; END IF;
  UPDATE public.page_recipes SET name=btrim(p_name),revision=head.revision+1,
    retired_at=CASE WHEN p_retire THEN COALESCE(head.retired_at,now()) ELSE NULL END WHERE id=head.id;
  PERFORM app.write_audit(head.site_id,'user',actor,CASE WHEN p_retire THEN 'recipe.retire' WHEN head.retired_at IS NOT NULL THEN 'recipe.restore' ELSE 'recipe.rename' END,
    'page_recipe',head.id,NULL,NULL,jsonb_build_object('before_name',head.name,'after_name',btrim(p_name),'retired',p_retire));
  RETURN head.revision+1;
END $$;

CREATE FUNCTION app.use_page_recipe(p_recipe uuid,p_expected bigint,p_page uuid,p_page_revision bigint,p_title text,p_slug text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE head public.page_recipes; content jsonb; target public.pages; previous public.page_versions; created uuid;
BEGIN
  PERFORM app.require_actor();
  SELECT * INTO head FROM public.page_recipes WHERE id=p_recipe FOR SHARE;
  IF NOT FOUND OR NOT app.has_site_access(head.site_id) THEN RAISE EXCEPTION 'recipe is unavailable' USING ERRCODE='CMS03'; END IF;
  IF head.revision IS DISTINCT FROM p_expected THEN RAISE EXCEPTION 'recipe changed; reload its preview before using it' USING ERRCODE='CMS01'; END IF;
  IF head.retired_at IS NOT NULL THEN RAISE EXCEPTION 'recipe is retired' USING ERRCODE='CMS04'; END IF;
  PERFORM 1 FROM public.sites WHERE id=head.site_id AND status<>'archived' FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'site is unavailable' USING ERRCODE='CMS03'; END IF;
  SELECT v.content INTO content FROM public.page_recipe_versions v WHERE v.id=head.current_version_id;
  PERFORM app.assert_page_recipe_content(head.site_id,content);
  IF p_page IS NULL THEN
    IF p_title IS NULL OR char_length(btrim(p_title)) NOT BETWEEN 1 AND 200 OR p_slug IS NULL OR char_length(p_slug)>160
      OR (p_slug<>'' AND p_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$') THEN RAISE EXCEPTION 'enter a page name and a valid address' USING ERRCODE='CMS04'; END IF;
    -- create_page independently enforces Editor+, including direct SQL calls.
    created:=app.create_page(head.site_id,p_slug,p_title);
    PERFORM app.save_page_draft(created,0,content,jsonb_build_object('title',p_title,'description',''),'checkpoint','Created from recipe: '||head.name);
  ELSE
    SELECT * INTO target FROM public.pages WHERE id=p_page AND site_id=head.site_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'choose an existing page on this site' USING ERRCODE='CMS03'; END IF;
    IF target.revision IS DISTINCT FROM p_page_revision THEN RAISE EXCEPTION 'page changed; reload before adding the recipe' USING ERRCODE='CMS01'; END IF;
    SELECT * INTO previous FROM public.page_versions WHERE id=target.draft_version_id;
    PERFORM app.save_page_draft(target.id,p_page_revision,COALESCE(previous.content,'[]'::jsonb)||content,
      COALESCE(previous.meta,jsonb_build_object('title',target.title,'description','')),'checkpoint','Added recipe: '||head.name);
    created:=target.id;
  END IF;
  PERFORM app.write_audit(head.site_id,'user',app.require_actor(),'recipe.use','page',created,NULL,head.current_version_id,'{}');
  RETURN created;
END $$;

CREATE FUNCTION app.preview_page_recipe(p_recipe uuid,p_version uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE head public.page_recipes; recipe public.page_recipe_versions; sections jsonb;
BEGIN
  PERFORM app.require_actor();
  SELECT * INTO head FROM public.page_recipes WHERE id=p_recipe;
  IF NOT FOUND OR NOT app.has_site_access(head.site_id) THEN RAISE EXCEPTION 'recipe is unavailable' USING ERRCODE='CMS03'; END IF;
  SELECT * INTO recipe FROM public.page_recipe_versions WHERE id=p_version AND recipe_id=head.id;
  IF NOT FOUND THEN RAISE EXCEPTION 'recipe version is unavailable' USING ERRCODE='CMS03'; END IF;
  SELECT jsonb_agg(jsonb_build_object('instance',i.value,'def',jsonb_build_object(
    'section_def_id',d.id,'version',v.version,'slug',d.slug,'compiled_ast',v.compiled_ast,'css',v.compiled_css,'slots',v.slots,
    'sanitizer_policy_version',v.sanitizer_policy_version,'css_policy_version',v.css_policy_version,
    'definition_kind',v.definition_kind,'structured_doc',v.structured_doc,'structured_schema_version',v.structured_schema_version)) ORDER BY i.ord)
    INTO sections FROM jsonb_array_elements(recipe.content) WITH ORDINALITY i(value,ord)
    JOIN public.section_defs d ON d.id=(i.value->>'section_def_id')::uuid
    JOIN public.section_def_versions v ON v.section_def_id=d.id AND v.version=(i.value->>'section_def_version')::int;
  -- Do not expand private collection records into reusable sample previews.
  -- Binding selections remain visible in the outline and resolve in page preview.
  RETURN jsonb_build_object('page',jsonb_build_object('id',head.id,'version_id',recipe.id,'title',head.name,'path','/'),
    'meta',jsonb_build_object('title',head.name,'noindex',true),'sections',COALESCE(sections,'[]'::jsonb));
END $$;

REVOKE ALL ON FUNCTION app.assert_page_recipe_content(uuid,jsonb),app.save_page_recipe(uuid,uuid,bigint,text,uuid,jsonb),
  app.manage_page_recipe(uuid,bigint,text,boolean),app.use_page_recipe(uuid,bigint,uuid,bigint,text,text),app.preview_page_recipe(uuid,uuid),
  app.page_recipe_media_references(jsonb),app.index_page_recipe_media() FROM PUBLIC;
ALTER TABLE public.page_recipes OWNER TO cms_migration_owner;
ALTER TABLE public.page_recipe_versions OWNER TO cms_migration_owner;
ALTER FUNCTION app.assert_page_recipe_content(uuid,jsonb) OWNER TO cms_migration_owner;
ALTER FUNCTION app.page_recipe_media_references(jsonb) OWNER TO cms_migration_owner;
ALTER FUNCTION app.index_page_recipe_media() OWNER TO cms_migration_owner;
ALTER FUNCTION app.save_page_recipe(uuid,uuid,bigint,text,uuid,jsonb) OWNER TO cms_migration_owner;
ALTER FUNCTION app.manage_page_recipe(uuid,bigint,text,boolean) OWNER TO cms_migration_owner;
ALTER FUNCTION app.use_page_recipe(uuid,bigint,uuid,bigint,text,text) OWNER TO cms_migration_owner;
ALTER FUNCTION app.preview_page_recipe(uuid,uuid) OWNER TO cms_migration_owner;
GRANT EXECUTE ON FUNCTION app.save_page_recipe(uuid,uuid,bigint,text,uuid,jsonb),app.manage_page_recipe(uuid,bigint,text,boolean),
  app.use_page_recipe(uuid,bigint,uuid,bigint,text,text),app.preview_page_recipe(uuid,uuid) TO cms_authenticated_user;
