-- A long report may place the same shared story section many times. Validate
-- each immutable definition once, while retaining every instance and its checks.
DO $migration$
DECLARE body text;needle text:=$needle$FROM jsonb_array_elements(COALESCE(sections,'[]'::jsonb)) section$needle$;
 replacement text:=$replacement$FROM (SELECT DISTINCT jsonb_build_object('def',item->'def') AS section FROM jsonb_array_elements(COALESCE(sections,'[]'::jsonb)) item) unique_definitions$replacement$;
BEGIN
 body:=pg_get_functiondef('app.build_render_manifest_core_before_template_lists(uuid,boolean,boolean)'::regprocedure);
 IF position(needle IN body)=0 OR position(needle IN substr(body,position(needle IN body)+length(needle)))>0 THEN RAISE EXCEPTION 'The definition-validation insertion point changed.';END IF;
 EXECUTE replace(body,needle,replacement);
END
$migration$;
