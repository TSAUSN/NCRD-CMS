-- Optional, typed per-site GA4 settings use the existing draft/release workflow.
-- No settings, public pages or existing permissions are changed by applying this.
ALTER FUNCTION app.site_public_settings_defect(jsonb) RENAME TO site_public_settings_defect_before_analytics;

CREATE FUNCTION app.site_public_settings_defect(p jsonb)
RETURNS text LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,public AS $$
DECLARE block jsonb;
BEGIN
 IF jsonb_typeof(p) IS DISTINCT FROM 'object' OR octet_length(p::text)>131072 THEN RETURN 'Check the site settings.';END IF;
 IF p ? 'analytics' THEN
  block:=p->'analytics';
  IF jsonb_typeof(block) IS DISTINCT FROM 'object' THEN RETURN 'Check Analytics settings.';END IF;
  IF NOT block ?& ARRAY['measurementId','enabled','includeStaging'] OR EXISTS(SELECT 1 FROM jsonb_object_keys(block) key WHERE key NOT IN('measurementId','enabled','includeStaging')) THEN RETURN 'Check Analytics settings.';END IF;
  IF jsonb_typeof(block->'measurementId') IS DISTINCT FROM 'string' OR jsonb_typeof(block->'enabled') IS DISTINCT FROM 'boolean' OR jsonb_typeof(block->'includeStaging') IS DISTINCT FROM 'boolean' THEN RETURN 'Check Analytics settings.';END IF;
  IF block->>'measurementId'<>'' AND block->>'measurementId' !~ '^G-[A-Z0-9]{4,20}$' THEN RETURN 'Use a GA4 Measurement ID such as G-XXXXXXXXXX.';END IF;
  IF (block->>'enabled')::boolean AND block->>'measurementId'='' THEN RETURN 'Add the Measurement ID before enabling tracking.';END IF;
 END IF;
 RETURN app.site_public_settings_defect_before_analytics(p-'analytics');
END $$;
ALTER FUNCTION app.site_public_settings_defect(jsonb) OWNER TO cms_migration_owner;
REVOKE ALL ON FUNCTION app.site_public_settings_defect(jsonb) FROM PUBLIC,cms_authenticated_user,cms_public_renderer,cms_worker;
