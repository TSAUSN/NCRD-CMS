-- Retiring a frame removes it from new choices, never from pinned versions.
-- The operation is reversible and audited; only a super admin owns this
-- placement-level decision (the same boundary as 0084).
CREATE FUNCTION app.set_frame_definition_status(p_definition_id uuid, p_status text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE actor uuid; def RECORD;
BEGIN
  actor := app.require_actor();
  IF NOT app.is_super_admin() THEN
    RAISE EXCEPTION 'only a super admin may retire or restore frame components' USING ERRCODE = 'CMS02';
  END IF;
  IF p_status IS NULL OR p_status NOT IN ('active', 'retired') THEN
    RAISE EXCEPTION 'choose active or retired' USING ERRCODE = 'CMS04';
  END IF;
  -- Same lock order as creator writes: slug advisory lock, then row lock.
  PERFORM pg_advisory_xact_lock(hashtextextended('section-authoring:' || d.slug, 55))
    FROM public.section_defs d WHERE d.id = p_definition_id;
  SELECT d.id, d.site_id, d.slug, d.scope, d.placement, d.status INTO def
    FROM public.section_defs d WHERE d.id = p_definition_id FOR UPDATE;
  IF def IS NULL THEN RAISE EXCEPTION 'no such frame component' USING ERRCODE = 'CMS03'; END IF;
  IF def.placement NOT IN ('header', 'footer') THEN
    RAISE EXCEPTION 'this command only manages site header and footer components' USING ERRCODE = 'CMS04';
  END IF;
  IF def.status::text = p_status THEN RETURN; END IF;
  -- Active definitions with the same CSS scope must never collide when used
  -- together. Match the ordinary authoring collision rule on restoration.
  IF p_status = 'active' AND EXISTS (
    SELECT 1 FROM public.section_defs d WHERE d.id <> def.id AND d.slug = def.slug
      AND (d.scope = 'global' OR def.scope = 'global' OR d.site_id = def.site_id)
  ) THEN
    RAISE EXCEPTION 'another component reserves this short name; use a different component to avoid stylesheet collisions' USING ERRCODE = 'CMS04';
  END IF;
  UPDATE public.section_defs SET status = p_status::public.section_status WHERE id = def.id;
  PERFORM app.write_audit(def.site_id, 'user', actor, 'section_def.' || p_status, 'section_def', def.id,
    NULL, NULL, jsonb_build_object('before', def.status, 'after', p_status, 'placement', def.placement));
END
$$;
REVOKE ALL ON FUNCTION app.set_frame_definition_status(uuid, text) FROM PUBLIC;
ALTER FUNCTION app.set_frame_definition_status(uuid, text) OWNER TO cms_migration_owner;
GRANT EXECUTE ON FUNCTION app.set_frame_definition_status(uuid, text) TO cms_authenticated_user;

-- A retired definition can still render through an immutable pin. Reserve its
-- CSS scope too: offering a same-slug definition in an overlapping scope would
-- let a new page section restyle an existing header/footer. Different sites
-- may still independently use the same site-local slug.
CREATE FUNCTION app.reserve_section_css_scope() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('section-authoring:' || NEW.slug, 55));
  IF EXISTS (SELECT 1 FROM public.section_defs d
    WHERE d.id <> NEW.id AND d.slug = NEW.slug
      AND (d.scope = 'global' OR NEW.scope = 'global' OR d.site_id = NEW.site_id)) THEN
    RAISE EXCEPTION 'this short name is reserved by an existing definition; retired components keep their stylesheet scope'
      USING ERRCODE = 'CMS04';
  END IF;
  RETURN NEW;
END
$$;
REVOKE ALL ON FUNCTION app.reserve_section_css_scope() FROM PUBLIC;
ALTER FUNCTION app.reserve_section_css_scope() OWNER TO cms_migration_owner;
CREATE TRIGGER section_defs_css_scope BEFORE INSERT OR UPDATE OF slug, scope, site_id ON public.section_defs
  FOR EACH ROW EXECUTE FUNCTION app.reserve_section_css_scope();


-- Frame fields have no collection binding workspace. Do not publish a
-- definition whose mandatory repeat binding the site cannot supply.
ALTER FUNCTION app.global_component_readiness_defect(uuid, global_element_kind, jsonb)
  RENAME TO global_component_readiness_defect_0084;
CREATE FUNCTION app.global_component_readiness_defect(
  p_site_id uuid, p_kind global_element_kind, p_content jsonb
) RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE defect text; definition record; markup text;
BEGIN
  defect := app.global_component_readiness_defect_0084(p_site_id, p_kind, p_content);
  IF defect IS NOT NULL THEN RETURN defect; END IF;
  SELECT v.source_html, v.compiled_ast, v.slots, v.structured_doc INTO definition
    FROM public.section_def_versions v
    WHERE v.section_def_id = (p_content->'component'->>'section_def_id')::uuid
      AND v.version = (p_content->'component'->>'section_def_version')::int;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(definition.slots) slot WHERE slot->>'kind' = 'repeat')
      OR jsonb_path_exists(COALESCE(definition.structured_doc, '{}'::jsonb), '$.nodes.** ? (@.type == "repeat")') THEN
    RETURN 'site frame components cannot contain collection lists';
  END IF;
  -- A client/imported marker is not proof that the frame is scriptless.
  -- Match the compiler's active-markup gate over both authored source and the
  -- rendered literal stream. Joining AST fragments also catches split tags.
  SELECT string_agg(node->>'value', '' ORDER BY ord) INTO markup
    FROM jsonb_array_elements(definition.compiled_ast->'nodes') WITH ORDINALITY AS nodes(node, ord)
    WHERE node->>'kind' = 'html';
  IF (COALESCE(definition.source_html, '') || E'\n' || COALESCE(markup, ''))
      ~* '<[[:space:]]*(script|iframe|object|embed|form|link|meta|base|style)\y|[[:space:]/]on[a-z]+[[:space:]/]*=|(javascript|vbscript)[[:space:]]*:' THEN
    RETURN 'site frame components cannot contain active markup or custom scripts';
  END IF;
  RETURN NULL;
END
$$;
REVOKE ALL ON FUNCTION app.global_component_readiness_defect(uuid, global_element_kind, jsonb) FROM PUBLIC;
ALTER FUNCTION app.global_component_readiness_defect(uuid, global_element_kind, jsonb) OWNER TO cms_migration_owner;
