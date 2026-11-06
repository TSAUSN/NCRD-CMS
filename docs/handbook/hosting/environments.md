# Separate staging and production

For environment administrators and maintainers.
Last checked: 2026-11-04.

Use [bootstrap](bootstrap.md) and [Friday go-live](friday-go-live.md) for the current
organization test-phase installation. Existing personal review identifiers are
in [review-environment.md](review-environment.md). Local verification does not
establish organization IAM, public policy, domain routing or notification delivery.

Staging and Production need separate databases, media storage, service identities,
auth callbacks, secrets, schedules, mail settings and backups. Use the same reviewed
revision in both. Staging must not send real messages or process production domain
jobs. Scrub private data before extending access and never start a general worker
against a production snapshot. Noindex is not access control.

Admin uses the authenticated login, Site the restricted public login and Worker
the job login. Only migration/recovery uses the database owner connection. Cloud
SQL uses its reviewed socket/proxy transport; TCP connections retain verified TLS.
Preserve RLS, narrow commands and exact target checks.

## Acceptance before promotion

- Verify exact project/account, budget, APIs, IAM identities and public invocation policy.
- Check source/digest, restricted database roles, media inventory and native HTTPS routing.
- Verify Supabase callback, existing Super admin identity and role/site isolation.
- Walk save/reload, preview, publish, History and scheduled publication in a normal browser.
- Prove private Worker refusal, heartbeat, alert delivery and encrypted backup recovery.
- Obtain content/font rights and final visual acceptance for the target hostnames.

Microsoft sign-in and real-editor delivery remain separate decisions. Provider
ownership, tenant/account linking and rollback are in [sign-in options](sign-in-options.md).
Custom-domain ownership, certificate/routing checks and DNS rollback follow the
separately authorized [domain procedure](domains.md). Do not infer routing targets
or move nameservers. [ADR 0012](../../adr/0012-static-publishing.md) governs the
future static-publication work; the dynamic renderer remains active.
