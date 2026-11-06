-- Keep native item metadata in agreement with the renderer's declaration
-- parser. A malformed field must never grant media that cannot be rendered.
-- This is additive:0140 is already applied on the retained local demo.
DO $$
DECLARE definition text;before text;after text;
BEGIN
 definition:=pg_get_functiondef('app.legacy_collection_repeat_descriptors(jsonb)'::regprocedure);
 before:='IF jsonb_typeof(field)<>''object'' OR NOT app.is_slot_id(field->>''id'')';
 after:=$replacement$IF jsonb_typeof(field)<>'object'
     OR jsonb_typeof(field->'id') IS DISTINCT FROM 'string'
     OR jsonb_typeof(field->'kind') IS DISTINCT FROM 'string'
     OR jsonb_typeof(field->'label') IS DISTINCT FROM 'string'
     OR btrim(field->>'label',E' \t\n\r\v\f'||U&'\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF')=''
     OR NOT app.is_slot_id(field->>'id')$replacement$;
 IF position(after IN definition)=0 THEN
  IF position(before IN definition)=0 THEN RAISE EXCEPTION 'Review the original list metadata validator before updating it.';END IF;
  EXECUTE replace(definition,before,after);
 END IF;
END $$;
