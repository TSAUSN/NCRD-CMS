-- 0005 — session resolution (SPEC §6.1).
--
-- The bootstrap problem: to set app.user_id the application must first know
-- who the verified subject is, but an identity-less connection is — correctly —
-- shown no rows of app_users at all. Loosening that policy would make every
-- signed-in user able to enumerate the user table, which is the opposite of
-- what is wanted.
--
-- So the lookup becomes a narrow command instead. It answers exactly one
-- question — "is this verified subject an active product user, and what are
-- they allowed to do" — and it answers nothing for a subject the caller does
-- not already hold a verified token for.
--
-- A disabled user resolves to no rows, so deactivation ends a session on its
-- next request whatever the token's remaining lifetime says.

CREATE OR REPLACE FUNCTION app.resolve_session(p_auth_subject text, p_email text)
RETURNS TABLE (
  user_id uuid, email text, display_name text,
  is_super_admin boolean, memberships jsonb
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT u.id, u.email, u.display_name,
         EXISTS (SELECT 1 FROM public.global_roles g
                  WHERE g.user_id = u.id AND g.role = 'super_admin'),
         COALESCE((SELECT jsonb_object_agg(m.site_id, m.role)
                     FROM public.site_memberships m WHERE m.user_id = u.id), '{}'::jsonb)
    FROM public.app_users u
   WHERE u.status = 'active'
     AND (u.auth_subject = p_auth_subject
          -- The invite-acceptance case: a product record exists, its login
          -- does not yet. Matching on email is only reachable while
          -- auth_subject is still NULL, and attaching it is a separate command.
          OR (u.auth_subject IS NULL AND u.email = lower(p_email)))
   LIMIT 1
$$;

GRANT EXECUTE ON FUNCTION app.resolve_session(text, text) TO cms_authenticated_user;

ALTER FUNCTION app.resolve_session(text, text) OWNER TO cms_migration_owner;
