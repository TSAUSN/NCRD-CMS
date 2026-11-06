-- The same named reference exception applies to its red call-to-action band.
-- It never exempts a different colour pair or an invalid theme.
DO $$ DECLARE source text; changed text; BEGIN
 source:=pg_get_functiondef('app.assert_section_appearance_contrast(jsonb,jsonb)'::regprocedure);
 changed:=replace(source, 'IF COALESCE(app.theme_contrast_ratio(foreground,background),0)<4.5 THEN', $guard$IF COALESCE(app.theme_contrast_ratio(foreground,background),0)<4.5 AND NOT (
   p_theme#>>'{presentation,referenceContrast}' IS NOT DISTINCT FROM 'sawso-2026-10-29'
   AND app.theme_tokens_defect(p_theme) IS NULL
   AND lower(foreground)='#ffffff' AND lower(background)='#ef3e42') THEN$guard$);
 IF changed=source THEN RAISE EXCEPTION 'the surface contrast guard changed; review the narrow reference exception'; END IF;
 EXECUTE changed;
END $$;
