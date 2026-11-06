-- 0050 replaced the manifest entry point. Restore the worker's narrowly
-- granted read capability on the replacement, not the pre-identity helper.
REVOKE EXECUTE ON FUNCTION app.build_render_manifest_before_identity(uuid) FROM cms_worker;
GRANT EXECUTE ON FUNCTION app.build_render_manifest_internal(uuid) TO cms_worker;
