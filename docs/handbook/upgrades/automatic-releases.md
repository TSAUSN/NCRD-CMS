# Publish staging and production from GitHub

The `staging` branch tests and publishes to the GitHub **staging**
environment. The `main` branch tests and publishes to **production**.
The environments must point to different Cloud projects and databases.
Pull requests and manual CI runs can test code without deploying it.

## Enable the two environments

1. Set up each environment separately using [the Google bootstrap](../hosting/bootstrap.md).
   You need an existing Cloud Run Admin, Site and private Worker, a build
   source bucket, an Artifact Registry repository and a builder identity.
   Confirm sign-in, backups, and rollback before enabling production.
2. Create GitHub environments named `staging` and `production`. Restrict
   deployments to their respective branches. Use a production reviewer if
   the repository's plan supports it. Protect both branches and review
   changes to `.github/workflows/` and `scripts/deploy-google-release.sh`.
3. Configure [Google workload identity federation for GitHub](https://github.com/google-github-actions/auth#workload-identity-federation-through-a-service-account).
   Use a separate deploy identity per project. Restrict the provider by
   the exact GitHub repository ID, `push` event, branch, and environment
   claims. For staging require `refs/heads/staging` and `staging`; for
   production require `refs/heads/main` and `production`. Grant
   `roles/iam.workloadIdentityUser` on only the matching deploy account.
   Do not use a service account key.
4. Set the variables below on each GitHub **environment**. Run the local
   read-only `plan` first using the intended project and release commit.
   Verify all three services and that the project number matches.
5. Set the **repository** variable `CMS_AUTODEPLOY_STAGING=true`, make a
   normal staging push, and verify the revision, admin sign-in and public
   review site. When production is independently ready, set
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

The deploy identity needs to read the project and bucket metadata, submit
and read the project’s Cloud Build jobs, read revisions and update traffic
on the three named services, and act as the existing builder and runtime
identities. Scope access to those resources. The builder writes the images
and its logs. Neither role should be able to read database credentials.

## What a release does

1. CI tests and builds the exact commit. The release job checks that
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
