# NCRD CMS: public access and keys

For IT approval before the Google project administrator deploys.
Last checked: November 5, 2026.

**Friday scope:** SAWSO/Echelon on separate pre-production `*.web.app` addresses;
only a site editor signs into Admin through the existing personal Supabase project.
Custom domains and long-term sign-in ownership come later. Public sites currently
use Cloud Run and Cloud SQL at request time; a database/service outage can take
public pages offline. Static publishing is deferred. Approve this test-phase
limitation and ensure alerts reach the maintainer.

| Surface | Intended access | Protection |
| --- | --- | --- |
| Firebase Hosting → Site service | Public visitors | Exact host/site routing, published-only database API and media authorization; unknown/foreign requests refused. |
| Admin HTTPS entry | Publicly reachable sign-in page | Verified Supabase session, active CMS account, existing roles/scopes/RLS, recent sign-in for access changes. Public invocation grants no CMS role. |
| Worker `/run` | Private | Cloud Run invoker restricted to the Scheduler service account; OIDC audience is the worker origin. Anonymous request must fail. |
| SQL and media/backup buckets | Private | Connector IAM plus distinct restricted database logins; uniform bucket access/public-access prevention; narrow object grants. No public bucket ACL. |
| Backup job | Private | Only the scheduled/operator invocation identity may run it; database owner DB secret and encryption key stay out of web services. |

**Choose the public invocation mechanism explicitly.** The current personal copy
uses `allUsers` with `roles/run.invoker` only on Admin/Site. Domain-restricted
sharing may forbid that binding. Google also supports disabling the invoker IAM
check on selected services; `constraints/run.managed.requireInvokerIam` may forbid
that option. IT must check the effective folder/organization policies and approve
one supported mechanism before deploy. The script never falls back automatically.
If both are forbidden, stop: an approved ingress/authentication architecture must
be designed and tested; a private worker or public Storage bucket is not a fix.
[Google's access-control options](https://docs.cloud.google.com/run/docs/securing/managing-access).

**Classify keys by capability.** Supabase's publishable/anon Auth key and project
URL identify the Auth service and are deliberately non-secret; they do not replace
user verification or give Cloud SQL access. Do not substitute a `service_role` or
`sb_secret_` key. Firebase web configuration/API keys, if introduced later, also
need API restrictions and application security; none is a substitute for user
permissions. Database passwords, refresh/session tokens, backup encryption keys,
SMTP secrets and service-account private keys are sensitive. Keep them outside
Git/logs/screenshots and in the approved secret store. Runtime identities use
attached Google credentials; the bootstrap creates no service-account key files.
[Supabase key types](https://supabase.com/docs/guides/api/api-keys).

IT supplies project ID/number, authorized operator/role grants, billing controls,
public-invocation decision and a verified notification channel. The maintainer runs
every organization command. Preserve the old deployment/dump, rehearse restore,
then verify public routes/assets, Super admin sign-in, private worker refusal and alert
delivery before enabling scheduling. Budget alerts are not a hard total-cost cap.
