# Deploy CMS V2 on Google

For the platform lead and Google project administrator. Source comes from the
organization GitHub repository at a reviewed release ref. The first deployment
uses [bootstrap](../../docs/handbook/hosting/bootstrap.md) and the ordered
[Friday go-live](../../docs/handbook/hosting/friday-go-live.md) runbook.
Existing deployments use [ship an update](../../docs/handbook/upgrades/ship-an-update.md).
For opted-in branch deployments to existing services, use
[automatic releases](../../docs/handbook/upgrades/automatic-releases.md).
The existing personal review identifiers are in
[review-environment.md](../../docs/handbook/hosting/review-environment.md).

## Services and prerequisites, in order

1. **Administrative setup:** confirm project ID/number, operator account, region,
   billing/budget, API permissions, service-account attachment and the IT-approved
   public-invocation mechanism. Run the bootstrap dry-run before execution.
2. **Infrastructure:** enable Service Usage, Resource Manager, IAM, Run, SQL Admin,
   Storage, Artifact Registry, Build, Secret Manager, Firebase/Hosting, Scheduler,
   Monitoring and Logging. Provision dedicated Admin, Site, Worker, Operator,
   Builder and Scheduler identities, private build/media/backup buckets and a
   Docker image repository. No default Editor identity or exported account keys.
3. **Database:** PostgreSQL 16 in Cloud SQL; the approved test-phase tier is
   `db-f1-micro`. Supply reviewed size, region, deletion protection and backup
   settings. Use an exact loopback Auth Proxy for operator work, restore the
   checksum-verified cleaned archive into an empty database, apply immutable
   migrations, compare fingerprints and create restricted runtime logins.
4. **Media and source:** verify media inventory/bytes before create-only upload.
   Cloud Build receives a committed Git archive, the reviewed source bucket and
   dedicated builder identity. Pin runtime and recovery image digests.
5. **Runtime:** deploy Site, Admin and a private HTTP Worker, plus the operator
   backup job. Use minimum instances zero and bounded pools/scaling. Keep database
   logins separate and use the Cloud SQL socket through `roles/cloudsql.client`.
   Keep scheduling off until operations acceptance. Hosted local-test auth is forbidden.
6. **Routing and auth:** Admin/Site require the approved public invocation policy;
   application sign-in and tenant authorization still apply. Worker stays private.
   Configure native Firebase Hosting rewrites for the three kept sites. Keep the
   selected Supabase provider and add exactly the new Admin `/auth/confirm` callback.
7. **Operations:** install the OIDC minute Worker trigger, OAuth backup trigger,
   heartbeat/failure/absence alerts and independent notification destination.
   Require successful encrypted backup/read-back and actual notification delivery
   before enabling schedules. Verify health revision, image digest, routes/assets,
   private-worker refusal and the ordinary-browser acceptance route.

`deploy/google/bootstrap.example.json` lists required private inputs. Copy it to
a private directory, fill the target values and verify every path/checksum. Never
commit private manifests, operator connection files, service secrets or backup keys.
The bootstrap phases are infrastructure → database → media → build → deploy →
hosting → operations → verify. The administrator performs organization commands.

## Runtime settings and boundaries

Admin, Site and Worker use distinct service and database identities. Admin creates
uploads, Site reads authorized media and Worker processes media and performs
supported Hosting operations. Operator owns migration/backup access; Builder has
source/registry/log access without database secrets. Scheduler invokes only the
private Worker and backup job. Secret access belongs only to the corresponding runtime.

The request-billed `worker-http` completes bounded work before responding. Do not
substitute a per-minute Cloud Run Job for that trigger. Preserve the reviewed
pool, concurrency, CPU/memory and instance limits in the private configuration.
Budgets and alerts are not an enforceable all-service spending ceiling; verify
current pricing and quotas with the billing administrator before provisioning.

The shared server renderer remains active; public requests depend on Cloud Run
and Cloud SQL. Static publishing is separate work under ADR 0012. Native review
addresses do not authorize custom domains or DNS cutover. The personal review
and retained local demo are separate environments, with separate receipts.

Retain prior manifests/digests for compatible code rollback. Recover data into a
separate empty database and verify schema, roles, media and queues before repointing.
Never downgrade applied migrations or restore destructively over active content.
