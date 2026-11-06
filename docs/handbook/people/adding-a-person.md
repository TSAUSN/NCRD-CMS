# Add a person without an invitation email

For Super admins.
Last checked: November 5, 2026, locally; hosted verification pending.

1. Open **People & access** → **Add person**. This appears when invitation email is off.
2. Enter the person's name and the exact email they will use to sign in.
3. Under **Whole-site access**, choose only the sites they need. **Site editor**
   edits and publishes; **Content creator** submits drafts for review. Leave other
   sites at **No whole-site access**. Chapter/division scope stays in chapter setup.
4. Choose **Add person**. Read the receipt: access is created, no email is sent.
   A hosted account-management operation requires a sign-in within 15 minutes;
   if asked, confirm sign-in in another tab and retry the retained form.
5. Share the CMS sign-in address through your usual approved channel. The person
   requests their own sign-in email and verifies it. Adding access creates no
   provider identity, password or reusable sign-in link.
6. In a separate browser profile, check that only the assigned sites are available.
   An editor cannot manage People, Header/menu/Footer or Manage tags. Verify a
   direct address to an unassigned site is refused as well.
7. Open **Activity** to see the person/access grant. To revoke access, edit their
   account and select **Deactivated**, then confirm. Their history remains.

**Sign-in delivery is a separate prerequisite.** The current personal Supabase
project has custom SMTP off at the last check. Supabase's built-in
sender delivers only to project-team addresses and is currently limited to two
emails per hour across the project. Adding real editors therefore requires
approved SMTP on the organization-owned Supabase project. Do not add content
editors to the infrastructure team as a workaround, disable email verification,
or use an operator-generated recovery link as proof of normal sign-in.
[Supabase's SMTP documentation](https://supabase.com/docs/guides/auth/auth-smtp).

If invitation email is enabled, **Invite someone** remains the existing audited
invitation flow. Its delivery is separate from Supabase's sign-in email service.
No-mail membership creation does not queue an invitation or change role powers.
