# Back up and prepare a hosted content copy

Restore an isolated copy, clean its access records, and compare its public content before hosting.

For: Maintainers and Super admins. Last checked: November 4, 2026.

Use Node 24, pnpm 11.22.0 and PostgreSQL 16 tools. For this review, build, test and
serve only from `/ABSOLUTE/PATH/TO/CHECKOUT`, using 3200/3201. The retained
installation stays on admin 3000, site 3001 and PostgreSQL 54329 with its existing
build and configuration. Never rebuild its main checkout or run `pnpm demo --reset`.
For a new seeded installation, use [Local demo](local-demo.md). For the verified
Google restore and deployment, use [Go live](go-live.md).

## Keep a consistent private backup

1. Read the running retained installation's configuration to identify its actual
   database and media folder. Do not assume an old `/tmp` media folder is current.
   Set `TASK_SOURCE_MEDIA` to that verified local directory.
2. Choose a new, empty backup directory outside Git and temporary folders. Keep
   directories mode 700, files mode 600, and credentials separately. A same-machine
   backup does not establish off-machine disaster recovery.
3. Keep a read-only, repeatable-read transaction open while dumping the database.
   Its exported snapshot makes the database dump and table fingerprints agree,
   even while the retained worker maintains its normal heartbeat.

   ```sql
   BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
   SELECT pg_export_snapshot();
   ```

4. In another terminal, use the returned identifier literally:

   ```bash
   set -e
   umask 077
   TASK_BACKUP_ROOT=/ABSOLUTE/PRIVATE/NEW-EMPTY-BACKUP
   TASK_SOURCE_MEDIA=/ABSOLUTE/PRIVATE/retained-media
   TASK_SNAPSHOT_ID=THE_IDENTIFIER_RETURNED_ABOVE
   mkdir "$TASK_BACKUP_ROOT"
   pg_dump --dbname=postgres://cms:cms@127.0.0.1:54329/cms_demo \
     --format=custom --snapshot="$TASK_SNAPSHOT_ID" \
     --file="$TASK_BACKUP_ROOT/retained.dump"
   pg_restore --list "$TASK_BACKUP_ROOT/retained.dump" > "$TASK_BACKUP_ROOT/archive-list.txt"
   ```

5. From that same open snapshot, record application table counts and stable row
   fingerprints, including versions, public projections, access, audit, releases
   and queues. Sort each table’s `to_jsonb(row)::text` lines using `COLLATE "C"`
   and hash them with SHA-256. Keep the fingerprint receipt privately. End
   the snapshot transaction with `COMMIT` only after the dump and receipts finish.
6. Copy media and compare the complete inventory before and after copying. Pause
   authoring/uploads during this operation, or prove the source inventory stayed
   stable; a database transaction cannot freeze filesystem writes.

   ```bash
   mkdir "$TASK_BACKUP_ROOT/media"
   cp -R "$TASK_SOURCE_MEDIA/." "$TASK_BACKUP_ROOT/media/"
   (cd "$TASK_SOURCE_MEDIA" && find . -type f -exec shasum -a 256 {} + | LC_ALL=C sort) > "$TASK_BACKUP_ROOT/media-source.sha256"
   (cd "$TASK_BACKUP_ROOT/media" && find . -type f -exec shasum -a 256 {} + | LC_ALL=C sort) > "$TASK_BACKUP_ROOT/media-copy.sha256"
   cmp "$TASK_BACKUP_ROOT/media-source.sha256" "$TASK_BACKUP_ROOT/media-copy.sha256"
   ```

7. Verify that every database-referenced original and variant exists in the copied
   media. A folder checksum match alone can faithfully copy an incomplete source.
   Keep database and media together; neither alone restores the site.

Select the checksum-verified backup from the private handoff and compare its
referenced-media inventory with the complete source/copy inventories. Reject
partial backups, obsolete media roots and folders marked `DO-NOT-RESTORE.md`.

## Prepare the maintainer-review hosted copy

