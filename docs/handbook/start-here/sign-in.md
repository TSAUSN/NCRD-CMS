# Sign in

Use your invitation address to reach the sites assigned to you.

For: Invited editors and administrators. Last checked: 2026-11-11.

## Email and password

On the hosted CMS, enter your email address and password, then choose **Sign in**.
Signing in does not grant site access: an administrator must assign it separately.

If you do not have a password yet, sign in once with a working email link or a
fresh one-time link supplied privately by your Supabase project owner. Open
**Password** in the sidebar, type your own password of at least 12 characters
twice, and choose **Save password**. Use that password on later visits. The same
screen replaces a forgotten password after you sign in again with a fresh link.
Each password field has a **Show** button; choose **Hide** to mask it again.
The buttons do not save or submit the form.
Do not send your password to the administrator or put it in a chat.

## Email links and recovery

Enter your email address and choose **Email me a sign-in link**. You can leave
Password empty for this action. Open the email in the same browser where you
requested it, and choose **Continue to CMS** on the confirmation screen. Request
and open links on the same Admin hostname; sessions are separate between hosts.

Links work once. An incomplete, expired or already-used link cannot sign you in;
choose **Go to sign in**, then use your password or request another link.
Organization email security may consume a default provider link before you open
it. Repeated requests can also hit the built-in sender's project-wide quota. If
this prevents the first password setup, ask your project owner for a fresh private
one-time link. A CMS site-access invitation and a Supabase dashboard invitation
are different from a working CMS sign-in.

Password sign-in sends no email. Email delivery and self-service recovery still
need the organization's approved SMTP setup for a wider editor rollout.

## Microsoft

Microsoft sign-in code is implemented through Supabase's Azure provider. The
button appears only after IT configures the approved organization tenant and app
registration in Supabase and the hosting operator sets
`AUTH_MICROSOFT_ENABLED=true`. It is not enabled merely by deploying this guide.
See [Sign-in options](../hosting/sign-in-options.md) for the exact setup and
existing-account checks. Microsoft authentication keeps CMS roles and site/page
assignments separate.

## Local demo

Local sample staff use **Continue to local CMS**. Scoped chapter links are
recorded in the local outbox; no email is sent. The demo operator opens those
recorded links. These local controls do not describe the hosted login flow.
