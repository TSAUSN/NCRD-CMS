# Friday go-live: administrator-run production test

For the platform lead and Google project administrator.
**Release tag:** `v2026.11.06`. Its runtime-identical review build was `e51b4b5`.
Deploy the verified release commit; the private handoff records the full SHA.
Select the verified release ref in GitHub and verify its full commit hash before building.

Friday is Super-admin-only sign-in through the **existing personal Supabase** project.
SAWSO/Echelon start on pre-production `*.web.app`; domains come later. No SMTP,
real-editor invitation, auth-provider migration or DNS change is in this deploy.
The Google project administrator runs all organization commands. Stop if IT has not completed the
[administrator checklist](bootstrap.md#administrator-checklist).

## 1. Select the frozen source and private inputs

Use a dedicated administrator-operated shell, Node 24 and the pinned pnpm.

Obtain the organization repository URL and release commit from the reviewed
handoff. From a new workstation, clone and fetch the release refs first:

```bash
git clone ORGANIZATION_REPOSITORY_URL cms-v2
cd cms-v2
git fetch origin tag v2026.11.06
git rev-parse v2026.11.06^{commit}
```

Compare the full hash with the handoff before checking out the release. Then select and check the release:

```bash
TASK_TAG=v2026.11.06
git checkout --detach "$TASK_TAG"
pnpm install --frozen-lockfile
pnpm check:node
TASK_REVISION=$(git rev-parse "$TASK_TAG^{commit}")
```

 CI is not an automatic deployment;
bootstrap builds the selected committed source through Cloud Build.

Collect the [private release handoff packet](private-release-handoff.md) before
restoring content or configuring sign-in.
Match the archive SHA-256 and inventory before proceeding. Keep inputs outside
Git and public storage. Do not use an unchecked live-review dump as a seed.
Preserve the retained demo and its data if it exists on the workstation.

## 2. Fill and review the target configuration

```bash
TASK_PRIVATE=/ABSOLUTE/PRIVATE/cms-friday
install -d -m 700 "$TASK_PRIVATE"
TASK_CONFIG="$TASK_PRIVATE/bootstrap.json"
cp deploy/google/bootstrap.example.json "$TASK_CONFIG"
chmod 600 "$TASK_CONFIG"
TASK_PROJECT=EXACT_ORGANIZATION_PROJECT_ID
TASK_ACCOUNT=EXACT_AUTHORIZED_OPERATOR_EMAIL
```

Edit the private JSON: project ID/number, operator account, exact frozen revision,
region, service prefix, SQL tier/instance/database, proxy port, all prepared input
paths/checksums, `expectedPublicPages:75`, public-asset oracle, verified notification
channel and IT-approved public invocation mechanism. Keep the Friday personal
Supabase URL, copy its existing **publishable** key, and use the authorized Super admin’s email.
For this original cleaned archive `ownerAuthSubject` stays null: it is a fresh
unbound copy; no existing hosted binding is cleared. First verified Super admin sign-in
attaches the same personal-provider identity through the normal flow.

Set `administratorPrerequisitesConfirmed:true` only after IT approves the checklist
and costs. Set `monitoringDeliveryConfirmed:false` until delivery is actually
checked. Do not substitute a provider secret/service-role key or local-test mode.
Friday starts with zonal PostgreSQL 16 **`db-f1-micro`**, 10 GiB SSD, about **$10/month**,
within the manager-approved test-phase budget. The review copy uses this tier;
its measured save/publish/previews are acceptable for the demo. Migration 0205
fixed the earlier 41-second case. Keep `db-custom-1-3840` (~$51/month) only as an
approved later upgrade if real editing is slow; see the [resize command and
downtime](speed-and-size.md#upgrade-only-if-real-editing-is-slow).

## 3. Select and verify the administrator’s Google configuration

Select a dedicated configuration first, then the Google project administrator signs into the exact
authorized Google account in its browser flow. This keeps the personal default
configuration intact. Every cloud command below names the target explicitly:

```bash
gcloud config configurations create cms-friday --no-activate \
  --project="$TASK_PROJECT" --account="$TASK_ACCOUNT"
export CLOUDSDK_ACTIVE_CONFIG_NAME=cms-friday
gcloud auth login "$TASK_ACCOUNT" --project="$TASK_PROJECT" --account="$TASK_ACCOUNT"
gcloud config set account "$TASK_ACCOUNT" --project="$TASK_PROJECT" --account="$TASK_ACCOUNT"
gcloud config set project "$TASK_PROJECT" --project="$TASK_PROJECT" --account="$TASK_ACCOUNT"
gcloud projects describe "$TASK_PROJECT" --format='value(projectId,projectNumber,lifecycleState)' \
  --project="$TASK_PROJECT" --account="$TASK_ACCOUNT"
```

[Google’s login command](https://docs.cloud.google.com/sdk/gcloud/reference/auth/login)
reuses valid stored credentials or opens its authorization flow; it activates the
account only in the selected configuration. The Google project administrator completes that flow.

If that named configuration already exists, inspect/select it; do not recreate
or overwrite an unfamiliar setup. Compare the displayed ID/number with IT's
record and JSON. The bootstrap independently checks the real configuration,
authenticated account and project identity and refuses a mismatch.

```bash
bootstrap() {
  node --experimental-strip-types scripts/bootstrap-google.mjs \
    --config "$TASK_CONFIG" --project "$TASK_PROJECT" --account "$TASK_ACCOUNT" "$@"
}
bootstrap --dry-run > "$TASK_PRIVATE/reviewed-plan.json"
```

Read the plan and administrator prerequisites. It makes no cloud calls. Preserve
that reviewed plan and the configuration outside Git.

## 4. Create infrastructure, then start the exact proxy

The next command creates a paid SQL instance if absent, so the Google project administrator runs it
only after the tier/cost approval:

```bash
bootstrap --phase infrastructure --execute --owner-operated --allow-create-sql
```

If SQL already exists, omit `--allow-create-sql` and provide its existing private
`operator.json`; the script will not rotate its password. For a new instance the
script writes that file privately. It creates no service-account key.

Read region/instance/proxy port from the reviewed JSON and start the official
proxy in another administrator shell with the same selected configuration/account:

```bash
TASK_REGION=us-central1
TASK_INSTANCE=EXACT_INSTANCE_FROM_JSON
TASK_PROXY_PORT=54332
CLOUDSDK_CORE_ACCOUNT="$TASK_ACCOUNT" CLOUDSDK_CORE_PROJECT="$TASK_PROJECT" \
  /PATH/TO/OFFICIAL/cloud-sql-proxy --gcloud-auth --address=127.0.0.1 \
  --port="$TASK_PROXY_PORT" --quota-project="$TASK_PROJECT" \
  "$TASK_PROJECT:$TASK_REGION:$TASK_INSTANCE"
```

The proxy uses explicit account/project environment plus the exact connection
name; it has no `--account` flag. Bind only loopback. The CMS services use the
Cloud SQL socket, not this workstation port. The retained 54329 port is forbidden.
[Official proxy instructions](https://docs.cloud.google.com/sql/docs/postgres/connect-auth-proxy).

## 5. Restore, verify media, build and deploy

```bash
bootstrap --phase database --execute --owner-operated
bootstrap --phase media --execute --owner-operated
bootstrap --phase build --execute --owner-operated
```

Require completed restore/fingerprint/migration receipts (208 current migrations),
unchanged archive checksum, verified media bytes and a successful build with
pinned runtime/recovery digests. Any error stops the sequence; do not reset/drop
anything to force success. A later changed database is refused by initial restore.
Keep backup encryption key custody separately from the encrypted archive.

Finish saves and close all editing tabs before replacing an app image:

```bash
bootstrap --phase deploy --execute --owner-operated
bootstrap --phase hosting --execute --owner-operated
```

Require all Run services Ready, expected digest, private worker, three correct
native Hosting destinations and no custom domain. If public policy blocks a
service, stop for IT; do not widen a bucket or auto-disable a security check.

## 6. Configure the sign-in callback and operations

From the generated admin origin (`https://PREFIX-admin-PROJECT_NUMBER.REGION.run.app`),
add exactly `ADMIN_ORIGIN/auth/confirm` to the existing personal Supabase Redirect
URLs. Preserve its old Site URL and existing callbacks. Use that same numeric
origin in Chrome for request and confirmation so the browser proof cookie agrees.
Only the authorized Super admin requests/signs in; default Auth email quota is shared and small.

```bash
bootstrap --phase operations --execute --owner-operated
```

Require the first encrypted backup job to succeed, object read-back verification,
fresh worker heartbeat, private authenticated Scheduler delivery and installed
administrator-channel alerts. Confirm a clearly labelled synthetic test alert reaches
the maintainer; IT can use its approved notification-channel test without stopping a
service. Then set `monitoringDeliveryConfirmed:true` in the reviewed private JSON
and repeat the operations phase; exact matching jobs/policies are reused. This
sets both scheduling flags true. Do not claim readiness from merely creating a job.

```bash
bootstrap --phase verify --execute --owner-operated
```

Require exact health version, all 75 public routes, every referenced asset and
expected 121 asset hashes, noindex, fresh worker and anonymous worker 401/403.
Then walk [the demo route](../start-here/demo-route.md) in ordinary Chrome, using
the **new** origins. Retained content IDs are the same. No real editor or domain
change is part of that route. Restore/archive every QA change and check public
content again. Save every receipt and the final source/digest/tag in the handoff.

## 7. Roll back a failed deploy without discarding edits

1. Pause authoring/scheduling decisions and make a fresh database dump and matching
   media inventory. Preserve the current manifests, migration ledger, build/digest
   receipts, audit evidence and encrypted backup key. Stop on an unknown target.
2. **Compatible code failure:** restore the prior verified manifests/digest for
   Site, Admin and Worker in that order, using explicit project/account/region
   on each `gcloud run services replace` command. Recheck health, sign-in, public
   routes/assets and worker. Do not downgrade or delete applied migrations.
3. **Damaged content/database:** use History/release recovery for an isolated edit.
   For broader damage, restore the verified backup into another empty database in
   the same instance; compare all table/schema/function/role/media evidence before
   serving it. Never use `pg_restore --clean` on the active database. Repoint the
   existing restricted runtime URLs to the recovered database only after verifying
   its ownership/RLS. Reconcile edits since backup and inspect schedules/outbox;
   do not start a general worker against a snapshot/review restore during checking.
4. Preserve the prior database and resources. After a reviewed repoint, check the
   whole route and only then resume authoring/worker work. Cloud Run image rollback
   does not itself roll back content, auth bindings, SQL migrations or DNS.
5. **First installation failure:** no earlier organization deployment may exist.
   Leave partial resources and source archives in place, fix the reported
   prerequisite or restore into another empty database; do not delete/recreate
   resources automatically. Personal review and retained demo remain fallbacks for
   review, with their separate data and URLs clearly identified.

There is no DNS rollback in this first native-address deployment. Later domain
work follows [the domain runbook](domains.md) under its own Google project administrator/IT approval.


## 8. Optional database upgrade after real-use feedback

Friday's default remains `db-f1-micro` (~$10/month). With later budget approval,
`db-custom-1-3840` is about $51/month. After a fresh verified backup and closing
editing tabs, the Google project administrator runs in the reviewed project/account:

```bash
TASK_SQL_INSTANCE=EXACT_INSTANCE_FROM_REVIEWED_CONFIG
bootstrap --phase verify --execute --owner-operated
gcloud sql instances patch "$TASK_SQL_INSTANCE" --cpu=1 --memory=3840MiB \
  --project="$TASK_PROJECT" --account="$TASK_ACCOUNT"
gcloud sql instances describe "$TASK_SQL_INSTANCE" \
  --project="$TASK_PROJECT" --account="$TASK_ACCOUNT" \
  --format='table(name,settings.tier,state)'
bootstrap --phase verify --execute --owner-operated
```

Expect a restart: Google documents under 60 seconds offline for Enterprise
CPU/memory changes, with the overall operation taking several minutes. Reserve
5–10 minutes for the maintenance/check window; this is not a downtime guarantee.
Save work first: both CMS and public pages depend on this database.
[Google's setting-change guidance](https://docs.cloud.google.com/sql/docs/postgres/instance-settings#impact_of_changing_instance_settings)

Require RUNNABLE, the expected tier, successful verify and a fresh Super admin
save/preview/publish walk before resuming editing. Record the approved tier in
private config; never replay the initial restore. Full checks and resize rollback
are in [speed and size](speed-and-size.md#upgrade-only-if-real-editing-is-slow).
