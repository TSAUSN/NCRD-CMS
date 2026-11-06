-- History labels both prior publications and genuine restores from the
-- append-only audit trail. Keep that lookup narrow as histories grow; the
-- superseded publish-only index cannot support the combined operation query.

DROP INDEX IF EXISTS public.audit_log_page_publish_version;

CREATE INDEX audit_log_page_version_operations
  ON public.audit_log(item_id, after_ref, action, created_at DESC)
  WHERE action IN ('page.publish', 'page.restore') AND item_type = 'page';
