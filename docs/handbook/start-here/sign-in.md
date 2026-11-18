# Sign in and recover your password

The hosted CMS uses Supabase to confirm who you are. Your site access comes from the CMS assignment for that same email address. A Super admin can check the assignment in **People & access**.

| What you need | What the CMS does |
| --- | --- |
| Sign in with an existing password | **Sign in** takes your email and password. The eye control shows or hides what you typed. Password sign-in does not send an email. |
| Sign in by email | **Email me a sign-in link** sends a one-time link to the account email. Open it in the same browser and on the same CMS hostname where you requested it, then choose **Continue to CMS**. |
| Set or change your password | **Password** in the sidebar accepts a new password of at least 12 characters, entered twice. Only the account holder chooses it. |
| Recover a forgotten password | **Forgot your password?** sends a recovery email while you are signed out. Open the latest link and choose **Continue to reset password**. After verification, the CMS opens **Password** so you can set a new one. |

NCRD’s sign-in and recovery email uses the organization’s verified Resend sending subdomain through Supabase. A completed owner recovery and fresh password sign-in were verified on November 16, 2026. Links are single-use. If a message is late or a fresh link repeatedly reports an error, the CMS administrator can check delivery and the exact Admin address. A working password is also available for accounts that have one.

A person who signs in but sees no sites may be using a different email or may be missing a CMS assignment. [Roles and assignments](../people/roles.md) explains what each role can do.

Microsoft sign-in is prepared for IT and is disabled on NCRD. The [IT guide](../hosting/microsoft-sign-in-it-setup.md) explains the provider setup. The local demo uses a separate local sign-in and records sample chapter mail without sending it to real people.
