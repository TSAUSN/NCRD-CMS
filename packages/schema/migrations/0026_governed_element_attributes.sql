-- 0026 — the element-node attribute allowlist gains aria-current.
--
-- ADR 0009 has the argument and the measurement. The short version: the
-- importer's `unsupported-attribute` code fires 141 times across 36 of the 118
-- V1 definitions, and 25 of the 36 names it names sit on an element the tag
-- allowlist already refuses — an `<svg>`, an `<iframe>`, a form control — so no
-- attribute allowlist can reach them. Of the eleven names that do sit on an
-- element this model keeps, exactly one is matched by a rule in a stylesheet:
-- INTERACTION_PRESET_CSS has one `[aria-current="page"]`. That is the test this
-- migration admits a name on, because it is the only test that says the page
-- would look different without it. Everything else measured is inert — nothing
-- styles it and nothing in v2 reads it — or is an identity in a page-wide
-- namespace, which this model does not yet keep unique.
--
-- The schema version is deliberately NOT moved. A new key on a node changes what
-- a node means and forces a reader that does not know the key to choose between
-- ignoring it and refusing; a new name in a closed allowlist does neither. Every
-- reader checks the name against its own list, so an older one refuses the whole
-- document — here, and again in the renderer — and the section is visibly absent
-- rather than quietly missing the attribute a rule matches. Moving the version
-- would instead make the window between this migration and the TypeScript that
-- matches it catalogue-wide: every structured definition failing to save and
-- every structured section on every page rendering nothing, including the ones
-- nobody touched.
--
-- Every grammar below is the one packages/schema/src/content/structured.ts
-- enforces, and the two must stay equal. TypeScript is where the compiler
-- checks; this is where a row that never met the compiler is checked, which is
-- the direction an attacker with a database role comes from.

/**
 * The attribute names an element node may carry.
 *
 * Copied from 0019 with one name added. Written out in full rather than as an
 * array append, because the list is meant to be read: a reader asking "what may
 * an element carry?" should find the answer in one place and not have to
 * assemble it from three migrations.
 */
CREATE OR REPLACE FUNCTION app.is_structured_attribute(p_name text) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog AS $$
  SELECT p_name IS NOT NULL AND p_name = ANY (ARRAY[
    'class', 'id', 'role', 'lang', 'dir',
    'aria-label', 'aria-labelledby', 'aria-describedby', 'aria-hidden', 'aria-current'])
$$;

/**
 * Is this a value the named attribute can actually hold?
 *
 * Copied from 0019 with one branch added. `aria-current` takes the seven states
 * the specification gives it rather than the one keyword the V1 catalogue wrote,
 * following the choice ADR 0008 already made for `decoding`, `loading` and
 * `fetchpriority`: the set is closed by the specification, so narrowing it to
 * what one catalogue happened to use would invent a second restriction nobody
 * could explain.
 *
 * `true` and `false` are states here, not booleans in the `aria-hidden` sense:
 * `aria-current="true"` means "this one, kind unspecified", and `false` is the
 * default said out loud. Both are inert. Neither is a synonym for the attribute
 * being absent, which is why an empty string is refused — `aria-current=""` and
 * no `aria-current` at all are different bytes and a document should say which
 * it means.
 */
CREATE OR REPLACE FUNCTION app.is_structured_attribute_value(p_name text, p_value text) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog AS $$
  SELECT p_value IS NOT NULL
     AND length(p_value) <= 512
     -- `<` is checked bluntly, the way the CSS gate checks it: one character,
     -- one search, and nothing about it depends on getting escaping right.
     AND position('<' IN p_value) = 0
     AND p_value !~ '[[:cntrl:]]'
     AND CASE p_name
           WHEN 'class' THEN
             p_value ~ '^[A-Za-z][A-Za-z0-9_-]{0,63}( [A-Za-z][A-Za-z0-9_-]{0,63})*$'
           WHEN 'aria-labelledby' THEN
             p_value ~ '^[A-Za-z][A-Za-z0-9_-]{0,63}( [A-Za-z][A-Za-z0-9_-]{0,63})*$'
           WHEN 'aria-describedby' THEN
             p_value ~ '^[A-Za-z][A-Za-z0-9_-]{0,63}( [A-Za-z][A-Za-z0-9_-]{0,63})*$'
           WHEN 'id' THEN p_value ~ '^[A-Za-z][A-Za-z0-9_-]{0,63}$'
           WHEN 'aria-hidden' THEN p_value IN ('true', 'false')
           WHEN 'aria-current' THEN
             p_value IN ('page', 'step', 'location', 'date', 'time', 'true', 'false')
           WHEN 'dir' THEN p_value IN ('ltr', 'rtl', 'auto')
           WHEN 'lang' THEN p_value ~ '^[A-Za-z]{2,8}(-[A-Za-z0-9]{1,8})*$'
           WHEN 'role' THEN p_value ~ '^[a-z]+(-[a-z]+)*$'
           WHEN 'aria-label' THEN length(p_value) > 0
           ELSE false
         END
$$;

-- No change to `app.structured_node_defect`, `app.structured_shape_defect` or
-- `app.current_structured_schema_version()`. The node walk already asks these
-- two functions the question and already produces the sentences the tests
-- assert; nothing about a stored document's shape changed, so no stored row is
-- rewritten and no version is re-stamped. A migration that touched any of them
-- would be a migration whose diff nobody could read against what it claims.

REVOKE ALL ON FUNCTION app.is_structured_attribute(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.is_structured_attribute_value(text, text) FROM PUBLIC;

DO $$
DECLARE obj RECORD;
BEGIN
  FOR obj IN
    SELECT p.oid::regprocedure AS sig FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname IN ('app', 'public_api')
  LOOP
    EXECUTE format('ALTER FUNCTION %s OWNER TO cms_migration_owner', obj.sig);
  END LOOP;
END
$$;
