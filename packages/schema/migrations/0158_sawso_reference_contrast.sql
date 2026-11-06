-- Explicit October29 owner decision: preserve the local reference's exact
-- red/white pair. Normal authorization, immutable theme history and every
-- other contrast check remain unchanged. The marker travels with exports.
DO $$ DECLARE source text; changed text; BEGIN
 source:=pg_get_functiondef('app.theme_tokens_defect(jsonb)'::regprocedure);
 source:=replace(source, 'ARRAY[''kind'',''canvas'',''headings'',''layout'']', 'ARRAY[''kind'',''canvas'',''headings'',''layout'',''referenceContrast'']');
 source:=replace(source, '  buttons := p_tokens->''buttons'';', $guard$
  IF p_tokens->'presentation' ? 'referenceContrast' AND (
    p_tokens#>'{presentation,referenceContrast}' IS DISTINCT FROM '"sawso-2026-10-29"'::jsonb
    OR p_tokens#>>'{presentation,layout}' IS DISTINCT FROM 'national'
    OR lower(p_tokens#>>'{colors,primary}') IS DISTINCT FROM '#ef3e42'
    OR lower(p_tokens#>>'{colors,primaryContrast}') IS DISTINCT FROM '#ffffff') THEN
    RETURN 'the approved SAWSO reference exception requires the national layout and exact red/white pair';
  END IF;
  buttons := p_tokens->'buttons';$guard$);
 EXECUTE source;
 source:=pg_get_functiondef('app.publish_theme(uuid,bigint)'::regprocedure);
 changed:=replace(source,
  'IF app.theme_contrast_ratio(draft.tokens->''colors''->>''primaryContrast'', draft.tokens->''colors''->>''primary'') < 4.5 THEN',
  'IF app.theme_contrast_ratio(draft.tokens->''colors''->>''primaryContrast'', draft.tokens->''colors''->>''primary'') < 4.5 AND draft.tokens#>>''{presentation,referenceContrast}'' IS DISTINCT FROM ''sawso-2026-10-29'' THEN');
 IF changed=source THEN RAISE EXCEPTION 'the theme contrast guard changed; review the narrow reference exception'; END IF;
 EXECUTE changed;
END $$;
