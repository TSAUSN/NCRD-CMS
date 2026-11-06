-- Upload/retention is not anonymous publication. Authorize the requested
-- rendition only through the current rendered page/frame/metadata sinks.
CREATE FUNCTION app.page_component_uses_url_pattern(p_component jsonb,p_values jsonb,p_pattern text)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,public AS $$
DECLARE node jsonb; binding jsonb; entry jsonb; schema_fields jsonb; item_values jsonb;
        item_node jsonb; simple_nodes jsonb:='[]'::jsonb; repeat_match boolean:=false;
BEGIN
  IF p_component->>'definition_kind' IS DISTINCT FROM 'structured' THEN
    RETURN app.frame_component_uses_url_pattern(p_component,p_values,p_pattern);
  END IF;
  -- Flatten ordinary element containers, keeping each repeat's item/values
  -- together. Values outside a declared rendered field never grant delivery.
  FOR node IN WITH RECURSIVE nodes(value) AS (
    SELECT value FROM jsonb_array_elements(p_component#>'{structured_doc,nodes}')
    UNION ALL SELECT child.value FROM nodes n CROSS JOIN LATERAL jsonb_array_elements(
      CASE WHEN n.value->>'type'='element' THEN COALESCE(n.value->'children','[]'::jsonb) ELSE '[]'::jsonb END) child
  ) SELECT value FROM nodes LOOP
    IF node->>'type'='element' THEN CONTINUE; END IF;
    IF node->>'type'<>'repeat' THEN simple_nodes:=simple_nodes||jsonb_build_array(node); CONTINUE; END IF;
    binding:=p_values->(node->>'field');
    IF binding->>'kind' IS DISTINCT FROM 'collection' OR jsonb_typeof(binding->'entries') IS DISTINCT FROM 'array'
      OR jsonb_typeof(binding->'schemas') IS DISTINCT FROM 'array' THEN RETURN false; END IF;
    FOR entry IN SELECT value FROM jsonb_array_elements(binding->'entries') LOOP
      SELECT value->'fields' INTO schema_fields FROM jsonb_array_elements(binding->'schemas')
        WHERE value->>'id'=entry->>'schemaVersionId';
      IF schema_fields IS NULL OR app.collection_repeat_item_defect(node->'item',schema_fields) IS NOT NULL THEN RETURN false; END IF;
      item_values:=entry->'values';
      -- Collection URL fields are strings; the renderer supplies their schema
      -- labels at link nodes. Ordinary page links already store {url,label}.
      FOR item_node IN WITH RECURSIVE nodes(value) AS (
        SELECT value FROM jsonb_array_elements(node->'item')
        UNION ALL SELECT child.value FROM nodes n CROSS JOIN LATERAL jsonb_array_elements(
          CASE WHEN n.value->>'type'='element' THEN COALESCE(n.value->'children','[]'::jsonb) ELSE '[]'::jsonb END) child
      ) SELECT value FROM nodes WHERE value->>'type'='link' LOOP
        item_values:=jsonb_set(item_values,ARRAY[item_node->>'field'],CASE
          WHEN COALESCE(entry->'values'->>(item_node->>'field'),'')='' THEN 'null'::jsonb
          ELSE jsonb_build_object('url',entry->'values'->>(item_node->>'field'),'label',
            (SELECT value->>'label' FROM jsonb_array_elements(schema_fields) WHERE value->>'key'=item_node->>'field')) END);
      END LOOP;
      IF app.frame_component_uses_url_pattern(jsonb_build_object('definition_kind','structured',
        'structured_doc',jsonb_build_object('nodes',node->'item')),item_values,p_pattern) THEN repeat_match:=true; END IF;
    END LOOP;
  END LOOP;
  RETURN repeat_match OR app.frame_component_uses_url_pattern(
    jsonb_set(p_component,'{structured_doc,nodes}',simple_nodes),p_values,p_pattern);
END $$;

CREATE FUNCTION app.render_manifest_uses_media_url(p_manifest jsonb,p_pattern text)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,public AS $$
DECLARE section jsonb; component jsonb; instance jsonb;
BEGIN
  IF app.frame_url_matches(p_manifest#>>'{meta,social_image}',p_pattern) THEN RETURN true; END IF;
  FOR section IN SELECT value FROM jsonb_array_elements(COALESCE(p_manifest->'sections','[]'::jsonb)) LOOP
    component:=section->'def'; instance:=section->'instance';
    IF instance->'hidden'='true'::jsonb THEN CONTINUE; END IF;
    IF app.compiled_css_defect(component->>'css',(component->>'css_policy_version')::int,
       '.cms-section--'||(component->>'slug')) IS NOT NULL THEN CONTINUE; END IF;
    IF btrim(COALESCE(instance->>'raw_html',''))<>'' THEN
      -- Only approved page versions reach public route snapshots. Raw source
      -- replaces the section body, so old typed values cannot authorize media.
      IF app.frame_markup_uses_url_pattern(instance->>'raw_html',p_pattern) THEN RETURN true; END IF;
    ELSIF COALESCE(app.structured_section_defect(component->>'definition_kind',component->'structured_doc',
      (component->>'structured_schema_version')::int),app.render_ast_defect(component->'compiled_ast',
      (component->>'sanitizer_policy_version')::int)) IS NULL
      AND app.page_component_uses_url_pattern(component,instance->'values',p_pattern) THEN RETURN true;
    END IF;
    IF app.frame_css_uses_url_pattern(component->>'css',p_pattern) THEN RETURN true; END IF;
    -- Source selectors are scoped by the renderer, so the source-stage check
    -- deliberately omits a compiled selector prefix. Active/network rules
    -- and malformed strings still refuse the complete source sheet.
    IF app.compiled_css_defect(instance->>'custom_css',app.current_css_policy_version(),NULL) IS NULL
      AND app.frame_css_uses_url_pattern(instance->>'custom_css',p_pattern) THEN RETURN true; END IF;
  END LOOP;
  RETURN false;
END $$;

CREATE OR REPLACE FUNCTION public_api.resolve_media(p_host text,p_media_id uuid,p_variant text)
RETURNS TABLE(media_id uuid,variant text,object_key text,mime_type text,bytes bigint,width integer,height integer,content_hash text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
  SELECT media.id,p_variant,
    CASE WHEN p_variant='original' THEN media.object_key ELSE variant.object_key END,
    CASE WHEN p_variant='original' THEN media.mime_type ELSE variant.mime_type END,
    CASE WHEN p_variant='original' THEN media.bytes ELSE variant.bytes END,
    CASE WHEN p_variant='original' THEN media.width ELSE variant.width END,
    CASE WHEN p_variant='original' THEN media.height ELSE variant.height END,
    CASE WHEN p_variant='original' THEN media.content_hash ELSE variant.content_hash END
  FROM public_api.resolve_host(p_host) host
  JOIN public.media media ON media.site_id=host.site_id OR media.site_id IS NULL
  LEFT JOIN public.media_variants variant ON variant.media_id=media.id AND variant.kind=p_variant AND p_variant<>'original'
  WHERE media.id=p_media_id AND media.status='ready' AND media.deleted_at IS NULL AND media.purged_at IS NULL
    AND p_variant IN ('original','thumbnail','card','wide') AND (p_variant='original' OR variant.id IS NOT NULL)
    AND (
      EXISTS(SELECT 1 FROM public.published_routes route JOIN public.pages page
        ON page.id=route.page_id AND page.published_version_id=route.page_version_id AND page.archived_at IS NULL
        WHERE route.site_id=host.site_id AND app.render_manifest_uses_media_url(route.render_manifest,
          '^/media/'||media.id::text||'/'||p_variant||'([?#][^[:space:]]*)?$'))
      OR app.published_frame_uses_url_pattern(host.site_id,
          '^/media/'||media.id::text||'/'||p_variant||'([?#][^[:space:]]*)?$')
      OR EXISTS(SELECT 1 FROM public.global_elements element JOIN public.global_element_versions version
        ON version.id=element.published_version_id WHERE element.site_id=host.site_id AND element.kind='header'
        AND version.content->'schemaVersion'='1'::jsonb AND version.content->'enabled'='true'::jsonb
        AND ((p_variant='wide' AND version.content#>>'{brand,logoMediaId}'=media.id::text)
          OR (p_variant='thumbnail' AND version.content#>>'{brand,compactLogoMediaId}'=media.id::text)))
    )
$$;
REVOKE ALL ON FUNCTION app.page_component_uses_url_pattern(jsonb,jsonb,text),app.render_manifest_uses_media_url(jsonb,text)
  FROM PUBLIC,cms_authenticated_user,cms_public_renderer,cms_worker;
ALTER FUNCTION app.page_component_uses_url_pattern(jsonb,jsonb,text) OWNER TO cms_migration_owner;
ALTER FUNCTION app.render_manifest_uses_media_url(jsonb,text) OWNER TO cms_migration_owner;
