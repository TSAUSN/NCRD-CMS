# ADR 0003 — Postgres-native background execution

**Status:** accepted · **Date:** 2026-08-21 · **Milestone:** M0
**Decides:** SPEC §11 open question 2 · **Reflected in:** SPEC §3 (Jobs), §11.2

## Decision

Background work runs Postgres-natively on the two tables SPEC §5 already
specifies:

- **`outbox`** — events written in the *same transaction* as the change that
  caused them, then delivered at-least-once.
- **`scheduled_actions`** — the business record of a pinned item, action,
  version, run time, and creator, leased and executed once.

Both are processed by the same handlers, invoked either by the long-running
`worker` role or by the monitored one-shot `jobs:drain` command. There is one
business implementation and one execution transport.

This is the official job architecture for V2. It is not a placeholder.

## Why not a job library

The two tables are not a lightweight stand-in for a queue; they *are* a durable
Postgres queue, and one of them has to exist regardless. The outbox pattern's
whole value is that the event commits atomically with the state change it
describes — a publication and its cache-invalidation event either both exist or
neither does. That property comes from being in the same transaction as the
publish, which an external queue cannot provide.

Adding a job library alongside them would mean two claim mechanisms, two retry
policies, two dead-letter concepts, and two places to look when a job did not
run. That is the outcome the standing rule against two implementations of job
execution exists to prevent.

## When to reconsider

A dedicated library — pg-boss or otherwise — is an **optional future
replacement**, not a scheduled migration. Adopting one requires a new ADR and
at least one demonstrated requirement the native queue cannot meet:

- recurring cron schedules managed by the product (not by infrastructure)
- job dependencies or multi-step workflows
- per-tenant concurrency limits, throttling, or priorities
- substantially better job retention and operational tooling than we are willing
  to build and maintain ourselves
- evidence that maintaining the native queue has become unreliable or costly

None of these apply to M0–M4's job types, which are: invalidate a cache entry,
and publish a pinned version at a time.

## If it is ever adopted

It becomes the **sole** execution transport. `scheduled_actions` may remain as
the business/domain record — it is what the product shows, audits, and cancels —
but it must then hold a reference to the enqueued job rather than also carrying
`leased_by`/`leased_until` and being claimed directly. Two competing transports
is not an acceptable end state, including as a migration step longer than one
release.

## What the native implementation guarantees

Hardened in migrations `0007_job_hardening.sql`, `0009_lease_tokens.sql` and
`0010_lease_secrecy_and_readiness.sql`, and in `apps/worker/src/handlers.ts`;
proved in `apps/worker/test/*.db.test.ts`:

| Property | How |
|---|---|
| One claimant per row | `FOR UPDATE SKIP LOCKED` plus `leased_by`/`leased_until` in a short claim transaction |
| No transaction held across external I/O | Claim, process outside the transaction, settle — three separate short transactions |
| Failures back off | `next_attempt_at` with exponential backoff and jitter; a failed row is not re-selected immediately |
| Poison events cannot starve the queue | `max_attempts` and a terminal `dead` state; a dead row leaves the ready set |
| Crash safety | A crash between the external action and settlement leaves the lease to expire and the row to be retried — handlers are required to be idempotent |
| Expired leases are reclaimable, active ones are not | The claim predicate takes rows whose lease has lapsed; `settle_outbox` refuses a caller that does not hold the lease |
| A worker cannot act on another's row | Authorization is a lease **capability**, not an identity: the claim mints an unguessable token and returns it to the claimant alone. Every worker shares one database role, so a self-asserted worker id authorizes nothing (0009) |
| The capability is secret, not merely unguessable | Only a SHA-256 digest is stored, and neither queue table grants any application role a table-level SELECT — so the token cannot be read out of the row it protects, and a column added later is not silently granted (0010) |
| A token is spent on use | The digest is cleared on every delivered, dead, retry, succeeded, failed, and blocked transition, so a settlement cannot be replayed |
| No row is stranded by a duplicate claim | `claim_outbox` takes an exclusion list, so a drain pass never leases an event it has already delivered and then has to abandon it |
| Permanent vs transient failure | Domain SQLSTATEs (`CMS01`–`CMS05`) fail closed immediately; infrastructure errors retry with bounded backoff |
| Operational visibility | `app.job_queue_health()` reports pending, oldest pending age, retrying, dead, and stale-heartbeat counts |

## Consequences

- Every handler must be idempotent, because delivery is at-least-once. The
  convention is documented in `apps/worker/src/handlers.ts`: a handler either
  performs a naturally repeatable action (cache invalidation) or checks a
  durable marker before acting. Publication is deliberately not in the first
  category — it advances a revision, appends audit, and emits an event — which
  is why a scheduled publish executes and settles in one transaction rather than
  relying on repetition being harmless.
- A scheduled publish evaluates readiness before that transaction, through the
  same `evaluateVersionReadiness` the editor uses, against the immutable pinned
  version. The database then checks what it can check: that a report was
  supplied at all, that its policy version matches the one the schedule pinned,
  that every finding is well formed, and that declared blocking findings are
  refused without an override reason. What it cannot check is that those
  findings are the ones the evaluator would produce — rendering a page is not
  something SQL does — so the guarantee is that every supported publication
  surface runs the shared evaluator and the database refuses anything that
  surface could not have produced, not that the database recomputed the verdict
  (SPEC §6.8, threat model §7a).
- Dead-lettered events need an operator surface. `app.job_queue_health()` and
  the admin dashboard's job panel cover visibility; requeueing a dead event is
  an M5 operator action.
- Backoff means an invalidation can lag a publish by up to the retry window.
  That is acceptable because public cache keys include the published revision,
  so a stale entry is unreachable rather than wrong (ADR 0002).
