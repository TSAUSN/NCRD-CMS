# Back up and recover content

Keep a matching database and media set, then verify recovery in isolation.

For: Maintainers and Super admins. Last checked: 2026-11-03.

A release recovery and an environment recovery solve different problems.
History restores a chosen saved version as a private draft; review and Publish
make it public. It retains later versions. For a coordinated site release, use
Publish → History → the release → Review recovery. It does not restore a lost
Postgres database, media files, provider credentials or DNS.

Before an app upgrade, migration or retained data change, capture a database
backup with all versions/access/reviews/audit/queue state, plus every media
object. Record the app commit, migration checksums, media size/hash inventory,
runtime configuration names and backup time. Store secrets and keys separately.
Use approved storage outside Git and disposable temporary directories.

The existing encrypted recovery commands are documented in
[Operations](../../operations.md#backup-and-restore). They use the migration
identity and a separate backup key. Key loss makes an encrypted backup
unrecoverable. A local verification can use a private custom `pg_dump` archive
and byte-verified media copy with a repeatable-read snapshot;
its exact procedure is in [Local staging](../hosting/local-staging.md).

Restore into a new empty database and independent media root. Verify all
application tables and immutable versions, not just public page counts. Check
ownership, RLS/grants, checksums, private/published pointers and content hashes.
Run only the public-site process against a restored review copy. Never start a
general worker there: retained schedules, email and domain jobs are real work
records even when restored into a different database. Local hostnames and
recording adapters do not make every queued job safe to replay.

A production recovery needs approved service repointing, authoring/job
coordination and reconciliation of writes since the backup. Resume the worker
only after the queue and duplicate-delivery risks are explicitly reviewed.
Verify both sites, media, sign-in/access, private drafts, history and scheduled
work, then observe health and worker silence alerts. Preserve the previous
instance and backup until the recovery is accepted.

Needs administrator input: backup destination/retention, key custody, recovery-point and
recovery-time targets, authorised operators and a hosted restore drill. The
local retained backup is on this machine; no remote durability or disaster
recovery service was established. The clean local restore passed; an actual
upgrade-and-step-back exercise remains post-acceptance work.

Migration 0200 makes direct collection validation respect the caller's existing
Media access. It changes no content, field format or write permission. Its
input-only URL checker becomes executable by the authenticated database role;
public and worker roles receive no new grant. Checked save/publication commands
and published-list rendering keep their existing context. Keep this Media
boundary when stepping back app code; do not restore elevated direct validation
without equivalent access checks.
