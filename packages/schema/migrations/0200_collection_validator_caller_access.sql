-- Direct validation must not bypass Media RLS. Checked definer commands and
-- published-list resolution retain their own existing execution context.
ALTER FUNCTION app.collection_entry_values_defect(uuid,jsonb,jsonb) SECURITY INVOKER;
-- This immutable predicate examines only its supplied text and reads no tables.
-- Authenticated validation needs it after losing elevated execution privileges.
GRANT EXECUTE ON FUNCTION app.collection_url_is_safe(text) TO cms_authenticated_user;
