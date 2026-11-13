# Recover failed Hosting deliveries

For the Super admin and database operator. Prepared for review on November 13,
2026; production application and retry execution require approval.

A corrected provider permission does not resolve historical dead deliveries.
Migration `0211_hosting_delivery_recovery.sql` adds explicit, audited recovery
for `domain.sync` and `site.hosting_requested`. It is independent of the pending
Analytics migration 0210; reconcile migration numbering and regenerate the SQL
reference when combining branches.

## What changes

- An append-only private `app.hosting_retry_receipts` table links original
  failures to retry deliveries and records the requesting user, time and target.
- `app.retry_hosting_delivery(failed_reference)` requires an active Super admin.
  It validates the current active site/domain and queues one pinned retry for
  up to 500 matching failures. Repeated/concurrent requests reuse eligible work.
- The worker's existing job readers validate the recovery target before provider
  work. A moved address, changed domain revision or archived/removed target is
  refused. Ordinary existing jobs retain their existing behavior.
- Active failure counts exclude a linked failure only after matching work is
  delivered for the still-current target. Domains also require a fresh stored
  provider result with DNS records. Waiting for DNS ownership is an expected
  connection state; a recorded provider error is not a successful recovery.

Applying the migration creates no retries and changes no existing content,
access, publication, audit or delivery rows. The migration runner adds its normal
checksum entry. Original failed rows retain their status, error, attempts,
payload and timestamps. Later explicit retries create new outbox, receipt and
audit rows; a failed retry leaves the issue unresolved. Unrelated job types and
the existing section-preview recovery rules remain unchanged.

## Local verification

Use only disposable databases with synthetic fixtures. Test the upgrade from
0209 with a published page, a newer private draft, people/site access, domains,
audit records and failed Hosting work. Compare every preexisting application
table's canonical row hash before/after, preserve all prior function owners and
execute grants, and run the migration runner twice. The schema suite also checks
the complete generated SQL reference, tenancy, publication and authorization.
Worker tests use recording/fake providers; they never contact Firebase or DNS.

```sh
TEST_DATABASE_URL=postgres://cms:cms@127.0.0.1:54329/postgres pnpm --filter @cms/schema test:db
TEST_DATABASE_URL=postgres://cms:cms@127.0.0.1:54329/postgres pnpm --filter worker test:db
```

## Approval and operator sequence

1. Review the exact migration and test results. Inventory all live dead deliveries
   read-only through the existing operator connection, including rows beyond the
   CMS's 100-row view. Do not assume all 126 recorded failures have the same cause.
2. Confirm the precise project/database, candidate commit and migration ledger;
   verify the existing backup procedure and preserve the previous image digests.
   Finish editing and coordinate the approved database/application upgrade using
   [Ship an update](ship-an-update.md). Never rerun the installation bootstrap.
3. Apply the new file through the checksum-aware migration runner, then verify
   existing data and the initially empty receipts table before any retries.
   Do not paste the file directly into a SQL editor outside the migration ledger.
4. The current Cloud Build trigger compares migration **files in the serving
   image** against the new source. Applying SQL alone does not change that image
   comparison. Keep the guard intact and prepare an operator-reviewed compatible
   image rollout; repeatedly rerunning the same rejected build is insufficient.
5. For each reviewed target, call the narrow command in an authenticated CMS
   Super admin transaction:

   ```sql
   SELECT * FROM app.retry_hosting_delivery(REVIEWED_FAILED_REFERENCE);
   ```

   The returned `retry_id`, `retry_status` and `linked_failures` are the recovery
   receipt. Do not invent a product identity or run a general drain against
   retained data. The normal worker performs this new work. No UI retry button
   is introduced by this migration.
6. Observe each retry and retained original, then check the CMS, native Hosting
   status, current failure counts and a healthy worker report. An unsuccessful
   or changed-target retry remains visible for inspection. DNS records and final
   HTTPS activation still require their existing domain-owner process.

No IAM, billing, DNS, alert-policy, Supabase or public-site cutover change is part
of this migration. Backups and live recovery execution have not been performed
by local validation. Existing content and the production queue remain untouched.

## If verification fails

Stop requesting retries and retain all failures, receipts and backups. The
migration runner rolls back a failed application transaction. Do not delete or
rewrite an applied migration, receipt or old failure to make a check pass. A
post-application behavior correction uses a new reviewed forward migration;
application rollback uses only a schema-compatible image. A database restore is
a separate recovery operation and is not the normal way to undo this change.
