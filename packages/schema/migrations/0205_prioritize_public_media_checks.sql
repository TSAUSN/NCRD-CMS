-- Public media checks were validating unrelated route and section CSS before
-- reaching a known rendered picture. On the review SQL shared core, a single
-- image took over 40 seconds and queued other image/preview requests.
-- Change only evaluation order; keep all rendered-sink and tenant gates.
CREATE OR REPLACE FUNCTION app.render_manifest_uses_media_url(p_manifest jsonb,p_pattern text)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,public AS $$
DECLARE section jsonb; component jsonb; instance jsonb;
        identity text := lower(substring(p_pattern FROM '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}'));
BEGIN
  IF app.frame_url_matches(p_manifest#>>'{meta,social_image}',p_pattern) THEN RETURN true; END IF;
  FOR section IN
    SELECT value FROM jsonb_array_elements(COALESCE(p_manifest->'sections','[]'::jsonb))
    ORDER BY COALESCE(strpos(lower(value::text), identity)>0,false) DESC
  LOOP
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


-- Prioritize likely references, then run every original sink/policy check.
-- Encoded URLs or indirect representations still use the complete fallback;
-- absence of a literal identity never removes a candidate or grants access.
CREATE FUNCTION app.published_routes_use_media_url(p_site uuid,p_pattern text)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE manifest jsonb;
        identity text := lower(substring(p_pattern FROM '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}'));
BEGIN
  FOR manifest IN
    SELECT route.render_manifest FROM public.published_routes route JOIN public.pages page
      ON page.id=route.page_id AND page.published_version_id=route.page_version_id AND page.archived_at IS NULL
    WHERE route.site_id=p_site
    ORDER BY COALESCE(strpos(lower(route.render_manifest::text),identity)>0,false) DESC
  LOOP
    IF app.render_manifest_uses_media_url(manifest,p_pattern) THEN RETURN true; END IF;
  END LOOP;
  RETURN false;
END $$;
REVOKE ALL ON FUNCTION app.published_routes_use_media_url(uuid,text) FROM PUBLIC,cms_authenticated_user,cms_public_renderer,cms_worker;
ALTER FUNCTION app.published_routes_use_media_url(uuid,text) OWNER TO cms_migration_owner;
CREATE OR REPLACE FUNCTION public_api.resolve_media_before_native(p_host text,p_media_id uuid,p_variant text)
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
      app.published_routes_use_media_url(host.site_id,
        '^/media/'||media.id::text||'/'||p_variant||'([?#][^[:space:]]*)?$')
      OR app.published_frame_uses_url_pattern(host.site_id,
          '^/media/'||media.id::text||'/'||p_variant||'([?#][^[:space:]]*)?$')
      OR EXISTS(SELECT 1 FROM public.global_elements element JOIN public.global_element_versions version
        ON version.id=element.published_version_id WHERE element.site_id=host.site_id AND element.kind='header'
        AND version.content->'schemaVersion'='1'::jsonb AND version.content->'enabled'='true'::jsonb
        AND ((p_variant='wide' AND version.content#>>'{brand,logoMediaId}'=media.id::text)
          OR (p_variant='thumbnail' AND version.content#>>'{brand,compactLogoMediaId}'=media.id::text)))
    )
$$;
ALTER FUNCTION public_api.resolve_media_before_native(text,uuid,text) OWNER TO cms_migration_owner;
REVOKE ALL ON FUNCTION public_api.resolve_media_before_native(text,uuid,text) FROM PUBLIC,cms_authenticated_user,cms_public_renderer,cms_worker;
