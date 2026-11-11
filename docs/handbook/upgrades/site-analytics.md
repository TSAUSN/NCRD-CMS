# Deploy per-site GA4 settings

For the Google project administrator and database operator.

1. Review migration `0210_site_google_analytics.sql` and the matching code. It
   adds an optional typed Analytics block through the existing settings
   validator. It changes no stored settings, published page or role grants.
2. Back up database/media through the approved operator configuration and
   record the current app digest and migration receipt. Confirm the intended
   organization project, database and operator identity. Verify the active CMS
   content database from the serving runtime configuration; the Supabase Auth
   project is not evidence of the content database location.
3. Apply migrations through the existing checksum-verifying migration runner,
   using the approved database-owner connection. Do not apply files from
   `packages/schema/current`; they are reading references only.
4. Deploy the matching reviewed application through the existing administrator
   release procedure (`scripts/deploy-google-release.sh`) after verifying the
   migration receipt. The normal Cloud Build guard compares migration files in
   the serving image with the candidate, rather than querying the database
   ledger. Applying SQL and retrying that trigger alone will still stop.

   For the first schema-changing rollout, the operator uses the approved
   existing project, service, image, source-bucket and builder configuration.
   Set `CMS_DEPLOY_SCHEMA_REF` to the full reviewed candidate commit only after
   its database migrations are confirmed applied. Run the script's `plan`,
   `build` and `deploy` modes for that same commit and a private receipt
   directory, following the reviewed release runbook. Do not guess resource
   names or disable the Cloud Build guard. Coordinate the main merge with this
   operator rollout; a push by itself does not complete this release. Once the
   serving image contains the matching migration set, normal automatic builds
   can resume.
5. Confirm `/health` matches the deployed commit. As an Admin, verify the new
   Settings → Analytics fields on the intended site. As a restricted editor,
   confirm configuration access remains denied.
6. Jon supplies the approved per-site `G-…` IDs. Save a draft, inspect its
   Publish comparison, and deliberately enable the intended host class.
7. On the real included hostname, verify the Google tag loads under CSP and
   the correct property's Realtime shows the visit. Confirm another site's
   ID and all private preview documents remain excluded. Do not enable
   tracking or claim event delivery until the property exists and this passes.

To stop collection, disable tracking through the normal settings draft and
publication. Before rolling back to an older application that rejects the
Analytics field, restore a compatible settings version through the reviewed
recovery flow as well. Merely disabling tracking leaves the optional field in
the saved JSON and does not make an old strict parser compatible. Preserve
subsequent unrelated settings during any recovery.

Reports inside the CMS remain phase two. The property owner and hosting
operator will need to enable the Analytics Data API and authorize scoped
read access; no Google credentials or new account permissions are created by
this first phase.
