-- A date is optional while writing, but required when a canonical Story becomes
-- public. Guard every publication/recovery path without constraining draft saves.
CREATE FUNCTION app.require_published_story_date() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE needs_date boolean; story_date text;
BEGIN
 IF NEW.published_version_id IS NULL OR NEW.published_archived_at IS NOT NULL THEN RETURN NEW;END IF;
 IF TG_OP='UPDATE' AND OLD.published_version_id IS NOT DISTINCT FROM NEW.published_version_id
  AND OLD.published_archived_at IS NOT DISTINCT FROM NEW.published_archived_at THEN RETURN NEW;END IF;
 SELECT c.reader_key='stories' AND EXISTS(SELECT 1 FROM jsonb_array_elements(s.fields) f WHERE f->>'key'='published_date' AND f->>'type'='date'),v.values->>'published_date'
 INTO needs_date,story_date FROM public.collections c JOIN public.collection_entry_versions v ON v.id=NEW.published_version_id AND v.entry_id=NEW.id JOIN public.collection_schema_versions s ON s.id=v.schema_version_id WHERE c.id=NEW.collection_id;
 IF needs_date AND NULLIF(btrim(story_date),'') IS NULL THEN
  RAISE EXCEPTION 'choose a story date before publishing this story' USING ERRCODE='CMS04';
 END IF;
 RETURN NEW;
END $$;
ALTER FUNCTION app.require_published_story_date() OWNER TO cms_migration_owner;
REVOKE ALL ON FUNCTION app.require_published_story_date() FROM PUBLIC;
CREATE TRIGGER collection_entries_require_story_date BEFORE INSERT OR UPDATE OF published_version_id,published_archived_at ON public.collection_entries FOR EACH ROW EXECUTE FUNCTION app.require_published_story_date();
