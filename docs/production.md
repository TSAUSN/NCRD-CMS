# NCRD CMS production

This is the operating snapshot for the organization’s CMS, checked November 18, 2026. The [architecture](architecture.md) explains how the system works. The [feature map](handbook/maintainers/where-things-live.md) follows an individual change through the code and tests.

## What is running

| Area | Current state |
| --- | --- |
| Source and release | [TSAUSN/NCRD-CMS](https://github.com/TSAUSN/NCRD-CMS), `main`, [November 16 recovery release](https://github.com/TSAUSN/NCRD-CMS/pull/5). After the [November 18 Disaster Manager release](https://github.com/TSAUSN/NCRD-CMS/pull/7), Admin and the public Site both reported `5a4892ca5c9bef100c4637a5ae6a884839d5bf44` at `/health`. The Worker is private and its serving revision is checked in Cloud Run. |
| Deployment | Google Cloud Build trigger `ncrd-cms-deploy` builds the reviewed commit for Cloud Run. The Admin, public Site and private Worker share an image. Cloud SQL PostgreSQL holds the CMS data. Cloud Storage holds media. Firebase Hosting routes site addresses to the public Site service. |
| Sign-in | Supabase Auth handles identity. NCRD uses Resend custom SMTP for sign-in and password recovery through `auth.usnsandbox.org`. Owner recovery and fresh password sign-in passed on November 16. This is link-based recovery. Microsoft is prepared in code and remains disabled pending IT configuration. |
| Public addresses | The three native Firebase addresses serve SAWSO, Echelon chapters and Echelon Symposium. The SAWSO custom [homepage](https://sawso.usnsandbox.org/) and [Newsroom](https://sawso.usnsandbox.org/newsroom) returned HTTP 200 after the November 18 SAWSO Hosting redeploy. [Domain recovery details](handbook/hosting/domains.md#ncrd-example-checked-november-18-2026). |
| Content and features | Editors save private drafts. Review and publication make selected versions visible to visitors. SAWSO’s story tags and public filters are available. Per-site GA4 settings are outside this release. |
| Current Disasters | The Admin tool gives Super admins and Disaster Managers access to the national Current Disasters cards. Push publishes a Zesty version outside the CMS content-release workflow. [Tool and access guide](handbook/people/roles.md#current-disasters). |
| Routine operations | The CMS Home page shows background-job health. The scheduled backup job and the [recovery runbook](handbook/upgrades/backup-recovery.md) cover environment recovery. Publication History is the normal way to recover an editorial change. |

## Public site addresses

| Site | Native HTTPS address |
| --- | --- |
| SAWSO | [ncrd-cms-e9bd03c015856424.web.app](https://ncrd-cms-e9bd03c015856424.web.app/) |
| Echelon chapters | [ncrd-cms-2d838515a69f3169.web.app](https://ncrd-cms-2d838515a69f3169.web.app/) |
| Echelon Symposium | [ncrd-cms-305ea4c4b0498edb.web.app](https://ncrd-cms-305ea4c4b0498edb.web.app/) |

The [NCRD admin](https://ncrd-cms-admin-57223803907.us-central1.run.app/) has its own address. A public-site domain connection leaves the admin address and Supabase callbacks as they are. Supabase authenticates the user, and PostgreSQL enforces CMS membership, role and site scope. Auth email delivery and the worker’s application email have separate configuration.

## How to orient a new maintainer

The [product spec](../SPEC.md) describes intended behavior. The [decision record](decisions.md) explains choices and their dates. The [source map](handbook/maintainers/where-things-live.md) identifies existing owners, database commands and tests for a feature. Current behavior can be checked in the serving build and by reproducing the flow on a disposable local instance.

A local demo, personal review instance and NCRD production have separate data, credentials and deployment targets. Release evidence comes from the environment that was checked. New installations have their own account, project, role, callback, domain and secrets configuration. The [release guide](handbook/upgrades/automatic-releases.md) explains the production trigger and the separate staging option.
