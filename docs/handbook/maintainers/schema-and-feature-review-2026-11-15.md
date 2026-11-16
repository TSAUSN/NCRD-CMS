# Schema and unfinished-feature review — November 15, 2026

Scope: personal V2 candidate on `lab/overnight-v2-20261115`, starting from
`45f15d4`. This review does not apply SQL, rewrite immutable migrations or change
NCRD. The current reference contains **210 migrations, 86 tables and 552 function
definitions**, including overloads and retained historical implementations.

## What was checked

Every current SQL reference file was included in a static inventory. Application,
worker, script and test references were compared with function calls, table
references, triggers, constraints and RLS policies. The review then followed the
paths relevant to Jon's list: identity/access, site creation, domains, story tags,
fonts, saved numbers, publishing, jobs/recovery and analytics. The roadmap and
known-improvement notes were checked against current callers rather than treated
as a fresh list of bugs.

Static references are not code-coverage percentages. A function can be tested
indirectly, invoked by a database policy or reserved for an operator. Dynamic SQL
and external operator commands may be missed. This is a feature/reachability
review and focused verification, not a claim that every function received an
independent security audit or that every hosted role journey has passed.

## Findings and actual gaps

| Area | Current implementation | Remaining work / decision |
| --- | --- | --- |
| Microsoft sign-in | Supabase Azure OAuth, browser-bound PKCE, verified identity and existing CMS authorization; UI button is configuration gated; password remains | IT tenant/app/provider setup and real organizational sign-in acceptance. Direct Entra replacement is deferred. No identity-table change is needed for this chosen path. |
| People and site access | Add person without mail, site/page/division/chapter scopes, deactivation and audited permission commands | Real staff onboarding/delivery and a full hosted role rehearsal remain separate from local fixture checks. Jon's password is not confirmed; do not invent a completed credential handoff. |
| Site creation and native hosting | Narrow create/setup commands, native addresses, worker provisioning and saved source pins | Rehearse new-site creation on the personal hosted lab; an empty-project install and organizational cutover remain separate acceptance work. |
| Domains | Reservation, provider attachment, exact DNS, ownership check, certificates, primary/redirect routing, removal, status history | Controlled personal `cms-test` address is live over HTTPS. New UI exposes stages and per-record copying; Settings lacked a Domains tab and the candidate adds it. Zero-downtime advanced migration is not implemented; NCRD must use its own generated records. |
| Hosting recovery and alerts | Append-only recovery receipts, retries pinned to the current target, original failures retained, resolution only after matching delivery succeeds | Recovery is an operator SQL command/runbook, not a general “retry everything” screen. Refresh and Verify are not substitutes for repairing a failed provider permission. Personal runtime/backup signals need continued observation, not alert suppression. |
| Stories and two-level tags | Tag IDs, main/secondary taxonomy, story tags, coverage/expiry, sector feeds, newsroom and map/split views; per-site isolation | Imported stories still need editorial review. Empty Family Care/Livelihoods assignments are content gaps. Source-check code has synthetic add/remove tests; the live feed's no-change response does not prove a real new/removed source story. |
| Fonts | Approved Adobe kit, published site-wide theme/shell and per-host font allowlist/CSP | Personal native/custom domains now render Trajan in ordinary Chrome. Reconfirm the target NCRD domains after its own host setup; preserve font rights and fallbacks. |
| Saved numbers | Versioned site settings and page bindings, publication dependency checks and scoped release selection | The warning protects against publishing a page that refers to numbers not included in the release. Keep it; verify the warning clears after publishing the required numbers. Do not remove it merely to make publishing appear successful. |
| Analytics | Per-site GA4 Measurement ID and optional property/report configuration, validated settings and renderer integration | Jon must create/supply intended IDs. Real collection/reporting requires the chosen property and its authorized Data API access. An empty field is not a failed integration; do not invent IDs. Domains take priority per Jon. |
| Data imports | Current CSV/import flows and versioned content are present | Reusable saved CSV mappings and Google Sheets synchronization remain deferred. No saved-mapping table or live Sheets sync was found. |
| Public delivery | Shared dynamic renderer and immutable route/shell publications | Static public publishing (ADR 0012) remains deferred. Public rendering still depends on its runtime/database; this is an architectural dependency, not a hidden free-plan upgrade. |
| Contact/review mail | Stored messages, delivery bookkeeping and explicitly local chapter recording | Hosted SMTP/contact notification rollout is not established. Local recording tools are already hidden by server-side `localChapterMailOrigin()` guards; no extra patch is needed just because their shared component contains local wording. |
| Historical helpers | Older validator variants, readiness/media helpers, old recipe wrapper and initial-shell trigger function remain defined | Some have no current app caller. `use_mapped_page_recipe` is the active recipe path; domain recovery is documented operator work; policy/font helpers are reached by RLS/constraints. Treat unused-looking helpers as cleanup candidates, not proof of unfinished product features. Do not remove them in this task. |
| Long-term improvements | Historical JSON read validation, capability-based replacement for site slugs, richer shared/chapter History and menu destination identity are tracked | Separate reviewed maintenance. No broad schema rewrite or changed applied migration checksums is justified by this inventory. |
| Human Needs Index / imported originals | Existing imported output is retained | Commissioning, rights, domain/Tableau and cutover decisions remain frozen/separate scope. |

## Inventory observations

The static scan found 228 directly referenced runtime function names and a call
chain reaching 540 of the 552 definitions after including policy/constraint/trigger
roots. 277 definitions have a directly matched test reference. These numbers
**do not mean** the others are untested or broken: test helpers and dependent
commands exercise many indirectly. Eighty-six tables include internal receipt,
lease and version-pin tables that are intentionally accessed only by narrow SQL
commands rather than directly from the application.

The small set without a current static app path contains operator or maintenance
commands (`retry_hosting_delivery`, `carry_forward_readiness_policy`,
`set_global_role`), compatibility wrappers (`use_page_recipe`), retained validator
versions and historical readiness/media helpers. Current callers and gates should
be rechecked before any later cleanup. No table or function is deleted here.

Private dated test/deployment receipts and the full machine-readable inventory
remain outside Git. Update acceptance states with the final run results; this
review alone does not make an unrun hosted scenario green.
