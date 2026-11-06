-- Read-only display metadata for shared Story widgets. No row backfill or new role grants.
CREATE FUNCTION app.story_catalog_valid(p_catalog jsonb) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,public AS $$
DECLARE tag jsonb;group_key text;settings jsonb;tags jsonb;
BEGIN
 IF jsonb_typeof(p_catalog) IS DISTINCT FROM 'object' THEN RETURN false;END IF;
 IF NOT(p_catalog ?& ARRAY['mainLabel','secondaryLabel','mainTags','secondaryTags']) OR (p_catalog-ARRAY['mainLabel','secondaryLabel','mainTags','secondaryTags'])<>'{}'::jsonb THEN RETURN false;END IF;
 settings:=p_catalog||'{"schemaVersion":1,"publishUnreviewed":true,"source":"none"}'::jsonb;
 FOREACH group_key IN ARRAY ARRAY['mainTags','secondaryTags'] LOOP
  IF jsonb_typeof(p_catalog->group_key) IS DISTINCT FROM 'array' THEN RETURN false;END IF;
  IF jsonb_array_length(p_catalog->group_key)>100 THEN RETURN false;END IF;
  tags:='[]'::jsonb;
  FOR tag IN SELECT value FROM jsonb_array_elements(p_catalog->group_key) LOOP
   IF jsonb_typeof(tag) IS DISTINCT FROM 'object' THEN RETURN false;END IF;
   IF (group_key='mainTags' AND (tag-ARRAY['id','label'])<>'{}'::jsonb) OR (group_key='secondaryTags' AND (tag-ARRAY['id','label','areas'])<>'{}'::jsonb) THEN RETURN false;END IF;
   tags:=tags||jsonb_build_array(tag||'{"keywords":[]}'::jsonb);
  END LOOP;
  settings:=jsonb_set(settings,ARRAY[group_key],tags);
 END LOOP;
 RETURN app.stories_settings_defect(settings) IS NULL;
END $$;
CREATE FUNCTION app.with_story_catalog(p_binding jsonb,p_draft boolean) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE settings jsonb;catalog jsonb;
BEGIN
 IF p_binding->>'readerKey' IS DISTINCT FROM 'stories' THEN RETURN p_binding;END IF;
 SELECT v.sort->'stories' INTO settings FROM public.collections c JOIN public.collection_schema_versions v
  ON v.id=CASE WHEN p_draft THEN c.draft_schema_version_id ELSE (p_binding->>'publishedSchemaVersionId')::uuid END AND v.collection_id=c.id
  WHERE c.id=(p_binding->>'collectionId')::uuid AND c.reader_key='stories';
 IF settings IS NULL THEN RETURN p_binding-'storyCatalog';END IF;
 IF app.stories_settings_defect(settings) IS NOT NULL THEN RAISE EXCEPTION 'Story tag settings need review' USING ERRCODE='CMS04';END IF;
 SELECT jsonb_build_object('mainLabel',settings->'mainLabel','secondaryLabel',settings->'secondaryLabel',
  'mainTags',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',t->'id','label',t->'label') ORDER BY position) FROM jsonb_array_elements(settings->'mainTags') WITH ORDINALITY item(t,position)),'[]'::jsonb),
  'secondaryTags',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',t->'id','label',t->'label','areas',t->'areas') ORDER BY position) FROM jsonb_array_elements(settings->'secondaryTags') WITH ORDINALITY item(t,position)),'[]'::jsonb)) INTO catalog;
 RETURN p_binding||jsonb_build_object('storyCatalog',catalog);
END $$;
ALTER FUNCTION app.resolve_collection_repeat(uuid,text,jsonb,jsonb) RENAME TO resolve_collection_repeat_before_story_catalog;
CREATE FUNCTION app.resolve_collection_repeat(p_site_id uuid,p_reader_key text,p_selection jsonb,p_item jsonb) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT app.with_story_catalog(app.resolve_collection_repeat_before_story_catalog(p_site_id,p_reader_key,p_selection,p_item),false)
$$;
ALTER FUNCTION app.resolve_initial_preview_repeat(uuid,text,jsonb,jsonb) RENAME TO resolve_initial_preview_repeat_before_story_catalog;
CREATE FUNCTION app.resolve_initial_preview_repeat(p_site_id uuid,p_reader_key text,p_selection jsonb,p_item jsonb) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT app.with_story_catalog(app.resolve_initial_preview_repeat_before_story_catalog(p_site_id,p_reader_key,p_selection,p_item),false)
$$;
ALTER FUNCTION app.canvas_draft_list(uuid,jsonb,jsonb) RENAME TO canvas_draft_list_before_story_catalog;
CREATE FUNCTION app.canvas_draft_list(p_site uuid,p_binding jsonb,p_value jsonb) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT app.with_story_catalog(app.canvas_draft_list_before_story_catalog(p_site,p_binding,p_value),true)
$$;
ALTER FUNCTION app.template_collection_binding_shape_valid(jsonb) RENAME TO template_collection_binding_shape_valid_before_story_catalog;
CREATE FUNCTION app.template_collection_binding_shape_valid(binding jsonb) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,public AS $$
BEGIN
 IF binding?'storyCatalog' AND (binding->>'readerKey' IS DISTINCT FROM 'stories' OR NOT app.story_catalog_valid(binding->'storyCatalog')) THEN RETURN false;END IF;
 RETURN app.template_collection_binding_shape_valid_before_story_catalog(binding-'storyCatalog');
END $$;
DO $$ DECLARE signature text;BEGIN
 FOREACH signature IN ARRAY ARRAY['app.story_catalog_valid(jsonb)','app.with_story_catalog(jsonb,boolean)','app.resolve_collection_repeat(uuid,text,jsonb,jsonb)','app.resolve_initial_preview_repeat(uuid,text,jsonb,jsonb)','app.canvas_draft_list(uuid,jsonb,jsonb)','app.template_collection_binding_shape_valid(jsonb)'] LOOP
  EXECUTE format('ALTER FUNCTION %s OWNER TO cms_migration_owner',signature);
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,cms_authenticated_user,cms_public_renderer,cms_worker',signature);
 END LOOP;
END $$;