1. Create a **new empty** local database named `cms_hosting_...` on loopback 54329.
   An existing target must make this operation fail. Do not reuse or clean it.

   ```bash
   createdb --maintenance-db=postgres://cms:cms@127.0.0.1:54329/postgres \
     --template=template0 cms_hosting_20261104
   pg_restore --dbname=postgres://cms:cms@127.0.0.1:54329/cms_hosting_20261104 \
     --exit-on-error "$TASK_BACKUP_ROOT/retained.dump"
   cd /ABSOLUTE/PATH/TO/CHECKOUT
   DATABASE_URL=postgres://cms:cms@127.0.0.1:54329/cms_hosting_20261104 pnpm db:migrate
   ```

   This local restore preserves its existing role grants/ownership in the same
   cluster. Do not bootstrap or rotate the retained cluster's runtime roles.
   Cloud SQL needs its own migration owner and restricted logins; its complete
   `--no-owner --role=cms_migration_owner` restore is documented separately in
   [Go live](friday-go-live.md#5-restore-verify-media-build-and-deploy).

2. Compare restored table fingerprints with the exported source snapshot before
   cleanup. Copy verified backup media into a fresh rehearsal media folder.
   Never point a worker at this local rehearsal database.
3. Run the guarded cleanup from the verification checkout. Supply the maintainer email
   and name; the last argument is another new private backup folder outside Git
   and `/tmp`:

   ```bash
   node scripts/prepare-hosted-copy.mjs \
     postgres://cms:cms@127.0.0.1:54329/cms_hosting_20261104 \
     "$TASK_OWNER_EMAIL" "$TASK_OWNER_NAME" "$TASK_COPY_BACKUP_ROOT"
   ```

   The script dumps before its transaction. It accepts only loopback 54329 and a
   `cms_hosting_*` database, requires the five expected sites, and refuses retained,
   test and cloud targets. It archives `bt2027-r8` and `hni` using the normal
   archive command, keeping `sawso`, `echelon-chapters` and `echelon` active.
   The existing demo Super admin becomes the configured Super admin while preserving
   its ID and historical references. Unused bracketed/sample and `example.test`
   access accounts are removed. Historical references to another sample account
   make cleanup roll back; authorship is never rewritten to force a pass.

   Private preview tickets are cleared. Existing domains or pending schedules
   make cleanup refuse the copy. Kept pages, versions, chapters, stories and public
   projections must match exactly before commit. Echelon sample content/photos
   and Join-us are untouched. No email or provider operation occurs.
4. Keep the cleanup JSON receipt and export the cleaned database again. To undo
   cleanup, restore its pre-cleanup dump into **another fresh local database**,
   never over the retained demo.

## Compare the public copy

Wait until other verification browser runs have released 3201. Build only the
verification checkout, then serve only the restored public app:

```bash
pnpm --filter admin --filter site build
CMS_LOCAL_TEST_MODE=true \
DATABASE_URL_PUBLIC=postgres://cms_site_app:devpassword@127.0.0.1:54329/cms_hosting_20261104 \
MEDIA_PROVIDER=filesystem MEDIA_ROOT="$TASK_REHEARSAL_MEDIA" \
NODE_ENV=production TRUST_PROXY_HEADERS=false \
pnpm --filter site start --hostname 127.0.0.1 --port 3201
```

The existing local font route needs local-test mode and a loopback hostname.
Never carry `CMS_LOCAL_TEST_MODE` into hosted configuration. Hosted font delivery
has its own explicit licence opt-in.

Request each kept site's actual `.staging.localhost` host at both ports. Enumerate
all paths using `public_api.site_routes(hostname)` as the restricted public login,
then compare rendered responses and referenced local image/font/CSS/script bytes,
including recursively referenced CSS assets. Never follow external/live-site
links to perform this comparison. For example:

```bash
curl --fail --silent --show-error -H 'Host: sawso.staging.localhost:3201' \
  http://127.0.0.1:3201/ > "$TASK_BACKUP_ROOT/sawso-copy.html"
curl --fail --silent --show-error -H 'Host: sawso.staging.localhost:3001' \
  http://127.0.0.1:3001/ > "$TASK_BACKUP_ROOT/sawso-retained.html"
cmp "$TASK_BACKUP_ROOT/sawso-copy.html" "$TASK_BACKUP_ROOT/sawso-retained.html"
```

Check unknown hosts, unpublished annual-report pages and foreign media requests
return 404. Inspect kept public pages at 1440 and 390 for missing images and
horizontal overflow. Stop only the isolated public process afterward and confirm
retained 3000/3001 still answer.

Require all 75 kept public paths and 121 referenced assets to match the selected
baseline byte for byte. Later renderer bug
fixes (such as native FAQ disclosure) intentionally improve behavior without
rewriting stored source; record those differences instead of claiming unchanged
HTML after a code update. Hosted status/asset and tenant-isolation checks are a
separate step. This rehearsal does not prove hosted sign-in, scheduling, capacity,
billing, off-machine restore or a future domain cutover.
