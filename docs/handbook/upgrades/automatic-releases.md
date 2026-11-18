# How CMS code releases reach Google Cloud

## Active production path

NCRD production deploys through Google Cloud Build trigger `ncrd-cms-deploy`.
A reviewed push to `main` without `[skip ci]` can start the production build.
The build uses `deploy/google/cloudbuild-deploy.yaml`. Its migration guard
compares the candidate migration set with the serving image. A schema-changing
release follows the reviewed migration procedure before deployment is retried.
Admin and Site `/health` report the serving commit. The Worker remains private.

[Production overview](../../production.md) records the live release. The
[deployment decision](../../decisions.md#production-deploys-through-a-cloud-build-trigger--november-9-2026)
explains how this path replaced GitHub Actions for NCRD.

## Optional GitHub Actions staging and production setup

The workflows below describe a separate setup. With environment-specific
credentials and deploy flags, the chosen staging branch targets staging and
`main` targets its own production environment. Separate projects and databases
keep staging jobs from reaching production data. Pull requests can run checks
without deploying.

Git cannot hold both a branch named `staging` and a branch under `staging/`.
An installation that uses `staging/cms-release` supplies that exact branch in
`CMS_STAGING_BRANCH`, the GitHub branch rules and the Google federation condition.

## Enable the two environments

1. Set up each environment separately using [the Google bootstrap](../hosting/bootstrap.md).
   You need an existing Cloud Run Admin, Site and private Worker, a build
   source bucket, an Artifact Registry repository and a builder identity.
   Confirm sign-in, backups, and rollback before enabling production.
2. Create GitHub environments named `staging` and `production`. Restrict
   deployments to their respective branches. Use a production reviewer if
   the repository's plan supports it. Protect both branches and review
   changes to `.github/workflows/` and `scripts/deploy-google-release.sh`.
3. Give each environment its own keyless deploy account using
   [Scope the GitHub identity](#scope-the-github-identity). Keep both automatic
   deployment flags off during setup.
4. Set the variables below on each GitHub **environment**. At the
   **repository** level, set `CMS_RELEASE_STAGING_PROJECT_NUMBER` and, before
   enabling production, `CMS_RELEASE_PRODUCTION_PROJECT_NUMBER`. These
   numbers must be distinct; the release rejects an environment with the
   wrong number before it asks for credentials. Use the read-only plan below before enabling the flag.
5. Set the **repository** variable `CMS_AUTODEPLOY_STAGING=true`, make a
   normal staging push without a CI skip marker, and verify the revision,
   admin sign-in and public review site. When production is independently ready, set
   `CMS_AUTODEPLOY_PRODUCTION=true`. Unset a flag to pause future deploys.

| Environment variable | Value |
| --- | --- |
| `CMS_DEPLOY_PROJECT`, `CMS_DEPLOY_PROJECT_NUMBER`, `CMS_DEPLOY_REGION` | Exact Google project, its number, and service region |
| `CMS_DEPLOY_IMAGE` | Existing regional Artifact Registry image path without a tag |
| `CMS_DEPLOY_SOURCE_BUCKET` | Existing source bucket in that project, without `gs://` |
| `CMS_DEPLOY_BUILDER` | Existing Cloud Build service account email |
| `CMS_DEPLOY_ADMIN`, `CMS_DEPLOY_SITE`, `CMS_DEPLOY_WORKER` | Existing Cloud Run service names |
| `CMS_DEPLOY_IDENTITY_PROVIDER` | Full Google workload identity provider resource name |
| `CMS_DEPLOY_SERVICE_ACCOUNT` | Federated deploy service account email |
| `CMS_DEPLOY_ADMIN_ORIGIN`, `CMS_DEPLOY_SITE_ORIGIN` | Optional HTTPS health origins when the default run.app address is disabled |
| `CMS_DEPLOY_SCHEMA_REF` | Optional exact Git commit matching the database's applied migrations |

## Scope the GitHub identity

Use [Google's deployment federation guide](https://docs.cloud.google.com/iam/docs/workload-identity-federation-with-deployment-pipelines)
to create a dedicated pool and OIDC provider in the target project. Set the issuer
to `https://token.actions.githubusercontent.com` and keep the provider's default
audience. Find the canonical repository name and numeric IDs with:

```sh
gh api "repos/$GH_OWNER/$GH_REPO" --jq '{repo: .full_name, repository_id: .id, owner_id: .owner.id}'
```

Map `google.subject` to `assertion.sub`. Map `attribute.repository_id`,
`attribute.repository_owner_id`, `attribute.event_name`, `attribute.ref`,
`attribute.environment` and `attribute.job_workflow_ref` to the matching
`assertion.*` claims. See the [GitHub OIDC claims](https://docs.github.com/en/actions/reference/security/oidc).
For staging, replace the placeholders in this provider condition with the exact
repository IDs, name and configured staging ref:

```text
attribute.repository_id == 'REPOSITORY_ID' &&
attribute.repository_owner_id == 'OWNER_ID' &&
attribute.event_name == 'push' &&
attribute.ref == 'refs/heads/staging/cms-release' &&
attribute.environment == 'staging' &&
attribute.job_workflow_ref == 'OWNER/REPO/.github/workflows/google-release.yml@refs/heads/staging/cms-release'
```

For production, use `refs/heads/main` in both places and `production` as the
environment. Give the pool's `attribute.repository_id/REPOSITORY_ID` principal
set `roles/iam.workloadIdentityUser` on that environment's deploy account only:

```text
principalSet://iam.googleapis.com/projects/PROJECT_NUMBER/locations/global/workloadIdentityPools/POOL_ID/attribute.repository_id/REPOSITORY_ID
```

Use the provider's full resource name in `CMS_DEPLOY_IDENTITY_PROVIDER`.

Grant only what the deploy script needs:

| Scope | Access needed |
| --- | --- |
| Target project | Read the project number; submit and read Cloud Build jobs and their operations. |
| Existing build source bucket | Read bucket metadata and upload the committed archive. |
| Existing image repository | Read the built image. |
| Existing Admin, Site and Worker | Read service and revision state, stage revisions and update traffic. |
| Existing builder and runtime identities | Act as the accounts on the matching build and deployments. |

The separate builder reads the source archive and writes the image and build
logs. Do not grant direct Secret Manager access to the deploy or builder accounts.
The deploy account can still run an image under the runtime identities, so
treat changes to the workflow, deployment script and build inputs as privileged.
Do not create a service account key.

Run `plan` from a full checkout with the target's operator account before
enabling the flag. This proves the configured project, services and migration
check without routing traffic. The first staging push with the flag enabled
still needs to prove GitHub's token exchange and the actual deploy job. Save the
release artifact and check the full commit on Admin and Site `/health`.

## What a release does

1. CI tests the exact commit in Chromium and WebKit with a fresh database for
   each engine, and builds it. The release job checks that
   the target branch and GitHub environment match. Deployments to the
   same environment do not interrupt an active rollout.
2. Cloud Build builds the committed Git archive. The deployment uses the
   exact image digest. Before routing traffic, all three revisions must be
   Ready, and their other runtime settings must match the serving revisions.
3. The job checks that the tested commit is still at the branch head.
   Traffic moves by revision, with live Admin and Site health checked
   against the full commit. Worker remains private. If routing or health
   fails, the script restores the captured revisions where it can verify
   traffic still points to this deployment.

Application releases do not apply migrations automatically. When migration
files differ from the deployed schema, the job stops before changing
traffic. Use [ship an update](ship-an-update.md) with the existing operator
identity: verify a backup, apply the reviewed compatible migrations, and
set `CMS_DEPLOY_SCHEMA_REF` to the exact commit that matches the database.
Then re-run the tested branch release. Never downgrade migrations to make
an old image start.

## Recover the previous release

Pause automatic deploys for the affected environment. Download its most
recent release artifact and keep the image digest and `previous.json`
together. From a full checkout of that repository, load the target
environment variables and authenticate with the scoped operator account.
Use a private folder for the receipt:

```sh
bash scripts/deploy-google-release.sh plan "$RELEASE_SHA" "$RECEIPT_DIR"
bash scripts/deploy-google-release.sh rollback "$RELEASE_SHA" "$RECEIPT_DIR"
```

`RELEASE_SHA` is the full SHA of the release you are rolling back.
The script validates that the old revisions belong to the target services
and still match their digests and versions. It blocks if the migration
sets differ. If a rollout was interrupted, inspect all three services and
use the recorded revisions in
[Cloud Run's traffic controls](https://docs.cloud.google.com/run/docs/rollouts-rollbacks-traffic-migration)
if the script cannot complete. Verify health, a signed-in edit, and a
public page before enabling deploys again. Rolling code back does not
restore or delete site content.
