-- A newly published collection schema does not retroactively change the
-- schema pinned by each record. Check both before emitting a repeat, so an
-- optional field added to a template cannot silently erase the entire list.
ALTER FUNCTION app.resolve_collection_repeat(uuid,text,jsonb,jsonb) RENAME TO resolve_collection_repeat_before_entry_gate;
CREATE FUNCTION app.resolve_collection_repeat(p_site_id uuid,p_reader_key text,p_selection jsonb,p_item jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE result jsonb; schema_row jsonb; defect text;
BEGIN
  result:=app.resolve_collection_repeat_before_entry_gate(p_site_id,p_reader_key,p_selection,p_item);
  FOR schema_row IN SELECT value FROM jsonb_array_elements(result->'schemas') LOOP
    IF EXISTS(SELECT 1 FROM jsonb_array_elements(result->'entries') entry WHERE entry->>'schemaVersionId'=schema_row->>'id') THEN
      defect:=app.collection_repeat_item_defect(p_item,schema_row->'fields');
      IF defect IS NOT NULL THEN
        RAISE EXCEPTION 'collection records need to be saved and published for this layout: %',defect USING ERRCODE='CMS04';
      END IF;
    END IF;
  END LOOP;
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION app.resolve_collection_repeat(uuid,text,jsonb,jsonb) FROM PUBLIC;
ALTER FUNCTION app.resolve_collection_repeat(uuid,text,jsonb,jsonb) OWNER TO cms_migration_owner;
