-- Native, scriptless disclosure rows for core FAQs and compact people cards.
-- Additive tag names: older readers refuse unfamiliar tags rather than guessing.
-- No new attributes, event handlers, URL sinks or script capability.
CREATE OR REPLACE FUNCTION app.is_structured_tag(p_tag text) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog AS $$
  SELECT p_tag IS NOT NULL AND p_tag = ANY (ARRAY[
    'section', 'div', 'article', 'aside', 'header', 'footer',
    'figure', 'figcaption', 'blockquote', 'details', 'summary',
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'p', 'span', 'strong', 'em', 'small',
    'ul', 'ol', 'li', 'dl', 'dt', 'dd', 'br', 'hr'])
$$;
REVOKE ALL ON FUNCTION app.is_structured_tag(text) FROM PUBLIC;
ALTER FUNCTION app.is_structured_tag(text) OWNER TO cms_migration_owner;
