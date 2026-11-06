-- Keep validation outside the unique-definition input: PostgreSQL may push a
-- deterministic predicate through DISTINCT and otherwise repeat the CSS scan.
DO $migration$
DECLARE body text;needle text:=$needle$FROM (SELECT DISTINCT jsonb_build_object('def',item->'def') AS section FROM jsonb_array_elements(COALESCE(sections,'[]'::jsonb)) item) unique_definitions$needle$;
 replacement text:=$replacement$FROM (WITH validation_definitions AS MATERIALIZED (SELECT DISTINCT jsonb_build_object('def',item->'def') AS section FROM jsonb_array_elements(COALESCE(sections,'[]'::jsonb)) item) SELECT section FROM validation_definitions) unique_definitions$replacement$;
BEGIN
 body:=pg_get_functiondef('app.build_render_manifest_core_before_template_lists(uuid,boolean,boolean)'::regprocedure);
 IF position(needle IN body)=0 THEN RAISE EXCEPTION 'The unique-definition validation input changed.';END IF;
 EXECUTE replace(body,needle,replacement);
END
$migration$;
