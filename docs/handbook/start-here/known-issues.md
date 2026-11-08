# Friday test-phase known issues

Release tag: `v2026.11.06`. Runtime-identical review build: `e51b4b5`. Exact commit, complete gate results and hosted
acceptance belong in the top handoff and SPEC. Do not deploy a moving branch tip.

## Demo pace and workarounds

| Area | Observed behavior | What to do |
| --- | --- | --- |
| Previews | The personal review copy has sometimes left the inline frame blank even when the preview document endpoint responded. | Wait for real content. If the inline preview offers **Try preview again**, use it once, or open the same preview in a new tab. Your draft is separate. |
| Story scheduling | After the phase-scoped readiness fix, server requests took 11.588 seconds to prepare, 12.814 seconds to schedule and 3.072 seconds to cancel. | Allow about 15 seconds per server step; wait for its final receipt. Do not run bulk content checks while timing it. Cancel a QA schedule before it can run. |
| Chrome debugging | Attaching browser debugging stalled some previews; cancelling Chrome's debugging banner let them load. | Review in ordinary Chrome. An ordinary-browser stall remains a defect and takes priority; do not dismiss it based only on the debugging observation. |

Friday uses `db-f1-micro`, about $10/month for SQL compute/storage at the agreed
small test size. Keep the existing bounded pools. The dedicated upgrade and its
restart downtime are documented in [speed and size](../hosting/speed-and-size.md);
it needs later budget approval and is outside this cleanup’s scope.

## Accepted Friday scope and Google project administrator/IT gates

The personal review copy uses the existing Supabase sign-in. No SMTP or
real-editor rollout is included. Adding a person can record CMS access; it does
not send an invitation when delivery is unavailable. For the platform lead’s
long-term identity decision, see
[sign-in options](../hosting/sign-in-options.md).

The empty organization-project deployment remains unverified.
IT must supply the exact project/account, grants, an approved public-invocation
mechanism and a verified alert destination. The maintainer runs every command in the
[go-live checklist](../hosting/friday-go-live.md). No organization or DNS operation
has been performed. Native pre-production Hosting addresses come first; custom
routing/certificates and DNS remain the maintainer/IT's separate gated procedure.

Public pages currently depend on Cloud Run and the live Cloud SQL database;
an outage can take them offline. Shared-core has no Cloud SQL SLA. These are
accepted test-phase limitations, described in the [IT note](../hosting/public-access-it.md).
A same-instance backup restore was rehearsed and content/schema/grants checked;
rollback retains data and uses compatible application revisions or a separately
restored empty database, never an in-place SQL downgrade.

## Pre-existing automated failures to investigate

The original complete baseline ran 631 checks per engine with zero skips/flaky:
Chromium 629 passed / 2 failed; WebKit 626 / 5. The final-tag comparison and raw
receipts are recorded in the private verification receipts. Assertions and timeouts remain
unchanged. Passing only a focused repeat does not erase the original failure.

- `round3-admin-home.spec.ts:156`: the attention-row count can be zero because its
  own published fixture creates no actionable attention. Picture checks passed.
- `round3-card-editor.spec.ts:111` in WebKit: selection is not acknowledged after
  a click two pixels from a native card section's corner at 1024. Geometry checks
  passed. Exact hit-testing cause remains open; use the Structure rail or click
  the intended section text while reviewing, and report any real failed selection.
- `round3-reviews-admin.spec.ts` in WebKit: a loading-state screenshot stalls while
  the test intentionally holds an exclusive submissions-table lock. The isolated
  repeat reproduces it at the original timeout; do not raise it.
- `r8-site-files.spec.ts:1472`: the combined batch reports five Home image 404s;
  the unchanged isolated repeat passes. Cause remains open.
- `section-product-completion.spec.ts:66` in WebKit failed only during overlap and
  passed unchanged alone. Repeat any overlap-only failure alone before diagnosis.

These observations describe the frozen release baseline. Record the exact commit
and complete checks for any new release candidate.

## Delivery and imported content

- **Contact forms:** On sites with a public CMS contact form, site administrators
  can read saved submissions in **Settings → Contact messages**. The CMS does
  not email these messages. Assign someone to monitor the inbox.
- **Chapter invitations:** The local demo can issue a test invitation link.
  Hosted chapter invitations are unavailable until a delivery provider is
  configured; the Chapters screen explains this. Keep site-wide access separate
  from chapter access.
- **Stories source:** A successful check stages new and changed stories for review
  and flags entries missing from the source. It does not publish automatically.
  Test the live source separately from local synthetic-feed checks.
- **Echelon Symposium import:** Its current Speakers and Agenda sections expose
  text fields. They do not have speaker records or schedule rows, and the
  imported page has no FAQ section. Editing that text is possible. Record-based
  editing needs a configured People or Program list and a suitable page section.
