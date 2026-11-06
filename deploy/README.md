# Prepare an independent CMS staging environment

The current direction is [personal Cloud Run + Supabase staging](google/README.md).
The maintainer wants to stay with Google and keep all CMS services under $20/month.
A $10 Cloud Run spend cap and separate $15 project-wide warning budget were
verified October 25. They do not guarantee a $20 total bill. The full worker,
durable media and domain integration still need adaptation and acceptance;
the CMS is not deployed.

`scripts/prepare-vm.mjs` writes the portable single-server Compose/Caddy
configuration locally and retains the continuous worker. The older
`prepare-lightsail.mjs` entrypoint remains compatible. The earlier
[Lightsail profile](lightsail/README.md) records the server setup and acceptance
checks; it is not a verified hard-cap solution. Approved addresses, native
amd64 packaging and external acceptance remain deployment gates.

## Current manifest generator (incomplete deployment profile)

This kit writes reviewable Cloud Run configuration files **locally**. It does
not create accounts, read credentials, deploy, change DNS or contact a provider.
The maintainer must supply a separate CMS project and approved staging addresses.
Salvation Army production sites, credentials, BetterTogether2027.org, the actual
Human Needs Index, Zesty and cPanel are outside this project. Do not use them.

## What is prepared

| File | Identity and database | Execution |
| --- | --- | --- |
| `admin.yaml` | `cms-admin`, authenticated runtime login only | HTTPS administration service |
| `site.yaml` | `cms-site`, public renderer login only | HTTPS public staging service |
| `drain.yaml` | `cms-worker`, worker runtime login only | One finite queue task; database leases protect duplicate invocations |
| `migrate.yaml` | `cms-operator`, owner connection only | Operator-controlled migration job |

The files use one immutable image digest, pinned Secret Manager versions,
verified HTTPS provider origins, independent service identities and optional
database CA mounts. Local sign-in, fixture secrets and recording mail are absent.
The service/job shapes follow Google's [Cloud Run YAML reference](https://docs.cloud.google.com/run/docs/reference/yaml/v1)
and [job documentation](https://docs.cloud.google.com/run/docs/create-jobs).

## Prepare files without deploying

1. Copy `cloud-run.example.json` into a private working directory. Replace the
   placeholder project, image, provider origins, sender and staging domain with
   the independent CMS environment's approved values. The file names secret
   references, never their values. Use a numbered secret version, not `latest`.
2. Build and smoke-test the OCI image locally with each role before choosing
   its digest. The repository's normal type, unit, database, build and browser
   checks are still required. Container smoke verification is an open gate on
   machines without Docker; generating files cannot close it.
3. Run `node scripts/prepare-cloud-run.mjs CONFIG_JSON NEW_PRIVATE_DIRECTORY`.
   The destination must be new. Review all four generated files. They are JSON
   documents valid as YAML; no deployment command runs.

## Before an operator deploys

- Create the separate provider accounts and environment. Record the operator,
  resource limits, quotas, budget and alert owner. Free allowances are not a
  promise of a zero-cost production service. No account or billing setup is
  performed by this kit.
- Apply migrations with the maintainer connection. Then run
  `node scripts/provision-runtime-logins.mjs --connection-file PRIVATE_OWNER_JSON --out NEW_PRIVATE_DIRECTORY`.
  This requires verified database TLS, refuses existing runtime-login rotation
  and verifies that the three logins cannot inherit migration ownership. Store
  their connection strings separately in Secret Manager. If using a custom CA,
  each hosted connection must point its `sslrootcert` at
  `/secrets/cms-db/database-ca.crt` with `sslmode=verify-full`.
- Create the four named service accounts. Give each access only to its named
  secrets. The web services never receive the maintainer connection; only the
  operator may run the migration job. Reserve permissions for deploying,
  changing IAM and managing secrets to operators.
- Configure Supabase email-link authentication and the exact HTTPS callback in
  [operations.md](../docs/operations.md#setting-up-a-hosted-environment). Configure
  a private media bucket, preferably in a separate storage project, and a
  send-only Resend key for the worker. Run a real sign-in/invitation and
  upload/process/render check in the independent staging environment.
- Arrange HTTPS ingress and the separate wildcard staging domain through a
  trusted proxy. Validate host routing and trusted forwarded headers. Public
  service exposure is a deliberate operator action; the kit does not grant
  unauthenticated Cloud Run invocation or touch an existing website's DNS.
- If scheduling the **queue drain job**, give a separate scheduler identity
  only the job's invocation permission. The Cloud Run Jobs API target uses
  OAuth service-account authentication ([Scheduler authentication](https://docs.cloud.google.com/scheduler/docs/http-target-auth),
  [running jobs on a schedule](https://docs.cloud.google.com/run/docs/execute/jobs-on-schedule)).
  The worker's database leases protect retries and duplicate invocations.
- Set independent alerts for failed jobs, overdue eligible work, worker silence,
  public render failures and backup age. Retain and rehearse encrypted backups
  of both Postgres and media in a separate destination.

**A continuously running browser-capable worker remains a pilot requirement.**
The lightweight `drain` role deliberately defers section thumbnails to the
`worker` role, which has Chromium. It handles image processing and delivery but
cannot by itself complete the visual section-library journey. Supply and verify
that worker on a suitable separate host before treating the hosted pilot as
complete. It uses only the worker runtime login and private media access.

**Editorial scheduling remains off in these manifests.** A drain every few
minutes does not establish the continuously fresh heartbeat required for timed
publication. Verify the continuous worker and independent alerts before enabling
`SCHEDULING_ENABLED` and `SCHEDULING_MONITORING_READY`; the kit never weakens that
requirement.

Only after those checks may the maintainer invite a non-technical pilot. This kit is
hosting preparation, not a deployed or accepted production installation. A
production-site or domain cutover requires separate authorization and must
respect the Salvation Army separation stated above.
