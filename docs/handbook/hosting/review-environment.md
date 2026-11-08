# Personal review environment

This is the personal review deployment, separate from the organization project.
The release is `v2026.11.06`. The November 6 review served the runtime-identical
build `e51b4b5`. Check the current Admin and Site `/health` before a new review.

The identifiers below are placeholders. Supply actual values through a private
operator configuration; this document grants no permission to deploy. Verify the account, project and deployed revision at action time.

| Setting | Review value |
| --- | --- |
| Google operator account | `OPERATOR_EMAIL` |
| Project ID | `PROJECT_ID` |
| Project number | `PROJECT_NUMBER` |
| Region | `us-central1` |
| Admin origin | https://ADMIN_SERVICE-PROJECT_NUMBER.REGION.run.app |
| SAWSO origin | https://SAWSO_HOSTING_SITE_ID.web.app |
| Echelon chapters origin | https://ECHELON_HOSTING_SITE_ID.web.app |
| Symposium origin | https://SYMPOSIUM_HOSTING_SITE_ID.web.app |

Select these values explicitly only when reviewing this environment. Organization
bootstrap uses its own project/account, identities, buckets, secrets and callbacks.
Never copy a personal connection string or private service manifest into that setup.

The review copy uses Cloud Run Admin, Site and a private HTTP Worker, Cloud SQL
PostgreSQL 16, private media storage and Supabase email sign-in. Native Hosting
addresses route to the public Site service. The frozen Git tag and the deployed
image are separate records: check `/health` and image digests before reporting a
version as live. Deployment and content checks do not establish organization readiness.

Use the [private release handoff checklist](private-release-handoff.md) for the
content and sign-in packet. See [bootstrap](bootstrap.md) and
[shipping an update](../upgrades/ship-an-update.md) for the procedures.
