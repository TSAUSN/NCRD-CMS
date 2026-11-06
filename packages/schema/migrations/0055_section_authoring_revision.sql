-- Editor authoring is compare-and-set; bootstrap/import commands can continue
-- to append versions explicitly through their existing command overloads.
CREATE FUNCTION app.save_section_def_version(
  p_slug text,p_name text,p_category text,p_source_html text,p_source_css text,p_compiled_css text,
  p_compiled_ast jsonb,p_slots jsonb,p_render_hash text,p_sanitizer_policy_version int,p_css_policy_version int,
  p_changelog text,p_carries_trusted_code boolean,p_definition_kind text,p_structured_doc jsonb,
  p_structured_schema_version int,p_scope text,p_site_id uuid,p_expected_version int,p_definition_id uuid
) RETURNS TABLE(section_def_id uuid,version int)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE head RECORD; current_version int;
BEGIN
  PERFORM app.require_actor();
  IF p_scope='global' THEN
    IF NOT app.is_super_admin() THEN RAISE EXCEPTION 'only a super admin may edit global sections' USING ERRCODE='CMS02'; END IF;
  ELSIF p_scope='site' THEN
    IF NOT app.can_administer_site(p_site_id) THEN RAISE EXCEPTION 'only a site admin may edit this section' USING ERRCODE='CMS02'; END IF;
  ELSE RAISE EXCEPTION 'invalid section scope' USING ERRCODE='CMS04'; END IF;
  IF p_expected_version IS NULL OR p_expected_version<0 THEN RAISE EXCEPTION 'load the section version before saving' USING ERRCODE='CMS04'; END IF;
  IF char_length(btrim(COALESCE(p_name,''))) NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION 'enter a section name of up to 200 characters' USING ERRCODE='CMS04'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('section-authoring:'||COALESCE(p_slug,''),55));
  SELECT d.id,d.status INTO head FROM public.section_defs d
    WHERE d.slug=p_slug AND d.scope::text=p_scope AND d.site_id IS NOT DISTINCT FROM p_site_id FOR UPDATE;
  IF p_definition_id IS NOT NULL AND (head IS NULL OR head.id<>p_definition_id) THEN
    RAISE EXCEPTION 'an existing section keeps its short name and scope' USING ERRCODE='CMS04';
  END IF;
  SELECT COALESCE(max(v.version),0) INTO current_version FROM public.section_def_versions v WHERE v.section_def_id=head.id;
  IF current_version<>p_expected_version THEN
    RAISE EXCEPTION 'a newer section version exists; reload before saving' USING ERRCODE='CMS01',DETAIL=current_version::text;
  END IF;
  IF head.status IS NOT NULL AND head.status<>'active' THEN RAISE EXCEPTION 'this section is no longer active in the library' USING ERRCODE='CMS04'; END IF;
  RETURN QUERY SELECT * FROM app.upsert_section_def_version(
    p_slug,p_name,p_category,p_source_html,p_source_css,p_compiled_css,p_compiled_ast,p_slots,p_render_hash,
    p_sanitizer_policy_version,p_css_policy_version,p_changelog,p_carries_trusted_code,
    p_definition_kind,p_structured_doc,p_structured_schema_version,p_scope,p_site_id);
END $$;
REVOKE ALL ON FUNCTION app.save_section_def_version(text,text,text,text,text,text,jsonb,jsonb,text,int,int,text,boolean,text,jsonb,int,text,uuid,int,uuid) FROM PUBLIC;
ALTER FUNCTION app.save_section_def_version(text,text,text,text,text,text,jsonb,jsonb,text,int,int,text,boolean,text,jsonb,int,text,uuid,int,uuid) OWNER TO cms_migration_owner;
GRANT EXECUTE ON FUNCTION app.save_section_def_version(text,text,text,text,text,text,jsonb,jsonb,text,int,int,text,boolean,text,jsonb,int,text,uuid,int,uuid) TO cms_authenticated_user;
