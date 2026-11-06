-- Footer logo inheritance is restricted to an opted-in, pinned image slot.
-- Reference extraction and public delivery must see the same effective image.
CREATE FUNCTION app.frame_values_with_header_logo(p_site_id uuid,p_kind global_element_kind,p_content jsonb,p_published boolean)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE result jsonb:=p_content->'component'->'values'; slot jsonb; header jsonb; header_slot jsonb; logo jsonb;
BEGIN
 IF p_kind<>'footer' OR p_content->'schemaVersion' IS DISTINCT FROM '2'::jsonb THEN RETURN result; END IF;
 SELECT v.content INTO header FROM public.global_elements g JOIN public.global_element_versions v
 ON v.id=CASE WHEN p_published THEN g.published_version_id ELSE g.draft_version_id END AND v.site_id=g.site_id AND v.global_element_id=g.id
 WHERE g.site_id=p_site_id AND g.kind='header';
 FOR slot IN SELECT value FROM public.section_def_versions v JOIN public.section_defs d ON d.id=v.section_def_id,
 LATERAL jsonb_array_elements(v.slots) WHERE d.id=(p_content->'component'->>'section_def_id')::uuid
 AND v.version=(p_content->'component'->>'section_def_version')::int AND d.placement='footer' AND (d.scope='global' OR d.site_id=p_site_id)
 LOOP
  IF slot->>'kind'<>'image' OR slot->'constraints'->'inheritHeaderLogo' IS DISTINCT FROM 'true'::jsonb OR result ? (slot->>'id') THEN CONTINUE; END IF;
  logo:=NULL;
  IF header->'schemaVersion'='2'::jsonb THEN
   SELECT value INTO header_slot FROM public.section_def_versions v JOIN public.section_defs d ON d.id=v.section_def_id,
   LATERAL jsonb_array_elements(v.slots) WHERE d.id=(header->'component'->>'section_def_id')::uuid
   AND v.version=(header->'component'->>'section_def_version')::int AND d.placement='header' AND (d.scope='global' OR d.site_id=p_site_id)
   AND value->>'kind'='image' AND value->'constraints'->'siteLogo'='true'::jsonb LIMIT 1;
   logo:=header->'component'->'values'->(header_slot->>'id');
  END IF;
  IF jsonb_typeof(logo) IS DISTINCT FROM 'object' THEN logo:=slot->'constraints'->'sourceSample'; END IF;
  IF logo IS NOT NULL THEN result:=jsonb_set(result,ARRAY[slot->>'id'],logo); END IF;
 END LOOP;
 RETURN result;
END $$;
ALTER FUNCTION app.frame_values_with_header_logo(uuid,global_element_kind,jsonb,boolean) OWNER TO cms_migration_owner;
REVOKE ALL ON FUNCTION app.frame_values_with_header_logo(uuid,global_element_kind,jsonb,boolean) FROM PUBLIC;

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
      component, app.frame_values_with_header_logo(p_site_id,frame.kind,frame.content,true), p_url_pattern, p_links_only) THEN RETURN true; END IF;
  END LOOP;
  RETURN false;
END
$$;

-- Return malformed references as defects instead of raising during extraction:
-- drafts/history remain repairable, and valid sibling references are retained.
CREATE OR REPLACE FUNCTION app.global_element_media_references(p_site_id uuid, p_kind global_element_kind, p_content jsonb)
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
  values := app.frame_values_with_header_logo(p_site_id,p_kind,p_content,false);
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

