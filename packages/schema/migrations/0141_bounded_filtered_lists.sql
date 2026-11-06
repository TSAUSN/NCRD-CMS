-- Dynamic choices and saved page recipes use the same200-entry bound as the
-- native resolver. Existing permission, field, filter and ordering checks stay.
DO $$
DECLARE signature text;definition text;
BEGIN
 FOREACH signature IN ARRAY ARRAY[
  'app.normalize_list_selection(uuid,text,jsonb,boolean)',
  'app.assert_page_recipe_content(uuid,jsonb)'
 ] LOOP
  definition:=pg_get_functiondef(signature::regprocedure);
  definition:=regexp_replace(definition,'\m100\M','200','g');
  definition:=replace(definition,'^(200|[1-9][0-9]?)$','^(200|1[0-9]{2}|[1-9][0-9]?)$');
  EXECUTE definition;
 END LOOP;
END $$;
