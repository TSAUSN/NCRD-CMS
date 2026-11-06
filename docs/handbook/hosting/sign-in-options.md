# Sign-in options after Friday

For the platform lead, IT and the next maintainer. Last checked: November 5, 2026.

**Friday's decision:** only a site editor signs in, using the existing personal Supabase
Auth project. Keep its existing provider and subject mapping. Add the exact new
admin `/auth/confirm` callback while preserving the personal-review/older callbacks.
No SMTP setup, new provider, real-editor invitation or account linking is required
for Friday. Long-term ownership is a question for the platform lead after Friday.

The no-mail Add person change was already complete and tested before this scope
change (Chromium/WebKit plus database tests), so it remains under the maintainer’s
explicit exception. It grants product access, not sign-in. Do not use it to invite
people during Friday's Super-admin-only test.

## Compare the choices

Estimates below are engineering judgments for one maintainer, including focused
security tests and a review deployment. They exclude IT/account approval delays.
They are not commitments to change sign-in for this release.

| Choice | Effort | What stays / what changes | IT needs and main risk |
| --- | --- | --- | --- |
| Organization-owned Supabase, transferring the existing dedicated project | About half to one day to prepare, verify and hand over; provider adapter stays | Preserve the provider project and existing user IDs if the supported transfer keeps the same project. Verify all consumers and settings before/after. Cloud SQL product data remains separate. | Organization account/owners, billing responsibility, recovery/MFA custody, approved email delivery before real editors. Transferring a shared personal project affects its other consumers; inventory them first. |
| Organization-owned Supabase, a new project | About 1–3 days | Keep the adapter, but configure a new URL/key/callback and carefully migrate or rebind identities. Email addresses alone do not preserve subjects. | IT-owned project and operators, SMTP for non-team users, identity export/migration approval. An unplanned new subject can lock out an existing Super admin. |
| Google Identity Platform / Firebase Auth | About 3–5 days | Add an AuthProvider adapter and sign-in/callback/session handling; keep CMS roles, RLS and audits. Google project ownership alone does not authenticate CMS users. | Enable/configure the service, Google/OIDC/SAML provider choice, allowed accounts/tenants, OAuth client/callbacks, consent/billing and recovery administrator. Identity Platform adds enterprise OIDC/SAML capabilities; pricing depends on method and usage. New Firebase user IDs must be linked explicitly. |
| Microsoft Entra through the existing auth port | About 4–7 days | Add a single-tenant OIDC adapter and redirect/callback/refresh/logout flows. Keep existing CMS memberships and permission commands. This is an application sign-in, not a Cloud Run IAM gate. | IT supplies tenant ID, app registration, exact redirect URI, credential/certificate custody, consent, assignment/guest policy and Conditional Access/MFA requirements. Email/UPN can change and is unsuitable as the authorization identity; use tenant plus immutable object identity. |

Supabase's default mail service is intended for testing: it currently delivers
only to project-team addresses and allows two messages/hour across a project.
The personal project's custom SMTP is off at the last check.
This is sufficient only for the explicitly limited Friday Super admin flow, subject to
its quota; it is not a real-editor rollout. Avoid repeated sign-in requests and
leave a working Super admin session open in ordinary Chrome.
[Supabase SMTP limits](https://supabase.com/docs/guides/auth/auth-smtp).

Supabase provides a supported project-transfer procedure; check its current
source/destination permissions and restrictions before selecting that route.
Moving an existing project and creating a new project are different operations.
[Supabase project transfer](https://supabase.com/docs/guides/platform/project-transfer).
Google documents which enterprise features require Identity Platform and how ID
tokens must be verified.
[Product comparison](https://docs.cloud.google.com/identity-platform/docs/product-comparison),
[Firebase ID-token validation](https://firebase.google.com/docs/auth/admin/verify-id-tokens).

## The existing boundary and the Super admin hazard

The seam is `AuthProvider` in `packages/platform/src/session.ts`: verification,
sign-in completion, refresh and revocation produce a verified `AuthSubject`.
`packages/platform/src/hosted-auth.ts` currently selects only local or Supabase;
Google and Entra are **not implemented options** in an environment variable.
Admin sign-in/callback actions and the session-refresh path also need integration.
Use the existing HttpOnly/Secure cookies and recent-authentication requirement;
a refresh must not masquerade as a fresh sign-in for access management.

The product then calls `app.resolve_session(subject,email)` and
`app.attach_auth_subject(email,subject)`. `app_users.id` owns memberships and audit
history; `auth_subject` is the external identity. A previously linked subject is
not silently replaced by a different one. Preserve the product user ID and all
roles/scopes when changing providers.

For a new adapter, define a collision-safe, issuer-bound subject representation
(for example Firebase project + UID, or Entra tenant + object ID) and an explicit
migration of existing Supabase values. The current Supabase adapter supplies its
verified provider UUID; changing that representation is a separately reviewed
migration, not a string-format refactor for this release.

Never clear every `auth_subject` or grant Super admin to whoever presents a
matching email. Never infer administrator access from a Google email domain,
Entra group name, `email` or `preferred_username`. Verify issuer, audience,
signature, expiry and the permitted tenant; verify email where the chosen flow
uses it for first attachment. Entra's immutable `tid` + `oid` guidance is
particularly relevant to stable account mapping.
[Microsoft claims validation](https://learn.microsoft.com/en-us/entra/identity-platform/claims-validation).
Supabase also warns against automatic linking of unverified-email identities.
[Supabase identity-linking security](https://supabase.com/docs/guides/auth/auth-identity-linking).

## Switch steps for a reviewed later release

1. the platform lead/IT choose the provider and accountable administrator, allowed tenant/guest policy,
   recovery operators, email delivery and budget. Inventory all current consumers
   before transferring the personal Supabase project.
2. Take a matching database/media backup and save the old deployment digest,
   callbacks and non-secret configuration. Keep the working Super admin session and
   old auth provider available for rollback. Rehearse in an isolated review copy.
3. Implement the adapter plus callback proof (OIDC state/nonce and PKCE where
   applicable), session refresh/logout and trusted fresh-auth time. Test invalid
   issuer/audience/tenant, unverified identity, expired token, replay and failures.
4. Prepare a private identity map: existing product user ID, old issuer/subject,
   verified new issuer/subject, expected role and approval. The current Super admin
   reauthenticates with the old provider and proves the new identity; IT independently
   checks that binding. A narrow audited, revision-checked migration must apply it.
   Do not edit all users by email or create a second privileged product record.
5. Test the mapped Super admin first, then a restricted editor and a disabled
   user. Prove unchanged permissions, direct-address tenant denial, immediate
   deactivation and the recent-sign-in requirement. Keep at least one recoverable
   Super admin path; test the recovery procedure before switching the main deployment.
6. At a short authoring pause, back up again, apply the reviewed map and deploy
   the provider configuration/callbacks together. Expire old-provider CMS sessions
   deliberately; an old cookie must not be accepted by the new verifier. Verify
   sign-in in a fresh browser, save/preview/publish and access administration.
7. For a failed switch, restore the previous code/configuration and the recorded
   identity bindings through the audited inverse mapping. Revoke the failed new
   sessions. Keep new content/audit records; do not restore an old whole database
   over edits merely to undo account linking. Retain both provider configurations
   until the switch is accepted; no provider project is deleted automatically.

Friday uses step zero: preserve the existing personal provider and Super admin mapping,
configure only the new callback and verify it in ordinary Chrome. Everything above
is a decision/implementation plan for after Friday, not a claimed migration.
