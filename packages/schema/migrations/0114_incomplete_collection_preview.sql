-- Incomplete collection selections must not erase the rest of an editing canvas.
-- Only authenticated draft previews use the placeholder resolver. Publication,
-- readiness and public projections keep the strict resolver and reject it.
CREATE FUNCTION app.resolve_editor_preview_repeat_values(
  p_site_id uuid,p_doc jsonb,p_values jsonb,p_initial_preview boolean
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=pg_catalog,public AS $$
DECLARE result jsonb:=p_values; repeat_node jsonb; binding jsonb; field_name text; resolved jsonb;
BEGIN
 IF jsonb_typeof(result) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'section values are not an object' USING ERRCODE='CMS04'; END IF;
 FOR repeat_node IN
  WITH RECURSIVE walk(node) AS (
   SELECT value FROM jsonb_array_elements(p_doc->'nodes')
   UNION ALL SELECT child.value FROM walk CROSS JOIN LATERAL jsonb_array_elements(
    CASE WHEN walk.node->>'type'='element' AND jsonb_typeof(walk.node->'children')='array'
     THEN walk.node->'children' ELSE '[]'::jsonb END) child)
  SELECT node FROM walk WHERE node->>'type'='repeat'
 LOOP
  field_name:=repeat_node->>'field'; binding:=result->field_name;
  BEGIN
   IF jsonb_typeof(binding) IS DISTINCT FROM 'object'
    OR (binding-ARRAY['readerKey','selection']) IS DISTINCT FROM '{}'::jsonb
    OR NOT(binding ?& ARRAY['readerKey','selection'])
    OR jsonb_typeof(binding->'readerKey') IS DISTINCT FROM 'string' THEN
    RAISE EXCEPTION 'choose a collection for this section' USING ERRCODE='CMS04';
   END IF;
   IF p_initial_preview THEN
    resolved:=app.resolve_initial_preview_repeat(p_site_id,binding->>'readerKey',binding->'selection',repeat_node->'item');
   ELSE
    resolved:=app.resolve_collection_repeat(p_site_id,binding->>'readerKey',binding->'selection',repeat_node->'item');
   END IF;
  EXCEPTION WHEN SQLSTATE 'CMS04' THEN
   -- A deterministic, empty preview envelope contains no foreign collection,
   -- private record, fabricated sample or publication pointer.
   resolved:=jsonb_build_object('kind','collection',
    'collectionId','00000000-0000-4000-8000-000000000000','readerKey','cms_unconfigured',
    'publishedSchemaVersionId','00000000-0000-4000-8000-000000000000',
    'publishedSchemaRevision','0','publishedEntryRevision','0','schemas','[]'::jsonb,'entries','[]'::jsonb);
  END;
  result:=jsonb_set(result,ARRAY[field_name],resolved,true);
 END LOOP;
 RETURN result;
END $$;

CREATE FUNCTION app.build_render_manifest_core(p_page_version_id uuid, p_initial_preview boolean, p_editor_preview boolean) RETURNS jsonb
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
    CASE WHEN section->'def'->>'definition_kind'='structured' THEN CASE WHEN p_editor_preview THEN app.resolve_editor_preview_repeat_values(v.site_id,section->'def'->'structured_doc',section->'instance'->'values',p_initial_preview) WHEN p_initial_preview THEN app.resolve_initial_preview_repeat_values(
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


-- Existing publication callers retain the strict two-argument entry point.
CREATE OR REPLACE FUNCTION app.build_render_manifest_core(p_page_version_id uuid,p_initial_preview boolean) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT app.build_render_manifest_core(p_page_version_id,p_initial_preview,false)
$$;

CREATE OR REPLACE FUNCTION app.build_initial_preview_manifest(p_page_version_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE version RECORD; manifest jsonb; sections jsonb;
BEGIN
  PERFORM app.require_actor();
  SELECT v.*,s.initial_release_required INTO version FROM public.page_versions v JOIN public.sites s ON s.id=v.site_id WHERE v.id=p_page_version_id;
  IF version.id IS NULL OR NOT app.has_site_access(version.site_id) THEN RAISE EXCEPTION 'page preview is not available' USING ERRCODE='CMS03'; END IF;
  manifest:=app.build_render_manifest_core(p_page_version_id,version.initial_release_required,true);
  manifest:=jsonb_set(manifest,'{page}',manifest->'page'||jsonb_build_object('title',version.page_title,'path',app.page_path(version.page_slug)));
  SELECT COALESCE(jsonb_agg(CASE WHEN (version.content->((ordinality-1)::int)) ? 'appearance'
    THEN jsonb_set(value,'{instance,appearance}',version.content->((ordinality-1)::int)->'appearance',true)
    ELSE value END ORDER BY ordinality),'[]'::jsonb) INTO sections
    FROM jsonb_array_elements(manifest->'sections') WITH ORDINALITY;
  RETURN jsonb_set(manifest,'{sections}',sections)||jsonb_build_object('fonts',COALESCE((SELECT jsonb_agg(jsonb_build_object('assetId',a.id,'fontKey',a.font_key) ORDER BY a.font_key)
    FROM public.site_assets a JOIN public.site_asset_usage u ON u.asset_id=a.id WHERE u.version_id=p_page_version_id AND a.kind='font'),'[]'::jsonb));
END $$;

REVOKE ALL ON FUNCTION app.resolve_editor_preview_repeat_values(uuid,jsonb,jsonb,boolean),
 app.build_render_manifest_core(uuid,boolean,boolean) FROM PUBLIC,cms_authenticated_user,cms_public_renderer,cms_worker;
ALTER FUNCTION app.resolve_editor_preview_repeat_values(uuid,jsonb,jsonb,boolean) OWNER TO cms_migration_owner;
ALTER FUNCTION app.build_render_manifest_core(uuid,boolean,boolean) OWNER TO cms_migration_owner;
