-- Small caps are a bounded national-theme choice. Preserve validator authority.
DO $$ DECLARE source text; BEGIN
 source:=pg_get_functiondef('app.theme_tokens_defect(jsonb)'::regprocedure);
 source:=replace(source, '(p_tokens->''presentation'') - ARRAY[''kind'',''canvas'']', '(p_tokens->''presentation'') - ARRAY[''kind'',''canvas'',''headings'']');
 source:=replace(source, 'OR (p_tokens#>>''{presentation,canvas}'') !~ ''^#[0-9A-Fa-f]{6}$''',
  'OR (p_tokens#>>''{presentation,canvas}'') !~ ''^#[0-9A-Fa-f]{6}$'' OR (p_tokens->''presentation'' ? ''headings'' AND p_tokens#>''{presentation,headings}'' IS DISTINCT FROM ''"small-caps"''::jsonb)');
 EXECUTE source;
END $$;
