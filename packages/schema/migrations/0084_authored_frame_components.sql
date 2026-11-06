-- 0084 — authored header and footer components (ADR 0010).
--
-- A header or footer version may pin a section definition whose placement is
-- `header` or `footer` instead of choosing a preset. The site owns one value
-- set, so the frame is site-wide by construction; a new definition version
-- reaches the site only through a saved and published frame version. Presets
-- (schemaVersion 1) keep their exact validation and rendering.

-- ------------------------------------------------------------- placement --

ALTER TABLE public.section_defs
  ADD COLUMN placement text NOT NULL DEFAULT 'page'
  CONSTRAINT section_defs_placement CHECK (placement IN ('page', 'header', 'footer'));

CREATE FUNCTION app.set_section_def_placement(p_section_def_id uuid, p_placement text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE actor uuid; def RECORD;
BEGIN
  actor := app.require_actor();
  IF NOT app.is_super_admin() THEN
    RAISE EXCEPTION 'only a super admin may decide where a section definition is placed' USING ERRCODE = 'CMS02';
  END IF;
  IF p_placement IS NULL OR p_placement NOT IN ('page', 'header', 'footer') THEN
    RAISE EXCEPTION 'placement must be page, header or footer' USING ERRCODE = 'CMS04';
  END IF;
  SELECT d.id, d.site_id, d.placement INTO def FROM public.section_defs d WHERE d.id = p_section_def_id FOR UPDATE;
  IF def IS NULL THEN RAISE EXCEPTION 'no such section definition' USING ERRCODE = 'CMS03'; END IF;
  IF def.placement = p_placement THEN RETURN; END IF;
  -- Moving a definition between page content and the site frame would strand
  -- whatever already pins it, so only an unused definition moves.
  IF EXISTS (SELECT 1 FROM public.page_versions v, jsonb_array_elements(
               CASE WHEN jsonb_typeof(v.content) = 'array' THEN v.content ELSE '[]'::jsonb END) item
              WHERE item->>'section_def_id' = def.id::text)
     OR EXISTS (SELECT 1 FROM public.global_element_versions g
              WHERE g.content->'component'->>'section_def_id' = def.id::text) THEN
    RAISE EXCEPTION 'this definition is already used, so its placement cannot change' USING ERRCODE = 'CMS04';
  END IF;
  UPDATE public.section_defs SET placement = p_placement WHERE id = def.id;
  PERFORM app.write_audit(def.site_id, 'user', actor, 'section_def.placement', 'section_def', def.id,
    NULL, NULL, jsonb_build_object('before', def.placement, 'after', p_placement));
END
$$;

-- A page never places a frame component; the frame is edited site-wide only.
CREATE FUNCTION app.validate_page_section_placement() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF jsonb_typeof(NEW.content) = 'array' AND EXISTS (
    SELECT 1 FROM jsonb_array_elements(NEW.content) item
      JOIN public.section_defs d ON d.id::text = item->>'section_def_id'
     WHERE d.placement <> 'page') THEN
    RAISE EXCEPTION 'a site header or footer component cannot be placed in page content' USING ERRCODE = 'CMS04';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER page_versions_section_placement BEFORE INSERT ON public.page_versions
  FOR EACH ROW EXECUTE FUNCTION app.validate_page_section_placement();

-- ------------------------------------------------------ navigation slot --
-- Same function as 0073 with one addition: a `navigation` slot, which stores
-- no value and may only sit between tags.

CREATE OR REPLACE FUNCTION app.render_ast_defect(p_ast jsonb, p_policy_version int) RETURNS text
LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog, public AS $$
DECLARE node jsonb; ord int := 0; ctx text; kind text; id text; has_slot boolean := false; markup text := '';
        declared int;
BEGIN
  IF p_policy_version IS NULL OR p_policy_version NOT IN (app.current_sanitizer_policy_version(), 5) THEN
    RETURN format('was compiled under sanitizer policy version %s, but this database requires version %s',
                  COALESCE(p_policy_version::text, 'null'),
                  app.current_sanitizer_policy_version());
  END IF;
  IF p_ast IS NULL OR COALESCE(jsonb_typeof(p_ast), 'missing') <> 'object' THEN
    RETURN 'is not a compiled section';
  END IF;
  IF COALESCE(jsonb_typeof(p_ast -> 'nodes'), 'missing') <> 'array' THEN
    RETURN 'has no node list';
  END IF;
  IF COALESCE(jsonb_typeof(p_ast -> 'policyVersion'), 'missing') <> 'number' THEN
    RETURN 'does not say which sanitizer policy version compiled it';
  END IF;
  declared := (p_ast ->> 'policyVersion')::int;
  IF declared IS DISTINCT FROM p_policy_version THEN
    RETURN format('says it was compiled under sanitizer policy version %s while its row claims %s',
                  declared, p_policy_version);
  END IF;

  FOR node IN SELECT * FROM jsonb_array_elements(p_ast -> 'nodes') LOOP
    IF COALESCE(jsonb_typeof(node), 'missing') <> 'object' THEN
      RETURN format('node %s is not an object', ord);
    END IF;

    IF node ->> 'kind' = 'html' THEN
      IF COALESCE(jsonb_typeof(node -> 'value'), 'missing') <> 'string' THEN
        RETURN format('node %s is markup with no value', ord);
      END IF;
      IF node ->> 'value' ~ '\{\{[[:space:]]*[A-Za-z0-9_-]+[[:space:]]*\}\}' THEN
        RETURN format('node %s contains a slot token no compiler leaves in markup', ord);
      END IF;
      markup := markup || COALESCE(node ->> 'value', '');

    ELSIF node ->> 'kind' = 'slot' THEN
      id := node ->> 'slotId';
      IF NOT app.is_slot_id(id) THEN
        RETURN format('node %s has a slot id that is not a usable one: %s', ord, COALESCE(id, 'null'));
      END IF;
      has_slot := true;
      kind := COALESCE(node ->> 'slotKind', '');
      IF kind NOT IN ('text', 'richtext', 'image', 'link', 'button', 'repeat', 'navigation') THEN
        RETURN format('slot %s has kind %s, which is not a slot kind', id, kind);
      END IF;
      ctx := node ->> 'context';
      IF ctx IS NULL THEN
        RETURN format('slot %s does not say what kind of place it sits in', id);
      END IF;
      IF ctx NOT IN ('element-text', 'quoted-attribute', 'url-attribute', 'style-attribute') THEN
        RETURN format('slot %s sits in %s, which cannot be rendered safely', id, ctx);
      END IF;
      IF kind = 'navigation' AND ctx <> 'element-text' THEN
        RETURN format('slot %s is a navigation slot in %s, where markup cannot go', id, ctx);
      END IF;
      IF kind IN ('richtext', 'link', 'button', 'image') AND ctx <> 'element-text'
         AND NOT (p_policy_version = 5 AND (
           (kind = 'image' AND (
             (ctx = 'url-attribute' AND COALESCE(node ->> 'attribute', '') = 'src')
             OR (ctx = 'quoted-attribute' AND COALESCE(node ->> 'attribute', '') IN ('alt', 'role'))
           ))
           OR (kind IN ('link', 'button') AND ctx = 'url-attribute' AND COALESCE(node ->> 'attribute', '') = 'href')
         )) THEN
        RETURN format('slot %s is a %s slot in %s, where markup cannot go', id, kind, ctx);
      END IF;

    ELSE
      RETURN format('node %s has an unknown kind %s', ord, COALESCE(node ->> 'kind', 'null'));
    END IF;
    ord := ord + 1;
  END LOOP;

  IF has_slot AND COALESCE(markup, '') ~* '<[[:space:]]*script[[:space:]/>]' THEN
    RETURN 'mixes a script element with editable slots, which approval cannot make safe';
  END IF;

  RETURN NULL;
END
$$;

-- ------------------------------------------------ frame content version 2 --

ALTER FUNCTION app.global_header_defect(jsonb) RENAME TO global_header_preset_defect;
ALTER FUNCTION app.global_footer_defect(jsonb) RENAME TO global_footer_preset_defect;
ALTER FUNCTION app.global_elements_readiness_defect(uuid, global_element_kind, jsonb)
  RENAME TO global_elements_preset_readiness_defect;

-- Shape only, like the preset checks: a draft may name a definition that is
-- not yet ready, and publication is where readiness is decided.
CREATE FUNCTION app.global_component_defect(p_kind global_element_kind, p_content jsonb)
RETURNS text
LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog, public AS $$
DECLARE keys text[]; component jsonb;
BEGIN
  keys := CASE p_kind WHEN 'header' THEN ARRAY['schemaVersion','enabled','sticky','component']
                      ELSE ARRAY['schemaVersion','enabled','component'] END;
  IF jsonb_typeof(p_content) IS DISTINCT FROM 'object'
     OR (p_content - keys) <> '{}'::jsonb OR NOT (p_content ?& keys) THEN
    RETURN format('an authored %s must contain exactly %s', p_kind, array_to_string(keys, ', '));
  END IF;
  IF p_content->'schemaVersion' <> '2'::jsonb THEN RETURN format('%s schemaVersion must be 2', p_kind); END IF;
  IF jsonb_typeof(p_content->'enabled') IS DISTINCT FROM 'boolean'
     OR (p_kind = 'header' AND jsonb_typeof(p_content->'sticky') IS DISTINCT FROM 'boolean') THEN
    RETURN format('%s enabled and sticky must be booleans', p_kind);
  END IF;
  component := p_content->'component';
  IF jsonb_typeof(component) IS DISTINCT FROM 'object'
     OR (component - ARRAY['section_def_id','section_def_version','values']) <> '{}'::jsonb
     OR NOT (component ?& ARRAY['section_def_id','section_def_version','values']) THEN
    RETURN format('the %s component must contain exactly section_def_id, section_def_version and values', p_kind);
  END IF;
  IF jsonb_typeof(component->'section_def_id') IS DISTINCT FROM 'string'
     OR NOT (component->>'section_def_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$') THEN
    RETURN format('the %s component names no definition', p_kind);
  END IF;
  IF jsonb_typeof(component->'section_def_version') IS DISTINCT FROM 'number'
     OR NOT (component->>'section_def_version' ~ '^[1-9][0-9]{0,8}$') THEN
    RETURN format('the %s component version must be a positive whole number', p_kind);
  END IF;
  IF jsonb_typeof(component->'values') IS DISTINCT FROM 'object'
     OR NOT app.json_within(component->'values', 131072) THEN
    RETURN format('the %s component values must be an object within the size limit', p_kind);
  END IF;
  RETURN NULL;
END
$$;

CREATE FUNCTION app.global_header_defect(p_content jsonb)
RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, public AS $$
  SELECT CASE WHEN jsonb_typeof(p_content) = 'object' AND p_content->'schemaVersion' = '2'::jsonb
    THEN app.global_component_defect('header', p_content)
    ELSE app.global_header_preset_defect(p_content) END
$$;

CREATE FUNCTION app.global_footer_defect(p_content jsonb)
RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, public AS $$
  SELECT CASE WHEN jsonb_typeof(p_content) = 'object' AND p_content->'schemaVersion' = '2'::jsonb
    THEN app.global_component_defect('footer', p_content)
    ELSE app.global_footer_preset_defect(p_content) END
$$;

-- The pinned definition, checked exactly as a page manifest checks a section:
-- placement, visibility to this site, no trusted code, and a current AST and
-- stylesheet. Returns the defect or null.
CREATE FUNCTION app.global_component_readiness_defect(
  p_site_id uuid, p_kind global_element_kind, p_content jsonb
) RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE defect text; def RECORD;
BEGIN
  defect := app.global_component_defect(p_kind, p_content);
  IF defect IS NOT NULL THEN RETURN defect; END IF;
  SELECT d.id, d.slug, d.scope, d.site_id, d.placement, v.compiled_ast, v.compiled_css, v.css_policy_version,
         v.sanitizer_policy_version, v.definition_kind, v.structured_doc, v.structured_schema_version,
         v.carries_trusted_code
    INTO def
    FROM public.section_defs d
    JOIN public.section_def_versions v ON v.section_def_id = d.id
   WHERE d.id = (p_content->'component'->>'section_def_id')::uuid
     AND v.version = (p_content->'component'->>'section_def_version')::int;
  IF def IS NULL THEN RETURN format('the %s component does not exist at that version', p_kind); END IF;
  IF def.placement <> p_kind::text THEN RETURN format('the pinned definition is not a %s component', p_kind); END IF;
  IF NOT (def.scope = 'global' OR def.site_id = p_site_id) THEN
    RETURN format('the %s component belongs to another site', p_kind);
  END IF;
  IF def.carries_trusted_code THEN
    RETURN format('a %s component cannot carry trusted code', p_kind);
  END IF;
  defect := COALESCE(
    app.structured_section_defect(def.definition_kind, def.structured_doc, def.structured_schema_version),
    app.render_ast_defect(def.compiled_ast, def.sanitizer_policy_version),
    app.compiled_css_defect(def.compiled_css, def.css_policy_version, '.cms-section--' || def.slug));
  IF defect IS NOT NULL THEN RETURN format('the %s component needs revalidating: %s', p_kind, defect); END IF;
  RETURN NULL;
END
$$;

CREATE FUNCTION app.global_elements_readiness_defect(
  p_site_id uuid, p_kind global_element_kind, p_content jsonb
) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT CASE WHEN jsonb_typeof(p_content) = 'object' AND p_content->'schemaVersion' = '2'::jsonb
    THEN app.global_component_readiness_defect(p_site_id, p_kind, p_content)
    ELSE app.global_elements_preset_readiness_defect(p_site_id, p_kind, p_content) END
$$;

-- The compiled definition in the shape a page manifest carries, or null when
-- the content is a preset or its component is not ready. The renderer falls
-- back to the baseline frame on null.
CREATE FUNCTION app.global_component_view(p_site_id uuid, p_kind global_element_kind, p_content jsonb)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF jsonb_typeof(p_content) IS DISTINCT FROM 'object' OR p_content->'schemaVersion' <> '2'::jsonb
     OR app.global_component_readiness_defect(p_site_id, p_kind, p_content) IS NOT NULL THEN
    RETURN NULL;
  END IF;
  RETURN (SELECT jsonb_build_object('section_def_id', d.id, 'version', v.version, 'slug', d.slug,
      'compiled_ast', v.compiled_ast, 'css', v.compiled_css, 'slots', v.slots, 'render_hash', v.render_hash,
      'sanitizer_policy_version', v.sanitizer_policy_version, 'css_policy_version', v.css_policy_version,
      'definition_kind', v.definition_kind, 'structured_doc', v.structured_doc,
      'structured_schema_version', v.structured_schema_version)
    FROM public.section_defs d JOIN public.section_def_versions v ON v.section_def_id = d.id
   WHERE d.id = (p_content->'component'->>'section_def_id')::uuid
     AND v.version = (p_content->'component'->>'section_def_version')::int);
END
$$;

-- Private preview of saved or unsaved frame content, under the reader's site
-- access. Never a public surface.
CREATE FUNCTION app.preview_global_component(p_site_id uuid, p_kind global_element_kind, p_content jsonb)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF NOT app.has_site_access(p_site_id) THEN
    RAISE EXCEPTION 'not permitted to preview this site' USING ERRCODE = 'CMS02';
  END IF;
  RETURN app.global_component_view(p_site_id, p_kind, p_content);
END
$$;

-- Same projection as 0045, plus the pinned frame definitions.
CREATE OR REPLACE FUNCTION app.rebuild_site_shell(p_site_id uuid) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE payload jsonb; next_rev bigint; header_live jsonb; footer_live jsonb;
BEGIN
  SELECT gv.content INTO header_live FROM public.global_elements g
    JOIN public.global_element_versions gv ON gv.id = g.published_version_id
   WHERE g.site_id = p_site_id AND g.kind = 'header';
  SELECT gv.content INTO footer_live FROM public.global_elements g
    JOIN public.global_element_versions gv ON gv.id = g.published_version_id
   WHERE g.site_id = p_site_id AND g.kind = 'footer';
  SELECT jsonb_build_object(
    'site', jsonb_build_object('id', s.id, 'name', s.name, 'slug', s.slug, 'kind', s.kind),
    'theme', COALESCE((SELECT tv.tokens FROM public.themes t
                        JOIN public.theme_versions tv ON tv.id = t.published_version_id
                       WHERE t.site_id = s.id), '{}'::jsonb),
    'navigation', COALESCE((SELECT nv.tree FROM public.navigations n
                             JOIN public.navigation_versions nv ON nv.id = n.published_version_id
                            WHERE n.site_id = s.id), '[]'::jsonb),
    'header', header_live,
    'footer', footer_live,
    'header_component', app.global_component_view(s.id, 'header', header_live),
    'footer_component', app.global_component_view(s.id, 'footer', footer_live),
    'canonical_host', (SELECT d.hostname_normalized FROM public.domains d
                        WHERE d.site_id = s.id AND d.kind = 'primary' AND d.status = 'live'
                        ORDER BY d.created_at LIMIT 1),
    'staging_host', s.staging_hostname
  ) INTO payload FROM public.sites s WHERE s.id = p_site_id;
  IF payload IS NULL THEN RAISE EXCEPTION 'no such site' USING ERRCODE = 'CMS03'; END IF;
  INSERT INTO public.published_site_shells (site_id, revision, payload, updated_at)
  VALUES (p_site_id, 1, payload, now())
  ON CONFLICT (site_id) DO UPDATE
    SET revision = public.published_site_shells.revision + 1,
        payload = EXCLUDED.payload, updated_at = now()
  RETURNING revision INTO next_rev;
  RETURN next_rev;
END
$$;

REVOKE ALL ON FUNCTION app.set_section_def_placement(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.validate_page_section_placement() FROM PUBLIC;
REVOKE ALL ON FUNCTION app.global_component_defect(global_element_kind, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.global_header_defect(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.global_footer_defect(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.global_component_readiness_defect(uuid, global_element_kind, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.global_elements_readiness_defect(uuid, global_element_kind, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.global_component_view(uuid, global_element_kind, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.preview_global_component(uuid, global_element_kind, jsonb) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION app.set_section_def_placement(uuid, text) TO cms_authenticated_user;
GRANT EXECUTE ON FUNCTION app.preview_global_component(uuid, global_element_kind, jsonb) TO cms_authenticated_user;

ALTER FUNCTION app.set_section_def_placement(uuid, text) OWNER TO cms_migration_owner;
ALTER FUNCTION app.validate_page_section_placement() OWNER TO cms_migration_owner;
ALTER FUNCTION app.global_component_defect(global_element_kind, jsonb) OWNER TO cms_migration_owner;
ALTER FUNCTION app.global_header_defect(jsonb) OWNER TO cms_migration_owner;
ALTER FUNCTION app.global_footer_defect(jsonb) OWNER TO cms_migration_owner;
ALTER FUNCTION app.global_component_readiness_defect(uuid, global_element_kind, jsonb) OWNER TO cms_migration_owner;
ALTER FUNCTION app.global_elements_readiness_defect(uuid, global_element_kind, jsonb) OWNER TO cms_migration_owner;
ALTER FUNCTION app.global_component_view(uuid, global_element_kind, jsonb) OWNER TO cms_migration_owner;
ALTER FUNCTION app.preview_global_component(uuid, global_element_kind, jsonb) OWNER TO cms_migration_owner;
