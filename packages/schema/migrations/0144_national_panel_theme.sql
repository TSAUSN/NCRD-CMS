-- Add bounded native panel presentation and 20px corners; preserve existing themes and authority.
CREATE OR REPLACE FUNCTION app.theme_tokens_defect(p_tokens jsonb)
RETURNS text
LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog, public AS $$
DECLARE colors jsonb; fonts jsonb; buttons jsonb; value text;
        allowed_fonts constant text[] := ARRAY[
          '''Open Sans'', Arial, sans-serif',
          '''Source Serif 4'', Georgia, serif',
          '-apple-system, BlinkMacSystemFont, ''Segoe UI'', Roboto, sans-serif',
          'Optima, Candara, ''Noto Sans'', sans-serif',
          'Georgia, ''Times New Roman'', serif',
          'Iowan Old Style, Baskerville, ''Times New Roman'', serif',
          'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
          'system-ui, sans-serif'
        ];
        allowed_radii constant text[] := ARRAY['0rem','0.25rem','0.5rem','0.75rem','1rem','1.25rem'];
BEGIN
  IF jsonb_typeof(p_tokens) IS DISTINCT FROM 'object' THEN
    RETURN 'theme tokens must be an object';
  END IF;
  IF (p_tokens - ARRAY['colors','fonts','radius','spacing','buttons','presentation']) <> '{}'::jsonb
     OR NOT (p_tokens ?& ARRAY['colors','fonts','radius','spacing','buttons']) THEN
    RETURN 'theme tokens require colors, fonts, radius, spacing and buttons, with optional presentation';
  END IF;

  IF p_tokens ? 'presentation' AND (
    jsonb_typeof(p_tokens->'presentation') IS DISTINCT FROM 'object'
    OR ((p_tokens->'presentation') - ARRAY['kind','canvas']) <> '{}'::jsonb
    OR NOT ((p_tokens->'presentation') ?& ARRAY['kind','canvas'])
    OR jsonb_typeof(p_tokens#>'{presentation,kind}') IS DISTINCT FROM 'string'
    OR (p_tokens#>>'{presentation,kind}') IS DISTINCT FROM 'panels'
    OR jsonb_typeof(p_tokens#>'{presentation,canvas}') IS DISTINCT FROM 'string'
    OR (p_tokens#>>'{presentation,canvas}') !~ '^#[0-9A-Fa-f]{6}$'
  ) THEN
    RETURN 'theme presentation must use rounded panels and a six-digit canvas color';
  END IF;

  colors := p_tokens->'colors';
  IF jsonb_typeof(colors) IS DISTINCT FROM 'object'
     OR (colors - ARRAY['primary','accent','surface','surfaceAlt','ink','muted',
                        'primaryContrast','accentContrast']) <> '{}'::jsonb
     OR NOT (colors ?& ARRAY['primary','accent','surface','surfaceAlt','ink','muted',
                             'primaryContrast','accentContrast']) THEN
    RETURN 'theme colors must contain exactly the eight supported color roles';
  END IF;
  FOR value IN SELECT item.value FROM jsonb_each_text(colors) item LOOP
    IF value IS NULL OR value !~ '^#[0-9A-Fa-f]{6}$' THEN
      RETURN 'theme colors must be six-digit hexadecimal colors';
    END IF;
  END LOOP;

  fonts := p_tokens->'fonts';
  IF jsonb_typeof(fonts) IS DISTINCT FROM 'object'
     OR (fonts - ARRAY['heading','body']) <> '{}'::jsonb
     OR NOT (fonts ?& ARRAY['heading','body']) THEN
    RETURN 'theme fonts must contain exactly heading and body';
  END IF;
  IF jsonb_typeof(fonts->'heading') IS DISTINCT FROM 'string'
     OR jsonb_typeof(fonts->'body') IS DISTINCT FROM 'string'
     OR NOT ((fonts->>'heading') = ANY(allowed_fonts))
     OR NOT ((fonts->>'body') = ANY(allowed_fonts)) THEN
    RETURN 'theme fonts must use a supported self-hosted or device font';
  END IF;

  IF jsonb_typeof(p_tokens->'radius') IS DISTINCT FROM 'string'
     OR NOT ((p_tokens->>'radius') = ANY(allowed_radii)) THEN
    RETURN 'theme radius is not supported';
  END IF;
  IF jsonb_typeof(p_tokens->'spacing') IS DISTINCT FROM 'string'
     OR p_tokens->>'spacing' NOT IN ('compact','comfortable','spacious') THEN
    RETURN 'theme spacing is not supported';
  END IF;

  buttons := p_tokens->'buttons';
  IF jsonb_typeof(buttons) IS DISTINCT FROM 'object'
     OR (buttons - ARRAY['style','color','radius','weight','hover','speed']) <> '{}'::jsonb
     OR NOT (buttons ?& ARRAY['style','color','radius','weight','hover','speed']) THEN
    RETURN 'theme buttons must contain exactly style, color, radius, weight, hover, and speed';
  END IF;
  IF jsonb_typeof(buttons->'style') IS DISTINCT FROM 'string'
     OR buttons->>'style' NOT IN ('solid','outline','text')
     OR jsonb_typeof(buttons->'color') IS DISTINCT FROM 'string'
     OR buttons->>'color' NOT IN ('primary','accent')
     OR jsonb_typeof(buttons->'radius') IS DISTINCT FROM 'string'
     OR NOT ((buttons->>'radius') = ANY(allowed_radii))
     OR jsonb_typeof(buttons->'weight') IS DISTINCT FROM 'string'
     OR buttons->>'weight' NOT IN ('regular','bold')
     OR jsonb_typeof(buttons->'hover') IS DISTINCT FROM 'string'
     OR buttons->>'hover' NOT IN ('none','darken','lift','invert','underline')
     OR jsonb_typeof(buttons->'speed') IS DISTINCT FROM 'string'
     OR buttons->>'speed' NOT IN ('fast','normal','slow') THEN
    RETURN 'theme button settings contain an unsupported value';
  END IF;
  RETURN NULL;
END
$$;
