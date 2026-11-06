-- Named site values reuse immutable settings versions and the existing release/recovery engine.
ALTER FUNCTION app.site_public_settings_defect(jsonb) RENAME TO site_public_settings_defect_before_data_values;
CREATE FUNCTION app.site_public_settings_defect(p jsonb) RETURNS text
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,public AS $$
DECLARE defect text;row jsonb;seen text[]:='{}';k text;
BEGIN
 defect:=app.site_public_settings_defect_before_data_values(p-'dataValues');IF defect IS NOT NULL THEN RETURN defect;END IF;
 IF NOT p ? 'dataValues' THEN RETURN NULL;END IF;
 IF jsonb_typeof(p->'dataValues') IS DISTINCT FROM 'array' OR octet_length(p::text)>131072 THEN RETURN 'Check the saved numbers.';END IF;
 IF jsonb_array_length(p->'dataValues')>100 THEN RETURN 'Keep up to 100 named numbers per site.';END IF;
 FOR row IN SELECT value FROM jsonb_array_elements(p->'dataValues') LOOP
  IF jsonb_typeof(row) IS DISTINCT FROM 'object' OR NOT row ?& ARRAY['id','label','value','unit','source','sourcePageId','asOf','status','showSource'] THEN RETURN 'Check the number fields.';END IF;
  IF EXISTS(SELECT 1 FROM jsonb_object_keys(row) key WHERE key NOT IN('id','label','value','unit','source','sourcePageId','asOf','status','showSource')) THEN RETURN 'Check the number fields.';END IF;
  FOR k IN SELECT unnest(ARRAY['id','label','value','unit','source','asOf','status']) LOOP IF jsonb_typeof(row->k) IS DISTINCT FROM 'string' THEN RETURN 'Check the number fields.';END IF;END LOOP;
  IF row->>'id' !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$' OR row->>'id'=ANY(seen) THEN RETURN 'Each number needs its own identity.';END IF;
  IF char_length(btrim(row->>'label')) NOT BETWEEN 1 AND 120 OR char_length(btrim(row->>'value')) NOT BETWEEN 1 AND 100 OR char_length(row->>'unit')>80 OR char_length(btrim(row->>'source')) NOT BETWEEN 1 AND 500 OR char_length(row->>'asOf')>60 THEN RETURN 'Add a label,value and source within the field limits.';END IF;
  IF row->>'status' NOT IN('matches-report','needs-checking') OR jsonb_typeof(row->'showSource') IS DISTINCT FROM 'boolean' THEN RETURN 'Choose whether this number matches its source or needs checking.';END IF;
  IF row->'sourcePageId'<>'null'::jsonb AND (jsonb_typeof(row->'sourcePageId')<>'string' OR row->>'sourcePageId' !~ '^[0-9a-fA-F-]{36}$') THEN RETURN 'Choose a source page from this site.';END IF;
  seen:=array_append(seen,row->>'id');
 END LOOP;
 RETURN NULL;
END$$;
CREATE FUNCTION app.guard_site_data_value_sources() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE row jsonb;
BEGIN
 FOR row IN SELECT value FROM jsonb_array_elements(COALESCE(NEW.settings->'dataValues','[]'::jsonb)) LOOP
  IF row->'sourcePageId'<>'null'::jsonb AND NOT EXISTS(SELECT 1 FROM public.pages WHERE id=(row->>'sourcePageId')::uuid AND site_id=NEW.site_id AND archived_at IS NULL) THEN RAISE EXCEPTION 'Choose a source page from this site.' USING ERRCODE='CMS04';END IF;
 END LOOP;
 IF EXISTS(SELECT 1 FROM public.pages p JOIN public.page_versions v ON v.id IN(p.draft_version_id,p.published_version_id) CROSS JOIN LATERAL jsonb_array_elements(v.content) s CROSS JOIN LATERAL jsonb_each(CASE WHEN jsonb_typeof(s#>'{values,__cms_data_values}')='object' THEN s#>'{values,__cms_data_values}' ELSE '{}'::jsonb END) b CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(b.value->'parts')='array' THEN b.value->'parts' ELSE '[]'::jsonb END) part WHERE p.site_id=NEW.site_id AND p.archived_at IS NULL AND s->'values' ? b.key AND part ? 'valueId' AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(NEW.settings->'dataValues','[]'::jsonb)) n WHERE n->>'id'=part->>'valueId')) THEN RAISE EXCEPTION 'A page still uses this number. Replace it on those pages before deleting it.' USING ERRCODE='CMS04';END IF;
 RETURN NEW;
END$$;
CREATE TRIGGER site_settings_guard_data_values BEFORE INSERT ON public.site_setting_versions FOR EACH ROW EXECUTE FUNCTION app.guard_site_data_value_sources();
CREATE FUNCTION app.page_data_values(p_page uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 PERFORM app.require_actor();IF NOT app.has_page_access(p_page) THEN RAISE EXCEPTION 'This page is not available to you.' USING ERRCODE='CMS02';END IF;
 RETURN COALESCE((SELECT v.settings->'dataValues' FROM public.pages p JOIN public.site_settings h ON h.site_id=p.site_id JOIN public.site_setting_versions v ON v.id=h.draft_version_id WHERE p.id=p_page AND p.archived_at IS NULL),'[]'::jsonb);
END$$;
CREATE FUNCTION app.guard_published_data_values() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE content jsonb;numbers jsonb;
BEGIN
 IF NEW.published_version_id IS NULL OR NEW.published_version_id IS NOT DISTINCT FROM OLD.published_version_id THEN RETURN NEW;END IF;
 SELECT v.content INTO content FROM public.page_versions v WHERE v.id=NEW.published_version_id AND v.page_id=NEW.id;
 SELECT COALESCE(v.settings->'dataValues','[]'::jsonb) INTO numbers FROM public.site_settings h JOIN public.site_setting_versions v ON v.id=h.published_version_id WHERE h.site_id=NEW.site_id;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(content) s CROSS JOIN LATERAL jsonb_each(CASE WHEN jsonb_typeof(s#>'{values,__cms_data_values}')='object' THEN s#>'{values,__cms_data_values}' ELSE '{}'::jsonb END) b CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(b.value->'parts')='array' THEN b.value->'parts' ELSE '[]'::jsonb END) part WHERE s->'values' ? b.key AND part ? 'valueId' AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(numbers,'[]'::jsonb)) n WHERE n->>'id'=part->>'valueId')) THEN RAISE EXCEPTION 'Publish the saved numbers with this page before it goes live.' USING ERRCODE='CMS04';END IF;
 RETURN NEW;
END$$;
CREATE TRIGGER pages_guard_published_data_values BEFORE UPDATE OF published_version_id ON public.pages FOR EACH ROW EXECUTE FUNCTION app.guard_published_data_values();
ALTER FUNCTION app.site_public_settings_defect(jsonb) OWNER TO cms_migration_owner;
ALTER FUNCTION app.guard_site_data_value_sources() OWNER TO cms_migration_owner;
ALTER FUNCTION app.page_data_values(uuid) OWNER TO cms_migration_owner;
ALTER FUNCTION app.guard_published_data_values() OWNER TO cms_migration_owner;
REVOKE ALL ON FUNCTION app.site_public_settings_defect(jsonb),app.site_public_settings_defect_before_data_values(jsonb),app.guard_site_data_value_sources(),app.page_data_values(uuid),app.guard_published_data_values() FROM PUBLIC,cms_authenticated_user,cms_public_renderer,cms_worker;
GRANT EXECUTE ON FUNCTION app.page_data_values(uuid) TO cms_authenticated_user;
