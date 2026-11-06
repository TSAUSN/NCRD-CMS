# Code work after the maintainer review

Deferred maintenance and observed workarounds, with risks and verification steps.

Audience: maintainers. Last checked: November 4, 2026, against the personal hosted review and verification checkout.

These changes are deferred to separate reviewed maintenance work. Fix a visible scenario bug with a focused regression now; keep structural work for a separately reviewed change. The desktop/laptop authoring boundary in SPEC §10 is intentional: do not turn this list into a phone editor project.

| Work | What and why it matters | Why deferred | Risk | How to test |
|---|---|---|---|---|
| Split the page editor | Separate the large editor's draft persistence, selection, canvas, history and publishing responsibilities into explicit modules without changing behavior. | A broad extraction during hosted content QA would invalidate too much of the review. | High: autosave, recovery, Undo/Redo, leave prompts and version conflicts share state. | Keep existing editor coverage; test save/reload, recovery after deployment, two-editor conflicts, section movement, Undo/Redo, History restore, review and publish at 1440 and 1024. Confirm the clean 390 read-only boundary. |
| Remove site-specific renderer branches | `packages/renderer/src/render.ts` imports Echelon presentation modules, branches on `core-echelon-jump-links`, recognizes a fixed `STORY_FEED_SLUGS` set, maps a story `newsroom` field to `more`, and applies Echelon/report page classes and post-render adjustments. The shared renderer still serves these pages, but behavior is coupled to particular definitions. | Replacing presentation ownership is a renderer redesign, not a safe handover change. | High: protected chapter sample content, photos, Join-us, SAWSO story feeds and annual reports may change. | Compare every kept public page, image and preview at desktop and phone widths; run renderer units, Echelon retained-page checks, story routing/filtering and report tests before and after each extraction. |
| Public page caching | Read the current public-request path and introduce cache keys/invalidation only after measuring it. Publishing, shared settings, media and tags must invalidate every dependent page. | Correctness and reviewer approval come before an additional invalidation layer. | High: stale publication, scheduled updates, content leakage between sites, or draft exposure. | Prove anonymous draft denial, per-site isolation, immediate publish/restore visibility, scheduled publishing, archived-page 404s and shared Header/Footer updates on multiple pages. Measure cold and warm requests separately. |
| Validate stored page JSON | Validate stored section data and referenced definition versions at read boundaries, with an actionable editor error and a safe public result. Current write validation alone cannot prove every historical row is valid. | Existing content must be inventoried before tightening its accepted representation. | Medium/high: a stricter schema can reject retained historical content or erase an unknown field during a save. | Seed malformed values, missing definitions and older valid versions. Ensure editor recovery preserves data, public output contains no broken image link, and all retained valid pages still render. |
| Site-specific slugs in shared code | Replace implicit meaning in shared `core-newsroom`, `core-stories`, `core-story-world`, `core-story-split`, Echelon and report definition slugs with explicit capabilities where appropriate. Page-address changes must not silently change behavior. | This affects definition contracts and import compatibility; it needs a migration plan. | High: public routes, story destinations, directory widgets and editor field behavior can drift independently. | Run the same section on two unrelated sites with renamed page addresses, verify previews and public output, and check all foreign-site direct addresses/media remain refused. |
| Email and invitations | Design invitations and delivery separately from the existing Supabase email sign-in. Record delivery, expiration and revocation behavior before adding a service. | Mail-service changes and additional onboarding features are outside the release scope. | Medium/high: unintended mail, account enumeration, elevated access and expired invitations. | Use a recording provider locally; prove single delivery, role limits, expiration, revocation and resend behavior. Never send real messages as a test without authorization. |
| Firebase or Microsoft sign-in | Add a provider only after a platform lead decision about identity, account linking, callback origins and organization ownership. | Supabase email sign-in is the approved provider for the hosted review. | High: account linking could attach an external identity to an existing privileged CMS user. | Isolated callback/provider tests, exact redirect allowlist, existing-user linking, wrong-tenant rejection, logout/session expiry and unchanged role scope. |

## Maintenance constraints

- **Shared settings recovery:** Header, menu and Footer have normal save/publish
  controls but no page-style History restore picker. Record original setting
  versions, restore exact values through the workspace, republish and compare.
  Avoid publishing unrelated page, list or Data values drafts.
- **Chapter recovery:** Page History does not restore independent chapter setup,
  contact or destination versions. Restore and compare both surfaces before
  publishing. A future unified recovery view needs separate review.
- **Publication scope:** Keep story-scoped reviews separate from general collection
  candidates. Check unrelated drafts, schedules, cancellation and public output.
  Chapter publication summaries must compare the setup pinned to the immutable
  selected page version and preserve private contact/site-role boundaries.
- **Media performance:** Preserve migrations 0205 and 0207 and the complete fallback
  for escaped/encoded media references. Measure cold and warm requests; never relax
  authorization or increase a timeout to conceal slow reference evaluation.
- **Story visibility:** Migration 0208 supports visible-page release/sitemap checks.
  Preserve hidden-story 404s, unhide recovery, sample-content consent, foreign-site
  refusal and additive SQL rollback compatibility.
- **Archive navigation:** Preserve the acknowledged archive receipt and navigation
  regression. Revalidation must not inject a competing 404 into the action response.
- **Repeated menu destinations:** Match label/destination pairs when available;
  a future stable identity model must cover renames and reordering with duplicate URLs.
- **Phone quick links:** The national Footer has fixed SAWSO destinations separate
  from Header button fields. Replace them only through a separately reviewed
  template design with explicit fields and public phone/desktop comparisons.
- **Browser control:** Preview frames can stall while browser debugging is attached.
  Reproduce in ordinary Chrome before diagnosis; preserve CSP/authentication and
  avoid repeating Save, Schedule or Publish while a browser is stalled.

[Known issues](../start-here/known-issues.md) lists unresolved baseline failures.
Verification receipts and detailed scenario history are private and stay outside Git.
