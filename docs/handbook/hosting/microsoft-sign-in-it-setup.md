# Microsoft sign-in through Supabase — IT setup

November 15, 2026. Direct Entra integration is deferred. Keep the existing
Supabase Email/password provider and existing CMS accounts. This adds another
sign-in choice; it does not replace the CMS database, migrate identities or
change the hosting plan.

## Application preparation

The application has a server-controlled **Sign in with Microsoft** button,
Supabase Azure OAuth with a browser-bound PKCE challenge, an explicit confirmation
step, verified identity checks, and the existing CMS membership gate. Cancellation,
an incomplete callback and a missing browser proof have recovery messages. The
password field, visibility control and email-link fallback remain available.

`AUTH_MICROSOFT_ENABLED` is deliberately off until the matching Azure provider is
configured. Deploying the code alone must not expose a button that leads to a
disabled provider. App-side tests do not prove the organization's tenant policy.

## What IT supplies and configures

1. Register a **Web application for the organization's tenant only**. Record the
   tenant ID and application/client ID. Use a separate test registration for the
   personal lab if IT permits testing there; organizational credentials must not
   be copied into a personal project without IT's explicit approval.
2. Set the Web redirect URI to that environment's **Supabase callback** in the
   table below. The Cloud Run callback belongs in Supabase's redirect allowlist,
   not in Entra's Web redirect field.
3. Configure the email and `xms_edov` optional ID-token claims as described in the
   linked provider guide. Decide account assignment, guest access, consent and
   MFA/Conditional Access policy. Do not infer CMS access from an email domain.
4. Create the application secret and enter its **value** directly in Supabase
   Authentication → Providers → Azure with the client ID and tenant URL
   `https://login.microsoftonline.com/<tenant-id>`. Record an accountable renewal
   owner and expiry date. Keep the secret out of chat, Git and handoff documents.
5. Preserve existing Supabase redirect URLs and add the exact CMS callback for
   the selected environment. Keep the Email provider enabled. Only then enable
   `AUTH_MICROSOFT_ENABLED=true` on the corresponding admin service and deploy
   the reviewed Git revision. No change to site/worker services is required by
   this sign-in flag.

| Environment | Entra Web redirect → Supabase | Supabase allowlisted redirect → CMS |
| --- | --- | --- |
| Personal isolated V2 lab | `https://huvnuktnschrwndzwbxo.supabase.co/auth/v1/callback` | `https://cms-review-admin-135407342104.us-central1.run.app/auth/confirm` |
| NCRD recorded configuration; confirm during IT session before changing it | `https://vgoxmhdhghronlzlgaog.supabase.co/auth/v1/callback` | `https://ncrd-cms-admin-57223803907.us-central1.run.app/auth/confirm` |

No NCRD configuration is changed by this preparation. The personal lab uses
its own Supabase project, database, files and jobs.

## Acceptance with IT

- Keep a working password session open. Sign in with Microsoft in a fresh
  browser as an existing invited CMS account; confirm the original CMS user ID,
  site access and role are preserved. A duplicate privileged account is a failure.
- Test a permitted editor, an account without CMS membership, a disabled account
  and an account outside the allowed tenant. Microsoft authentication alone must
  not grant access. Confirm the chosen guest/assignment rules with IT.
- Cancel the Microsoft screen; repeat a callback; open a callback in another
  browser; try an expired code. Each must fail safely and leave password sign-in
  usable. The confirmation GET must not sign anyone in by itself.
- Check refresh, sign-out and access-management reauthentication. A refreshed
  session must not masquerade as a recent sign-in. Check save/preview/publish
  with the user's existing role after successful sign-in.

Record the test accounts by business role and result, not their passwords or
raw tokens. Real tenant acceptance remains **pending IT**.

## Rollback and cost

Turn `AUTH_MICROSOFT_ENABLED` off on the same admin service and redeploy its
reviewed revision. Keep Email/password enabled and preserve identity/membership
records. Do not clear `auth_subject`, delete users or restore an old database to
undo the button.

Supabase's current Free plan includes social OAuth providers and 50,000 monthly
active users. This uses Azure social OAuth, not the separately priced SAML SSO
feature. No Supabase plan upgrade is required for this integration within the
published limits. IT's Microsoft policy/licensing requirements are a separate
check; the CMS work does not change those subscriptions.

Sources checked November 15:
[Supabase Azure setup](https://supabase.com/docs/guides/auth/social-sign-in/auth-azure),
[Supabase pricing](https://supabase.com/pricing),
[Supabase identity-linking security](https://supabase.com/docs/guides/auth/auth-identity-linking).
