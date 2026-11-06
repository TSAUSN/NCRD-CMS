# V1 source migration

**Where it stands (October 10):** HNI's four pages and Echelon's page were
migrated with the commands below, corrected until they matched V1 at every V1
breakpoint (the remaining differences are decisions D1–E3 in
[decisions.md](decisions.md)), and exported as the demo archives in
[`demo/sites`](../demo/sites). A real cutover repeats the migration from a fresh
V1 backup taken at the content freeze.

The importer now reads the native JSON backup produced by V1's
`tsa-cms-admin/scripts/backup-firestore.mjs`, preserves every document and empty
parent, and creates private HNI/Echelon reference drafts through the V2 command
boundary. It never connects to Firebase, evaluates V1 JavaScript, publishes a
page, or activates a V1 account.

This is a working migration/review path, not completed visual cutover. The
reference drafts make preserved content inspectable in V2 while source-specific
styles, interactive features, documents, and fonts are reviewed explicitly.

## Verified historical source

The available backup is dated **2026-07-30T17:16:03.968Z**. Its native manifest
reconciles to 45 documents and 3 fieldless parents. The source package also
contains 118 catalogue definitions and 52 site source files, and inventories
70 public assets by byte count and SHA-256. Original source and personal data
stay in the explicitly requested private package and the super-admin-only
database journal. Checked-in reports contain counts, source paths, hashes,
mapping findings, and synthetic local test identities.

The real historical import creates:

- 14 private reference pages across HNI and Echelon, retaining HNI's saved draft
  and published states as separate immutable source snapshots;
- 218 immutable source records, including unsupported and unrelated test-site
  records that must be retained without being mistaken for migrated HNI pages;
- 10 inspected images, 30 responsive variants, and 17 indexed page usages;
- all 9 release-note entries in the V2 audit log with `actor_type=migration`,
  immutable source-record references, original action and timestamp provenance;
- no published pages and no activated V1 users.

A second import of the same package creates no duplicate pages, records, media,
or audit entries. The real run re-read its source manifest afterward and proved
that every source hash was unchanged. Exact run/database references and counts
were recorded in the run's runtime report; section coverage and
cutover findings were recorded with the September evidence (in git history
before October 10).

The later hands-on visual review corrected source palette/utility scoping, excessive stylesheet payload, mobile
overflow and inaccessible static disclosure copy through new checkpoints. It
also verifies source-image rendering and a persisted hide/show cycle. Available
V1 build stylesheets are now read as additional hashed inputs; the original
import's recorded source manifest and earlier versions remain unchanged.

## Operator commands

Use Node 24 and the repository's pinned pnpm. Supply the V1 checkout and an
explicit backup directory; the importer never guesses which backup is current.
The private package contains source content and account/history records. Keep
it outside the repository and in the same protected storage as the backup.

```sh
pnpm --filter @cms/importer run migration prepare \
  --v1 "$V1_ROOT" --backup "$V1_BACKUP_ROOT" \
  --out "$V1_REPORT_DIR" --package "$V1_PRIVATE_DIR/source-package.json"
```

`prepare` performs no database or storage writes. With neither output option it
prints the provenance report only. Private package files are created with mode
`0600` and cannot be overwritten with different content. Source path traversal,
symlink escapes, missing records, duplicate collections, and count mismatches
are refused. Output directories must be outside the V1 and backup roots.

Apply migrations, provision an existing V2 super admin, and set
`IMPORT_DATABASE_URL` to the authenticated application-role connection for the
intended isolated destination. `IMPORT_ACTOR_ID` is that V2 user's UUID; V1
roles never confer import authority. Use the destination's configured media
directory, shared by its admin, site, and worker processes.

```sh
pnpm --filter @cms/importer run migration drafts \
  --v1 "$V1_ROOT" --backup "$V1_BACKUP_ROOT" \
  --prefix hni-review --staging-apex staging.example.test \
  --media-root "$V1_MEDIA_ROOT"

pnpm --filter @cms/importer run migration status --run "$V1_RUN_UUID"
```

