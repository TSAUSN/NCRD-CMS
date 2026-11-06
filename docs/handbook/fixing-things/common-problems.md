# Find the right recovery path

Use the screen's saved state and evidence before changing configuration.

For: Editors, site administrators and maintainers. Last checked: 2026-11-02.

| Symptom | Next step |
| --- | --- |
| Sign-in link expired or used | Request a new link, then enter the invitation email again. In the local demo use the recorded outbox; no real email was sent. Sign-in alone does not grant access. |
| A site or page is absent | Check the chosen site and assigned role. Ask a site administrator to check People or chapter assignment. Do not broaden database grants. |
| Save failed or reports a newer version | Keep the current text, read the error, and reload/retry through the offered path. Do not double-submit or overwrite someone else's newer draft. |
| A saved edit is missing publicly | Open Publish and review the actual saved change. Save draft is private. A newer draft can require a new review. |
| Publish is blocked | Read the named checks and Show links. Correct missing content/media or request the authorised review; do not remove readiness or permissions. |
| Wrong content was published | Open History and review the saved version or coordinated release recovery. Recovery creates private drafts, which still need normal publication. |
| A scheduled change has not appeared | Check its saved status and exact review, then ask a maintainer to inspect worker health/monitoring. Do not create a duplicate schedule. |
| A picture or document is missing | Open Media and check its status/usage. Maintainers verify the correct environment's media root and bytes. Never replace an unknown original or fetch a live image to hide a restore gap. |
| A restored Echelon page uses fallback type | On the loopback-only rehearsal check `CMS_LOCAL_TEST_MODE=true` and the registered local font response. Never enable that flag on hosted staging or download a substitute font. |
| The whole site or database is unavailable | Preserve the error/time, ask the environment operator, and follow the isolated backup/recovery gate. An Editor should not run migrations or restart Postgres. |

[Local staging](../hosting/local-staging.md) verifies local installation and
restore. [Environment planning](../hosting/environments.md) lists hosted
prerequisites. Hosted sign-in/mail, provider DNS/HTTPS, off-machine recovery
and the final acceptance walk are not proven by these troubleshooting notes.
