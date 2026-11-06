# Ship a tested update

For maintainers and the Google project administrator. First installations follow
[bootstrap](../hosting/bootstrap.md) and [Friday go-live](../hosting/friday-go-live.md).
The personal review identifiers are kept in [review-environment.md](../hosting/review-environment.md).

## 1. Check the change locally

Use a dedicated checkout, Node 24 and the pinned pnpm version:

```bash
cd /ABSOLUTE/PATH/TO/CHECKOUT
pnpm install --frozen-lockfile
pnpm check:node
pnpm typecheck
pnpm lint:styles
pnpm test
pnpm --filter admin --filter site build
```

Run database and focused browser tests appropriate to the change. Tests may reset
only explicitly disposable databases. Back up a disposable fixture before a reset
if it contains evidence to retain. Keep the retained demo and its build unchanged.
Use the isolated ports in [refactor gates](../maintainers/refactor-gates.md).
Never weaken assertions, increase timeouts to conceal failures or omit required cases.

## 2. Review and commit

Exclude dumps, credentials, private manifests and test screenshots. Configure the
actual contributor identity locally; the values below are placeholders:

```bash
git diff --cached
git -c user.name='YOUR NAME' -c user.email='YOUR_EMAIL' \
  commit -m 'Describe the verified change [skip ci]'
```

Push only the branch or release refs authorized for the target repository. An
uncommitted change is absent from an immutable Git source archive. Preserve
normal commit authorship without an attribution trailer.

## 3. Confirm the target and back up

```bash
TASK_ACCOUNT=AUTHORIZED_OPERATOR_EMAIL
TASK_PROJECT=REVIEWED_PROJECT_ID
TASK_REGION=us-central1
test "$(gcloud config get-value account)" = "$TASK_ACCOUNT"
test "$(gcloud config get-value project)" = "$TASK_PROJECT"
test "$(gcloud auth list --filter=status:ACTIVE --format='value(account)')" = "$TASK_ACCOUNT"
```

Repeat these checks before every cloud operation, with explicit account/project
flags. For organization deployments the Google project administrator runs the
commands. Back up database and media through the private operator configuration;
verify the migration checksum receipt and use only forward migrations.

## 4. Build an immutable image

Set the target project's reviewed build-source bucket and dedicated builder
identity. They are provisioned by bootstrap; do not use another project's values.

```bash
TASK_REVISION=$(git rev-parse HEAD)
TASK_ARCHIVE=/ABSOLUTE/PRIVATE/source.tar.gz
TASK_SOURCE_BUCKET=REVIEWED_BUILD_SOURCE_BUCKET
TASK_BUILDER=REVIEWED_BUILDER_SERVICE_ACCOUNT_EMAIL
git archive --format=tar.gz --output="$TASK_ARCHIVE" HEAD
gcloud builds submit "$TASK_ARCHIVE" --config=deploy/google/cloudbuild.yaml \
  --gcs-source-staging-dir="gs://$TASK_SOURCE_BUCKET/submissions" \
  --service-account="projects/$TASK_PROJECT/serviceAccounts/$TASK_BUILDER" \
  --substitutions="_REVISION=$TASK_REVISION,_POSTGRES_MAJOR=16" \
  --account="$TASK_ACCOUNT" --project="$TASK_PROJECT" --async --format=json
```

Wait for build SUCCESS, verify the revision and pin its exact image digest. Retain
the previous app/recovery digests with protected deployment tags before replacing images.

## 5. Deploy and verify

Finish saves and close editing tabs. Preserve current service manifests privately.
Prepare replacement manifests with the exact digest; preserve runtime identities,
Cloud SQL socket, private storage, Supabase settings, limits and budget controls.
Never enable local-test sign-in in a hosted manifest.

```bash
gcloud run services replace /PRIVATE/cloud-run/site.yaml \
  --region="$TASK_REGION" --account="$TASK_ACCOUNT" --project="$TASK_PROJECT"
gcloud run services replace /PRIVATE/cloud-run/admin.yaml \
  --region="$TASK_REGION" --account="$TASK_ACCOUNT" --project="$TASK_PROJECT"
gcloud run services replace /PRIVATE/cloud-run/worker.yaml \
  --region="$TASK_REGION" --account="$TASK_ACCOUNT" --project="$TASK_PROJECT"
```

Require Ready, expected health/version/digest and a fresh worker heartbeat. Check
ordinary-browser sign-in, save/reload, preview, publish, scheduling and changed
flows. Inspect public output at 1440/390 and authoring at 1440/1024. Confirm host,
media and role isolation. Verify backup completion and notification delivery;
creating Scheduler jobs alone does not establish readiness.

## 6. Recover safely

Select the retained compatible image digests and corresponding private manifests.
Verify the target, replace Site/Admin/Worker sequentially and repeat acceptance.
Application rollback does not reverse SQL migrations. Restore broader data damage
to a separate empty database; do not overwrite the active database. Editorial
History restoration creates a new draft that must be reviewed and published.
Infrastructure removal, provider changes and DNS work need separate authorization.
