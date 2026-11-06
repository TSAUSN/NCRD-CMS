-- 0040 — comments follow the same audience as their review request.
--
-- Removing direct comment writes in 0037 did not narrow the old site-member
-- SELECT policy. That would let a contributor query discussion on somebody
-- else's submission even though the submission row itself is hidden. Reviewers
-- keep the site queue; submitters keep discussion on their own exact version;
-- authors can always read what they wrote.

DROP POLICY comments_member_read ON public.comments;
CREATE POLICY comments_member_read ON public.comments FOR SELECT TO cms_authenticated_user
  USING (
    app.has_site_access(site_id)
    AND (
      author_id = app.current_user_id()
      OR app.can_review(site_id)
      OR EXISTS (
        SELECT 1
          FROM public.submissions s
         WHERE s.site_id = comments.site_id
           AND s.item_type = comments.item_type
           AND s.item_id = comments.item_id
           AND s.version_id IS NOT DISTINCT FROM comments.version_id
           AND s.submitted_by = app.current_user_id()
      )
    )
  );
