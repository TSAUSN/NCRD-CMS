-- BT's local workshop table contains125 items. Keep the existing native list
-- pipeline and its1.8MB manifest bound, with room for up to200 chosen entries.
-- Alter only the two existing selection-bound bodies; all permission/schema/
-- publication checks and function identities/ACLs remain unchanged. Idempotent.
DO $$
DECLARE signature text;definition text;
BEGIN
 FOREACH signature IN ARRAY ARRAY[
  'app.resolve_collection_repeat_before_entry_gate(uuid,text,jsonb,jsonb)',
  'app.resolve_initial_preview_repeat(uuid,text,jsonb,jsonb)'
 ] LOOP
  definition:=pg_get_functiondef(signature::regprocedure);
  definition:=regexp_replace(definition,'\m100\M','200','g');
  -- The unpublished-list path has a numeric regular expression as well.
  definition:=replace(definition,'^(200|[1-9][0-9]?)$','^(200|1[0-9]{2}|[1-9][0-9]?)$');
  EXECUTE definition;
 END LOOP;
END $$;