The returned `runId` from `drafts` is the database journal UUID. The 64-character
run ID in the preparation report identifies the source/mapping package. Changing
the source or mapping creates a new package identity. Reusing a database import
identity with different data is refused.

Database records, definitions, pages, usage, and audit writes share one
transaction. The storage contract uses immutable keys and verifies every stored
object's hash. A failed transaction can leave unreferenced storage objects;
retain them for safe retry and remove them only after reconciling object keys
against database media records. A retry must not delete objects that another
successful attempt may reference.

## Content and media decisions

The static compatibility path keeps authored HTML rather than flattening the
content into the smaller typed-node vocabulary. It preserves saved text/rich
text, links and link intent, images, visibility, and safe SVG icon sizing. V1's
derived button styles are correctly treated as editor defaults. Content epochs
and shape guards keep stale saved HTML from replacing a newer authored
structure. V1 editor markers are namespaced so they cannot shadow V2's numeric
canvas section markers. Counts exclude fields with unresolved mappings.

HNI's 22 section positions in each source state and Echelon's 9 native section
positions now have visible reference representations. Form controls are
disabled, embedded frames become labelled references, and animation-only hidden
content is shown in its static state. Those are recorded behavior differences,
not functional parity. Unconvertible source remains in the journal with a
visible review notice; a missing section is never silently omitted.

Images are read only from the frozen manifest, decoded by the same bounded
image processor as ordinary uploads, normalized to strip metadata, and given
thumbnail/card/wide variants. Source and normalized hashes remain distinct.
`src`, `srcset`, and CSS image URLs are remapped to governed V2 media routes;
explicit page values retain media usage so deletion checks and public delivery
use the normal policy. Authored alt text or explicit empty-alt intent supplies
Media metadata. An unused image without that evidence is deferred rather than
given an invented description. PDFs, fonts, icons in unsupported file formats,
and runtime files are inventoried but are not represented as ready image media.
The runtime report names these outstanding assets. Internal page URLs are
remapped to the corresponding source-state reference page when one exists.

## Review and publication

Migration 0069 adds an exact-version gate on the actual page publication
pointer. Passive markup cannot fake the trusted-code flag; instead, **every
imported reference page requires a super admin's mapped-source decision for the
exact version being published**. A newer draft requires another review. The
gate applies to every publication path, including releases and schedules.

```sh
pnpm --filter @cms/importer run migration review \
  --record "$V1_RECORD_UUID" --revision 0 --disposition mapped \
  --target "$V2_REVIEWED_VERSION_UUID" \
  --note 'Reviewed the saved source and resolved the recorded differences.' \
  --evidence 'migration-review/report-and-browser-evidence' \
  --request "$V1_REVIEW_REQUEST_UUID"
```

`needs_review`, `mapped`, and `exception` are immutable, revision-checked review
decisions. `mapped` requires an existing immutable V2 page version. An exception
records an acknowledged gap and does not bypass the reference publication gate.
Review does not itself publish anything. V1's role mapping is explicit:
`content_creator → contributor`, `editor → editor`, `admin → site_admin`, and
`super_admin → super_admin`; all identity and site-assignment activation remains
a separate reviewed operation.

## Validation and remaining cutover work

The dedicated database suite tests import, replay, rollback, role isolation,
immutable history, review CAS, exact-version publication, real image bytes,
responsive variants, source changes, URL remapping, and usage indexing. The
schema drift suite checks the new tables and authorization declarations. Unit
tests cover the native backup reader, static conversion, V1 field semantics,
inert references, URL rewriting, and the actual read-only catalogue.

```sh
pnpm --filter @cms/importer test
pnpm --filter @cms/schema test:db -- test/v1-migration.db.test.ts test/drift.db.test.ts
```

Before cutover, obtain a fresh backup at the agreed content freeze; resolve the
specific fonts/PDFs, native interactions, section settings, and stylesheet
findings; review HNI and Echelon through desktop/mobile browser comparisons;
reconcile identities and every remaining source record; then complete the
separate recovery/DNS/rollback and named-owner cutover checks. The historical
source package proves preservation and repeatable import. It cannot establish
that July's state is the current production state.
