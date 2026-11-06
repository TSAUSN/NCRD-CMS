# ADR 0012 — Static public releases with a dynamic authoring service

Status: accepted architectural direction, 2026-11-02. Implementation deferred;
current dynamic routing remains active. Static-export implementation follows
the acceptance gates below. This ADR does not authorize hosting or domain changes.

## Context

The public service resolves a hostname through the public Postgres role, reads
published manifests and the shared shell, then renders with the same renderer
as preview. Revision-aware cache keys/ETags and an outbox invalidation path
protect publication. Private drafts and review tickets remain separate.

Public behavior includes more than HTML pages: Story query filters/search/
pagination, World View, chapter directories, governed media/files, redirects,
canonical addresses, sitemap/robots, expiry and scheduled releases. The current
catch-all route supplies search parameters to the renderer. Exporting only the
unfiltered homepage would remove working features. Forms also need an
application endpoint; private preview must remain authenticated and dynamic.

SPEC §12.3 recommends static public publication to keep sites available through
CMS outages. The target hosting context is the organisation-owned Google
project; provider setup and prices are not verified in this local run.

## Options

| Option | Cost drivers | Publication/cache | Jobs and domains | Failure/rollback |
| --- | --- | --- | --- | --- |
| Current dynamic public renderer behind the approved host | Public requests/compute, database connections, database service, media transfer/cache, worker, backups and builds. Cache hits can reduce work but do not prove a zero bill. | Existing exact-version release, ETag and invalidation path; request-time query behavior works today. | Current schedule/expiry worker and hostname resolver; provider DNS/HTTPS remain separate. | Uncached requests depend on the app and database. Use compatible app rollback or matching DB/media recovery. |
| Full rebuild of every public site on each change | Build/render/upload work scales with all pages/assets, even for one edit; static storage/transfer remains. | Simple immutable whole-release directory, but slow global rebuilds and an unnecessary cross-site failure scope. | Jobs rebuild everything; each domain needs a site-specific release mapping. | Visitors can keep the last release; a failed global build delays unrelated sites. |
| Incremental static release per site, shared renderer — chosen target | Changed-page render/build work, static file storage/transfer, release retention and invalidation; Admin/Postgres/worker/forms/auth still have costs. | Render pinned published dependencies; content hashes reuse unchanged assets; atomically switch one complete site release. | Existing reviewed schedule/expiry initiates exports; verified hostname maps to one site's release, never a default site. | Failed build/upload keeps the last complete release. Roll back the release pointer; align CMS publication state before the next publish. |

## Decision

Prepare an off-by-default local incremental exporter after the current timing
gate. Reuse the shared sanitizing renderer and governed resources; do not build
a second template system or inject private content in the browser. Preserve the
current dynamic public service until the static path proves parity and recovery.
The architectural recommendation is not a claim that an exporter exists.

A static release must contain only published, exact-version inputs: pages,
shared frame/theme/navigation/settings, published collections/stories, Data
values, chapter destinations, reviewed files, necessary media, redirects and
metadata. Record site ID, app revision, input version pins, dependency hashes
and an output file inventory. Never include authoring records, People, contact
routing secrets, unpublished media or private preview capabilities.

Use the existing release engine for authorisation, readiness, stale-version
checks and schedules. Stage all changed outputs first. Upload/content-address
assets, verify the complete inventory, then atomically activate the new site
release. A failed or partial export leaves the previous public release serving.
Do not report an externally activated release before its activation is known;
retain a retryable, idempotent publication outcome and visible failure state.
Coordinate the database publication pin and output activation explicitly;
Postgres and a hosting upload cannot share one transaction.

Invalidation is per-site and dependency-aware. A header/menu/theme/Data value/
collection change may affect many pages. An unchanged file is reused; an absent
page or expired item must be removed from the next complete inventory. The
active release pointer is the visibility boundary, not a sequence of writes to
live files. Short-lived HTML/revalidated release pointers and immutable hashed
assets avoid mixing new HTML with missing assets. Test stale caches and rollback.

Arbitrary Story search/query combinations cannot be enumerated as a finite set
of HTML files. Prove an approved published-only static index/client behavior,
or keep the required query route dynamic with explicit routing and cost scope.
Do not silently strip filters, pagination, no-JavaScript behavior or World View.
Forms/contact endpoints stay dynamic and tenant-scoped; acknowledgements must
not leak private responses into shared caches. Preview stays dynamic/authenticated.
This means the target is static where parity is proven, not a promise that every
public request immediately becomes independent of application services.

Scheduled publication and expiry must create and activate the same exact-version
release path, with the existing permissions/review/idempotency semantics. An
exporter cannot replace the scheduler or claim a deadline was met while showing
old content. Surface failure/retry and retain the last complete release. Media
revocation/deletion and reviewed-script CSP require tests, not a blanket cache.

Each verified hostname maps to exactly one site's active release. Preserve
canonical/alias redirects, original paths/query strings, staging noindex and
unknown-host404. Certificates/DNS are a separately authorised provider task.
Do not make new domains reachable merely by generating files.

## Cost and release gates

The verified spend for this work is local/$0. No current provider price, free
tier, billing eligibility or hosted cost total was checked. Static publication
can reduce public compute/database reads; it does not eliminate Postgres,
Admin/auth, worker/schedules, forms, storage/transfer, backups, monitoring or
build charges. Shared hosting across 5–10 sites needs measured page/asset sizes,
request/transfer scenarios, changed-file build counts and retention limits.
A dated provider-priced cost brief and approved caps remain prerequisites
before hosting; this ADR is not that cost brief or permission to enable billing.

Before enabling the exporter, prove locally: identical public output and query
behavior at the required widths; two sites/unknown-host isolation; private
content exclusion; only changed files updated; shared-dependency updates;
publication/scheduling/expiry; failed activation/retry; release rollback and
history alignment; cache/CSP/media safeguards; and static pages/assets serving
with the CMS/database unavailable. Keep dynamic exceptions explicitly listed.
Then rehearse the approved host and recovery separately after authorisation.

Static output rollback restores a prior immutable release, not authoring history.
To resume editing from that version, prepare/review the normal coordinated CMS
recovery so a later publish does not accidentally reintroduce the bad state.
Keep matching release inventories and media until retention allows removal.
Database rollback still follows the matching app/DB/media recovery plan.

## Reversal

Leave the feature off and continue the existing dynamic route. If later enabled,
repoint the site's reviewed routing to the dynamic renderer only after checking
its publication pins, assets, cache and canonical behavior. Retain all immutable
versions and output receipts. No migration or retained content rewrite is needed
to accept this architectural direction today.
