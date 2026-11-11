# Add a person and give site access

For Super admins. Last checked: November 11, 2026 against the live People form
and the account commands. No production person or permission was changed during
this documentation check. First-sign-in delivery still needs operator acceptance.

## Add someone new

1. Open **People & access**. Use **Find a person** to search their exact email.
   If they already exist, follow “Change existing access” below.
2. Choose **Add person** when invitation delivery is off, or **Invite someone**
   when it is enabled. The current organization pilot shows **Add person**.
3. Enter **Name** and the exact **Email address** they will use to sign in.
4. Under **Whole-site access**, set each intended website to one of:
   - **Content creator — drafts and review**: prepares work for approval.
   - **Site editor — edit and publish**: edits and publishes assigned content.
   - **Admin — manage this site**: administers the assigned website.
   Leave other sites at **No whole-site access**. Adding a new person requires
   at least one site assignment. Use the separate chapter/division workflow
   for a volunteer who should not edit every page.
5. Choose **Add person**, or **Create account & send invitation**. A hosted
   account-management operation requires a sign-in within 15 minutes. If asked,
   use **Confirm sign-in in a new tab**, sign in there, then retry the retained form.
6. Read the receipt. **Add person** sends no invitation. The invitation flow
   queues a message; a queue receipt is not proof the person received it.
7. Share the CMS sign-in address through your approved channel. A new person
   completes their own verified email sign-in, then opens **Password** to set
   their own password. An existing password user can sign in normally. Adding
   CMS access does not set a password or itself create a provider identity.
8. Have the person use their own browser profile to confirm assigned sites are
   available and direct addresses to unassigned sites are refused. Check **Activity**
   for the account/access change. This is a verification task, not a claim that
   every hosted role walkthrough has already passed.

## Change existing access

1. Open **People & access**, search the name/email or use **Showing people for**.
2. Select their name to open **Edit account access**. Check the email, role and
   **Can edit** summary. The email is read-only in this form.
3. Open **Whole-site access** and select the required role for the intended site.
   Keep unrelated site choices unchanged. Choose **No whole-site access** to
   remove that whole-site assignment.
4. Choose **Save account access** and complete the offered recent-sign-in check
   if necessary. Permissions apply on the next request; no Publish step is needed.
5. Reload and confirm the saved summary. Have the person check their own work.

**Save draft and leave** keeps choices only in this browser, for this operator
and person. It does not apply permissions, create an account or send an email.
Review restored choices before applying them. A stale refusal means the account
changed elsewhere: clear the saved choices and reopen the current record.

## Chapter, division and Super admin scope

Whole-site access covers every page on a site. Existing chapter and division
assignments are listed separately in the account panel, with **Manage chapter
access** and **Manage division team** links. Saving whole-site fields preserves
those assignments. Removing one whole-site role does not remove separate scopes.
See [Roles](roles.md) and [Chapter destinations](../site-setup/chapter-destinations.md).

An existing **Super admin** can access all sites while active; changing site
choices does not narrow the global role. This form does not grant or revoke
Super admin. Ask the responsible platform administrator about global-role changes.
An **Admin** does not gain global People management; other accounts see **Your access**.

## Stop or restore access

To stop all CMS access, set **Account status** to **Deactivated — no CMS access**,
choose **Save account access**, then confirm **Deactivate account**. The person's
pages, drafts and history remain. The current account cannot deactivate itself
here. To reactivate, review retained assignments, choose **Active**, then save;
those assignments become available again on the next request.

## Sign-in delivery is separate

The organization pilot's invitation delivery is off at this check. Before real
editor onboarding, the hosting/authentication operator must configure and test
approved sign-in delivery through an actual organization mailbox. Password
sign-in avoids routine email only after a person has a verified account and
has set a password. An unavailable or consumed first-sign-in link remains a
separate delivery problem. Infrastructure invitations, CMS memberships and
provider sign-in accounts are distinct; do not add editors to the infrastructure
team as an onboarding workaround.
