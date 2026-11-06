-- A fixed number stays fixed until an Admin explicitly changes its status.
ALTER FUNCTION app.site_public_settings_defect(jsonb) RENAME TO site_public_settings_defect_before_fixed_numbers;
CREATE FUNCTION app.site_public_settings_defect(p jsonb) RETURNS text
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,public AS $$
DECLARE checked jsonb:=p;
BEGIN
 IF octet_length(p::text)>131072 THEN RETURN 'Check the saved numbers.';END IF;
 IF jsonb_typeof(p->'dataValues')='array' THEN
  checked:=jsonb_set(p,'{dataValues}',COALESCE((SELECT jsonb_agg(CASE WHEN value->>'status'='does-not-change' THEN jsonb_set(value,'{status}','"matches-report"'::jsonb) ELSE value END ORDER BY ordinality) FROM jsonb_array_elements(p->'dataValues') WITH ORDINALITY),'[]'::jsonb));
 END IF;
 RETURN app.site_public_settings_defect_before_fixed_numbers(checked);
END$$;
CREATE FUNCTION app.guard_fixed_data_values() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM public.site_settings h JOIN public.site_setting_versions v ON v.id=h.draft_version_id CROSS JOIN LATERAL jsonb_array_elements(COALESCE(v.settings->'dataValues','[]'::jsonb)) previous_number CROSS JOIN LATERAL jsonb_array_elements(COALESCE(NEW.settings->'dataValues','[]'::jsonb)) next_number WHERE h.site_id=NEW.site_id AND previous_number.value->>'id'=next_number.value->>'id' AND previous_number.value->>'status'='does-not-change' AND next_number.value->>'status'='does-not-change' AND previous_number.value->'value' IS DISTINCT FROM next_number.value->'value') THEN RAISE EXCEPTION 'Choose Needs checking or Matches report before changing a fixed number.' USING ERRCODE='CMS04';END IF;
 RETURN NEW;
END$$;
CREATE TRIGGER site_settings_guard_fixed_numbers BEFORE INSERT ON public.site_setting_versions FOR EACH ROW EXECUTE FUNCTION app.guard_fixed_data_values();
ALTER FUNCTION app.site_public_settings_defect(jsonb) OWNER TO cms_migration_owner;
ALTER FUNCTION app.guard_fixed_data_values() OWNER TO cms_migration_owner;
REVOKE ALL ON FUNCTION app.site_public_settings_defect(jsonb),app.site_public_settings_defect_before_fixed_numbers(jsonb),app.guard_fixed_data_values() FROM PUBLIC,cms_authenticated_user,cms_public_renderer,cms_worker;

-- Existing picks show the value that is public;new private IDs remain available to draft writers.
CREATE OR REPLACE FUNCTION app.page_data_values(p_page uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE live jsonb;draft jsonb;
BEGIN
 PERFORM app.require_actor();IF NOT app.has_page_access(p_page) THEN RAISE EXCEPTION 'This page is not available to you.' USING ERRCODE='CMS02';END IF;
 SELECT COALESCE(l.settings->'dataValues','[]'::jsonb),COALESCE(d.settings->'dataValues','[]'::jsonb) INTO live,draft FROM public.pages p JOIN public.site_settings h ON h.site_id=p.site_id LEFT JOIN public.site_setting_versions l ON l.id=h.published_version_id LEFT JOIN public.site_setting_versions d ON d.id=h.draft_version_id WHERE p.id=p_page AND p.archived_at IS NULL;
 RETURN COALESCE(live,'[]'::jsonb)||COALESCE((SELECT jsonb_agg(draft_number.value ORDER BY draft_number.ordinality) FROM jsonb_array_elements(COALESCE(draft,'[]'::jsonb)) WITH ORDINALITY AS draft_number(value,ordinality) WHERE NOT EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(live,'[]'::jsonb)) public_number WHERE public_number.value->>'id'=draft_number.value->>'id')),'[]'::jsonb);
END$$;
ALTER FUNCTION app.page_data_values(uuid) OWNER TO cms_migration_owner;
REVOKE ALL ON FUNCTION app.page_data_values(uuid) FROM PUBLIC,cms_authenticated_user,cms_public_renderer,cms_worker;
GRANT EXECUTE ON FUNCTION app.page_data_values(uuid) TO cms_authenticated_user;
