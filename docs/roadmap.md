# Delivery roadmap

[SPEC release state](../SPEC.md#current-release-state) controls the current milestone.
The release is `v2026.11.06`; `e51b4b5` was the runtime-identical review build.
Deployment uses the reviewed release ref and private verification receipts.

## Implemented scope

| Work package | Capability | Remaining acceptance |
| --- | --- | --- |
| SH-1–SH-3 | Shared tokens/components, shell, navigation and saved-state vocabulary | Final release/browser and reviewer acceptance |
| ED-1–ED-13 | Real-page editor, panels, section actions, lists, undo/redo, History, preview and page settings | Baseline failures in known issues; no claim of an unfamiliar-editor study |
| LB-1–LB-8 | Shared core catalogue, samples, templates, library preview and national theme | Approved content/font rights and final visual review |
| WS-1–WS-8 | Home, Pages, Lists, Media, Site look, publishing, settings and section workspaces | Release acceptance and appropriate role walkthroughs |
| MG-1 / MG-2 | Existing-site importer and local Better Together 2027 showcase | Imported-site regression preservation; live cutover separately approved |
| MG-3 / RO-1 / DY-3 | Echelon chapters, page/division scope, protected shared sections and review checks | Chapter operating roles and maintenance responsibility |
| MG-4 / R3-1–R3-8 | SAWSO national template, site-wide frame, Stories, tags, data/report/chapter controls | Known issue follow-up and ordinary-browser acceptance |
| DOC-0 / DOC-1 / R3-9 | Handbook, maintainer map, SQL reference and deployment/recovery runbooks | Administrator execution and final operational handoff |

## Open and deferred work

| Work package | Requirement | Gate |
| --- | --- | --- |
| HO-1 | Organization Google deployment | Administrator checklist, approved budget/public invocation, exact revision, restore/media verification, sign-in and operational acceptance |
| HO-2 | Static public publishing | ADR 0012 and its release gates; dynamic rendering remains active |
| HO-3 | Current hosting cost brief | Dated provider estimates and platform-lead review; no zero-cost guarantee |
| MG-5 | Human Needs Index commissioning | Existing imported output remains frozen; domain/Tableau/cutover decisions separately reviewed |
| DY-1 / DY-2 / DY-3 | External feed refresh, data values and review/expiry work | Real source-change evidence, bindings and missing-feature review in SPEC |
| DY-4 | Saved CSV mappings and Google Sheets sync | Separate scoped implementation |
| RO-2 | Role-based Home follow-up | Preserve current site/role isolation |
| RO-3 | Organization sign-in / Microsoft SSO | Provider ownership, tenant policy, explicit existing-user linking and rollback |
| RO-4 | Utilities hub | Separate product scope |
| Maintenance | The refactor branch separates the editor, renderer and styles by responsibility. `globals.css` lists the shared imports. | Verify the candidate's complete browser, Friday-data and hosted role checks before release. |

For code and visual verification, see the [maintainer gates](maintainers/gates.md).
For a new installation, use the [private release handoff](handbook/hosting/private-release-handoff.md).

Organization installation, custom-domain/DNS cutover, real-editor rollout and
SMTP/provider changes are distinct administrator decisions. Approved public copy,
seed content, retained examples and immutable migrations remain unchanged by
handover cleanup. Private verification receipts remain outside the repository.
