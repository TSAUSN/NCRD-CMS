# Roles — draft for review

Use the shortest view that supports a person's content responsibilities.

For: Admins and Super admins. Last checked: 2026-11-03.

This is the approved RoleViews draft, with the hard-rule clarification below.
It is a target for review, not a claim that every screen already follows it.

| Work | Super admin | Admin | Site editor | Content creator | Page editor |
| --- | --- | --- | --- | --- | --- |
| Words, photos and links | Yes | Yes | Yes | Yes | Assigned page |
| Add and tag stories | Yes | Yes | Yes | Yes | No |
| Add and move sections | Yes | Yes | No* | No | No |
| Publish or schedule | Yes | Yes | Yes | No | No |
| Create pages | Yes | Yes | Yes | No | No |
| Header, menu and footer | Yes | Yes | No | No | No |
| Manage tags | Yes | Yes | No | No | No |
| Site look and people | Yes | Yes | No | No | No |
| Section spacing and appearance | Yes | Yes | No | No | No |
| Template, fonts, hosting and code | Yes | No | No | No | No |

*RoleViews shows Yes for Site editor section add/move. The Round3 hard UX rule
says content fields only, without section management. Native page editing
follows the hard rule. Admin and Super admin move controls remain.

Verified locally: native content-role page editing keeps the page list, fields
and card/slide flows while hiding section management, spacing and visibility.
Content-only native panels open directly on fields without a redundant Content
tab. Admins and Super admins retain grouped controls. Imported-site editor
interfaces keep their existing controls while those sites are frozen.

Database permissions and normal save/release checks remain enforced. The
remaining full-screen comparisons and fresh-account role acceptance are open;
do not use this draft as proof of those behaviors. Chapter page memberships
resolve to Content creator and submit for approval; division assignments resolve
to Site editor and retain their existing chapter approval capability. People and role badges use Super admin, Admin, Site editor and Content creator.
These map to the existing super_admin, site_admin, editor and contributor IDs;
permissions do not change. “Assigned pages” or “division” describes the scope,
not whole-site access. Comment-only reviewers keep their existing access and name.

An assigned-page editor can load the photos referenced by that page and its
history. This does not open the site-wide Media library or unrelated photos.
Removing the page assignment removes this photo access too.

For chapter work, refresh the chapter list after someone else changes its page
before sending an invitation. The invitation checks the current saved version
and refuses an outdated screen. Invitations remain in the local outbox for
this demo; no real email is sent. Scoped volunteers send content for approval.

The local demo's three example accounts display role placeholders. Catalogue
people/speakers are numbered samples. These labels do not change their access;
use the role and assigned-scope notes to see what an account can do.

People & access opens People for Super admins. Invite someone keeps the same
invitation flow. When invitation delivery is off, Add person creates the chosen
site access without sending an email; see [Adding a person](adding-a-person.md). Other
accounts open Your access and see their authorized sites and scopes. This pass
does not grant account management to Site admins.

Choose Edit access to open the bounded panel beside the list. Save account
access and Cancel stay at the bottom while fields scroll. Saving access takes
effect immediately; it is separate from page drafts and publication. Existing
chapter/division assignments stay visible and unchanged when saving whole-site
account fields. Manage chapter access and Manage division team open their
existing setup screens. Deactivation still requires its normal confirmation.

Closing or choosing another account with unfinished changes offers Keep editing,
Discard changes and Save draft and leave. Saving on leave keeps only private
choices in this browser, scoped to your account and the selected person (or the
invitation form). It changes no permissions, creates no account and sends no
invitation. Reopening restores those choices; Clear saved access choices removes
the browser copy and returns to the form's opening values. A storage failure
keeps the form open. Another browser has its own choices.

Review restored name, status and whole-site access before using Save account
access or Create account & send invitation. An old restored revision cannot
replace newer account access; clear the choices and reopen the account after a
stale refusal. Missing saved sites require clearing and reopening. Deactivation
still requires its explicit confirmation. Discard returns to the opening or
last browser-saved choices; it does not delete an earlier saved browser copy.
 A pending save disables switching and
closing; an uncertain result keeps its error with the fields. Search/filter and
empty states use saved account facts. Status is shown instead of an invented
last-active time; January/July reminders stay in chapter-site Settings.
