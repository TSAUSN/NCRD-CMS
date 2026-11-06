-- A bounded national layout, explicitly selected by the SAWSO preset.
DO $$ DECLARE source text; BEGIN
 source:=pg_get_functiondef('app.theme_tokens_defect(jsonb)'::regprocedure);
 source:=replace(source, 'ARRAY[''kind'',''canvas'',''headings'']', 'ARRAY[''kind'',''canvas'',''headings'',''layout'']');
 source:=replace(source, 'OR (p_tokens->''presentation'' ? ''headings''', 'OR (p_tokens->''presentation'' ? ''layout'' AND p_tokens#>''{presentation,layout}'' IS DISTINCT FROM ''"national"''::jsonb) OR (p_tokens->''presentation'' ? ''headings''');
 EXECUTE source;
END $$;
