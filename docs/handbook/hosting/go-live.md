# Host and verify a review copy on Google

For the maintainer and Google project administrator.
Last checked: November 4, 2026.

Use [review-environment.md](review-environment.md) to identify the existing personal
review. For a new installation, follow [bootstrap](bootstrap.md) and the ordered
[Friday go-live](friday-go-live.md) procedure. Organization installation requires
its own approved project/account, budget, identities and public invocation policy.

## Deployment order

1. Select the reviewed Git revision and verify private content/media checksums.
2. Confirm the explicit account and project before every cloud operation.
3. Verify billing/API/IAM prerequisites; prepare the offline bootstrap plan.
4. Provision identities, private buckets, registry and PostgreSQL; start the exact
   loopback Cloud SQL proxy for database operations.
5. Restore into an empty database, verify table fingerprints, apply immutable
   migrations and provision separate restricted runtime logins.
6. Verify and upload media create-only. Build from committed Git source and pin
   the runtime and recovery image digests.
7. Deploy Site, Admin and private Worker, then native Hosting routes. Keep
   scheduling disabled until backups, heartbeat and notification delivery pass.
8. Add the exact Admin callback to the selected Supabase provider. Verify normal
   Super admin sign-in; no local-test sign-in in a hosted manifest.
9. Verify public routes, owned asset bytes, host/media isolation, preview,
   save/reload, History, publication and the ordinary-browser acceptance route.

A complete custom-format database dump and matching media inventory precede any
content-changing scenario. Preserve retained content and its original versions.
No real-editor rollout, custom-domain change or DNS cutover is implied by a native
review address. See [domains](domains.md) for separately authorized domain work.

## Existing-environment updates and recovery

Use [ship an update](../upgrades/ship-an-update.md) for an existing installation.
Retain previous manifests and protected image digests. Roll back compatible code
using those manifests; database migrations remain forward-only. Recover isolated
editorial changes through History, or restore a verified backup into a separate
empty database for broader recovery. Never reset an active or retained database,
remove its migration ledger, overwrite media or relax RLS to pass a check.

[Known issues](../start-here/known-issues.md) records baseline failures and pending
administrator acceptance. Private receipts contain detailed verification evidence.
