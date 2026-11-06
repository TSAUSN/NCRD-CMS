-- 0091 — retained media usage and publication readiness for site frames.
-- 0087's rendered-URL matcher is shared by draft validation and live delivery.
-- Its parser/renderer boundaries stay unchanged; metadata and inert mentions
-- do not become references merely because a UUID appears in saved content.

CREATE FUNCTION app.frame_component_uses_url_pattern(
  p_component jsonb, p_values jsonb, p_url_pattern text, p_links_only boolean DEFAULT false
) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog, public AS $$
DECLARE component jsonb := p_component; values jsonb := p_values;
        node jsonb; value jsonb; markup text; kind text; context text; address text;
BEGIN
  -- The shell does not resolve collection bindings for frames. A repeat
  -- makes the structured renderer refuse the body; its item template and
  -- sibling values must not independently grant public access.
  IF component->>'definition_kind'='structured' AND EXISTS (
    WITH RECURSIVE nodes(value) AS (
      SELECT root.value FROM jsonb_array_elements(component#>'{structured_doc,nodes}') root
      UNION ALL
      SELECT child.value FROM nodes n CROSS JOIN LATERAL jsonb_array_elements(
        CASE WHEN n.value->>'type'='element' THEN COALESCE(n.value->'children','[]'::jsonb) ELSE '[]'::jsonb END) child
    ) SELECT 1 FROM nodes WHERE nodes.value->>'type'='repeat'
  ) THEN RETURN false; END IF;
  IF component->>'definition_kind'<>'structured' AND NOT app.frame_ast_bindings_match(component->'compiled_ast') THEN RETURN false; END IF;
  IF NOT p_links_only AND app.frame_css_uses_url_pattern(component->>'css', p_url_pattern) THEN RETURN true; END IF;

  IF component->>'definition_kind' = 'structured' THEN
    -- Walk rendered children only. Field declarations/labels, unused values,
    -- provider metadata and repeat templates are not rendered media sinks.
    FOR node IN
      WITH RECURSIVE nodes(value, depth) AS (
        SELECT root.value, 1 FROM jsonb_array_elements(component#>'{structured_doc,nodes}') root
        UNION ALL
        SELECT child.value, n.depth+1 FROM nodes n CROSS JOIN LATERAL
          jsonb_array_elements(CASE WHEN n.value->>'type'='element'
            THEN COALESCE(n.value->'children','[]'::jsonb) ELSE '[]'::jsonb END) child
          WHERE n.depth<16
      ) SELECT nodes.value FROM nodes
    LOOP
      value := values->(node->>'field'); kind := node->>'type';
      IF NOT p_links_only AND kind='image' AND jsonb_typeof(value)='object'
         AND (value->'decorative'='true'::jsonb OR
           (jsonb_typeof(value->'alt')='string' AND value->>'alt'<>'')) THEN
        IF app.frame_url_matches(value->>'src', p_url_pattern) THEN RETURN true; END IF;
      ELSIF kind='link' AND jsonb_typeof(value)='object' AND jsonb_typeof(value->'label')='string' AND value->>'label'<>'' THEN
        IF app.frame_url_matches(value->>'url', p_url_pattern) THEN RETURN true; END IF;
      ELSIF kind='richtext' AND jsonb_typeof(value)='string' THEN
        IF app.frame_markup_uses_url_pattern(value#>>'{}', p_url_pattern, true) THEN RETURN true; END IF;
      END IF;
    END LOOP;
  ELSE
    -- Reconstruct URL attributes in their owning element before matching.
    -- Attribute names alone are insufficient: <div href> and <a src> are
    -- inert even if their declared slot kind is link/image.
    markup := '';
    FOR node IN SELECT entry.value FROM jsonb_array_elements(component#>'{compiled_ast,nodes}') entry LOOP
      IF node->>'kind'='html' THEN markup := markup || (node->>'value'); CONTINUE; END IF;
      value := values->(node->>'slotId'); address := NULL;
      IF node->>'context'='url-attribute' THEN
        IF node->>'slotKind'='image' AND node->>'attribute'='src' AND jsonb_typeof(value)='object' THEN
          address := value->>'src';
        ELSIF node->>'slotKind' IN ('link','button') AND node->>'attribute'='href' AND jsonb_typeof(value)='object' THEN
          address := value->>'url';
        ELSIF node->>'slotKind'='text' AND jsonb_typeof(value)='string'
          AND node->>'attribute' IN ('src','href','poster','background','xlink:href') THEN
          address := value#>>'{}';
        ELSIF node->>'slotKind'='text' AND node->>'attribute'='srcset' AND jsonb_typeof(value)='string'
          AND app.frame_srcset_is_safe(value#>>'{}') THEN
          address := regexp_replace(value#>>'{}','[[:cntrl:]]','','g');
        END IF;
      END IF;
      -- Keep unsupported/absent values inert instead of accidentally joining
      -- static URL halves, and escape scalar values as the renderer does.
      markup := markup || replace(replace(replace(replace(replace(COALESCE(address,'__cms_value__'),
        '&','&amp;'),'<','&lt;'),'>','&gt;'),'"','&quot;'),chr(39),'&#39;');
    END LOOP;
    IF app.frame_markup_uses_url_pattern(markup, p_url_pattern, false, p_links_only) THEN RETURN true; END IF;
    FOR node IN SELECT entry.value FROM jsonb_array_elements(component#>'{compiled_ast,nodes}') entry
      WHERE entry.value->>'kind'='slot'
    LOOP
      value := values->(node->>'slotId'); kind := node->>'slotKind'; context := node->>'context';
      address := NULL;
      IF NOT p_links_only AND kind='image' AND context='element-text' THEN
        address := CASE WHEN jsonb_typeof(value)='object' THEN value->>'src'
          WHEN context='element-text' AND jsonb_typeof(value)='string' THEN value#>>'{}' END;
      ELSIF kind IN ('link','button') AND context='element-text' THEN
        address := CASE WHEN jsonb_typeof(value)='object' THEN value->>'url'
          WHEN context='element-text' AND jsonb_typeof(value)='string' THEN value#>>'{}' END;
      ELSIF kind='richtext' AND context='element-text' AND jsonb_typeof(value)='string' THEN
        IF app.frame_markup_uses_url_pattern(value#>>'{}', p_url_pattern, true) THEN RETURN true; END IF;
      END IF;
      IF app.frame_url_matches(address, p_url_pattern) THEN RETURN true; END IF;
    END LOOP;
  END IF;
  RETURN false;
END
$$;

CREATE OR REPLACE FUNCTION app.published_frame_uses_url_pattern(p_site_id uuid, p_url_pattern text, p_links_only boolean DEFAULT false)
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE frame RECORD; component jsonb;
BEGIN
  FOR frame IN
    SELECT g.kind, v.content FROM public.global_elements g
      JOIN public.global_element_versions v ON v.id=g.published_version_id
        AND v.global_element_id=g.id AND v.site_id=g.site_id
     WHERE g.site_id=p_site_id AND v.content->'schemaVersion'='2'::jsonb
       AND v.content->'enabled'='true'::jsonb
  LOOP
    component := app.global_component_view(p_site_id, frame.kind, frame.content);
    IF component IS NOT NULL AND app.frame_component_uses_url_pattern(
      component, frame.content->'component'->'values', p_url_pattern, p_links_only) THEN RETURN true; END IF;
  END LOOP;
  RETURN false;
END
$$;

-- Return malformed references as defects instead of raising during extraction:
-- drafts/history remain repairable, and valid sibling references are retained.
CREATE FUNCTION app.global_element_media_references(p_site_id uuid, p_kind global_element_kind, p_content jsonb)
RETURNS TABLE(media_id uuid, variant text, defect text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE component jsonb; values jsonb; candidate text; rendition text; logo_key text;
BEGIN
  IF p_kind='header' AND p_content->'schemaVersion'='1'::jsonb THEN
    FOREACH logo_key IN ARRAY ARRAY['logoMediaId','compactLogoMediaId'] LOOP
      candidate := p_content->'brand'->>logo_key;
      IF candidate IS NULL THEN CONTINUE; END IF;
      media_id := NULL; defect := NULL;
      variant := CASE logo_key WHEN 'logoMediaId' THEN 'wide' ELSE 'thumbnail' END;
      IF candidate ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
        media_id := candidate::uuid;
      ELSE defect := 'the header logo has an invalid Media ID'; END IF;
      RETURN NEXT;
    END LOOP;
    RETURN;
  END IF;
  IF p_content->'schemaVersion' IS DISTINCT FROM '2'::jsonb
    OR app.global_component_defect(p_kind,p_content) IS NOT NULL THEN RETURN; END IF;
  -- Historical pins need protection even if a policy change requires later
  -- revalidation. Publication separately runs the complete current frame gate.
  SELECT jsonb_build_object('compiled_ast',v.compiled_ast,'css',v.compiled_css,
    'definition_kind',v.definition_kind,'structured_doc',v.structured_doc) INTO component
    FROM public.section_def_versions v JOIN public.section_defs d ON d.id=v.section_def_id
   WHERE d.id=(p_content->'component'->>'section_def_id')::uuid
     AND v.version=(p_content->'component'->>'section_def_version')::int
     AND d.placement=p_kind::text AND (d.scope='global' OR d.site_id=p_site_id);
  IF component IS NULL THEN RETURN; END IF;
  values := p_content->'component'->'values';
  IF app.frame_component_uses_url_pattern(component,values,
    '^/media/(?![0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/(original|thumbnail|card|wide)([?#][^[:space:]]*)?$)') THEN
    media_id := NULL; variant := NULL; defect := format('the %s contains an invalid Media address',p_kind);
    RETURN NEXT;
  END IF;
  -- UUIDs are candidates, not authority. Probe each canonical rendition against
  -- the same actual rendered sinks as delivery. This also covers src-only image
  -- values, static HTML/CSS, rich-text links and split URL attribute bindings.
  FOR candidate IN SELECT DISTINCT lower(match[1]) FROM regexp_matches(
    jsonb_build_object('definition',component,'values',values)::text,
    '([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})','g') AS matches(match)
  LOOP
    FOREACH rendition IN ARRAY ARRAY['original','thumbnail','card','wide'] LOOP
      IF app.frame_component_uses_url_pattern(component,values,
        '^/media/'||candidate||'/'||rendition||'([?#][^[:space:]]*)?$') THEN
        media_id := candidate::uuid; variant := rendition; defect := NULL;
        RETURN NEXT;
      END IF;
    END LOOP;
  END LOOP;
END
$$;

CREATE FUNCTION app.index_global_element_version_media(p_version_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE version RECORD; reference RECORD;
BEGIN
  SELECT v.*,g.kind INTO version FROM public.global_element_versions v
    JOIN public.global_elements g ON g.id=v.global_element_id AND g.site_id=v.site_id WHERE v.id=p_version_id;
  IF NOT FOUND THEN RETURN; END IF;
  -- Share locks serialize deletion with reference creation without preventing
  -- drafts from retaining already deleted, but recoverable, images.
  FOR reference IN SELECT DISTINCT m.id FROM app.global_element_media_references(version.site_id,version.kind,version.content) r
    JOIN public.media m ON m.id=r.media_id AND (m.site_id IS NULL OR m.site_id=version.site_id)
    ORDER BY m.id
  LOOP
    PERFORM 1 FROM public.media WHERE id=reference.id FOR SHARE;
    INSERT INTO public.media_usage(media_id,site_id,item_type,item_id,version_id)
      VALUES(reference.id,version.site_id,'global_element',version.global_element_id,version.id)
      ON CONFLICT(media_id,version_id) DO NOTHING;
  END LOOP;
END
$$;

CREATE FUNCTION app.index_new_global_element_version_media() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  PERFORM app.index_global_element_version_media(NEW.id);
  RETURN NEW;
END
$$;
CREATE TRIGGER global_element_versions_index_media AFTER INSERT ON public.global_element_versions
  FOR EACH ROW EXECUTE FUNCTION app.index_new_global_element_version_media();

DO $$
DECLARE version_id uuid;
BEGIN
  FOR version_id IN SELECT id FROM public.global_element_versions LOOP
    PERFORM app.index_global_element_version_media(version_id);
  END LOOP;
END
$$;

ALTER FUNCTION app.global_elements_readiness_defect(uuid,global_element_kind,jsonb)
  RENAME TO global_elements_readiness_before_frame_media;
CREATE FUNCTION app.global_elements_readiness_defect(p_site_id uuid,p_kind global_element_kind,p_content jsonb)
RETURNS text
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE problem text; reference RECORD;
BEGIN
  problem := app.global_elements_readiness_before_frame_media(p_site_id,p_kind,p_content);
  IF problem IS NOT NULL THEN RETURN problem; END IF;
  -- Disabling a broken authored frame is a legitimate repair, and emits no image.
  IF p_content->'enabled'='false'::jsonb THEN RETURN NULL; END IF;
  FOR reference IN SELECT * FROM app.global_element_media_references(p_site_id,p_kind,p_content) ORDER BY media_id LOOP
    IF reference.defect IS NOT NULL THEN RETURN reference.defect; END IF;
    -- Keep the check true until the publication transaction has committed.
    PERFORM 1 FROM public.media WHERE id=reference.media_id
      AND (site_id IS NULL OR site_id=p_site_id) FOR SHARE;
    IF NOT EXISTS(SELECT 1 FROM public.media m WHERE m.id=reference.media_id
      AND (m.site_id IS NULL OR m.site_id=p_site_id) AND m.status='ready' AND m.deleted_at IS NULL
      AND (reference.variant='original' OR EXISTS(SELECT 1 FROM public.media_variants v
        WHERE v.media_id=m.id AND v.kind=reference.variant AND v.mime_type IS NOT NULL AND v.content_hash IS NOT NULL))) THEN
      RETURN format('the %s contains media that is missing, deleted, unavailable to this site, or missing its rendition',p_kind);
    END IF;
  END LOOP;
  RETURN NULL;
END
$$;

REVOKE ALL ON FUNCTION app.frame_component_uses_url_pattern(jsonb,jsonb,text,boolean),
  app.global_element_media_references(uuid,global_element_kind,jsonb),app.index_global_element_version_media(uuid),
  app.index_new_global_element_version_media(),app.global_elements_readiness_before_frame_media(uuid,global_element_kind,jsonb),
  app.global_elements_readiness_defect(uuid,global_element_kind,jsonb) FROM PUBLIC,cms_authenticated_user,cms_public_renderer,cms_worker;
ALTER FUNCTION app.frame_component_uses_url_pattern(jsonb,jsonb,text,boolean) OWNER TO cms_migration_owner;
ALTER FUNCTION app.global_element_media_references(uuid,global_element_kind,jsonb) OWNER TO cms_migration_owner;
ALTER FUNCTION app.index_global_element_version_media(uuid) OWNER TO cms_migration_owner;
ALTER FUNCTION app.index_new_global_element_version_media() OWNER TO cms_migration_owner;
ALTER FUNCTION app.global_elements_readiness_defect(uuid,global_element_kind,jsonb) OWNER TO cms_migration_owner;
