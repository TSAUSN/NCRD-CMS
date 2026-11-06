-- One national parent, stored in immutable theme versions. No site/data migration.
DO $$ DECLARE source text; BEGIN
 source:=pg_get_functiondef('app.theme_tokens_defect(jsonb)'::regprocedure);
 IF position('''referenceContrast'']' IN source)=0 THEN RAISE EXCEPTION 'national theme validator shape changed'; END IF;
 source:=replace(source, '''referenceContrast'']', '''referenceContrast'',''template'']');
 source:=replace(source, '  colors := p_tokens->''colors'';', $body$
  IF p_tokens#>'{presentation,template}' IS NOT NULL AND (
    jsonb_typeof(p_tokens#>'{presentation,template}') IS DISTINCT FROM 'object'
    OR ((p_tokens#>'{presentation,template}') - ARRAY['id','version','mayChangeColours']) <> '{}'::jsonb
    OR NOT ((p_tokens#>'{presentation,template}') ?& ARRAY['id','version','mayChangeColours'])
    OR p_tokens#>>'{presentation,template,id}' IS DISTINCT FROM 'national'
    OR p_tokens#>>'{presentation,layout}' IS DISTINCT FROM 'national'
    OR jsonb_typeof(p_tokens#>'{presentation,template,version}') IS DISTINCT FROM 'number'
    OR (p_tokens#>>'{presentation,template,version}') !~ '^[1-9][0-9]{0,5}$|^1000000$'
    OR jsonb_typeof(p_tokens#>'{presentation,template,mayChangeColours}') IS DISTINCT FROM 'boolean'
  ) THEN RETURN 'national template policy is invalid'; END IF;
  colors := p_tokens->'colors';
$body$);
 EXECUTE source;
END $$;

-- All existing theme commands, imports and release paths pass this boundary.
-- A site admin cannot detach a template or bypass its policy by calling SQL.
CREATE FUNCTION app.guard_national_template_theme() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE previous jsonb; prior_policy jsonb; next_policy jsonb;
BEGIN
 SELECT v.tokens INTO previous FROM public.themes h
 JOIN public.theme_versions v ON v.id=h.draft_version_id WHERE h.id=NEW.theme_id;
 prior_policy:=previous#>'{presentation,template}';
 next_policy:=NEW.tokens#>'{presentation,template}';
 IF prior_policy IS NULL AND next_policy IS NULL THEN RETURN NEW; END IF;
 IF prior_policy IS DISTINCT FROM next_policy AND NOT app.is_super_admin() THEN
   RAISE EXCEPTION 'Only a super admin can change the national template policy' USING ERRCODE='CMS02';
 END IF;
 IF next_policy IS NOT NULL AND EXISTS(SELECT 1 FROM public.site_file_heads h
   JOIN public.site_file_versions v ON v.id=h.draft_version_id OR v.id=h.published_version_id
   WHERE h.site_id=NEW.site_id AND v.bundle ? 'original') THEN
   RAISE EXCEPTION 'Brought-in sites keep their original design' USING ERRCODE='CMS04';
 END IF;
 IF prior_policy IS NOT NULL AND NOT app.is_super_admin() THEN
   IF NOT COALESCE((prior_policy->>'mayChangeColours')::boolean,false) AND NEW.tokens->'colors' IS DISTINCT FROM previous->'colors' THEN
     RAISE EXCEPTION 'Colours come from the national template' USING ERRCODE='CMS02';
   END IF;
   IF (NEW.tokens - ARRAY['colors','fonts']) IS DISTINCT FROM (previous - ARRAY['colors','fonts']) THEN
     RAISE EXCEPTION 'Layout and buttons come from the national template' USING ERRCODE='CMS02';
   END IF;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION app.guard_national_template_theme() FROM PUBLIC;
ALTER FUNCTION app.guard_national_template_theme() OWNER TO cms_migration_owner;
CREATE TRIGGER guard_national_template_theme BEFORE INSERT ON theme_versions
FOR EACH ROW EXECUTE FUNCTION app.guard_national_template_theme();
