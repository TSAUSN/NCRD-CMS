# Start maintaining CMS V2

Pick the guide for what you need to do. The [handbook index](handbook/INDEX.md)
is also the starting point for editors and site admins.

| I need to… | Start with |
| --- | --- |
| See what NCRD is actually running | [Production overview](production.md) |
| Learn how requests and content flow | [Architecture](architecture.md) |
| Run a clean clone and sign in locally | [Local demo setup](handbook/hosting/local-demo.md) |
| Learn what this release is meant to do | [Current release state](../SPEC.md#current-release-state) and the [product checklist](../SPEC.md#round-3-passfail-checklist) |
| Find the code for a screen, read, save, or public page | [Where things live](handbook/maintainers/where-things-live.md) |
| Decide what to run before a change ships | [Verification gates](maintainers/gates.md) and [operations](operations.md) |
| Understand the current deployment path or roll back a release | [Automatic releases](handbook/upgrades/automatic-releases.md) |
| Recover content or the database | [Backup and recovery](handbook/upgrades/backup-recovery.md) |
| Know which behaviors still need evidence | [Known issues](handbook/start-here/known-issues.md) and [performance measurements](maintainers/performance.md) |

A new maintainer can start with the production overview and feature map, then
compare the relevant product guide with the code and tests. The local demo ships
with sample data. Hosted checks use the exact target and its `/health` version.
