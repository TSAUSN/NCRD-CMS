# Independent CMS staging on AWS Lightsail

Target: the $7/month Linux/Unix public-IPv4 bundle (1 GB RAM, 40 GB disk) in
`us-east-1`, Supabase Free for Postgres and email-link sign-in, and private
uploads on a persistent server volume. The three application roles run
continuously. This is a staging profile for the maintainer, not a production
availability promise. Capacity and real-provider acceptance are separate gates.
Treat native AWS memory checks as an acceptance gate before relying on this size.

The maintainer authorized hosting around $10/month on October 19, 2026. Allow roughly
$1–2 for incremental server snapshots, subject to measured changed data, plus
tax. Resend Free handles invitations; Supabase handles sign-in email with its
own delivery limits. Registering a new domain is outside this estimate. Do not
add a managed Lightsail database, load balancer, CDN or paid Supabase plan.
Those services are unnecessary for this profile and exceed this budget.
The [current AWS price](https://aws.amazon.com/lightsail/pricing/),
[snapshot billing](https://docs.aws.amazon.com/lightsail/latest/userguide/amazon-lightsail-frequently-asked-questions-faq-billing-and-account-management.html)
and [Supabase quotas](https://supabase.com/pricing) must be checked in the
administrator account before purchase. An account budget alert is not a hard bill cap.

## Prerequisites

- Personal AWS, Supabase and send-only mail access, independent of Salvation
  Army. The maintainer signs in or creates accounts. Use only approved personal
  staging addresses and the fictional event archive. No production connection.
- A Supabase project for database/auth; real verified Super admin email; exact HTTPS
  callback and magic-link template from [operations](../../docs/operations.md#setting-up-a-hosted-environment).
  Supabase's default mail service is restricted to project-team recipients and
  rate limited. Configure approved SMTP before inviting anyone else.
- Three restricted database logins from `scripts/provision-runtime-logins.mjs`.
  Use a direct or **session-mode** Postgres endpoint supporting these logins,
  verified TLS, and the provider CA. Never use a transaction pooler without
  checking the connection contract and per-role isolation.
- An approved admin hostname and a staging base, e.g. `cms.example.org` and
  `preview.example.org`. Exact A records for the admin and `*.preview` point to
  the instance's attached static IPv4. Keep existing authoritative DNS if desired.

The maintainer is also asking the platform lead about an organization-funded AWS development
account. This is an unapproved alternative, not permission to use workplace
access. Before changing account ownership, confirm a persistent environment
without automatic resets, its bill payer and allowed services (including
Supabase and mail), operator access, and approved test hostnames. Use only the
fictional event and keep production networks, data and DNS separate. Free AWS
workshop sandboxes expire and cannot provide continuous staging hosting.

## Prepare the application

1. Build a tested **linux/amd64** runtime image on the development/build machine.
   Record the Git revision and image ID. Build the `recovery` target with
   `POSTGRES_MAJOR` matching the hosted database. Run `scripts/smoke-images.sh`
   with both images. A native Arm smoke alone does not prove amd64 readiness.
   Transfer the private image with `docker save`/`docker load` over SSH. Do not
   upload this private repository or its image to a public registry.
   The October 19 local Arm image builds and runs; both amd64 cross-build
   engines crash inside QEMU on the local workstation. Do not label that as an amd64 build
   success. Use a native x86 builder. For the first staging deployment, the
   Lightsail instance itself can build before the apps are started, with
   temporary swap and one build at a time; validate available disk/RAM first.
   Subsequent builds on that small instance require a maintenance window or
   a separate builder. Do not rebuild under the running image workload.
2. Copy [lightsail.example.json](../lightsail.example.json) to a private working
   directory. Supply the loaded application's `sha256:` image ID, approved
   addresses and contact email, and the official multiarch Caddy image digest.
   Run `node scripts/prepare-lightsail.mjs CONFIG_JSON NEW_PRIVATE_DIRECTORY`.
   This only writes `compose.yaml` and `Caddyfile`; it does not deploy.
3. Apply migrations with the operator connection, provision the runtime logins,
   then run `node scripts/bootstrap-hosted-owner.mjs PRIVATE_PG_CONFIG_JSON OWNER_EMAIL DISPLAY_NAME`.
   It only initializes an empty installation, leaves the auth subject unbound
   until a verified sign-in, and refuses another administrator’s existing installation.
   Do **not** run the development `seed` or four-site demo script on staging.

## Configure the server

Use a minimal Ubuntu instance. Install Docker Engine and its Compose plugin;
enable OS security updates. Attach the static IP. In both the host and Lightsail
firewalls, allow HTTPS/HTTP, and restrict SSH to the operator's current IP.
There are no public app, worker or database ports. Configure modest swap for
brief peaks; steady use must fit RAM. Build updates elsewhere or stop the
applications for the documented maintenance-window build.

Create `/etc/cms-v2` owned by root, mode 0700. Store one mode-0600 environment
file per role. The application containers receive only their file:

| File | Required secret settings |
| --- | --- |
| `admin.env` | `DATABASE_URL_AUTHENTICATED`, `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` |
| `site.env` | `DATABASE_URL_PUBLIC` |
| `worker.env` | `DATABASE_URL_WORKER`, `DOMAIN_ORIGIN_IPV4`, `RESEND_API_KEY`, `MAIL_FROM` |

Set every DB URL to `sslmode=verify-full` with
`sslrootcert=/etc/cms-v2/database-ca.crt`. Put the public CA certificate there,
readable by container UID 1000; it contains no private key. Keep the migration
owner connection and recovery key in separate operator-only files, never any
application environment. Never set `CMS_LOCAL_TEST_MODE`, test credentials,
recording mail or a fake domain provider.

Copy the generated release directory to `/opt/cms-v2/releases/REVISION`, then
validate the proxy and `docker compose -f compose.yaml config --quiet` before
starting it. Caddy is the sole public ingress. It replaces forwarded host/proto
headers, hides `/internal`, and asks the site's existing permission endpoint
before issuing a certificate for a new public hostname. Certificates persist
in the Caddy volume; private uploads persist in the `media` volume. Application
caches use disk volumes isolated by image revision, not RAM-backed tmpfs. Use the
same Compose project name across updates. Never use `down --volumes`.

## Acceptance and iteration

Sign in as the real owner, import **only**
`demo/sites/event-editing-example.cms-site.json.gz`, and publish its first release
through the CMS. Verify speaker/schedule editing, save/reload, public publication,
upload and variants, section thumbnails, tenant routing, unknown-host refusal,
hosted sign-out and unauthenticated access. Verify the chosen hostname's real
HTTPS certificate. Imported content remains private until publication.

Enable server snapshots and retain an encrypted application-level backup of
both Postgres and media using the separate recovery image/operator identity.
Copy a backup off the application host and rehearse an isolated restore. A
server snapshot alone does not contain the Supabase database. A free Supabase
project has inactivity/space limits and no included automatic database backup.
Set AWS budget alerts and review disk/snapshot/transfer usage.

Configure an independent uptime/dead-man monitor that checks web health and
worker readiness, with alerts for silence, dead letters and backup age. Worker
readiness/queue ports stay loopback-only and can be checked over SSH by a
separate monitor. Timed publishing stays disabled until independent alerts are
verified; ordinary manual publication still works.

For an update, back up first, load the new tested image, apply reviewed
migrations using the operator identity, generate its release files, and use
`docker compose up -d`. Keep the prior image and compatible configuration for
rollback. Database and media are preserved; never reseed during deployment.
