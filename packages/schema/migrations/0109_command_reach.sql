-- AUTH-01 / AUTH-05 (October 6): every security-definer command the admin's
-- role can run checks who is calling, or is reviewed as not needing to. The
-- review found three that reached too far:
--
--  * rebuild_site_shell re-derives a site's published shell from published
--    data. Only other commands (running as the owner) need it, yet the admin
--    role could run it for any site without a check.
--  * section_definitions_needing_revalidation lists every definition's name
--    and defects across all sites. Only the revalidation tool needs it, and it
--    connects as the migration owner.
--  * resolve_session (sign-in) was executable by PUBLIC, so even the public
--    renderer's role could map an email to an account. Only the admin's
--    authenticated role signs people in.
REVOKE EXECUTE ON FUNCTION app.rebuild_site_shell(uuid) FROM PUBLIC, cms_authenticated_user;
REVOKE EXECUTE ON FUNCTION app.section_definitions_needing_revalidation() FROM PUBLIC, cms_authenticated_user;
REVOKE EXECUTE ON FUNCTION app.resolve_session(text, text) FROM PUBLIC;
