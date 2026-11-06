-- Tokenize runs in PostgreSQL's native regular-expression engine rather than
-- repeatedly walking UTF-8 prefixes one character at a time in PL/pgSQL.
-- Quotes, escaped characters and braces retain the existing policy semantics.
CREATE OR REPLACE FUNCTION app.css_rule_preludes(p_css text) RETURNS text[]
LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog AS $fn$
DECLARE
  preludes text[] := ARRAY[]::text[];
  current text := '';
  token text[];
  part text;
BEGIN
  IF p_css IS NULL THEN RETURN preludes; END IF;
  FOR token IN SELECT regexp_matches(p_css,
    $tokens$\\.|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|[{}]|[^{}"'\\]+|["'\\]$tokens$, 'g')
  LOOP
    part := token[1];
    IF part = '"' OR part = '''' THEN RETURN NULL; END IF;
    IF part = '{' THEN
      preludes := array_append(preludes, current);
      current := '';
    ELSIF part = '}' THEN
      current := '';
    ELSE
      current := current || part;
    END IF;
  END LOOP;
  RETURN preludes;
END
$fn$;
ALTER FUNCTION app.css_rule_preludes(text) OWNER TO cms_migration_owner;
REVOKE ALL ON FUNCTION app.css_rule_preludes(text) FROM PUBLIC;
