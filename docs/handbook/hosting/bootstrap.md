# Bootstrap an empty Google project

For the platform lead and Google project administrator.
The Google project administrator performs organization deployment. Local checks
and a personal review restore do not prove an empty-project installation.
Use [Friday go-live](friday-go-live.md) for the ordered commands.

## Administrator checklist

| Prerequisite | Who supplies it | Required before |
| --- | --- | --- |
| Exact project ID and number, authorized operator account, billing enabled and agreed budget/alerts | Organization/billing administrator | Any execution |
| Permission to enable the listed APIs, create service identities, buckets/registry/SQL, write IAM policies and attach runtime identities | Organization/project administrator | Infrastructure phase |
| Operator permissions for Cloud Run deployment/act-as, Cloud Build submission, SQL administration, Secret Manager, Storage, Hosting, Scheduler, Monitoring and Logs; temporary bootstrap access reviewed separately from routine deployer access | Organization/project administrator | Infrastructure and deploy |
| Explicit approval for `allUsers` invoker **or** disabled invoker IAM check on Admin/Site; effective folder constraints checked | Organization policy administrator | Public deploy; see [IT note](public-access-it.md) |
| Verified target-project notification channel resource name, recipient and delivery test | Monitoring administrator | Operations and scheduling |
| Friday micro SQL budget (~$10/month) confirmed by platform lead/manager; IT/billing verifies backup/storage/build budget and approves any larger tier separately | Billing administrator | `--allow-create-sql` |
| Existing personal Supabase URL/publishable key, exact new callback added, Super admin email and working Super admin sign-in | Super admin, test phase only | Demo; no SMTP/new provider/editor rollout |
| Cleaned dump and SHA-256, all-table fingerprints, media directory/inventory and public asset oracle | Super admin/maintainer | Database/media verification |
| Official Cloud SQL Auth Proxy and matching PostgreSQL clients (16+ dump client; preserve the archive's server-major compatibility) | Google project administrator/IT workstation maintainer | Database phase |

The script does not grant its human operator permission to grant itself access.
It creates no Google project, billing account, sign-in account or service-account
private key. IT establishes those administrative prerequisites first.

## Script contract

`node --experimental-strip-types scripts/bootstrap-google.mjs --config PRIVATE_JSON
--project EXACT_ID --account EXACT_EMAIL` is **offline dry-run by default**.
`--execute --owner-operated` is required for execution; SQL creation additionally
needs `--allow-create-sql`. Use `--phase` in the order below. Every cloud CLI action
receives project/account explicitly. REST calls obtain the explicitly scoped
operator token and supply a quota project. Local database operations validate the
private connection's project/region/instance/database/loopback port first.

The script checks the actual gcloud configuration before adding global flags,
so those flags cannot mask a wrong ambient account/project. It never changes
that configuration for the operator. A mismatch, unexpected credential override,
wrong project number, failed command or unreviewed existing resource stops the run.
Failure output omits provider responses that could contain credentials.

| Phase | What it does and refuses |
| --- | --- |
| `infrastructure` | Enables APIs; creates six named identities, three private buckets, Docker registry and Firebase; applies named grants. Creates SQL only with the extra spending flag. Existing bucket project/region/privacy and registry/SQL region/version/tier are checked. A larger existing SQL tier is refused, never silently reused/resized. Existing operator credentials are never rotated. |
| `database` | The Google project administrator first starts the exact loopback proxy. Creates an empty target/check database, verifies dump checksum and restores schema/data/constraints atomically with NOLOGIN ownership. Compares every application table to snapshot fingerprints; applies immutable migrations; verifies configured Super admin and safe queue state; creates restricted logins and pins five secrets. Rejects occupied targets without completed matching receipts, later changed content, credential collisions and other active users for Friday. |
| `media` | Checks every local SHA-256/size, then reuses byte-identical objects or uploads create-only. A differing object stops the phase. No overwrite/delete. |
| `build` | Requires the exact clean committed revision, archives Git source, submits the existing Docker recipe, waits for success and pins/protects runtime/recovery digests. Credentials never enter the archive/build. |
| `deploy` | Generates private manifests; deploys Site, Admin and private Worker plus backup job. Pools/instances are bounded, runtime credentials separated, and the chosen public invocation mechanism is explicit. Scheduling initially stays off. |
| `hosting` | Backs up, audits native-host rebinding for exactly three kept sites, then prepares their `*.web.app` Hosting rewrites. Refuses custom domains or an unreviewed prior public host. |
| `operations` | Installs matching administrator-channel alerts, OIDC minute worker trigger and OAuth backup trigger every 12 hours; performs a first backup and checks fresh worker heartbeat. Scheduling enables only after the maintainer confirms notification delivery. Existing matching jobs/policies are reused; differences stop. |
| `verify` | Requires exact health revision, private worker refusal, fresh heartbeat, reviewed route count, native host ownership, noindex, every local asset response and supplied expected asset hashes. Super admin sign-in/edit/preview/publish remain the ordinary-browser demo gate. |

API list: Service Usage, Resource Manager, IAM, Cloud Run, SQL Admin, Storage,
Artifact Registry, Cloud Build, Secret Manager, Firebase, Firebase Hosting,
Cloud Scheduler, Monitoring and Logging.

Runtime grants: Admin/Site/Worker/Operator receive SQL connector access. Admin
uploads media, Site reads media, Worker processes media, Operator reads media and
writes backups. Admin/Worker manage Hosting; Worker reads the one public Run
service. Builder writes only its registry and logs and reads its source bucket.
Secrets are granted only to the corresponding runtime identity; database owner DB/backup
key go only to Operator. Scheduler invokes only Worker and the backup job.

## Required verification and limits

- Refuse a wrong project/account, absent operator attestation or missing
  administrator prerequisites before any cloud command. Review all eight offline phases.
- Require an empty-project installation to pass its own acceptance. Personal-review
  and local restore evidence do not establish organization IAM or public policy.
- Compare every application table fingerprint, complete schema/owners/grants/RLS,
  function definitions/ACLs and media inventory after restore and migrations.
- Admin/Site/Worker logins must have no superuser, BYPASSRLS, CREATEROLE or CREATEDB
  privileges. Verify public-page resolution and refusal to read private people data.
- Verify the supplied archive's migration ledger and all current immutable files;
  migration prefixes have gaps, so do not infer the file count from a filename.
- Refuse unexpected active users, schedules or pending/running queue work. Reviewed
  archived-site cache invalidations are handled only by the documented bootstrap policy.

A dump alone does not prove media durability. Verify encrypted backup read-back
and maintain independent key custody. A restore into the same SQL instance proves
procedure and roles, not recovery after losing a Google project.
