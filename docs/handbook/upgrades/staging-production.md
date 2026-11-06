# Review and upgrade an environment

Promote one tested revision while preserving content, permissions and recovery.

For: Maintainers and environment owners. Last checked: 2026-11-02.

The local clean-install/restore procedure is verified in
[Local staging](../hosting/local-staging.md). Hosted Staging/Production and the
GitHub promotion flow below remain a plan. No hosted setup or downgrade was
performed. Environments/Handbook product screens remain later continuation work.

## Review and promotion plan

1. Develop on an isolated feature branch. Review the diff, touched migrations,
   content compatibility, permission changes and handbook instructions in a PR.
   Use the repository’s approved branch/review policy and CI budget. Deployment
   requires a separate administrator-controlled operation.
2. Tag or record the exact reviewed revision and locked dependencies. Install
   cleanly; run relevant types, units, database policies and affected browser
   journeys within machine limits. A green historical run is not new evidence.
3. Back up Staging's database and complete media before the change. Verify an
   isolated restore. Record the app revision, migration checksums, runtime
   configuration names and recovery point; keep secrets separately.
4. Apply forward migrations once as the migration identity, then start the new
   apps with their existing separate runtime identities. Check own-site/public
   routing, drafts/history, real roles, uploads/media, schedules and monitoring.
   Keep real mail and domain work disabled in Staging until separately approved.
5. Review receipts and administrator prerequisites before scheduling Production. After
   approval, take a fresh Production backup, apply the same tested revision and
   migrations, and perform a bounded smoke check. Require the reviewed acceptance gates before merge or publication. No such promotion is authorised by this guide.

## Database constraints

Migrations are forward-only SQL with recorded checksums. Never edit an applied
migration, drop retained content or grant a broad role to bypass an error.
The existing Postgres ownership preflight gives the NOLOGIN migration owner its
schema privileges; the migrator needs the documented role capabilities.
Runtime apps never use that migrator connection.

An additive migration does not prove an older app can safely write newer data.
Check readers, command signatures, saved fields, manifests, scheduled actions
and release/recovery versions before calling an upgrade reversible. Preserve
unknown fields. Newer Story, Settings and Data values formats have their own
[compatibility guides](data-values.md); consult those and their linked topics.

If old and new apps cannot coexist, use a maintenance window with authoring and
job writes stopped, migrate once, and start a matching set. Do not run two
workers against copies of the same queue or share database/media paths between
environments. A worker on a recovered queue can repeat real deliveries.

## Step back plan

For a faulty app with a proven compatible schema, stop its writes/jobs and use
the last reviewed compatible app revision and configuration. Recheck all roles
and pending schedules before resuming jobs. Merely checking out an older Git
commit does not undo migrations or restore content.

For an incompatible database change, use a tested forward correction or restore
the pre-change database **and its matching media** into a new empty environment.
Validate pages, private heads, all history, access and publication before
repointing services. Writes after that backup need explicit reconciliation;
report the recovery-point loss rather than silently discarding them. Keep the
failed environment for investigation, subject to retention/access policy.

[Backups and recovery](backup-recovery.md) describes the gate. An actual
upgrade-then-step-back drill using only these instructions is still unrun; it
remains a separate operations acceptance item. Local restore alone
does not close that item or prove hosted recovery time.
