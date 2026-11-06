# Friday demo route

For the maintainer and a first-time reviewer. Use ordinary
Chrome at 1440 or 1024 pixels; do not attach browser debugging. Resolve Admin and public routes against the origins in
[review-environment.md](../hosting/review-environment.md). Use the new origins
after organization deployment; copied content keeps its IDs. Allow about 25–35 minutes, plus email delivery.

This is the acceptance route. The operator records each browser and result in the
private acceptance receipt; a passing automated check does not replace the hosted walk.
Report the step, width, visible message and approximate wait if anything fails.
Stop a pending Save or Publish at its receipt; do not click repeatedly.

Before changing retained content, the operator records its original version and
makes a private database dump. Use one labelled QA story; restore each real page
through History, publish the restoration and archive the QA story/article after
the walk. Preserve Echelon sample wording, photos and Join-us. Do not change DNS.

1. **Sign in.** Open [Sign in](/sign-in), enter the assigned email and choose
   **Send me a link**. Open that email in the same browser, then **Continue to CMS**.
   Check the name and role on Home. A valid sign-in alone gives no site access.
   Friday uses only the maintainer’s existing personal Supabase sign-in. Report a delivery
   error; do not configure another provider or email service during the walk.

2. **Edit and save a sector page.** Open [SAWSO Education](/pages/3622c62e-1403-453a-977c-784495df1072).
   Select the introduction, make one identifiable QA sentence change, choose
   **Save draft**, wait for **All changes saved**, and reload. Confirm the sentence
   remains and the SAWSO public route `/ways-we-help/education`
   still has its original wording.

3. **Preview and publish that page.** Check Desktop and **Phone** preview, then the
   saved visitor preview. Wait for actual page content, not just the preview frame.
   Choose **Publish**, inspect the exact selected changes and confirm once. If the
   original sample-content acknowledgement appears, read it and confirm only the
   reviewed page. After the published receipt, reload the public page at desktop
   and phone widths. Compare text, logo, header, photo and links with preview.

4. **Find stories by tag.** Open [SAWSO Stories](/sites/95976d54-9dfc-41d3-83e1-93f1d070a76f/stories).
   Use **Project Sectors → Education** and **Regions → Africa**, then clear both filters.
   The tag chips on each story change its tags; exercise those only on the QA story in step 7. Open
   [Overview](/sites/95976d54-9dfc-41d3-83e1-93f1d070a76f/stories?view=gaps), choose Education and open its page.
   Inspect its story section: the Education tag fills it from this site's stories.
   A Site admin can change the binding; an Editor must see only allowed controls.

5. **Manage tags.** As Super admin or Site admin, open
   [Manage tags](/sites/95976d54-9dfc-41d3-83e1-93f1d070a76f/stories/tags). Inspect the main and secondary tag
   groups and their names. Return without saving for this route. As an Editor,
   the management control must be absent and that direct address refused. Changing
   tags is a separate backed-up exercise; it can affect many pages.

6. **Explore story views.** Open [World View](/sites/95976d54-9dfc-41d3-83e1-93f1d070a76f/stories?view=world),
   select a region and check the saved visitor preview. Open
   [Split View](/sites/95976d54-9dfc-41d3-83e1-93f1d070a76f/stories?view=split) and choose **View shown first → By Project Sector**, then **By Map**; check
   the preview at desktop and phone widths. Its default heading is **News and Stories**.
   Reload and confirm the preview choices persist in the address.
   Inspect [Newsroom order](/sites/95976d54-9dfc-41d3-83e1-93f1d070a76f/stories?view=order) and
   [Coming up](/sites/95976d54-9dfc-41d3-83e1-93f1d070a76f/stories?view=soon). Preview choices do not publish.

7. **Write and schedule a story.** Open [New story](/sites/95976d54-9dfc-41d3-83e1-93f1d070a76f/stories/new).
   Create exactly one clearly labelled QA story with title, summary, body, an
   existing approved picture, image description, focal point and Education/region
   tags. On the Stories row, toggle that QA story’s tag chips and confirm the selected
   tags persist after reload; restore its intended Education/region selection. Save, reload and preview. Choose **Schedule**, inspect the story and its
   generated article, select a future Eastern time and confirm once. On the micro
   review database, allow about 12 seconds to prepare the review and 13 seconds
   after confirmation; wait for the saved receipt rather than clicking again. Check it in
   Coming up, then cancel this QA schedule before it runs. If also publishing,
   review only this story/article and verify the public Education feed includes it.
   To clean up, open **Lists → Stories**, open the QA item, choose **Hide from list**
   and **Save item**. Open its generated article, then **More page actions → Page
   settings → Archive page**, and confirm. Check both records are archived and no
   QA schedule remains pending. Never archive retained stories.

8. **Edit the shared frame.** Open [Header & menu](/sites/95976d54-9dfc-41d3-83e1-93f1d070a76f/header).
   Inspect **Logo**, **Header buttons** and **Menu**; check their real-page preview.
   Open [Footer](/sites/95976d54-9dfc-41d3-83e1-93f1d070a76f/footer). These are site-level workspaces and their
   saved changes affect multiple pages only after publication. For the short walk,
   inspect without saving. To exercise a change, record the original version first,
   publish only the reviewed shared change, check three pages, then restore it.

9. **Check Echelon national and chapter pages.** Open
   [Echelon national Home](/pages/eb563f42-4b7b-4234-b094-0fc9f8af44f3).
   Inspect the hero and open Echelon chapters public route `/`.
   If the restored hero has one slide, it correctly has no chevrons: use the
   multi-slide SAWSO public route `/` to exercise
   **Next slide** at 1440 and 390, through all three slides back to the first.
   This approved hero exposes forward chevrons only. Wait for each animation to
   settle and verify the page does not jump. Adding a temporary Echelon slider is
   a separate backed-up exercise.
   Open [Chapters](/sites/616d295e-c28a-45ea-9786-bd2f55a21679/chapters), then
   [Atlanta Chapter](/pages/47c971b8-6ce8-4ea1-bd7e-ac542b3b7c34).
   Inspect setup, contact and section controls without changing original values.
   On the public national page choose **Find a chapter**, filter Atlanta and open
   it; the destination must be `/chapters/atlanta`, with one matching chapter.

10. **Restore History.** Return to [Education History](/pages/3622c62e-1403-453a-977c-784495df1072/history).
    Select the original version recorded before step 2, choose **Restore as new
    draft**, inspect the comparison and **Create draft**. Save/reload if needed,
    then review and publish the restoration. Confirm public wording matches the
    recorded original. Restoring creates a new version; it preserves history.

11. **Inspect access as the maintainer.** Open [People](/people)
    and confirm your active Super admin account. Friday is Super-admin-only: do not add
    editors, send invitations or set up SMTP. The locally tested Add person feature
    remains available, but onboarding is outside Friday's acceptance route. Long-term
    sign-in ownership and alternative providers are in [Sign-in options](../hosting/sign-in-options.md).

12. **Inspect Domains.** As Super admin, open [Domains](/domains) and
    [SAWSO Domains](/sites/95976d54-9dfc-41d3-83e1-93f1d070a76f/domains). Inspect the native review address and
    setup/status instructions. Leave DNS and domain changes untouched. As the
    restricted editor, confirm only the role's permitted view is available.

Finish with every temporary story/schedule removed from active publication,
original page/settings content restored, QA access deactivated when testing ends,
and the 75-page/asset comparison recorded by the operator. Send failures by step
number; preview stalls remain defects until an ordinary-browser walk proves the
route works. Full operator gates live in [the SPEC status](../../../SPEC.md).
