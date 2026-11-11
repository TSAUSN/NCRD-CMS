# Decisions

Dated entries. Later approved decisions supersede earlier choices. Each says what was decided, why, and how to reverse
it. Architecture decisions with longer reasoning live in [`adr/`](adr/). Entries
that later decisions replaced were removed on October 25, 2026, including the
Lightsail and free-only hosting assessments, the October 7 demo database, and
"human acceptance only at launch". Read them with
`git log -p -- docs/decisions.md`.

## Start with these decisions

Current readiness and release scope are in [SPEC](../SPEC.md). For paths and
verification commands, use the [maintainer map](handbook/maintainers/where-things-live.md).
The dated entries below explain the choices; they do not override a later platform lead decision.

| Subject | Decision |
| --- | --- |
| Pushes to `main` deploy through Cloud Build | [Production deploys through a Cloud Build trigger — November 9, 2026](#production-deploys-through-a-cloud-build-trigger--november-9-2026) |
| Friday sign-in is Super-admin-only on personal Supabase | [Friday stays on personal Supabase, Super admin only — November 5, 2026](#friday-stays-on-personal-supabase-super-admin-only--november-5-2026) |
| Friday SQL starts on the agreed micro budget | [Friday database budget: micro first — November 5, 2026](#friday-database-budget-micro-first--november-5-2026) |
| Product access and email delivery are separate | [Add product access independently of invitation mail — November 5, 2026](#add-product-access-independently-of-invitation-mail--november-5-2026) |
| Placeholder social links stay absent | [Social marks require a destination — November 4, 2026](#social-marks-require-a-destination--november-4-2026) |
| Use the same compiled CSS validator | [Reuse exact compiled CSS validation — November 4, 2026](#reuse-exact-compiled-css-validation--november-4-2026) |
| Preserve work on narrow editor screens | [Narrow editing screens preserve work without phone editing — November 4, 2026](#narrow-editing-screens-preserve-work-without-phone-editing--november-4-2026) |
| Scripted previews use isolated saved capabilities | [Scripted visitor previews use the isolated saved-page capability (2026-10-26, MG-1)](#scripted-visitor-previews-use-the-isolated-saved-page-capability-2026-10-26-mg-1) |
| Reuse controls across the isolated boundary | [Reuse controls across the isolated editor boundary (2026-10-26, MG-1)](#reuse-controls-across-the-isolated-editor-boundary-2026-10-26-mg-1) |
| Review a complete related publication together | [Related publication uses one complete release review (2026-10-26, WS-6)](#related-publication-uses-one-complete-release-review-2026-10-26-ws-6) |
| Keep recovery and list previews private | [Revision 8 — page recovery and private list previews (2026-10-25)](#revision-8--page-recovery-and-private-list-previews-2026-10-25) |
| Page identity belongs to undo/history | [2026-10-25 — Page identity participates in the editor's history (ED-3, ED-8)](#2026-10-25--page-identity-participates-in-the-editors-history-ed-3-ed-8) |
| Menu visibility preserves page identity | [Preserve menu identity while changing visibility (2026-10-26, WS-5)](#preserve-menu-identity-while-changing-visibility-2026-10-26-ws-5) |
| One bar owns page publication decisions | [2026-11-02 — Native editor gives publication decisions one bar](#2026-11-02--native-editor-gives-publication-decisions-one-bar) |
| Site settings use normal releases/recovery | [2026-11-01 — Keep site settings in the normal release and recovery path](#2026-11-01--keep-site-settings-in-the-normal-release-and-recovery-path) |
| Manual Story source checks are visible/recoverable | [2026-10-31 — Keep manual Story checks visible and recoverable](#2026-10-31--keep-manual-story-checks-visible-and-recoverable) |
| Source refresh preserves CMS edits | [2026-10-31 — Preserve CMS edits with an explicit source baseline](#2026-10-31--preserve-cms-edits-with-an-explicit-source-baseline) |
| Shared Story widgets snapshot site-owned tags | [2026-10-31 — Snapshot site-owned display tags for shared Story widgets](#2026-10-31--snapshot-site-owned-display-tags-for-shared-story-widgets) |
| Queue Story metadata and enforce feed policy | [2026-10-31 — Queue story metadata saves and enforce published feed policy](#2026-10-31--queue-story-metadata-saves-and-enforce-published-feed-policy) |
| World View is server-rendered | [2026-10-31 — Use one server-rendered World View section](#2026-10-31--use-one-server-rendered-world-view-section) |
| Chapter creation uses site-owned photos | [2026-11-01 — Use site-owned Echelon photos at creation and publication](#2026-11-01--use-site-owned-echelon-photos-at-creation-and-publication) |

## Production deploys through a Cloud Build trigger — November 9, 2026

The `ncrd-cms-deploy` trigger in `aohub-migration` runs
`deploy/google/cloudbuild-deploy.yaml` on each push to `main`, as the
organization's other Cloud Run apps do. It runs as `cms-builder` with
`run.developer` on the three CMS services and `serviceAccountUser` on their
runtime accounts. GitHub Actions minutes are exhausted, so the Actions release
path stays unconfigured. The trigger does not run the browser suites; run the
relevant checks before pushing. It stops before building when the migration set
differs from the live image, because migrations run separately. A commit message
containing `[skip ci]` skips the deploy as well as Actions. Reverse by disabling
or deleting the trigger and removing the two grants.

## 2026-10-31 — Connect Story actions to the existing scoped review

**Decision.** Put Save draft, Schedule and Publish together. Save local content
before deriving an owned individual-story review; never jump from writing to
publication. A private site requires an explicit first-site review. Keep article
search words aligned through normal page drafts while preserving its content and
other metadata. Show actual saved differences using names and photo descriptions,
with a comparison available directly from the review; the confirmation repeats
those descriptions. Reuse the monitored release timer and its conflict rules.
The existing layout/background queue, Ready-row wording and full StoryAdd/leave
experience remain separate unfinished work. Complete Story/feed end/change-back
dates are unsupported by the existing engine and remain omitted.

## 2026-10-31 — Let writers save a Story before choosing its day

**Decision.** Make the canonical date optional in private Story drafts, with an
explicit normal field-version upgrade for the retained site. Do not silently
change published article values or old field versions. Require a non-empty Story
date at the published-pointer transition, covering full-list, scoped and recovery
paths while preserving draft saves. Keep date selection separate from scheduling;
use plain labels/help. Cancel discards the unfinished Add form. The calendar,
full StoryAdd layout, role cleanup and leave flow remain separate open work.

## 2026-10-31 — Scope a Story release without publishing other drafts

**Decision.** Extend the existing release item with an explicit active Story ID
scope, validated again against site/list ownership. Publish selected pointers via
a narrow command retaining the normal collection review, role, schema and media
gates. Keep unselected records exact and the list dirty while other changes wait.
Use the existing preview, immutable review, sample consent, readiness, receipt,
History and leased timer. Saved differences/counts cover only selected stories;
server-derived labels identify them. Whole-list behavior remains unchanged.
Existing whole-site stale-state checks stay enforced; independent queued schedules
amid unrelated edits remain open calendar work, not claimed complete here.

## 2026-10-31 — Keep story drafts free of sample prose and preserve photo focus

**Decision.** Creation uses the normal private page/list transaction with empty
article text, or sanitized supplied text, instead of inserting sample text. Keep
the existing normalized image focus through collection validation/rendering;
allow only optional bounded x/y alongside existing source/alt/decorative fields.
Migration0176 preserves all prior source/media ownership checks and article size
limits, without rewriting content. Full StoryAdd/calendar work remains open.

## 2026-10-31 — Use report authority and exact captures

**Decision.** The follow-up overrides the previous disputed-number freeze. Update
report-supported current SAWSO figures through normal drafts/Data values; preserve
story, biography and past-event numbers. Keep absent figures unchanged and Needs
checking; record every change/source in the private numbers ledger. The replacement
people-assistance wording remains Needs administrator input. Updated row11/full report captures
are exact including open panels; use normal site frame and shared Stories World
View. Add acceptance55–57. Keep report private pending reviewer approval. After all
required work and acceptance, address the deferred roadmap items in reviewed changes.

## 2026-10-31 — Adopt Split View without breaking Newsroom links

**Decision.** New SAWSO setup uses the shared Split section for Newsroom with
exact approved copy. Adopt the retained page explicitly as a draft, preserving
identity/meta/menu; publish only that page and its saved Story catalog through
normal review. Home and other saved pages remain intact. The shared renderer
accepts older sector/region/view/search/page links, explains combined/search
filters and offers a normal clear link. Earlier fragment bookmarks replace their
history entry with scoped state; no external feed is read. Reposition the tab
indicator after fonts settle, as the approved tool does. Update old phone-feed
and Newsroom assertions to the approved complete cards/three-view behavior.
Reverse through page/catalog History and a reviewed release, using the pre-change
dump for recovery; keep immutable original article versions.

## 2026-10-31 — Share widget preview and private page insertion

**Decision.** The Split View hub uses the existing Story card projection and
renderer, with a bounded scrollable desktop frame and a cancellable larger
preview. A closed server-selected World/Split kind chooses the known definition;
clients cannot supply code or definition pointers. Reuse owned page choices,
exact optimistic page saves and identical-addition retry recognition. No draft
exists until Add as draft; existing content/meta/published heads remain intact.
World behavior stays covered. Reverse through normal History/review; Cancel
writes nothing. Retained Newsroom adoption remains a separate reviewed change.

## 2026-10-31 — Render Split View through the shared Story binding

**Decision.** Add one global section, preserving existing definition pins. Server
links render recent, main-tag and map views without scripts; use the owned Story
catalog and shared map/grid. Keep tag/region counts distinct from visible card
caps and use this site's group names. The fixed runtime reads same-origin page
HTML only. Native browser animation reproduces approved view/stagger timing,
with reduced-motion cancellation, keyboard tabs and focus on newly shown cards.
Remember only visitor tag visibility in browser storage; it grants no authority.
No animation dependency, embed field, source read or publication bypass. Reverse
page choices via normal History/review; old definitions stay available. Hub and
retained Newsroom adoption follow as separate pieces.

## 2026-10-31 — Configure World View without creating abandoned sections

**Decision.** World View hub choices live in its address and the existing private
card projection; use the shared map renderer with site typography and no site
frames. The scriptless scaled preview has loading/retry and a return from opened
stories. Only Site admins choose a page and explicitly append a private section.
Reuse ordinary page saves, role/tenant checks and exact optimistic heads; preserve
all existing content/meta. A retry recognizes only the same actor's one-step,
identical addition against the prior immutable head. Other changes conflict.
No separate widget store, empty placeholder section, publication or source read.
Reverse a completed addition through normal page History; Cancel creates nothing.

## 2026-10-31 — Use one server-rendered World View section

**Decision.** Vendor only the approved local map data, retaining its Natural Earth
public-domain source declaration. Use saved site region areas/labels and a normal
Story binding, with stable per-section URL state, region-count pins, grey empty
areas and ordinary region links. Keep map/card content in white containers with
its heading allowed on grey. A fixed enhancement may replace that section from
same-origin rendered HTML, with progress, retry and reduced motion; it never
reads the external Story source. Page settings use a region picker/main-tag
choices/per-region limit. Pin the fixed SAWSO six-story sector display rule in
the display catalog, independent of the private-preview address; counts remain
complete before the visible card cap. No source address/policy is exposed. World
hub settings will reuse this section separately.
Reverse by removing the unused library definition; existing page pins remain
available, and normal history/review restores earlier page drafts.

## 2026-10-31 — Snapshot site-owned display tags for shared Story widgets

**Decision.** Add one optional closed display catalog to resolved Story bindings,
containing group names, ordered stable IDs/labels and approved region areas. Public
resolvers use the pinned published model; explicit draft previews use its current
saved draft. Do not expose keywords, source settings or review policy. Keep old
bindings and other readers unchanged and preserve existing resource/identity checks.
This lets World/Split sections use each site's catalog without copied per-page
code or borrowed SAWSO labels. It introduces no publish/write authority. Reverse
by stopping new projection; immutable earlier bindings remain readable.

## 2026-10-31 — Keep manual Story checks visible and recoverable

**Decision.** Put a secondary Check for new stories action on the configured
Site-admin list, beside the existing actions; Editors see status only. Keep the
last successful UTC check visible after a failure. Show explicit progress and a
slower-check message, counts and a Needs review fast path. Recover a lost response
with the same request ID; do not poll or retry the public read automatically.
Pause quick tags and Preview while checking, and wait for queued tag saves first.
New drafts still need ordinary publish review. Retain all archived keys when
choosing new stable keys/paths. The additional action/status is required by
MUST-HAVE although absent from the drawn StoriesHub header. Broader shell/tabs
remain unfinished. Reverse the action/status while retaining check history.

## 2026-10-31 — Merge the approved Story source against fresh drafts

**Decision.** The authenticated same-origin endpoint accepts only site/library/
request identities, never a feed address. Only a newly granted lease invokes the
fixed HTTPS read: no redirects, credentials or cache,20-second timeout and20MB
stream limit. Network work finishes outside a database transaction. A narrow
command then locks the current authorized collection without adding direct
application write grants. Merge against its newest drafts/baselines, create new
private article pages with ordinary commands, and finish/audit in one transaction.
Failures preserve content and save a bounded failure code; request retries reuse
the journal. New source photos remain data references until a person chooses a
CMS photo. This endpoint is not yet connected to the list; local fixtures made
no public read. Reverse the endpoint while retaining source baselines/history.

## 2026-10-31 — Journal manual Story checks separately from the network read

**Decision.** Give each explicit check a durable request ID and a two-minute,
collection-locked lease. Retrying an ID returns its saved state, including an
expired failure; another click cannot overlap an active check. Site admins alone
start/finish checks and read source baselines. Members can read check status;
public/worker roles get no access. Completion rechecks access/source, accepts
only bounded closed counts/source fields and keeps source identities fixed to
owned entries. The final result and baseline update share the normal draft
transaction and audit. No publication or feed read is added by this foundation.
Reverse by disabling the future manual action and retaining journal history;
do not drop baselines while refreshing remains enabled.

## 2026-10-31 — Preserve CMS edits with an explicit source baseline

**Decision.** Adapt the approved tool’s form decoding/order/gates, using a strict
closed source record and an atomic failure for malformed or unsafe input. A pure
three-way merge updates only the five source fields still equal to their last
source baseline; body, photo, descriptions, tags, reviewed/hidden state and local
article paths remain CMS-owned. First-check baselines come from the approved CMS
import snapshot, never today’s possibly edited draft. New records get keyword
suggestions and clean empty body/photo choices; removed records remain stored,
and archived/CMS-authored records are never revived or marked removed. Source
photos are references only, with no download/hotlink or copied PHP storage/auth.
The manual action will save drafts for normal reviewed publishing; the per-site
unreviewed policy governs published feed eligibility. No background refresh or
automatic publication is introduced. This foundation has no runtime/UI connection
yet. Reverse the additive module; no saved data changes.

## 2026-10-31 — Keep filtered Story previews private and use actual cards

**Decision.** Open list Preview in a separate authenticated document using saved
site appearance and the same Story renderer. Carry all list filters, apply draft
feed eligibility, explain excluded matches and page24 cards without JavaScript.
Use a card-only private projection and owned draft article links; no feed fetch,
public JSON, content write or public cache. Keep the existing scriptless policy.
Disable Preview while quick-tag jobs are queued or failed. Live filters use
published policy until the policy draft is released. Reverse the private route
and list action; no saved records change. The supplied tool’s standalone preview
flow is retained; the CMS’s real site frame and shared white explanation panel
replace its separate SAWSO CSS/one-off bar and sign-in/storage implementation.

## 2026-10-31 — Use each site’s catalog in page Story choices

**Decision.** Extend the existing identity-scoped collection choices with draft
Story group labels and stable tag IDs, omitting keywords and article bodies.
Replace the hard-coded sector select with shared chips for both groups; preserve
excluded articles, unavailable IDs and deliberately combined older filters.
Offer the normal bounded maximum and the six-story SAWSO sector control. Use one
optional archive value through the existing Change dialog on desktop and phone,
keeping an older more-only value readable. No saved content is backfilled and
no database permissions change. Reverse the panel/renderer adapters; old bindings
remain compatible. Full filtered Preview is still separate required work.

## 2026-10-31 — Share count-based Story grids across owned sections

**Decision.** Apply the approved tool’s full-row preference to definition-owned
Story feeds after filtering/paging: one stays half width, two halves, three thirds,
then four or three columns and centered incomplete rows. Reduce columns at the
existing responsive breakpoints while keeping every selected card reachable,
including without JavaScript. The renderer adds only a bounded column marker;
shared CSS overrides the old narrow-screen hiding rule. No saved definitions,
article fields or frozen imported layouts change. Reverse in renderer code.
A multi-feed development page exposed repeated internal-link findings exceeding the publication audit size limit. Check each identical destination once while retaining every distinct blocker and the same policy version; no authorization gate or audit size limit is relaxed. Full section controls and filtered Preview remain separate required work.

## 2026-10-31 — Recheck Story feed dates on each server response

**Decision.** Use a shared UTC calendar-date window, clamped13 months, for
public feeds, draft previews and Live counts. Automatic Story selection applies
it before its bounded limit; the renderer checks it again before Newsroom paging
so a frozen manifest can expire without a release or JavaScript. Existing response
ETags already hash the resulting HTML and require revalidation. Keep individual
manual articles readable and prevent empty feeds from becoming sample records.
Future dates wait for their day; scheduled privacy still uses the existing release
engine, not a date field alone. Other list readers/date options and all permissions
stay unchanged. Clear the old Newsroom placeholder when no filters match; show
Not in feeds for published older rows. Widen the shared status-filter token for
its full wording. Reverse via the earlier code/release and database plan; do not
mutate old records or silently change their dates.

## 2026-10-31 — Extend existing Story choices with two bounded tag groups

**Decision.** Add optional main/secondary tag groups to the existing automatic
Story binding. Match OR within each group and AND between groups; an empty group
allows any. Keep groups closed, unique, at most100 IDs each, and Story-only in
both TypeScript and SQL. Apply the same helper in draft preview and keep Overview
page usage accurate. Existing visibility policy, ordering, old filters, manual
article bindings, published envelopes, role grants and RLS remain unchanged.
Reapplying the additive migration changes no collection or entry pointer.
No backfill or content publication occurs. Existing callers omit the new setting.
New section controls/grid/runtime aging and full Preview are still required;
this is a data foundation, not completion of Stories on pages. To reverse a
new page choice, save an older binding and publish normally. A code rollback
that cannot read group choices needs the prior saved bindings/release too.

## 2026-10-31 — Use the existing private national CSS reference without refetching

**Decision.** A valid482172-byte Bootstrap reference already exists; its local
SHA256 was checked and the original contradictory404 receipt preserved beside a
new private audit. The original fetch script names the declared source, but the
successful HTTP response is absent, so do not present attribution as independently
reverified. The file header identifies Bootstrap/MIT; that does not resolve the
custom theme licence. Read the local copy for matching, never copy it or its font
import into the product build. The corrected source says site.css is absent;
make no lookup/retry. This corrects documentation only and grants no deployment
or extra live reads. Reverse by correcting the source record when evidence arrives;
no public content, style or saved data changes in this checkpoint.

## 2026-10-31 — Explain current and published Stories coverage separately

**Decision.** Overview shares the Stories header and role gate, retains catalog
order/zeroes, expands linked story titles and groups untagged work at the bottom.
Use saved draft dates/tags for current coverage and published dates/tags/policy
for Live; exclude future/expired dates. Hidden/removed/review-blocked stories do
not enter the upcoming30-day cutoff list. Page usage reads owned automatic story
bindings from saved page drafts; individual manual article bindings do not count.
Collapse additional page links to keep rows compact. No article bodies enter
the client and no data changes on open. Reuse shared coverage/table/card controls.
Keep old gaps/soon addresses as routes to these views; the main tab is Stories.
This does not establish public runtime aging; shared widget work still must do so.
Reverse by returning to earlier saved catalog/entry drafts; no migration is added.

## 2026-10-31 — Track the expanded54-item Round3 contract

**Decision.** Copy the current approved checklist verbatim and add the supplied
row11 work in its stated order: sourced Data values after Stories, a private
exact Annual Report after those numbers, division-page destinations in Echelon,
and the additional hosting/static-publishing plans. Core requirements 1–8 remain unchanged. Only the report page may retain its exact public people
content; only approved public content and relevant sample seeds. Keep the
three disputed existing SAWSO numbers unchanged, Needs checking (superseded by
the October31 report-authority decision above). Source report
review is required before publication. No live report fetch, background sync,
cloud action or new deployment is authorized. Licence verification remains open
for the reference-only national stylesheet. Reverse implementation through normal
saved drafts/releases and backups; this documentation checkpoint changes no data.

## 2026-10-31 — Enable Stories with a private, site-owned starter

**Decision.** A Site admin or Super admin can create an empty Stories library
from Settings, name its tag groups and choose the review policy. Serialize setup
per site and return the existing library on retry; use the existing list-create
command and RLS. Copy no SAWSO words, tags, images or source connection. Existing
imported-site settings remain unchanged. Settings also saves the review policy
through the catalog command; publication still uses the normal review. No public
feed request occurs during setup. Reverse draft choices through the versioned
catalog; keep immutable history rather than removing a populated library.

## 2026-10-31 — Queue story metadata saves and enforce published feed policy

**Decision.** Reuse versioned list commands for row tagging and review/hide flags.
The browser sends explicit selected states, never article bodies. Apply queued
choices serially with both catalog and list heads; retain failed choices for
Retry/Discard and reload canonical data under the same identity. Retrying keeps
another editor's article draft. Unchanged choices create no new entry head.
List/catalog clients receive lean summaries. New starters use a shared configured
model; the old model remains available for explicit legacy compatibility.

Automatic story bindings filter published hidden/removed/review-policy flags;
private previews use draft settings and entries. Manual article bindings remain
reachable. Other readers, RLS, grants and release commands are unchanged. Draft
tags reach public feeds through the normal reviewed release. Preserve old
coverage/expiry routes until their design pass. Full preview, source refresh,
expanded Overview/map/Split/calendar and clean StoryAdd remain required. Reverse
metadata via an earlier list draft and normal publication; keep immutable history
and the adoption dump.

## 2026-10-31 — Manage tags uses atomic, scoped draft commands

**Decision.** Build Manage tags with shared catalog rows/cards/badges and an
opt-in compact Dialog density matching row 10. Keep existing component defaults.
The server derives operations from the current site-owned catalog, checks both
list heads and Site-admin rights, and uses the existing model/entry commands in
one identity transaction. A rename keeps IDs; delete moves or removes only the
chosen group's tag; suggestions skip reviewed stories. Derived display labels
change with tags, while body copy, photos and source addresses stay intact.
Unchanged operations create no extra model history.

Existing single-region SAWSO models are recognized by their legacy field shape
on copied sites; an explicit per-site catalog always wins. Upgrade only after
an explicit management save, retain the first legacy region, and let current
story forms read custom IDs and multiple secondary tags. Other sites use their
own names and catalog. No retained data is backfilled and no source feed is
read. Restore an earlier list draft to reverse content changes, then review and
publish normally; the compatibility reader continues to accept old records.
Expanded StoriesHub, refresh, widgets, calendar and the full acceptance walk
remain separate required work.

## 2026-10-31 — Keep site-specific Stories tags in versioned list models

**Decision.** Extend the existing collection presentation with an optional,
closed Stories catalog rather than introducing a second content store. It
contains both tag groups, stable IDs, labels/order/keywords, approved map areas
and the review policy. Ordinary collection schema save/publish commands retain
their existing Site-admin permissions, immutable versions and stale-save checks.
SQL validates the same closed shape as the application. Existing records and
frozen sites receive no backfill. New multi-region reads retain the first legacy
region; moving/removing a tag preserves unrelated content. Suggestions use only
the approved tool's title/description keywords and preserve reviewed stories.

**Why.** The approved TagManager explicitly saves drafts and offers Publish;
public tag changes should use the existing release instead of bypassing it.
The source tool's PHP, authentication and JSON file storage are not imported.
Its approved taxonomy supplies fresh SAWSO defaults; the existing eighth sector
keeps its ID with no invented keyword suggestions. No public feed is read by
this piece. UI, refresh, feed rendering and the complete required walk remain
open. Reverse by dropping the optional settings from a new model draft and
publishing normally; immutable old versions and legacy fields remain readable.

## 2026-10-31 — Header buttons share the four destination choices

**Decision.** Header buttons use the same destination fields as native page
links, inline with the approved A page/A website/Email/Phone labels. Keep Label
and Tracking code beside them. The Site-admin save checks button text and a
valid destination, preserving the existing HTTPS/path policy while adding only
email and phone contact schemes. Database permissions and frame commands stay
unchanged. Contact links retain their destination without website tracking;
the stored code survives a later switch back to a page/website. Reverse by
restoring the old fields/adapter; existing ordinary link values need no migration.

## 2026-10-31 — Focus title edits and put link settings behind Change

**Decision.** Selecting a native top-level heading/title opens a focused panel
with Back/Done and the adjacent link summary. Keep the section outline and
current page layout. New sections open their full content view. The shared
Change dialog retains page, website, email and phone destinations plus per-link
behavior; ordinary Editors receive no button appearance controls. Existing
Advanced roles keep appearance behind Advanced. Original-design editing stays
compatible.

Nested cancellation restores a snapshot of that one field's value, presence and
sample marker, by stable section origin. It preserves unrelated edits and the
existing Undo/save/release authority. Revert and sample indicators remain in the
focused title view. Reverse by restoring the prior UI; immutable saved history
and existing link values require no migration.

## 2026-10-31 — Native Site look edits appearance only

**Decision.** Initialize the private appearance preview from the saved frame and
navigation. Remove its duplicate native frame editor and offer canonical
Header & menu/Footer links to Site admins instead. Reject native writes through
the legacy paired-frame action; brought-in sites keep their existing path.
Measure the available panel height so draft controls stay within the window.

Template-owned layout stays fixed. Appearance readiness recognizes the existing
validated exact national red/white exception, while every other pair still needs
AA. The actual contrast badges keep reporting their measured result. No database
permission, contrast exception or stored content is broadened. Reverse by
restoring the prior screen/action adapter; draft history remains unchanged.

## 2026-10-31 — Page editing hands shared areas to site-level screens

**Decision.** Native header/footer clicks expose scope metadata and Back/Done,
with role-gated links to their matching site screens in a new tab. This keeps
the original page session and current edits intact. No inline menu, identity or
frame fields remain in that page panel. Footer uses Open Footer to name the
approved dedicated destination. Original-design flows remain compatible.

Native Page details has a saved menu-location note. Its command accepts null
for preserve-menu and rejects an explicit membership change, even from a Super
admin. Renaming a native page and publishing it preserve existing automatic
menu labels. New-page additions and removal of unavailable pages keep the
existing engine. Page locks, revision checks, site access, hierarchy validation
and normal release commands stay enforced. Restore the prior UI/function
definitions to reverse this behavior; no stored content is rewritten by this
migration. Existing dedicated Header/Footer permissions are unchanged.

## 2026-10-30 — Native page navigation remains beside the preview

**Decision.** Native editors preserve the left page list at1440/1024 and open
one section at a time. Cards have one navigation target while all member
values remain searchable and retain their change/selection identities. Search
can reveal matching rows; brought-in sites retain their old behavior.
Selected native rows keep their move/visibility controls rather than showing
those controls on every collapsed row.

A panel preference remains in browser storage, with its rendered width bounded
by the available space. Native workspace ancestors use clipping so programmatic
selection scrolling stays inside the page instead of moving the external
toolbar. No public markup, saved content or write authority changes. Reverse
by restoring the previous display components; browser preferences remain safe
to ignore or reset with the existing divider.

## 2026-10-30 — Selecting content never inserts layout children

**Decision.** Native page editing opts into a closed display-only layout policy.
It suppresses canvas insertion buttons and added sample grid/list children, and
keeps section actions outside the page. Add card lives in the panel. The isolated
canvas carries only a validated boolean for that policy; it gains no code, content
or command authority. Brought-in sites retain the existing default and controls.

Native repeated content has a one-item panel using the existing fields and
commands. Empty starts clear new sample values/markers; duplicates preserve
chosen content. Cancel removes the new item completely, including when restoring
a previously below-minimum draft. Untouched insertions are removed on selection
changes using the stable section origin and the current editor state, preserving
unrelated edits. Typed work stays in the draft. Reverse by restoring the prior
UI behavior; saved content/version and access contracts are unchanged.

## 2026-10-30 — Hero controls preserve the approved placement and editing target

**Decision.** Use one code-owned open-chevron icon beside the original dots
pill at the hero’s bottom right; dot anchors keep previous slides reachable
without JavaScript. Public six-second/pause/reduced-motion behavior remains.
The editor opts out of automatic movement before its first field selection;
manual canvas navigation selects the matching slide’s photo/fields through the
existing private bridge. Neither saved words nor image/link behavior changes.

The national parent advances to version3. Remove the hero-specific12-item cap,
using the existing48-item repeated-content and content-size safeguards. Those
safety bounds remain explicit; this is not unbounded storage. The left tree
navigates by slide while retaining all slide words for search. Shared updates
stay drafts until reviewed publication. Reverse through a prior draft/version
and normal release; immutable pins remain. The independent card-selection
reflow is captured and remains the next editor correction.

## 2026-10-30 — Numbered app acceptance and exact editor behavior govern Round 3

**Decision.** Adopt all45 approved checklist items verbatim in SPEC and track
real-app screenshot evidence by number. Automated success does not establish
acceptance. Updated HeroSlides, EditorClean and HeaderMenu govern the next
pieces: hero immediately after Footer, then selection-invariant card/title and
site-wide navigation handoff. Existing link choices, focus previews, page list,
page-count note, move buttons and Material Symbols remain required. Unfinished
items stay Fail or Not built by number at handoff. This supersedes earlier
hero-control/flat-panel completion claims; no permissions are weakened.

## 2026-10-30 — Footer has its own workspace and inherits the site logo

**Decision.** Footer work reuses the established Site-admin predicate and
changed-area global draft command. It preserves the header and navigation,
with both frame revisions checked before saving. The national template opts
its image slot into header-logo inheritance; a custom footer image overrides
it. The renderer and media-reference walkers resolve the same own-site value,
using published values for public delivery. Disabled headers do not remove an
image still rendered in the footer. Existing immutable versions are unchanged.

The three-card workspace edits ordinary link paragraphs as sortable rows.
Unfamiliar formatting stays editable as rich text, preventing lossy conversion.
Plain paragraphs use a plain text field without exposing markup. The preview
uses the actual saved-site skin; only its private footer focus temporarily
releases a sticky header so the footer is visible. Reverse by restoring an
older frame draft and publishing it through review; retain version/media history.

## 2026-10-30 — Separate header work preserves the footer draft

**Decision.** The Header & menu screen checks the existing Site-admin predicate
and uses the normal navigation/global-element commands in one transaction.
The global-element command gains an explicit changed-area mode so header work
preserves the footer's version. Its original signature still performs a paired
save for existing callers. Both modes use the established restricted command
owner, locks, validation, conflicts and audit. A stale menu rolls back the header
edit. Source preparation creates immutable shared definitions only; accepting a
new header and publishing it remain explicit. Reverse through saved history or
unpublished-draft replacement; do not remove published versions.

## 2026-10-30 — Site identity uses ordinary shared fields

**Decision.** National frames declare a logo and an optional second button.
The approved shield is the starting value only for a new logo field. Existing
logo choices survive an explicit design upgrade. Tracking remains query data
on a button, with a safe destination retained. Root-only dropdown groups use
a closed optional flag on the existing navigation model and native details;
normal parent links are unchanged. Existing save/publish and permission commands
remain the authority. Dedicated screens and page-control removal follow in
separate pieces. Reverse by reverting unpublished frame/menu drafts; published
pins remain immutable and can be restored through History/release recovery.

## 2026-10-30 — National updates and site copies stay private

**Decision.** Template review uses real saved before/after renders and a
fingerprint of the reviewed theme, page heads and shared section versions.
Application rechecks that fingerprint and uses normal save commands atomically.
Site creation reuses the setup/import commands, keeps copies private, verifies
only needed assets and repins current copies to shared global sections. Word-free
copies retain section appearance and repeat-item counts; isolated historical
section copies stay hidden in the library. Cancel creates no record and retries
preserve later work. **Why.** Template reuse must preserve ownership, layout,
content and publication control. **Reverse.** Restore page/theme checkpoints
through History; archive an unused private copy through the normal site flow.

## 2026-10-30 — The approved Stories required list is the acceptance contract

**Decision.** SPEC §17.6 replaces its short summary with the approved tool's
MUST-HAVE list, preserving its look and behavior in shared CMS components.
Every required item needs an acceptance check; unfinished items are named
under Needs administrator input. Check for new stories is the sole permitted public SAWSO
feed read, triggered by a user's button press. No scheduled/background read.
CMS edits, tags and Reviewed status must survive refreshes. **Why.** Preserve
the existing workflow without silently omitting required behavior. **Reverse.**
Disable the manual refresh action; do not remove imported stories or reset tags.

## 2026-10-30 — One parent, with database-enforced site controls

**Decision.** SAWSO and Echelon starting themes derive from one national parent,
with separate font choices and immutable policy metadata. Colour changes start
off. A site admin may change approved fonts but cannot detach the parent,
unlock colours, or change layout/buttons through a direct command. Original
imported designs cannot be bound to this parent. Existing immutable snapshots
are not rewritten; review/apply and retained-site migration follow separately.
The inherited contrast exception remains limited to the existing exact red and
white pair; other contrast and authorization checks remain enforced.
**Why.** A shared preset alone cannot enforce site-level control boundaries.
**Reverse.** A Super admin can change the policy through an ordinary saved draft;
revert the migration only with the reviewed database recovery plan.

## 2026-10-30 — National pages enforce their content surface

**Decision.** The shared national renderer gives ordinary sections a white
container automatically. Composed national sections retain their existing
white cards, while page titles remain on grey and supplied introductions get
a white surface. This applies equally to public pages and the editing canvas;
original imported designs and standalone catalogue previews remain unchanged.
**Why.** Reports, accountability, team content and newly added sections must
not depend on an editor remembering a background setting. **Reverse.** Revert
the national panel helper and page-shell opt-in; saved content is unchanged.

## 2026-10-30 — Full admin structure pass is part of Round 3

**Decision.** R3-7b requires inspected 1440/1024 mockup comparisons, recorded
as Matches or Differs with reasons. Demo-route
screens come first. Layout and hierarchy must match; token changes alone do
not establish completion. Remove mockup-absent controls unless a reason is
listed; preserve features/test-visible names or update SPEC in that commit.
Screens outside the accepted release scope remain deferred roadmap items.

**Why.** Existing restyle completion does not establish the requested structural
match. **Reverse.** Revert a screen commit without altering data or permissions;
Scope changes require platform-lead review.

## 2026-10-30 — Round 3 uses one national template and site-owned controls

**Decision.** SPEC §17 and approved mockup row 10 now govern the finishing
step. SAWSO and Echelon share a national parent and shared sections, with
per-site identity, content, tags and approved heading fonts; colour changes
are disabled for both. Header/menu/footer editing belongs only to the site.
Stories becomes an opt-in site feature using the approved local PHP tool as
behavior/data reference, with CMS authentication, storage, commands and RLS.
Draft/Schedule/Publish share review and saved-difference summaries. RoleViews
and the editing map remain drafts, constrained by existing database rules.
Echelon uses the exact reference templates and reviewed replacement text,
with sans-serif headings and no chapter stories option. Handbook topics and
Google environment/backup/rollback planning accompany features; no deployment.

**Why.** Keep one approved national experience, clear ownership and a clean
editing flow while preserving the brought-in sites and existing enforcement.
The October 30 instruction authorizes only a one-time read-only fetch/local
reference copy of the named public Zesty theme files; licenses remain open.
Adobe fonts load from a narrowly allowed kit, never a local font bundle.

**Limits.** Local only, $0; dump before data changes; no retained-demo reset.
No cloud/deploy/DNS changes, Microsoft sign-in, automated drafting, Handbook question
service, Better Together or HNI changes. Browser verification uses isolated fixtures and bounded workers; required
release coverage is specified by the current verification gates. The reference license/font/domain and Echelon review items remain
Needs administrator input. No completion is inferred from older acceptance results.

**Reverse.** Revert feature commits in reverse order, preserving content dumps;
restore this planning commit only if the maintainer changes direction. A code
rollback cannot undo a database migration or restore discarded drafts; use
the reviewed backup/restore plan and avoid destructive migrations.

## 2026-10-29 — New Stories use the shared template

Add story saves one list row and its private template page atomically through the existing commands; page creation remains limited to its existing roles. Photos must be ready, owned or shared Media. Imported stories keep their old addresses; new stories leave that optional field blank. The local initializer upgrades only that known requirement when there are no private field changes. To reverse, remove the add action and restore the old requirement after checking new records; existing imported records are preserved.

## 2026-10-25 — Revision 8: editing experience first, real sites in scope

**Decision.**

- SPEC revision 8 replaces revision 7 as the product direction.
- The editor, a **shared core section library** (global definitions themed per site) and task-first workspaces are the priority.
- New sites stop receiving per-site "· site starter" copies of seed sections.
- **UI is built from the SPEC and judged on screenshots.** UI items need the maintainer to see screenshots before they close. Approved mockups in `docs/design/approved/` are optional: the maintainer adds one when a built screen should look different, and builders then match it.
- The product's purpose now includes hosting the team's real sites (Better Together 2027 first, then Echelon chapters, AO Hub, HNI and SAWSO). the platform lead set this direction on Oct 21 and Oct 23.
- The operational safety boundary is unchanged: no Salvation Army credentials, no live Zesty/cPanel/DNS changes, no cutover without maintainer and platform lead authorization; imports use local copies.
- Revision 7 is archived unchanged in `docs/archive/` because code cites its section numbers. Its engineering contracts still apply.

**Why.** The editing experience needed improvements relative to the V1 reference:

- bare starter sections on new sites
- an undifferentiated inspector
- workspaces that show the data model instead of the task
- weak wayfinding and status
- no shared design system

The product scope includes hosting real sites on the organisation's Firebase/Google Cloud project.

**Reverse.** Restore `SPEC.md` and `AGENTS.md` from git history. The archived revision 7 is in `docs/archive/SPEC-r7-2026-10-11.md`.

## 2026-10-25 — Hosted pilot on Cloud Run + Supabase Free + Firebase Hosting

**Profile.** the maintainer’s personal Google project hosts the pilot on this profile:

- admin, site and worker on Cloud Run; request-driven worker with durable leases
- Supabase Free for Postgres and sign-in
- Firebase Hosting as the address and certificate layer, with stable hashed site IDs queued atomically on site creation
- private Google storage through attached identities

Postgres roles/RLS, immutable versions, deliberate publication and the shared renderer are unchanged.

**Spending.**

- A $10/month Cloud Run cap and $15 all-services alerts are configured. Caps are estimates; never lift them automatically.
- Firebase does not support custom roles for Hosting, so use the predefined Hosting Admin role scoped to the project.
- Registry cleanup keeps deployed digests and the newest three versions.

**Sign-in and invitations.**

- Supabase sign-in uses PKCE with a Secure HttpOnly proof cookie. The free plan cannot edit email templates.
- Invitation mail is off for the single-Super-admin pilot; server actions refuse invites rather than fake delivery.

**Robustness.**

- Domain jobs bind to their site before provider calls.
- Certificate DNS instructions read both routing and ACME records.
- The editor mounts its preview frame after hydration, re-requests readiness after load, and offers a deliberate reload after 20 s without readiness.

**Reverse.** Move the same roles and a backed-up Postgres/media restore to another host through the existing ports. No content conversion is needed. Details: [deploy/google](../deploy/google/README.md), [operations](operations.md).

## 2026-10-19 — Explain domain setup responsibilities

Domain setup separates the website hostname, the CMS hosting destination and the authoritative DNS service, and names who supplies each record. The Hostname field explains that nameservers do not belong there. Local demos refuse provider-backed connect/verify, and simulated checks are labelled as such. Reverse the wording if a pilot finds clearer copy with the same prerequisites.

## 2026-10-17 — Presentation rules that stay

- **Hidden sections:** stay editable by default.
- **Preview visibility:** a choice in preview never changes the document, and Undo and publication keep their meaning.
- **List publication:** a review names the additions, edits, ordering and removals, and explains the list's shared scope.
- **Unpublished-change counts:** they count meaningful record differences, not every new immutable version.
- **Demo startup:** the demo honours an explicit Postgres port, refuses a mismatch with a running cluster, and rebuilds stale source automatically.

Revision 8 restyles these screens but keeps these rules.

## 2026-10-16 — Reliable previews

- Design and header/footer previews share one guarded request path. Obsolete markup clears when values change, cancelled requests stay quiet, and a failed refresh keeps draft values and offers a retry.
- A card-order test uses a retrying ordered-text assertion.
- Local sign-in is loopback-only, so a public tunnel is not a supported remote editor setup. Use screen sharing, or the hosted profile.

## 2026-10-11 — Domains, incomplete drafts and drag/focus fixes

- **Domains:** only global Super Admins connect, verify, remove or choose a primary domain. The UI, server actions and SQL agree (migration 0113).
- **Unfinished collection sections:** they render as an empty repair prompt in the guarded editor preview (migration 0114). Publication stays strict.
- **Drag:** cancelling a drag clears the canvas insertion marker through the parent-checked canvas channel.
- **Preview focus:** opening a library preview focuses its invoker first, so Back and Escape return focus correctly in Safari.

Reverse each through a new migration or a replacement flow with the same behaviour.

## 2026-10-10 — Publishing, demo data and readiness

- **Publish together:** when a page links to pages that are not live yet, or the site has never been published, Publish offers one release containing those pages, their lists and, the first time, design, header, footer and menu. Reverse with `publishTogetherPlan` in `apps/admin/src/lib/publish-together.ts`.
- **Demo data:** `pnpm demo` builds from the committed `demo/sites/*.cms-site.json.gz` archives through the product's own import. Local Postgres and demo media live outside the repository, in `~/.local/share/cms-v2` or `$CMS_DATA_HOME`.
- **Readiness:** `alt="" aria-hidden="true"` counts as decorative, and links to the site's own ready pictures count as real destinations (migration 0111, `packages/domain/src/readiness.ts`).
- **Scheduling:** it is on in the local demo, where the worker runs beside the apps. Hosted setups enable it only with independent monitoring.

## 2026-10-07 — Maintainers own technical execution

Maintainers decide and close non-UI work (`AGENTS.md`). Revision 8 adds reviewer screenshot review before UI items close. The retired 99-row register, checklist and dated handoffs remain in git history. Reverse by restoring the register and reviewer sign-off for all items.

## 2026-10-06 — Fidelity differences

Decided under delegation; each can be reversed by implementing the original.

| # | Decision |
| --- | --- |
| D1 | Keep V2's exact header reservation (V1's spacer was 7px short on desktop, 39px long on phones). |
| D2 | One site footer for every HNI page (V1 had a hand-written inner-page variant). |
| D3 | V1's FAQ search works through a code-owned filter; without JavaScript the box stays disabled. |
| D5 | Governed chart controls sit below the Tableau frame, with "Open larger on Tableau". |
| D6 | Two decorative chart icons are omitted until the structured grammar gains a decorative-icon node. |
| E1 | Accept Echelon's 5px phone-header difference (83px against V1's 78px). |
| E2 | Echelon's "Event details coming soon" overflow is repaired, not copied. |
| E3 | Echelon's registration label is made readable. |

Responsive repairs of V1 defects: the HNI footer contact panel opens on-screen on
phones, and Methodology's stats no longer scroll sideways at 768–1023px.

## 2026-10-06 — V1's four form sections are excluded

`contact-form-v1`, `newsletter-signup-v1`, `hero-search-v1` and `locator-form-v1`
never submitted anywhere in V1. Editors use the governed Microsoft/Google Forms
embed or a link button. Reverse: add a governed form handler with hosting.

## 2026-10-04 — Standing platform decisions

- Sign-in is by email link with per-site assignments. Organizational SSO (Microsoft Entra ID) will be prepared for IT (SPEC §9.4) but is configured only when IT agrees.
- Echelon Symposium keeps clearly labelled test content and an honest "coming soon" state until real content is supplied.
- Separate local/staging addresses until a cutover is authorized.
- Recovery targets (provisional): at most 24 hours of lost data, restored within 24 hours; backups include database and media.
- **Open, Super admin only:** who owns the organisation hosting account after the internship, and the right to reuse Salvation Army photos, logos and fonts. The system stays portable so the organisation can take it over.

## 2026-10-02 — Product decisions carried from earlier revisions

| Topic | Decision |
| --- | --- |
| Editing | Real canvas first, synchronized inspector, inline plain and rich text, docked section library (revision 8 makes panels resizable and adds insertion points). |
| Technical authoring | Super Admin owns HTML/CSS source and core/frame sections; Site Admin builds bounded visual site sections. |
| Page templates | Ordered section compositions; using one copies independent instances. |
| Documents | Immutable PDF replacement, search, categories and archive; no general document management. |
| Release recovery | Coordinated drafts and the normal atomic release; no pointer rollback. |
| Source variants | Migrated sites keep their own section variants; new work uses the shared core library (revision 8). |
| Site creation | New sites start as private drafts with an authorized preview; publishing is separate. |
| Responsive model | One page order; per-device visibility, mobile size and two-column reversal only. |

## Earlier architecture decisions

See [`adr/`](adr/): migrations (0001), public renderer database access (0002),
Postgres-native jobs (0003), Node runtime (0004), sanitizer contexts (0005),
structured sections (0006, 0007), governed attributes (0008, 0009), authored
header/footer components (0010) and connecting existing sites (0011).

## 2026-10-25 — Revision 8 review conventions

**Decision:** use reviewed changes with documented verification and designated
visual acceptance. Keep local fixtures isolated from hosted environments and
store operational evidence outside Git.

**Why:** explicit review and environment boundaries make changes reproducible
and preserve retained content.

**Reverse:** revise the contributor review policy through a reviewed documentation change.

**Decision:** keep the existing screen import paths as re-exports of the shared PageHeader and status primitive. Track Back's source on the current browser-history entry, accept only same-origin CMS paths, and fall back to the breadcrumb parent. The site switcher reads a minimal RLS-scoped endpoint. Archive requires typing the saved site name and has its own bottom card.

**Why:** existing screens migrate together without duplicate header implementations; Back cannot take an editor outside the CMS; site names remain readable; routine saves are separate from destructive work.

**Reverse:** remove the compatibility exports after all callers import the primitives directly; history and width preferences are browser-only conveniences and can be cleared without content changes.

**Contrast review:** the specified live green on its 10% tint measures 4.37:1. Keep `--status-live` at the specified value, with a slightly darker `--status-live-text` (#1B7549) for small pill text (over 4.5:1). Remaining status pairs pass. Existing standalone CSS modules were migrated to tokens so the lint gate applies to every admin stylesheet except the grandfathered globals file. Breakpoints use em because CSS custom properties cannot be evaluated in media conditions. Reverse by changing the token values centrally.

## 2026-10-25 — Core catalogue storage and native disclosures

**Decision:** core definitions use reserved `core-` names at global scope. The installer compares immutable render artifacts and slot metadata before invoking the existing upsert command, and never replaces a page pin or draft. Authored purposes, capability flags and examples are versioned in slot constraints, alongside the existing source-sample convention.

**Why:** global resolution, two definition models, samples and narrow commands already exist. Reusing them avoids a second library or an unsafe direct writer. The CLI is deliberately fixed to the local demo on 127.0.0.1:54329 and does not load .env.

**Reverse:** retire the core entries after moving their users explicitly; old page pins remain intact. Remove metadata consumers without rewriting stored content.

**Decision:** add native details/summary to the structured tag allowlist in TypeScript and Postgres. This is the additive-tag case documented by the existing structured schema contract: no new node shape, attribute or script capability; older readers fail closed. People layouts use native biographies and an explicit image class that requests an escaped initials fallback. The three built-in sample illustrations are original geometric artwork; Bootstrap grid code is vendored from 5.3.8 under MIT, with its license.

**Why:** the public page must work without JavaScript, biographies should stay compact on phones, and missing images should remain designed.

**Reverse:** publish replacement section versions before removing these allowed tags or fallback styling. Assets use versioned names and remain available to pinned content.

**Local tool environment boundary:** the new core installer and asset generator intentionally do not load .env. The existing environment-wiring suite now checks their stricter contracts: exactly two installer connections, both fixed to 127.0.0.1:54329/cms_demo, no environment/provider reads or reset commands; the asset tool remains offline. Existing application entrypoints retain their original .env assertions. The fixed local target prevents hosted environment variables from changing the destination.


### Revision 8 — samples, templates and section previews (2026-10-25)

Sample-field names live under the reserved `values.__cms_sample_fields` key, preserving snapshots and page-wide Undo without rewriting old versions. A field edit clears its marker. Policy 3 adds a blocking sample finding; pending schedules move monotonically from policy 2 through the existing audited migration command. The editor provides an explicit “Publish with sample content” confirmation; other blocking checks remain in force. Hidden sections are excluded. Real nonempty list envelopes replace illustrative records; samples never become collection entries. Reverse by removing consumers and reverting the marker-free values in a new draft, never altering immutable versions.

Seven shared page templates compose global `core-` pins; blank gets Page header. Missing global sections fail clearly instead of creating per-site copies. Existing setup files retain their layout choices, and supplied body text is preserved. Sponsors uses Image link cards and Logo strip because Sponsor tiers is outside the 24 P0 section catalogue; a dedicated tiers layout can replace it later. Reverse by saving a new page draft or selecting another template, not changing existing page pins.

The library and inspector remember separate widths. Section previews reuse the sanitizing document renderer with section-only output and a measured natural height. Static neutral section captures provide useful fallback thumbnails while themed worker images are pending. Open Sans and Material Symbols are development-time font assets with full bundled license notices; they add no runtime service. Proprietary brand fonts remain unused.


People examples use initials avatars, rather than suggesting that a building illustration is a speaker portrait. Event home binds up to six speakers and a three-session teaser; dedicated list pages use the existing guarded 100-item ceiling. This preserves the renderer's bounded collection contract. Replace examples with real list records or change the binding limit to reverse these choices.


### Revision 8 — page recovery and private list previews (2026-10-25)

Reset to live reads both page heads under a lock, checks the loaded page revision and published source pointer, checkpoints the previous draft and saves through the existing app command. Older sections have no persistent instance identity: an explicit live-section picker avoids guessing when layouts repeat or positions changed. Undo remains one page-wide history. Reverse by restoring the earlier checkpoint; no immutable version is rewritten.

List edits reuse the existing shared field controls and collection command/CAS boundary. An explicit authenticated preview projection resolves saved entry drafts, with the same bounded and validated envelope consumed by the sanitizing renderer. History and public publication continue to use the strict canonical database manifest. The projection writes nothing and is capped at the canonical manifest size. Reverse by removing the private projection argument and returning to published list snapshots.

The responsive baseline/preset header uses a native phone disclosure and a CSS-hidden desktop menu generated from the same navigation model. It needs no public script. Authored imported frames keep their own pinned markup. Section anchors use reserved instance metadata and retain numbered renderer scope ids; both Postgres and the renderer reject reserved or duplicate anchor names. Reverse by clearing the authored anchors in a new draft, not editing old versions.

Copied sections receive an available numbered anchor suffix (within 64 characters) as part of the same Undo step, so Duplicate never creates an unsavable draft. The original anchor remains unchanged.

### Revision 8 — site-wide drafts, page grouping and dynamic list choices (2026-10-25)

Header, footer and menu edits use an explicit purple site-wide mode. A single identity-scoped transaction saves the existing frame and menu commands with their loaded revisions; a stale menu rolls back frame edits. Save refreshes the canonical site preview; Done also saves before leaving. This keeps menu naming in place without introducing a second client renderer or making a page Publish action publish a site's frame. Reverse through a new site-look draft; published snapshots remain unchanged.

Parent page is a same-site, cycle-free grouping relationship independent of dropdown nesting. A narrow page-details command coordinates name/address, grouping and optional menu visibility, retaining the existing live address until publication. Removing a parent menu link promotes its child links rather than losing them. The relationship is optional in version-1 site archives, so older archives remain valid. Reverse by moving a page to the top level or restoring a saved draft; no immutable page version is edited.

Newest means the date an item was added, with its stable identity as the deterministic tie-break for batch imports. Filters match a select category or a declared tag/category text field; comma-separated tags match complete, case-insensitive values. Choices remain bounded to 100 records and are resolved dynamically by the canonical database reader. Authenticated draft previews apply the same choice to saved drafts; public output always uses published records. Reverse by choosing All or Pick specific items. No new public reader or arbitrary query capability is granted.

Copy section stays private to the same user and site in the browser for up to 24 hours; it carries the exact layout pin and the full saved value shape. Paste is one page-history action and uses the existing unique-anchor rule. Duplicate page is a new private draft with its own available address, and never copies a publication or approval pointer. Reverse with page Undo or archive the copied page.

Structural edits temporarily block canvas interaction until the canonical saved preview is ready. Plain and formatted text keep their existing in-place patch/caret path; clearing their editorial sample chips does not reload the page. A list's sample marker can change its illustrative fallback, so that change still needs the canonical preview. The guard prevents a click on an old positional section from editing the new section at that index. Undo and the inspector remain available during refresh. Reverse by replacing the guarded reload with an equally identity-safe structural patcher; never accept edits against stale section positions.

Floating menus measure their available space, including the canvas's Zoom control, and open above or below with bounded scrolling. In-canvas ghost controls are private editor DOM only, with physical target/text sizes corrected for preview scale; the fixed preview bridge leaves their native clicks alone. Remove these conveniences to reverse them; neither is serialized or published.

### 2026-10-25 — Page identity participates in the editor's history (ED-3, ED-8)

Keep the page name and address beside content in the session document, outside SEO metadata. Saving Page settings creates one history step; whole-page Discard restores the live name/address as well as content, and Undo saves the previous identity through `app.rename_page` followed by the ordinary draft command in one transaction. This closes a misleading partial discard without adding write privileges. Contributors can save unchanged identity with their content, but cannot reverse an administrative rename; the existing Editor permission remains authoritative. Parent grouping and menu membership remain site organization and Site look, respectively. Reverse by removing the optional session identity and its save adapter; immutable versions and published addresses remain intact.

### 2026-10-25 — Approved import fidelity and approved site scripts (MG-1/MG-2)

The maintainer explicitly changes SPEC §11.1 and §15.2: imported sites must preserve appearance and behavior, including original markup/classes/data attributes, complete CSS/fonts, carousels, popups, menus and filters. Implement immutable, site-owned script assets with Super Admin review (file, size, source), activity history, exact-byte approval, original order/position and page scope; publish through the normal release. Enforce exact per-site CSP, no inline or third-party execution, no script privileges for Editors, unchanged section sanitization and no policy change for script-free sites. Run approved enhancements in the editor while protecting direct edits; keep server-rendered no-JavaScript content. Step 5 must serve the local original and compare all marketing pages at 1440/1024/390, including behavior, treating every difference as Major and reporting any remaining difference with its reason. This overrides the earlier blanket scriptless rule; it does not authorize hosted work or live-site access. Reversal requires an approved change to these product requirements, then reverting the optional asset/release adapter; retain immutable history and sanitize fields throughout.

### 2026-10-25 — Keep canvas controls clear of content (ED-3, ED-10)

Reserve a token-sized gutter for insertion targets so short imported text remains clickable. Keep item controls in a context row above the preview. Section controls float when there is room and move to that row if they would cover text or leave the viewport; both sets remain available. Shared menus clamp to the canvas boundary. This serves the same editing actions at 1024 and in Phone without covering headings. Switching site-preview context protects the old iframe until the replacement is ready, and site-wide mode waits for the real purple frame state. Page-selection acknowledgements cannot end a menu edit. Reverse the adaptive placement in CanvasChrome and the optional shared Drawer footer; canonical rendering, content and database contracts are unaffected.

### Revision 8 workspaces: shared editors and native menu layers (2026-10-25)

Home tasks and Pages use RLS-scoped saved work, hierarchy and menu facts. They do
not invent personal assignments, expiry dates or activity. An editor is named
“You” for their own saves and “Another editor” when the directory’s privacy
policy does not expose a name; this does not grant broader access to people.

Site look composes the existing theme editor with the same header/footer/menu
panel used on the page canvas. Each area saves its own guarded draft; publishing
continues through the existing atomic release review, listing affected pages.
This keeps the role boundary between theme administration and editorial menu
content. Reverse by moving the shared controls to separate routes; stored
artifacts and commands need no migration.

Action menus use the browser’s native popover top layer, with measured viewport
or canvas bounds and Zoom avoidance. A menu inside the scrolling Pages table was
otherwise clipped and could not be clicked. This also keeps menus above dialogs
without duplicating a portal/focus system. Reverse by replacing that presentation
primitive; menu actions and persistence are independent.

### 2026-10-26 — Schedule a reviewed release through the existing engine (WS-6)

Publish later pins the reviewed Pages, Lists and Site look release as one queue
intention. The worker uses its existing ephemeral lease capability to ask the
admin's bounded execution endpoint to resolve the stored creator; it cannot
choose an actor, site or release. The admin rechecks the lease and current role,
runs the same release engine and settles the job in one transaction. No new
service account or credential is introduced. New edits or readiness findings
require a new review; sample consent is explicit and retained. The old page
scheduler remains available for a single saved page or its removal.

This avoids a second implementation of multi-item publication under the worker
role. Reverse by disabling release schedule creation and draining/cancelling its
pending jobs, then removing the HTTP dispatch; keep immutable schedule history.

## Reviewed image replacement prepares drafts (2026-10-26, WS-4)

Replacing a library image chooses another ready, site-accessible asset and reviews
its current page, list and Site look destinations. Selected destinations are saved
atomically through the existing compare-and-set commands. The review fingerprints
saved content, permissions and both assets; a changed review must be refreshed.
Original bytes, live pointers and saved history stay intact until normal publication.
Each placement keeps its description and decorative choice, because the same image
can serve different purposes; the review explicitly asks editors to check those
words before publishing. Replaced sample-image fields lose only their own sample
marker. Editors cannot use this operation to alter authored HTML/CSS; those
destinations require a Super Admin. The shared picker uses the native shared dialog
so it also works above a list drawer. No new database grants or commands are needed.
Reverse by restoring the earlier destination versions as drafts, or choosing the
original image again; the operation never overwrites the old asset.

## Share complete preset frame controls (2026-10-26, WS-5)

Site look and the existing frame workspace now use one PresetFrameFields component
for header identity, partner, links, actions and the complete footer. Native
disclosures group longer forms; a fixed Save footer and a focused-field scroll
area keep editing usable at 1024 px. Incomplete fields keep the last valid page
preview while Save explains the correction. Server capabilities determine whether
controls are editable; foundation identity remains Super Admin only. The standalone
preview describes menu editing in the adjacent tree, while the page editor keeps
its direct header editing. Reverse by changing the shared fields or composition;
no stored configuration, command or permission needs migration.

## Preserve menu identity while changing visibility (2026-10-26, WS-5)

Hide/Show changes only a menu item's visibility, retaining its position, destination
and dropdown links. Hidden page targets remain in the menu's used-page set, so
Add page never flattens a hidden dropdown or creates duplicates. Editors can
prepare links to unpublished pages in a draft; the existing public renderer and
publication readiness still decide which destinations can be shown. Web links
use the shared bounded HTTPS/internal-path grammar, and removal names any child
links in a confirmation. All saves use the existing atomic frame/menu commands.
Reverse by changing the controls or restoring an earlier menu version as a draft;
no stored shape or permission migration is needed.

## Self-hosted theme specimens and reversible presets (2026-10-26, WS-5)

Modern, Editorial and Reading pairings use the shipped Open Sans and Source Serif
4 Latin regular/bold files. Source Serif 4 is OFL licensed; its pinned development
package and Adobe upstream license notices ship with both apps. Migration 0129
adds only the exact named stack to the existing allowlist, retaining all other
validation and permissions. Existing font choices and history are preserved.
Button shape, fill and hover choices show real examples and update the real page;
Save and validation stay in a fixed footer. Invalid colours keep the last valid
preview; insufficient contrast blocks publication before release preparation.

The requested Better Together 2027, Echelon and SAWSO presets are editable starting
palettes: respectively deep blue/gold, dark red/ink with square corners, and
teal/navy. These are deliberate provisional defaults, not claims of exact brand
specifications. Original imported sites retain their exact source CSS and fonts;
a preset does not replace that fidelity contract. Reverse by selecting an earlier
theme version as a draft or another pairing/preset. Keep font assets while any
saved/published theme version references them.

SPEC §9.1 and the database commands require Site Admin for theme changes. The
Editor-accent task in §14 is read as a role-bound acceptance check: verify refusal
as Editor, then success as Site Admin; header/footer/menu content remains editable
by Editor. Do not weaken the existing permission boundary to satisfy that
ambiguous task. Reverse only through an explicit product permission change and
matching database-policy tests.

## Shared verified logo choices (2026-10-26, WS-5)

Full and compact site logos use the same verified media picker as page images.
The header describes the brand with the site name, so logo picking does not ask
for an unused placement description or overwrite library descriptions. Both
choices retain their media identities; removing a choice falls back to the other
logo or site name without deleting the file. Empty, loading and unavailable
libraries have distinct messages. Reverse through an earlier header draft or by
choosing another existing image; all immutable header versions remain available.

## Reviewed section updates across administered pages (2026-10-26, WS-8)

Sections and the editor share one card presentation. Section details expose the
current sample preview, fields, immutable versions and current usage. Saving a
new version leaves existing page pins alone and offers Update pages. The update
review includes only active pages on sites the reader administers (Super Admin
can include every accessible site). Before/after previews update all older
placements of that section on a page together, preserving compatible values.

Selected updates use the existing upgrade engine and app.save_page_draft in one
transaction, with sorted page locks, loaded-version/revision checks, render-policy
validation and recovery checkpoints. A stale, incompatible or unauthorized page
rolls back the whole selection. Live pointers are untouched. Limit each selection
to 100 pages to bound transaction work; larger sets can be updated in successive
reviewed batches. No schema or grant change. Reverse a page through its recovery
checkpoint; remove the batch interface without changing existing saved versions.

## Related publication uses one complete release review (2026-10-26, WS-6)

The editor's first/linked-page publication planner treats sample findings as
reviewable content, rather than interpreting their field details as missing
links. Its action opens the shared Publish review with the required pages and
shared areas selected. Unrelated pages stay unchecked. Every affected page's
samples are listed and require explicit consent before execution. Query values
are only initial-selection hints; RLS, permissions, immutable heads, readiness
and normal release confirmation remain authoritative. Reverse by removing the
selection hints and opening the same workspace with no preselection; do not
restore an immediate action that hides related-page findings.

## Separate orientation from the page table (2026-10-26, WS-1, WS-2)

Home contains personal tasks, recent work and the site grid. All sites opens a
separate directory using the same cards. Within a site, Overview shows quick
actions, attention and the page tree; Pages opens the same tree without the
orientation cards. Both use one server workspace and the same RLS-scoped queries,
filters and page commands. This makes the rail names agree with each screen and
keeps Back useful. Reverse by changing route composition; there is no content or
permission migration.

## Scoped administration links in the rail (2026-10-26, SH-2, WS-1)

Every server shell receives the resolved session principal. People appears only
for Super Admin; Sections appears for Super Admin or Site Admin on the current
site, after the routine site areas. A higher membership on another site never
adds these links here. Missing access defaults to ordinary destinations. This is
presentation only: existing RLS, route checks and command permissions are kept.
Reverse by changing navigation composition; do not infer site rights from the
person's highest display-role label. The editor's All sites exit leads directly
to the directory through the existing unsaved/pending navigation guard.

## Shared native confirmations and list image choices (2026-10-26, WS-3, WS-4)

Confirmations use the shared native dialog so they remain above drawers, with
safe initial focus, bounded keyboard navigation and focus return. Confirmations use Cancel and Escape without a redundant header close button, preserving the reason-field/Cancel keyboard loop. Referenced
image deletion requires an eight-character explanation in both the controls
and the existing command guard. Restore is a routine primary action. Lists use
the existing verified image picker; their saved image values still contain only
src, alt and decorative, and library descriptions remain unchanged. Review
comparisons show item names and values; permanent keys and field metadata live
inside Advanced. Reverse these presentation choices in the shared components;
keep immutable review snapshots, asset verification and command permissions.

The rail follows the SPEC order: Home, All sites, the full-name site switcher,
site areas, then bottom Inbox/People/Activity above the account. It reuses one
link renderer and keeps the same role-scoped destination model. Reverse by
changing the shell composition only.

Media grids and pickers share one thumbnail component. A temporarily unavailable
preview uses a labelled placeholder, without changing the verified asset's
status or saved placements. Focus-point ranges keep working when the picture
cannot load. List cards reserve their top row for selection/order controls and
wrap names inside the full-width content area. Reverse these display choices in
the shared thumbnail and Lists module; media approval and delivery stay intact.

## Reviewed site files preserve imported behavior (2026-10-26, MG-1)

What: immutable site-owned files use the existing configured object store. A separate reviewed version lists their exact hashes, script order, position and page scope. Only Super Admin commands can register files or approve/restore a version. Publication joins the ordinary atomic release, with exact file checks on delivery and per-page CSP/SRI. Script-free sites retain their policy and section fields retain the sanitizer.

Why: source scripts need their original DOM and order, but a mutable URL or approval boolean cannot establish which bytes were reviewed. A full version also makes replacement/removal reversible and preserves activity/history. No package scanning, CDN loading or app credentials are required at runtime. The local PHP marketing include chain contains only presentation variables and no application/database includes; application areas are excluded.

How to reverse: restore an earlier reviewed file version through a normal release, or publish an empty file bundle. Objects and versions remain immutable. A future storage adapter can move objects while retaining hashes and authorization. Script-enabled canvas pages must be isolated from the admin session; same-origin script execution is not an acceptable shortcut.

## Review file choices before publishing them (2026-10-26, MG-1)

What: Super Admin Settings opens a file workspace. Uploads first become private immutable files; the complete list shows source, size, loading position/order and chosen pages. Explicit acknowledgement saves a new reviewed version, and the ordinary Publish workspace releases it. Replacement preserves loading choices; removal and historical restoration also require review and release.

Why: a file picker alone does not make executable changes reviewable. A visible approval acknowledgement and separate publication preserve the same draft/live boundary as the rest of the CMS. Order controls move only among scripts with the same execution position, because other moves would have no effect. Public file delivery revalidates authorization rather than caching past approval removal.

How to reverse: restore a retained file list as new choices, review it and publish, or publish an empty list. Every source file and approval remains retained.

## Isolate script-enabled editor canvases (2026-10-26, MG-1)

What: use the separate public-site origin for a site with approved scripts. A short-lived read-only preview ticket pins one authorized page, its site look, approved file version and referenced private assets. The ticket is rechecked after expiry, lost access or archive. It never contains an admin cookie or grants a write command. A bounded message bridge carries editing intent back to the existing editor, where normal permission, sanitizing and revision checks still apply.

Why: reviewed site scripts must run on the real canvas, but giving them the admin origin would expose the editing session. Ordinary script-free sites retain their current canvas. Reuse the shared section controls, rich-text model and toolbar across the boundary; pause carousels while editing. The iframe loads only reviewed files and a code-owned external editor runtime under exact hashes.

How to reverse: disable new script-canvas tickets and publish an empty reviewed file bundle, keeping all content and versions. Existing site rendering and script-free editing remain available. No hosting configuration, new account or shared production secret is part of this local implementation.

## Private preview resources work without third-party cookies (2026-10-26, MG-1)

What: isolated canvases use ticket-scoped URLs for exactly referenced media, assets and reviewed files. The original file bytes are verified before delivery. Private CSS changes resource addresses only, using the shared CSS tokenizer; selectors, animations and declarations keep their meaning. Original JavaScript bytes and SRI stay intact. A code-owned prelude maps same-site fetch/XHR resource requests into this read-only namespace. Public output is unchanged.

Why: a local browser experiment proved that a Secure partitioned HttpOnly cookie reaches the cross-site iframe in Chromium and Firefox but is refused by WebKit. Depending on that cookie would break private fonts/images and interactive lists in a release browser. URL capabilities require no browser storage, admin session, proxy destination or hosting change. The response is private/no-store and suppresses referrers.

How to reverse: replace this transport with another verified read-only capability transport. Keep exact Host/page/asset approval checks and isolated origin; do not relax private content or CSP.

## Keep complete library cards usable on short screens (2026-10-26, LB-4 / MG-1)

What: the destination is named in the pinned title, with Change opening its selector. Secondary controls, categories and cards share one ordinary scroll area; search stays visible while browsing. Hover highlights a card without scrolling it. Keyboard navigation and filtered results can still reveal the active card.

Why: at1024×768, pinning every control above a separate card scroller left only a strip for cards. Hover also scrolled whole cards during pointer clicks in WebKit. One scroll surface gives thumbnails, names and actions enough room together, without hiding categories or adding another filter mode.

How to reverse: change the scoped library layout or reveal policy; preserve explicit destinations and stable pointer targets.

The first catalogue opening stays at its controls; automatic reveal begins only after keyboard/filter interaction. Opening Change scrolls its selector into view. Focus mode keeps one exit control in the canvas toolbar plus Escape; removing its duplicate floating exit stops it covering page content.

## Reuse controls across the isolated editor boundary (2026-10-26, MG-1)

The isolated canvas reuses the existing section controls and rich-text model locally; the main editor keeps the same page history and write commands. A display-only projection and closed intents cross the exact origin/source/channel/document bridge. Before structural actions or saving, final text values precede an acknowledgement on the same message stream. Code-owned controls use scoped tokens and an inverse zoom so their targets remain usable without changing the original site's layout. Insertion controls sit opposite the section-name tag and open labels inward, keeping labels and short scaled footer text clear. Reverse by changing these owned UI adapters; keep the origin separation, exact file approval and normal command checks.

## Scripted visitor previews use the isolated saved-page capability (2026-10-26, MG-1)

What: visitor Preview opens the separate site origin using a saved-page ticket, without an opener, admin cookie or editor controls. It renews through the authenticated editor while that editor remains open. Existing governed FAQ, schedule and embed enhancements use their exact code-owned external files on scripted sites; script-free sites retain their previous output and policy.

Why: a visitor preview must show real behavior without executing site code on the CMS origin or adding inline execution. Readiness starts with a child announcement and one fresh document challenge. An iframe load event must not reset an already confirmed document: that race could discard menu-editing commands after a saved refresh.

Reverse: return scripted previews to inert evidence and remove the external-widget option and fixed-file route together. Keep section sanitization, exact file approval and separate origins intact; never restore site scripts on the admin origin.

## Preview unsaved Site look on the site's origin (2026-10-26, MG-1)

What: scripted Site look uses the same private saved-page capability, with a narrow database command for closed theme, header, footer and menu overrides. It checks the actor's existing editing roles, same-site pages/files and authored frame pins; saved heads stay untouched. Historical theme defaults are normalized only in the preview. The owned visitor runtime reveals the real footer and keeps it visible after resize/font loading, without scrolling the CMS.

Why: unsaved design choices must preview real behavior without giving a browser-supplied manifest or script access to the CMS origin. The iframe's available height excludes its token-based padding; physical screen bounds, rather than only child viewport coordinates, are checked.

Reverse: return this workspace to its existing inert preview, then remove the new issuance command and client hook. Retain ordinary page tickets, source sanitization and role boundaries.

## Preserve reviewed original resource addresses (2026-10-26, MG-1)

What: an optional exact path-to-file mapping belongs to the immutable reviewed file bundle. Only resource-file paths can map to files selected in that same version; administrative routes, traversal, foreign origins, invalid encodings and mismatched file types are refused. A canonical checksum address keeps its exact checksum/name. Published readers bind the current approved version to its Host; private readers bind the frozen ticket version.

Why: imported styles need their original base path for relative fonts/images, and archived immutable scripts may refer to older file addresses. Rewriting historical JavaScript would lose its reviewed bytes. These readers are the database foundation; HTTP delivery, preview rewriting and archive transport must use them before the feature is complete.

Reverse: stop emitting mapped URLs, publish a bundle without mappings and retain historical versions for recovery. Old bundles without this optional field keep their original shape.

Original addresses now use the same verified-byte delivery as canonical files in public output and frozen private previews. Relative private URLs resolve against the original page or stylesheet, only for mappings in that ticket. Replacing a file moves its ordinary addresses while retaining old checksum aliases and their exact bytes. The Super Admin review shows those addresses; publication remains the normal atomic release. These transport changes do not yet complete archive support or import fidelity.

Local recovery inventories include every immutable site file, including files retained only by historical reviewed versions. The encrypted snapshot and object set recover together; the restore proof checks both current and historical bytes. Reverse only with a replacement retention-aware object inventory, never by dropping reviewed artifacts from backups.

## Transfer reviewed site files as private history (2026-10-26, MG-1)

What: optional v1 archive lists retain every site-file receipt and immutable reviewed bundle, with exact byte inspection/readback and deterministic destination identities. An import requires a fresh Super Admin review of every file, size and source. Published pointers and source account authority do not transfer; imported choices remain private until the normal release. Exact source checksum addresses become reviewed aliases to the copied bytes. Historical page bindings survive archiving; a fresh release still checks present availability.

Why: removing executable files or rewriting their bytes would break behavior, while inheriting publication approval would hide a consequential choice from the receiving administrator. The mutable change counter and immutable file-version numbers are distinct: publication increments the counter without adding a version. Both are retained independently.

Reverse: stop offering file-bearing archives and retain the local encrypted recovery path. Do not discard existing receipts/history or loosen file review, tenant checks or publication. Native media/document addresses embedded in immutable files still need their own bounded alias delivery before the complete import-fidelity work can close.

## Preserve native resource identities without rewriting reviewed bytes (2026-10-27, MG-1)

What: a reviewed bundle may declare closed native image/document identities and owned targets, with explicit image sizes. It stores source UUIDs rather than arbitrary paths, origins or storage keys. Host and frozen-ticket readers expose only an exact declared target. Private reference scanning includes each declared size and does not infer an extra wide image. Transfers preserve old source identities and add current native identities to the copied targets, including through a second transfer.

Why: opaque script/CSS bytes may still use native addresses after content IDs change. These are explicit reviewed references, not a proxy. The metadata and transfer foundation precedes public/private delivery, lifecycle usage and management review wiring; those must be completed before import fidelity can close. Reverse by publishing choices without these mappings; retain immutable history and ordinary native access checks.

Publication actions already revalidate their server path and stream refreshed UI, as the bundled Next documentation specifies. An additional client refresh could overtake a person's next navigation in WebKit. Removed that duplicate and keep navigation pending until the transition settles; the completion message follows the settled transition. Reverse only with a refresh lifecycle that cannot override later navigation.


Native mappings now grant only their declared target/size in ordinary published readers; private delivery uses the frozen ticket. Both paths verify image digests before serving bytes, including conditional/HEAD requests. Immutable reviewed-file image usage has its own ledger, included in Media counts, deletion reasons and release availability checks. Removing a mapping affects later publication and keeps earlier choices/tickets intact. The Super Admin choices/review lists original addresses, resource names, sizes and sources. Reverse by releasing choices without mappings; retain the usage history and integrity checks.

CSS-only and image-only reviewed imports use the isolated resource preview too. Original stylesheet/image addresses need the same private delivery even without executable files. Ordinary sites without reviewed resources retain their existing canvas and public script policy. Reverse only with another resource-aware preview path that preserves original addresses and private authorization.


Transfer aliases include explicit reviewed native dependencies and native identities present in the selected verified JS/CSS/JSON bytes. They do not include every ready image/document owned by the site. A repeated transfer adds current identities only for those dependencies and preserves any explicit image-size limits. Unrelated draft media stays private and remains in the content archive. Reverse only with another dependency model that keeps that privacy boundary.

The isolated canvas build rejects Next/server/Node imports. Navigation buttons live in a separate module from base buttons, so shared canvas controls cannot pull routing code into the public-origin runtime. File-publication events capture their affected page paths and counter in the same transaction and use the existing idempotent worker invalidator; no new hosting adapter is involved.

## Preserve reviewed source document structure (2026-10-27, MG-1)

What: immutable reviewed file choices may also pin original own-site definition versions and plain HTML/body attributes on named pages. The shared renderer omits its invented main, skip link, section and authored-frame wrappers only for those exact approvals. Editor selection attaches to the source element. Hidden/device visibility still works; explicit custom styling or multi-root fragments keep the normal CMS wrapper. The import pipeline must split source roots and retain the original styles. No raw HTML, script body, URL proxy or storage authority is added to this metadata. AST/CSS validation, field sanitization and ordinary release checks remain authoritative.

Why: extra layout elements, default body/heading/button rules and lost body attributes alter original CSS selectors, carousel/menu geometry and scroll behaviour. Original pages retain theme variables for newly added core sections while source styles govern their original elements. Pages and definition versions outside the approval keep the existing rendering path. A fresh import explicitly reviews layouts even if no executable files are present. Archived page choices remain in immutable history; current approval still checks availability. Transfers remap CMS pins while preserving literal authored DOM identities.

Reverse: remove the original-layout choices, review and publish through the normal release; those pages return to the CMS frame. Retain earlier reviewed versions. Per-page source frame variants and the actual Better Together import/fidelity proof remain implementation work; this foundation does not claim they are complete.

Original pins require empty section CSS: source styles live in the reviewed site files, and a stylesheet compiled for a missing CMS wrapper must never silently stop working. Explicit sticky/custom styling retains the normal wrapper. New CMS sections on original pages receive owned theme/font/button CSS confined to their own wrappers; original nodes retain their source styling. Ordinary sites retain their existing stylesheet order.

Local website imports check both lexical and real file boundaries before reading pages or referenced resources. A sibling folder with a shared name prefix and an escaping symlink grant no access; aliases cannot disguise server-side source as another file type. Valid in-folder CSS symlinks retain their linked address as the base for relative URLs. Additional assets must be explicitly selected with the public-assets folder option; never restore the old raw prefix check.

## Finish one real BT2027 page before broadening the import (2026-10-27, MG-1)

The imported homepage requires source-fidelity verification: import it,
compare the local PHP reference and local CMS at 1440/1024/390, check carousel,
popup, menu and hover behavior, then commit after the three-browser gate. The
BT-specific command reads the rendered homepage, explicitly referenced local
public assets and the existing digest-verified offline CDN cache. It does not
fetch remote resources or inspect other marketing pages/backend files. Existing
content and drafts remain; this checkpoint creates a separate private import and
releases it only to its loopback demo address.

Original styles and script order are retained in reviewed site files. Inline
styles/behavior move to external reviewed files; source text and images become
typed fields without changing their surrounding markup. Missing offline images
are recorded, with an unavailable local address rather than a runtime external
request. Analytics remains disabled for local comparison. Modern font formats
are retained; obsolete EOT fallbacks use an empty data resource. A reviewed
no-JavaScript media rule reveals scroll-animated content and all schedule days;
it does not change the JavaScript-enabled original appearance.

Visible differences require review. If the approved local source/cache cannot
supply a resource, record the missing source and comparison evidence as an
explicit unresolved item. Subpixel/antialiasing noise does not block the
checkpoint. Chromium is used during iteration, all three engines at checkpoints.
Reverse by removing the BT-specific command; existing generic imports and the
reviewed-file/renderer boundaries do not change. General remote vendoring requires separate scope and source review.

The real homepage walk exposed a framing-policy entry bug: a client transition
from Pages kept that workspace document's CSP, so the isolated canvas was
blocked. The proxy now overwrites a private request marker with its verified
single canvas origin; the root layout keeps that origin on the actual document.
Editor and Site look entry reload once when their origin differs from the
current document's marker, before issuing a ticket. This covers links, action
redirects and cross-site navigation without granting every tenant a frame
exception. Same-origin document entry does not reload. Reverse only with another
full-document navigation mechanism; do not widen CSP as a shortcut.

### 2026-10-27 — Remaining BT2027 pages use their actual local designs

The six newer marketing pages, standalone manifesto and older Workshops page
retain their respective original roots, CSS cascade and ordered scripts. The
workshop table already contains its rows in server-rendered HTML, so verification
adds no remote data service. Marketing links are rewritten to the CMS's existing
clean page addresses; sponsor/booth/dashboard applications stay external.

The incremental installer adds missing pages through the existing commands,
shares identical reviewed files and preserves every existing page draft. A
page-scoped ordering graph refuses conflicting file sequences. Current per-page
source menus/footer variants remain page content until the editable frame/menu
pass; MG-1 stays open. Reverse by restoring the previous local release; immutable
page and file history is retained. No general remote-vendoring feature is added.

### 2026-10-27 — Preserve the reviewed document's browser layout mode

The local Workshops source has no doctype. Browsers therefore use their older
layout rules, including a normal table line height and a viewport-height table
container. Adding the CMS's standard doctype visibly changed row heights and
phone scrolling. A boolean on the existing Super Admin-reviewed original page
profile now preserves that rendering mode for that page only. No script, HTML,
CSS or resource permission is granted by it. Ordinary pages retain the standard
doctype. SQL validates a real boolean and still checks the original site/page
ownership, attributes and exact definition pins. Reverse by restoring the prior
reviewed file release or saving a reviewed profile without the flag.

### 2026-10-27 — Native Lists may fill an explicitly declared original repeat

BT2027's original card/table markup must survive conversion to editable Lists.
Use the existing typed repeat fields and native list resolver, with an explicit
`collection: true` declaration on the definition. Keep interpolation and the
sanitizing AST unchanged. Bound items belong to the list drawer, never page-owned
manual repeat history. The resolver still checks site ownership, published/draft
visibility, compatible field types, revision limits and actually rendered media.
The three imported lists are enabled on the retained local demo; checkpoint
verification remains in progress.
Reverse by pinning the prior original definition/page and reviewed file release;
retain the imported lists and their immutable versions.

The native selection bound is200 (BT's table has125 original rows), with the
existing1.8MB manifest bound. Manual page repeats remain capped at48. A source
blank workshop row is preserved; new items need a title in both the drawer and
its server action. Sponsor levels use one native Sponsors list with filtered
original templates, keeping each level's original class rather than exposing
CSS to coordinators. Speaker direct links remain an optional plain Link name.

The original table rebuilds its tbody when filtering. Canvas Add controls live
beside the table, outside those managed rows; native entry annotations remain
on the real rows. Public output has no editor control or additional wrapper.
Reverse with the prior page/layout and reviewed file pins; keep list history.

### 2026-10-27 — Imported BT2027 keeps its reviewed design

BT2027 retains the original reviewed design
files. Skip theme/site-look controls for this imported site; its remaining
site-wide editing work is menu and footer text/links. Do not build a theme-token
bridge or restyle the source. Ordinary CMS sites retain the existing theme
controls. Step6 verifies the preserved design rather than changing BT's accent
colour. Reverse only on a new release requirement to support theme changes for
this imported site. Sponsor registration, booth and dashboard stay out of scope.

### 2026-10-27 — Scriptless previews name owned font paths

The Firefox release gate exposed a real font loading failure: its srcdoc meta
policy treats font-src self as the about:srcdoc address. Keep the sandbox and
script/frame/connect prohibitions. When copying a response into srcdoc, replace
only our exact generated meta with a policy naming the embedding window's own
/cms-samples/fonts/ and /assets/ font paths. The origin is read from the window,
never from authored content; direct response headers remain unchanged. Render
the srcdoc after that origin is available, avoiding an initial blocked load.
The font journey asserts the loaded face and absence of font CSP errors. Reverse
by restoring the prior preview component/policy, which reintroduces the Firefox
font defect; no public-site or site-script permission changes are involved.

### 2026-10-27 — Uploading cannot reuse the prior image selection

The real BT coordinator review caught Use this image confirming a previously
selected logo while a new photo was still being processed. Opening Upload now
clears that selection, and accepted uploads cannot be confirmed until ready.
The ready upload selects its verified native Media row automatically. Cancel
keeps the caller's field unchanged. Existing picker coverage now proves the
old selection is unusable during processing and the new row is selected before
confirmation. Reverse by restoring the prior picker state transitions, which
would reintroduce accidental substitution; no storage or publication changes.

### 2026-10-27 — Judge the trial release's exact published projection

Release preparation already uses the normal commands inside a rollback-only
savepoint. Its final readiness pass now reads each exact page-version projection
from published_routes in that same transaction. It still renders through the
shared renderer, gathers the final frame/dependencies and runs every readiness
rule. Ordinary draft and worker checks rebuild as before. A private version
never falls back to the live version, and tenant RLS still applies. This avoids
repeating the expensive manifest validation after publication has just done it;
first-site preparation otherwise exceeded the unchanged browser expectation.
Reverse by using member access in the final simulation check. Database tests
require identical findings, refusal of private/foreign versions, rollback and
blocked-release behavior.

The offline BT archive commands deliberately take only explicit local source,
rendered HTML, cache and output arguments. They do not load environment files or
connect to services. The environment-boundary test now positively verifies this
stricter boundary, hash-checked cache access and absence of network/DB imports,
following the existing offline core-asset tools. Reverse if the commands later
need environment configuration, after reviewing their connection boundary.

Execution also reuses only server-recorded reports whose immutable page version
and current policy match the locked release. These reports construct the
rollback-only trial; its complete future state is still freshly evaluated and
compared for new findings before the actual commands commit. Missing/mismatched
reports rebuild normally. This removes the second redundant preflight from an
unchanged reviewed release while keeping the final readiness and all revision,
policy, ownership and approval checks. Reverse by omitting preparedChecks from
reviewedSiteRelease's simulation call. The unchanged first-publication browser
journey now passes review, explicit sample consent, publication and archival.

### 2026-10-28 — Keep editor labels and menu actions clear of content

A section's blue name tag now sits in its action toolbar, which measures its
actual dimensions before floating over a safe area or moving above the canvas.
The old section pseudo-element could cover an unpadded heading, especially in
Phone preview. This changes only CMS editing chrome; public/original markup and
styles stay unchanged. Reverse only if a future canvas reserves a safe label
area outside the authored content.

A top-layer menu clamps its trigger position and vertical space to the visible
boundary. A long table refreshed by another tab can move its trigger outside
view; actions must remain reachable. The existing concurrent-rename browser
journey now scrolls/resizes and verifies full menu bounds before Archive.
Reverse if menu positioning is replaced by an equivalent tested anchor system.

### 2026-10-28 — Case-safe editor CSS in original browser layouts

Workshops must retain its source quirks mode. That mode matches CSS class names
without case: esbuild's shortened .a button class also matched its .A toast rule,
fixing Add workshop over rows. Keep syntax/whitespace compression, but disable
identifier shortening for the isolated canvas bundle. Descriptive module names
remain distinct when case folds. A browser regression now uses a reviewed
quirks-mode page and requires the add button to remain in normal flow. No
original CSS, script bytes or browser-mode approval is changed. Reverse only
with a case-insensitively unique CSS-name allocator verified in that fixture.

Place table list controls after the outer Bootstrap-table wrapper, outside its
managed/scrollable body. Sorting/filtering owns that body; CMS controls must not
cover rows or disappear when it rebuilds. Other repeating groups retain their
original layout container. Reverse if a different table integration provides an
equally durable, non-overlapping insertion surface.


### 2026-10-28 — Refresh the browser test framework after native WebKit stalls

Long WebKit2336 runs stalled before sign-in with a blank page and no recorded
request. Local diagnostics also showed native thread growth. This matches the
[upstream macOS report](https://github.com/microsoft/playwright/issues/42385).
Upgrade existing E2E Playwright to1.64.1 and declare its matching Core peer for
the accessibility checker; retain the checker's version and every assertion.
The normal WebKit2370 launch completed150 fresh navigations. The complete
three-engine gate remains the acceptance check, not that short diagnostic.
Unsupported native launch-argument experiments were removed and the temporary
manual test-app preference was restored. Local release runs keep the Mac awake.
Page animation behavior, retry policy and timeout budgets stay unchanged.
Reverse by choosing a browser/framework set that passes both the long navigation
smoke and all release suites, updating the test runner and Core peer together.

The refreshed Firefox reports a transformed32px target as31.999996px. Check
both the exact computed CSS minimum and screen geometry at four decimal places,
below a browser layout unit. The32px threshold remains; a31.99px control still
fails. Reverse this measurement normalization if browser rectangles become exact.

### 2026-10-28 — Edit the brought-in design through its original frame

BT2027 keeps its reviewed source CSS and distinct page layouts. Its shared main
menu uses the existing bounded navigation tree through a closed Bootstrap5
formatter, enabled only by a reviewed original frame pin and declared menu
capability. Text and destinations become typed fields; source classes, data
attributes and script order remain. Social icons get nonvisual names. Share the
seven identical footers; retain distinct Workshop/Manifesto framing. Show actual
per-area usage and changed-page impact, and Menu & footer without theme controls.
Ordinary CMS sites retain Site look. Reverse with a reviewed restoration of the
prior frame pins and original page footer instances, preserving draft history.

New template pages need the existing common design and menu enhancement. A
Super Admin may review closed new-page document/frame defaults and opt existing
file bindings into those pages. Explicit imported-page profiles take priority;
homepage-only scripts stay scoped. Every file/hash/order remains unchanged and
the ordinary release/CSP rules apply. Immutable snapshots and archives retain
the reviewed choice. Removing original framing also removes future-page opt-ins.
Reverse by publishing another reviewed bundle, explicitly binding any necessary
files to already-created pages before removing their defaults. No general remote
vendoring or BT theme bridge is introduced.

### 2026-10-28 — Reproducible original-design demo and document links

The lead demo is the actual nine-page BT2027 local import, including its three
native lists, reviewed frame/files and two prospectus PDFs from the same local
source. Hash-check the exact compressed fixture before granting its script-file
review; other archives retain normal review. Keep the fictional event as a test
fixture. Reversibly archive superseded local examples instead of deleting their
drafts/history. Reverse by restoring those sites and changing the bootstrap list.

Native HTML list layouts now recompile through the shared closed item-template
contract during archive transfer. Bare or malformed repeat placeholders and
lists in frame components remain refused. This preserves original slide/table
markup without a separate compiler or script exemption. Reverse by migrating
those layouts before narrowing the compiler again.

The reviewed fixture's first local release records only its known source
heading/image-description findings through the normal override audit. New rules,
other page names and ordinary sites fail bootstrap instead of inheriting that
exception. The local workshop-submission link retains its original external
application address; no application is fetched or imported. Reverse the source
findings by approving corrected content and updating the exact fixture/hash.

Creating a page exposed a server-action redirect that updated the root HTML
origin marker while retaining the overview document's restrictive CSP. Confirm
the actual loaded document URL through Navigation Timing before accepting the
marker; reload on entry from another route. Keep the exact own-site frame policy
and capability handshake. Reverse only with another immutable document-policy
signal that passes the create-page and cross-site navigation browser checks.

Reveal the original footer by scrolling its own overflow ancestors and child
window. Native scrollIntoView also moved the containing CMS document and clipped
Back. Preserve the CMS scroll position and test both ordinary and body-scrolling
original documents. Reverse only with an iframe-only scrolling primitive that
passes the outer-window regression check.

## 2026-10-28 — Preserve the reviewed BT palette and report its source contrast

The original `.btn-solid-reg` uses 14 px semibold red text on white, reversed on
hover. The source/CMS comparison measured the same colours on both sides:
`#ff1f38` and white, a 3.81:1 text contrast ratio, below 4.5:1 for that size.
This is a source accessibility Major under **Needs administrator input before hosted reuse**.
Preserve BT2027’s reviewed source design; colour changes require a separately
approved source revision. CMS controls and ordinary core
sections retain their own contrast requirements; this records no general waiver.
Reverse by reviewing a revised original design with the maintainer, having a Super
Admin approve its replacement stylesheet, then repeating source/fidelity and
accessibility checks against the newly agreed design.

## 2026-10-28 — Acceptance fixes for original pictures and new-page menus

Imported picture fields keep their source addresses in content, but the inspector
resolves reviewed images to the existing authenticated immutable file route.
Build the address map from the selected draft or published bundle under the
member's RLS context. Missing original files show an explanation and Media
choice instead of requesting nonexistent admin paths. No files are approved,
script policy widened or original values rewritten. Reverse by replacing this
map with another authenticated image resolver that passes the foreign-site and
changed-file tests.

A new core-template page has no source-authored space for BT's fixed Bootstrap
menu. Only on pages using the reviewed new-page defaults, make that original
menu sticky so its actual height participates in document flow. Original page
profiles and original stylesheets remain unchanged. This works before scripts
load and avoids a guessed spacer at different device widths. Reverse with a
reviewed template frame that reserves the menu's height and passes the desktop
and phone title-overlap checks.

At collapsed widths, Structure opens beside its existing toggle rail, keeping
Close reachable. Choosing a section closes that overlay and opens its inspector.
The previous overlay covered its own toggle. Reverse only with another drawer
arrangement whose close control and selection behavior pass real pointer tests
at1024; no new global styles or spacing values are needed.

The final touch check found the original BT More submenu closes/fails to stay
open on tap, identically in the local source and CMS. Record it as a source
Major requiring platform-lead approval before hosted reuse. Keep the reviewed script
unchanged in this fidelity run; an agreed corrected original behavior can be
implemented, reviewed as a new site-file version and compared again. Desktop
hover, saved menu nesting and the top mobile menu remain separately verified.

## 2026-10-28 — Adopt the approved Echelon additions and desktop admin boundary

Adopt the maintainer’s eight UI additions in SPEC §16, correct chapter templates to
optional board/no member roster or stories, and prioritize the separate local
Echelon chapters site after the completed BT2027 checkpoint. The supplied
sources conflict with the old chapter roster/story template; the latest explicit
release requirement resolves that conflict. Public text comes from
the supplied public-text file; missing content stays a labelled placeholder.

The approved mockup guides admin layout and interactions. Its drawn sites and
example status/timing claims are not evidence about real content. Keep existing
tokens and real rendered previews. Admin checks are desktop1440/1024, while
public pages/Phone preview retain390 checks. Use touched tests at checkpoints
and the full gate at the step end; preserve the stated demo pause. Reverse these
product/workflow decisions only with a later platform-lead approval, updating SPEC,
AGENTS and the roadmap together.

## 2026-10-28 — Measured national panels with licensed font stand-ins

Replace the provisional National/Echelon preset values with the supplied local
measured palette, 20px card corners and 8px button corners. Add one optional,
closed panel-presentation value (kind plus validated canvas colour); ordinary
stored themes remain byte-for-byte unchanged. Renderer CSS is code-owned, not
copied from an unconfirmed national stylesheet. Section-only library previews
keep their compact layout. Other named presets retain their previous values.

Use self-hosted Open Sans until Creato Display rights are confirmed. Retain the
measured brand red but use black small button labels: the supplied dark ink on
red measures 4.44:1, while black measures 5.44:1. Echelon uses navy primary with
white labels and red accents. An approved logo/photo is not supplied, so use a
text wordmark and labelled sample media. These are explicit administrator review items, not a
claim of licensed brand-font or image availability. Reverse by selecting the
standard presentation or saving another validated preset; old versions and
imported-site design approvals are preserved.

## 2026-10-28 — Chapter template uses page-owned optional cards

Add a Chapter page starting point to the existing wizard and Add page flow,
using global core sections. Board and Photos start hidden; board cards belong
to that page rather than a site-wide People list. This keeps later chapter
editing independent and avoids introducing a member roster or stories. New
content is neutral placeholders, invented labelled sample people and original
abstract sample media; normal sample-content confirmation still applies.
The starting outline names the chapter parts and identifies hidden ones before
creation. Reordering or removing parts preserves the remaining template values,
labels and visibility rather than silently restoring generic library samples.

This is the template foundation, not the complete chapter workflow. The Echelon
site installer must add its approved national copy and locked shared parts;
per-chapter options and access remain separate work. Reverse by removing the
starting-point option; existing immutable page versions and core section pins
remain readable. A future list-backed board requires an explicit scoped model
and migration preserving each page's content.

## 2026-10-28 — National pages, closed site controls and chapter setup drafts

Compose the Echelon national home and Find a chapter from shared sections.
Three closed controls supply chapter search, the directory and contact form;
their markup comes from code, their instance values cannot introduce markup,
and they cannot be placed in attributes or edited as ordinary text fields.
Search uses a normal GET, so the directory remains usable without JavaScript.
Other sites receive no additional control styles unless they use these sections.

Chapter setup has immutable private versions and revision checks. Only site
administrators configure it. The public directory reads published setup only,
omits unlisted chapters and unavailable page destinations, and exposes no point
of contact. Page content continues through the existing release. Chapter setup
release/review integration and the scoped workspace are still required before
the whole chapter step is complete; the narrow commands are a data foundation.

The supplied public contact text requires all five fields, including Phone;
use that over the mockup's optional Phone. Messages are stored privately with
same-site origin checks, bounded input, duplicate suppression and a per-site
limit. No automatic reply or real email is sent. An admin messages view remains
part of the subsequent workspace work.

Preserve all41 CSV rows, including the two Florence rows, under distinct draft
identities; do not silently merge unverified records. Add the two requested
neutral Maryland/rebuilding examples. External URLs use reserved example.test
stand-ins until supplied by the maintainer. All setup remains unpublished initially.
Reverse by retiring the templates/controls and keeping immutable versions; an
intentional model migration must preserve existing chapter and message data.

The maintainer's8:50 AM demo override defers browser checks, builds and installation
into the retained demo. Source/type/unit/test-database checks are allowed until
9:45; keep the existing demo build and cms_demo untouched, then pause again.

## 2026-10-28 — Approved local Creato Display, guarded before public hosting

Use the maintainer’s approved AO Hub WOFF2 bytes for National/Echelon, keeping
Open Sans as fallback. Copy seven faces to source assets outside public/;
only a closed hash/size registry can serve them on local hosts in explicit
local-test mode. Changed files, unknown paths and public domains are refused.
Existing stored themes and other presets are unchanged; the forward migration
adds only the supported stack and retains validation authority.

Confirm the font licence before public hosting. Keep the Echelon text wordmark
until its official file is supplied; the Symposium mark is not a substitute.
Reverse by choosing Open Sans again; immutable theme versions remain readable.
Browser/font loading and visual review are deferred until after the demo by the
maintainer override, as are all production builds and demo installation.

## 2026-10-28 — Separate native chapters demo, preserve the brought-in lead

After the maintainer’s post-demo continue, the normal demo initializer creates
Echelon chapters beside Echelon Symposium. It installs through the same
identity-scoped commands as the database tests and publishes only the new
site's first release, with explicit sample-content consent. Existing drafts
are never republished by a retry; Better Together remains the lead example.
The source still needs approved chapter branding/photos and real external
addresses. Reverse by archiving the separate local site; neither imported
example needs to change.

## 2026-10-28 — Chapter pages, exact approval pins and directory releases

Native chapter pages compose shared library sections; section choices update
the existing instances and retain their text and board order. First-eight
boards use native details, keeping all sixteen sample members in server HTML.
Boston's explicitly requested social-first CMS page takes precedence over its
CSV destination for this demo. Preserve the original CSV separately; upgrade
only its untouched private sample setup and never an edited draft. Keep the
national menu explicit so chapter pages do not fill its main navigation.

Each page version pins its immutable chapter setup. Publishing or approving
that page installs exactly that setup, even if another setup draft now exists.
External directory changes use ordinary selected releases. Recovery captures
associated setup, preserves later drafts, and compares the restored values;
it does not rewind version identifiers. Reverse configuration through ordinary
draft/release recovery, keeping page content and private contacts retained.

The screenshot walk caught a real recovery defect: page identity validation
still allowed only flat addresses. Use the existing archive/routing segment
grammar for rename and browser recovery, with the same length, CAS and caller
checks. Reject traversal, empty segments, escapes and non-normalized addresses.
The shared link section also needs a visible heading. Upgrade only untouched
generated chapter drafts whose pinned link section lacks that field; keep the
old page/version and all field values, and leave authored drafts pinned.

Content archives retain their existing website-content scope. Private chapter
setup/contact records and visitor form messages remain in the database and
require an operator database backup. The chapters Settings screen states that
limit. Extending archives to those private records requires explicit administrator
authorization; automatic approval review refused that expansion in verification.

## 2026-10-28 — Chapter access remains separate from whole-site access

Chapter volunteers receive a page assignment, and division staff receive an
explicit chapter-team assignment. Neither creates a site membership. Separate
page predicates gate existing save, restore, review, preview and publication
commands; whole-site predicates continue to protect lists, site look, imports
and access management. Deactivation, team removal and changing a chapter back
to division updates revoke the relevant page capability immediately.

Immutable page creation enforces the canonical What is Echelon and Join us
instances for Contributors, including their position and visibility. Editors
maintain the canonical instances. Existing revision, exact-review, trusted-code
and publication policies remain in the existing commands. Reversal requires
removing page/team assignments and deliberately granting ordinary site access;
never interpret a page assignment as access to all site content.

## 2026-10-28 — Local chapter invitations with one-use email links

Division staff can invite an editor only to an assigned chapter, using its
current setup. This narrow command may create that person's identity without
renaming an existing account or granting whole-site access. Existing chapter
setup saves use the authorized page lock; a direct row lock would also apply
an unrelated whole-site update policy and reject legitimate division staff.

The explicitly local recording adapter stores email links in a private outbox;
it never sends email. The callback requires the local provider, loopback admin
and database, and recording mode. Links are random, expire after twenty minutes,
are consumed once under a database lock, and are rechecked against current
chapter access. Only a digest is stored in the capability table. Replacement
links invalidate older ones. The response forbids caching and referrers, then
uses the existing signed, HttpOnly session cookie. Hosted callbacks stay off.

Reversal disables the local adapter and removes the relevant page assignments;
activity and recorded messages remain private. Enabling a hosted invitation
transport is separate work with the maintainer’s credentials and delivery approval.

## 2026-10-28 — Division setup before a chapter exists

A division assignment identifies its site even before it has a chapter page.
Session data carries division assignments separately from page and whole-site
roles. The workspace shows Set up chapters, while the ordinary site capability
matrix remains unchanged. Empty division users cannot see other divisions'
pages, lists or settings.

Site administrators create division teams, add or remove their staff, choose
the default update mode, and assign chapters (or leave national-only review).
New settings use a revision check and affect future chapters only. No division
names are inferred from internal notes or the CSV. Use an explicit sample team
for demonstrations until the maintainer supplies the actual mapping.

A narrow database command creates a new chapter, its own private page and its
division assignment atomically. The normal page save still validates the
section content and captures its shared-section baseline. An assigned team may
also create a CMS page when an external chapter needs one, but cannot attach
another existing page. Reversal removes assignments or archives the draft;
existing versions remain available and no site membership is implied.

## 2026-10-28 — Contact checks and approval reminders stay in the local outbox

January and July use the maintainer’s two approved update-mode wordings. Combine
chapters sharing a normalized contact email into one message per site/cycle;
a later mode change does not rewrite an already recorded message. A combined
message is visible only to someone who manages every chapter in it. This avoids
exposing another division's private contacts through the shared recipient.

Use Monday–Friday working days in America/New_York, preserving the submission's
local clock across daylight saving changes. No holiday calendar was supplied.
Notify the assigned division first, then remind it and copy site administrators
as the national backup after five working days. An empty division falls back
to that backup immediately. Keep one message per request/person/kind, skip stale
or closed requests, and never approve or publish from the reminder process.

Only the explicit local/recording worker on port54329 records due messages.
It has an execute-only command and cannot read private mail or feed it into the
SMTP delivery outbox. Site administrators can trigger local checks and waiting
review messages from Settings. Flags/defaults use the same revision check;
recorded mail and activity remain private. Reverse by switching checks or
reminders off; replacing the local adapter with real delivery requires the
administrator approval and credentials. No real email is sent in verification.

## 2026-10-28 — Redirects point to page identities, never other redirects

A site administrator chooses an old local path and a page on the same site.
Only that page's published address is exposed publicly; a draft or archived
page never becomes a visitor destination. Page identity keeps a redirect valid
through a later page rename. Page and published-route guards reject an address
already used by a redirect. Existing release-order site/page locks also
serialize a competing new-page insertion against a redirect save.

Redirect responses preserve link options and use308 with no-store so a corrected
mapping takes effect locally. Referenced pages, rather than arbitrary target
strings, rule out redirect chains, outside origins and loops. Changes take
effect directly in Settings; the UI explains that publication still controls
the destination. Removal is revision checked, confirmed and audited. Reverse
by editing or removing the mapping; no page content changes.

Spreadsheet import uses CSV with Old address/New address columns, at most200
rows. Preview every row, preserve matching mappings, recheck saved revisions
and commit the complete import in one transaction. The demo installs only
missing, unambiguous CSV-backed chapter mappings that have actual CMS pages;
it keeps edits and skips external destinations or ambiguous chapter identities.
No invented visitor counts or external lookups are needed.

Review also found that attaching a first CMS page to an external chapter could
hold its chapter lock before waiting for the new page's site foreign-key lock.
For a chapter with no page, take the site key-share lock first, then the chapter
lock. This matches releases/redirects without broadening permissions. A real
concurrent attachment/redirect regression keeps both operations successful.
Ordinary page creation also takes that site FK lock before its existing path
reservation advisory lock; a concurrent create/release regression covers the
same ordering. Existing permissions, audits and immutable content stay intact.

## 2026-10-28 — Search uses fresh permissions and guarded destinations

The sidebar and Cmd/Ctrl+K share one search dialog, also available inside the
editor canvas. Each request resolves the active session and reads pages, list
items and action capabilities under existing RLS. No cross-user result cache
or new database authority is needed. Bounded literal queries avoid wildcard
surprises; stale asynchronous responses cannot replace a newer search.

List results link to their existing list drawer. Chapter-only users receive
only their permitted pages and common destinations. Navigation keeps the
existing unsaved-work guard. Isolated canvases may open search only through
the already verified origin/source/channel/document handshake; public output
gets no search code. Long names wrap in full. Reverse by removing the dialog
and triggers; stored content and permissions are unchanged.

Review found missing thumbnails for four new Echelon sections. Generate those
offline from the shared renderer with --missing, preserving existing reviewed
thumbnails; subsequent runs are idempotent. This fixes editor library404s
without changing imported site rendering.

## 2026-10-28 — People keeps chapter, division and whole-site access distinct

The People table shows independent assignments and filters by site, chapter or
division. Scoped volunteers no longer appear as having zero assigned sites.
The account form lists chapter/division assignments with their existing
management links, explains shared locks and paused access, and folds whole-site
controls for a scoped person. Account saves still use the existing revision
command and preserve separate assignments; there is no new grant or role.

Your access lists the reader's permitted pages and division responsibilities.
Keep actual account/invitation status instead of inventing a last-active time
or a sign-in provider choice. Root-only queries use existing RLS, and navigation
keeps unsaved access forms guarded. Reverse the read-model/UI changes without
changing any assignment or stored content.

## 2026-10-28 — Picture focus belongs to its saved placement

Reuse the normalized image focus point{x,y} and automatic(null) choice. Media
keeps the existing library default; a newly chosen supported page picture
copies that default into its own value. Inspector adjustments stay in the
immutable page draft and follow its existing save, history and publish flow.
They never change another page or the library image. Reopening the chooser
keeps an explicit page choice, including automatic. List image values retain
their existing format.

One shared control provides a draggable dot, keyboard movement, labelled
fine-tuning and live4:3 Card,3:4 Phone and16:9 Wide example crops. A drag changes
only local previews until release, then adds one page history step; cancelling
it preserves the saved choice. Keep sample pictures marked while adjusting
only focus. Loading, unavailable/retry, reset and disabled states use existing
tokens/components.

Only bounded numeric coordinates become a generated object-position. Legacy
whole-image fields and structured images support it; derive inspector support
from the pinned renderer shape rather than a section name. Attribute-bound
original markup remains unchanged, and original-design sites keep their reviewed
styling. Missing or malformed focus produces the previous output. No new
commands, privileges, migrations or dependencies are needed. Reverse the UI and
rendering additions while retaining the optional stored coordinates.


The preview and public font routes share one platform handler and one asset set.
Each response verifies the registry size/hash and is limited to local mode and
localhost addresses. This fixes preview/public typography drift without enabling
hosted use. Revert both routes together if the approved font changes.


## 2026-10-28 — Acknowledged chapter saves and bounded repeating controls

A chapter setup can be reopened before the refreshed server list arrives. Keep
its returned saved row visible immediately, then replace that temporary view
when fresh RLS rows arrive. Prefer a newer revision and never change a command's
revision check. This prevents old board/section choices from appearing after a
successful save. Reverse by waiting for a refreshed row before reopening.

Long repeating-item titles must wrap within a bounded inspector grid. Explicit
zero-minimum tracks and item bounds keep image controls/crops inside the panel;
the browser acceptance walk checks the panel's own horizontal extent, since a
page-level overflow check cannot detect content clipped by a scrollable panel.
No public design or rendering changes. Reverse the module rules if the shared
inspector layout supplies the same bounds.

The Echelon step-end Firefox/WebKit gate covers every browser spec, matching
Chromium rather than a curated subset. Each engine still starts with a fresh
isolated local database, serially. Per-piece checks remain touched Chromium only.

## 2026-10-28 — Consistent picture precision and scriptless preview origins

New picture-focus moves use whole-percent steps, matching the displayed position
and fine-tune sliders. Browser pointer events can round fractional screen pixels;
keeping extra hidden precision made the saved crop disagree with the displayed
controls. Existing stored coordinates remain unchanged until edited. Reverse by
restoring finer pointer precision together with equally precise controls/readouts.

Layout review uses the shared native Dialog and Buttons, with a visible fixed
footer and an explicit initial-focus target after the previous drawer closes.
This replaces a custom overlay whose initial focus could be lost in Firefox.
The native dialog closes during layout cleanup before its node is detached,
then restores a still-connected opener.
Reverse by providing equivalent native focus and scrolling behavior in that flow.

Firefox interprets copied srcDoc CSP self references against about:srcdoc. The
admin-only scriptless policy explicitly names the embedding window's exact image
origin and its three owned font paths. The origin is never taken from authored
content; invalid origins retain the restrictive default. Scripts, forms, frames,
connections, popups and top navigation remain blocked; media authentication/RLS
and public site CSP are unchanged. Reverse these explicit sources when browser
self handling is consistent, retaining the private-image and foreign-media tests.

## 2026-10-28 — Refuse user-info in rendered HTTP URLs

The existing malicious corpus includes host-masking user-info URLs. Chromium
refused to fetch them itself, hiding a gap in the runtime URL escaper; Firefox
attempted the request under the CSP-free independent test. Parse HTTP(S) URLs
and refuse any username/password, including encoded or backslash-normalized
forms. Ordinary paths, email/telephone links and credential-free URLs retain
their exact output. The test intercepts external requests before the network.

This repairs the existing value-escaping contract, not the compiled AST grammar;
AST policy versions and stored content remain unchanged. Every render applies
the escaper, and HTTP representation tags include the resulting HTML. Reversal
would require an explicit policy change and equivalent browser defenses; never
rely on a browser to refuse credential-bearing image requests. Run one final
local BT comparison after all renderer fixes are complete.

## 2026-10-28 — Use the upstream Firefox focus fix for release checks

The source-organizer journey exposed Playwright's bundled r1555 focus-emulation
regression, confirmed in [upstream #43280](https://github.com/microsoft/playwright/issues/43280).
Native input focus matched `:focus` while `document.activeElement` remained the
iframe; typing never reached the input. Dialog cleanup, stable iframe identity
and smooth-scroll probes did not repair it. Reverted those iframe/scroll probes;
no application focus workaround or filtered assertion remains.

The same click/focus/type/canvas/save/reload assertions pass with official
Firefox r1562 and the unchanged Playwright client. Allow an explicit
`CMS_E2E_FIREFOX_EXECUTABLE` test-only override; document the official archive and
checksum in operations. Chromium/WebKit and all tests remain unchanged. Reverse
by removing this override when the bundled stable browser contains the fix and
the complete browser gate passes. No runtime dependency or hosted setting changes.

## 2026-10-28 — A consistent clock for review times

WebKit's review Inbox produced a real hydration error: Node formatted the date
with a comma, while Safari inserted "at" for the same locale/options. Review
timestamps now assemble numeric date/time parts with fixed punctuation and an
explicit "Eastern time" label. This also removes server/browser time-zone
guessing and matches the chapter review working-day clock. Page/list reviews
and recorded chapter messages share the formatter; stored instants and
approval/version rules do not change.

Tests cover midnight/year boundaries, daylight-saving changes and substituted
ICU literal words/spaces; the role walk uses a Pacific-time reviewer and keeps
its zero-browser-error assertion.
Reverse by introducing a deliberate user/site clock and serialized or equally
stable display labels, preserving that hydration proof. No suppression or error
filter is used.

## 2026-10-29 — Cancel departing previews and retain update-review focus

WebKit exposed a delayed site-look preview starting while a saved workspace was
reloading. All three frame-preview workspaces now cancel queued and active work
on document departure, as well as on a new edit or unmount. A cancelled leave
warning keeps its preview. This preserves the existing HTTP failure messages and
strict empty browser-error assertions. Reverse by removing the shared lifecycle
queue after the browser no longer needs departure cancellation.

The section-update trigger explicitly takes focus before opening its review, as
the library preview already does. Safari pointer clicks otherwise leave focus in
the canvas, so Cancel returned there rather than to the initiating control.
The update review also uses the shared native Dialog with a fixed action footer;
its former scrolling container placed Cancel below the viewport. Both section
comparison dialogs share one CSS module. Reverse only with an equally accessible
bounded dialog. The schedule keyboard spec uses Safari's
Option-Tab on macOS to include buttons, matching the existing imported-frame
keyboard acceptance; the exact Cancel-focus assertion remains.

## October 29 — SAWSO standalone demo and delivery order

Build SAWSO as a standalone national-look site using shared core sections and
site-owned Stories data. Preserve the approved local text; missing story bodies
are labelled samples; approved real photos are stored in local Media.
Publish-time feed expiry keeps the demo server-rendered without external fetches. Scheduled sync and the launch/review
views follow later. Echelon receives fixes only; BT2027 stays frozen and switches
over last. Hosting targets the organisation's Google project with Postgres;
Supabase sign-in remains until RO-3. Reverse by an explicit platform-lead scope decision;
no hosting or production state changes in local verification.

## October 29 — Dated list selections and sample readiness

Stories use standard typed list envelopes with an explicit publication-date
field, bounded month cutoff and optional related-item exclusion. Publish freezes
that selection; previews apply the same order and cutoff. Existing list choices
keep their previous ordering. Story definitions declare the photo/text sample
flags so real bound items still appear in publish readiness. Reverse through new
definition/page versions; existing page pins and published output are preserved.

### SAWSO public reference and local contrast exception (October 29)

Use the supplied high-fidelity preview and approved homepage text with shared
national sections, the exact shield asset and normally imported local Media.
The maintainer explicitly chose #EF3E42 with white text over the contrast rule. A
named marker on the immutable theme permits only that exact pair in the national
layout; body/accent contrast and all authorization remain enforced. Other themes
keep the existing rule. Remove the marker and choose a compliant paired colour
to reverse this local exception. Fonts, photo rights/descriptions, sector naming
and the missing global-needs illustration remain administrator review items before hosted reuse.

Release audit entries record readiness counts by rule and a hash/reference to the
full immutable release report, rather than duplicating every finding. A normal
49-page release exceeded the existing 64 KiB audit limit. The limit, detailed
release report, reviewed-outcome fingerprint and authorization are unchanged.

Large shared-section styles made public photo authorization slow. A conservative
UUID candidate rejection now skips sections that cannot contain a governed
media URL; every positive candidate still passes the existing CSS, AST, rendered
field, publication and tenant checks. Other URL patterns keep the original path.
The same local photo request fell from14.3s to2.2s;28 media-access checks pass.

### Stories workspace and saved native previews (October 29)

The Stories screen edits a single list record through the existing collection
CAS command. Source addresses and photo references are retained from the owned
server record; tags regenerate the approved sector links. Publish uses the
normal release gate. The Details screen embeds the existing authenticated,
scriptless native preview with draft list values. Before a list's first release,
that preview uses its draft schema; published lists keep the published schema.
No frame-policy or permission changes are needed. Revert the dedicated routes
to return authors to the general Lists workspace.

### Native SAWSO demo bootstrap (October 29)

Fresh SAWSO demos use the native preset/page/list/frame/redirect builders and a
checksum-checked offline pack of40 approved photos. Each photo goes through the
normal upload receipt and guarded worker processor; the queued delivery later
observes the same completed intent and has no further effect. Extracting the
existing processor makes it usable during local bootstrap without a second
worker or a fake job lease. Released sites and their drafts remain untouched;
partial private setup can resume. General site-archive core-layout portability
needs follow-up: imported private definitions currently cannot retain global
core appearance choices. No importer, capability or permission guard is relaxed.
The native recipe can later be replaced by a fully checked archive round trip.

### Shared admin frame (October 29)

The admin uses the approved light sidebar and central ink/line/canvas/navy
tokens, with #C8102E for Publish. Existing routes, roles, labels and navigation
order remain. Ordinary legacy creation/design buttons use navy. The public
page stays inside its separate renderer document. Inter is unavailable in the
repository and supplied local fonts, so the admin requests it with a system
stand-in and no download; a supplied local font is Needs administrator input. Restore the
previous token values and shell module to reverse this cosmetic change.

### Existing admin redesign and authored stories (October 30)

Restyle existing screens through shared tokens and components, preserving their
accessible names and permission checks. The expanded fresh-admin acceptance also
requires adding a story: the existing Stories action now composes the normal
list and page commands into one guarded transaction, using the shared story
template and owned, ready Media. New stories have no legacy source address.
Retained demos run the same conservative schema compatibility check as fresh
ones, preserving page heads and private schema edits. Reverse the screen commits
independently; preserve authored story data through the normal versioned commands.

The creation dialog keeps its existing template/copy/blank choices; parent and
menu settings remain in Page details after creation. Unbuilt mockup-only controls
remain roadmap work rather than decorative actions. Acceptance-created stories
and pages were removed through normal recoverable commands; deleted history is
retained. Two current BT2027 photo descriptions were restored to the exact local
source alt text, including in the checksum-reviewed reusable bundle.

### Frozen approved content capture and normal release (October 30)

The maintainer permitted one gentle public capture of the missing story text and
specified information pages, while keeping the approved nine ministry/hub pages
unchanged. Store normalized article text, provenance hashes and copied raster
assets in a frozen local pack. The importer makes no network requests, refuses
non-local databases/stores and uses normal Media receipts, guarded processing,
list/page/frame commands and reviewed release snapshots. Existing private work
is preserved; only supplied real content clears its corresponding sample marker.
The oversized Venezuela article stays marked Text needed, with its full capture
available for review. The unused local Privacy placeholder stays marked while
the footer points externally. Reverse with normal version history and earlier
section pins; no publishing or authorization guard is bypassed.

The Text + image phone row cancels its Bootstrap horizontal gutter inside its
shared definition, keeping new reports/team pages within390px. Desktop layout
and existing immutable page pins are retained. The original Global Needs SVG
was rasterized locally before normal image processing; active SVG is not served.

### Story article capacity — October30
Captured articles retain their complete approved text without trimming. Rich-text fields named body allow100,000 UTF-16 units in collection parsing, story editing, the import and both SQL value/binding validators; all other text keeps20,000. Forward migration0161 preserves function ownership and grants. Reversal requires first reviewing any saved bodies above20,000; do not truncate them.


## 2026-10-30 — Approved Adobe kit with exact-address checks

The maintainer authorizes the fixed euh2hvn CSS kit, without bundling its fonts.
Keep its four named families in the closed theme validator, preserve the local
stand-ins in each stack and emit the stylesheet only for the site’s exact
listed hostname. Allow only the two CSS/licensing hosts and the font host;
no Adobe script or optional performance service is permitted. FontLibrary uses
the existing private canvas capability and normal theme save/release commands.
A read-only, origin/source/channel-checked canvas message reports real font
loading at that staging address. Live-domain availability remains unverified
until checked there; failed loading never removes the stand-ins.

Chapter themes cannot save Trajan headings, including through a Super admin
command. Existing local sans remains available for Echelon. The font screen uses
actual saved-page previews, and the approved public CSS retains button weight.
The older Colours/Buttons workspace and sidebar still require the separate
7b structural pass; font controls alone do not close that work. Reverse by
saving a new theme draft with the kit disabled and local font stacks, then
reviewing/publishing it normally; immutable earlier versions remain intact.


## 2026-10-30 — Repeating national hero, with explicit cancellation

The national parent advances to version two. Feature slider declares ordinary
repeated content fields and a closed, code-owned carousel enhancement. The
approved three numbered slides migrate into stable list keys without changing
words, pictures, focus points or destinations. The template review recognizes
only this known field migration and still refuses other incompatible upgrades.
Before/after previews use the migrated values as well as the new definition.
Updates remain drafts and use the existing save/release commands.

New slide additions begin empty, show on the canvas as written, and remove all
fields on Cancel or Back. Done requires a meaningful title, photo and description
(or decorative choice). The shared member/worker/release readiness path catches
unfinished enabled slides; old immutable numbered heroes retain their existing
policy. No database permission, publication override authority or source access
is broadened. The story picker reads this site’s saved records under existing
list rights and never refreshes a public feed.

The six-second enhancement pauses on hover/focus and document hiding, disables
automatic/smooth motion for reduced motion, and preserves anchor navigation
without JavaScript. Only a rendered repeated hero gets its exact script hash;
no arbitrary script origin or inline-handler permission is added. The existing
private canvas bridge keeps the selected slide visible. Dates use local calendar
days with an inclusive end; the renderer checks the window on each page load.
Tile hover is limited to fine pointers, with the same outline for keyboard
focus; touch hover is omitted. Existing source skin dimensions are preserved.
Reverse through an earlier page version as a draft and a normal reviewed release;
immutable old definitions and earlier media remain available.

Private preview font correction (2026-10-31): keep the site's RLS-scoped staging
address when its private shell has no host, so the existing exact kit-host gate
can select the approved kit. Permit only its fixed CSS/font/licensing-image
resources in editable, scriptless and parent admin policies. Script nonces/hash
and scriptless restrictions stay enforced. This fixes CMS policy/context bugs;
Adobe account address permission is still checked by actual browser loading.

Coming up (2026-10-31): use existing Story drafts, exact release review and timer
commands. A drag is a proposed choice, never publication or an immediate write.
Cancel saves nothing; Review schedule saves the day and opens the normal review.
Use all seven calendar days for weekend publication, with a button/date field as
the keyboard path. Do not infer Story membership of old whole-list jobs. Keep the
engine's current conservative conflict rules until independent scheduled reviews
can be proved safe; calendar UI alone does not complete that requirement.

Story version preservation (2026-10-31): keep the ordinary guarded collection
save command and scope its no-change optimization to reader_key=stories. Skip
only exact active/current-field rows after validation and ownership checks. Do
not weaken collection CAS, normalize away real field upgrades, skip ordering or
archive history, or change ordinary non-Story lists. A complete Story no-op does
not change its dirty counter. Independent release schedules remain separate work.

Independent Story release review (2026-10-31): preserve exact canonical Story and
article version pins in a server-owned dependency hash; keep immutable original
release snapshots. Refresh only the collection concurrency counter after those
pins match under the normal site locks. Retain whole-site behavior for all other
release kinds and old reviews. Classify articles by their registered first
Story-detail binding plus owned record, not an editable URL alone. A Story
publication does not silently add a header link on native automatic menus.
A fresh published-only baseline distinguishes an already-public finding from a
new effect of this Story. It may tolerate a missing unpublished Story for that
baseline only; final trial/application stay strict. Existing findings are audited
separately and other private drafts cannot grant consent. Recovery refreshes
unselected before-state at application, preserving later publications and private
drafts without changing the reviewed Story. Permissions, pending approval,
policy version and media validation remain enforced at execution.

Story photo editing (2026-10-31): reuse the governed picker and unchanged focus
control. Require a description for Story placements without changing decorative
images elsewhere. Resolve library ownership/readiness and the public URL on the
server, then use the existing guarded Story save. Replacing the image clears its
sample marker; recropping/redescribing the same image preserves provenance.
Cancel never changes the Story. Full editor design and placement remain open.

Story writing layout (2026-10-31): put writing before preview in a shared full-width
editor frame. Keep the approved toolbar/form structure and use existing CMS
controls for the required sidebar omitted by the reference. Preserve working RTE
list/link actions. Collapse focus details, remember panel width, and group source
under the Super-admin Advanced tab, with Content selected by default. Restrict new/edited summaries to155 while keeping
unchanged approved imported copy. Use normal private saves before Preview or Save
draft and leave; a failed departure save must retain the editor and its words.
The Details heading replaces its redundant single tab. Browser-history/other-writer
guards and actual placement remain separate required work.

Story placement (2026-10-31): derive destinations from real page bindings and public
snapshots, not hard-coded site/page names or unrelated draft rows. Read current
published route paths, so an unpublished URL change cannot affect the projection.
Use the target article's draft and clearly label a private site's initial context.
Share widget selection and definition-owned date opt-in with public rendering;
never generate map geometry merely to explain placement. Limit transported other-
Story fields to selection criteria. Update only local projection on tag/date
changes; ordinary saves/reviews remain the writing and publication authority.

New Story recovery (2026-10-31): put an immutable, author/site-scoped receipt around
the existing private page/list commands, inside their transaction. A response
lost after commit must replay the original result rather than duplicate content.
Hash the authored values, not mutable tag labels or library defaults. Keep
permissions, media checks and collection concurrency on the first write. While
a transport result is uncertain, preserve and lock the submitted form and offer
the same request's retry. No direct receipt writes or public receipt reads.

New Story writing screen (2026-10-31): use the same writer as saved Stories rather
than a separate preliminary dialog. Carry unsaved candidate metadata only for
read-only placement; create no placeholder. Save authored text/photo/tag/date
through normal private creation and its stable retry receipt. Preview/review
intent continues on the fresh saved Story; Publish still never applies directly.
Keep the new form mounted and its request id stable when server props refresh.

Editing parity authority (2026-10-31): use approved row13 and the exact Symphony
follow-up as the target. Finish Stories,then follow the eight supplied parity
pieces before Echelon final checks. If time is short,originalRound3/add-ons/walk
win and parity is cut from the bottom. Reuse existing drafts/releases,menus and
permissions;no separate Symphony/Tools/Event/alert system or new section types.
Page-list switches write the same site-wide commands as Header & menu/Footer.
Featured Story order is for news lists,never sector selection. Role wording may
change without changing roles/rules. The33-row handbook map distinguishes approved
targets from verified availability and excluded ideas.66 checks require the real
acceptance walk;planning and existing tests do not turn them into Pass.

Explicit Story visibility (2026-10-31): interpret the required Hide from feeds
item literally across automatic feeds,manual placements and the canonical
article. Keep records and private work intact; publication changes visibility.
Filter known hidden manual keys before normal resolution while retaining every
invalid/unknown choice for existing refusal. Use existing canonical definition
and binding ownership plus published values to suppress only the Story article
route/sitemap entry. Ordinary pages stay public. Do not apply13-month age or
automatic-feed review policy to direct visible articles. Unhide uses normal
publication and restores the existing article,not a new copy.

Complete Story sources (2026-10-31): separate a managed widget's complete source
pool from an authored feed's display limit. Reuse the existing2,000-entry library
bound only for owned World/Split automatic sources. Keep ordinary binding limits,
non-Story envelopes,SAWSO6 and all selection/permission rules. Validate original
records,then omit optional non-card fields to stay within the unchanged manifest
resource guard. Required fields and real schema/version identities are retained.
Reuse the same scoping in draft preview and placement. Keep legacy All settings
and stored bindings stable;no data backfill or publication outside normal review.

### 2026-10-31 — Recover Story drafts by field
Use the normal authorized route refresh to obtain saved Story fields after a
revision conflict. Keep local words,combine independent fields,and require a
choice for overlapping changes. Apply choices locally before another ordinary
save;never bypass CAS or publish as part of recovery. Related photo and region
fields are atomic choices. Reversing this UI needs no database migration.

### 2026-10-31 — Schedule from the page writer
Reuse normal release preparation and Publish later instead of a second timer
form. Flush the existing canvas/save queue,resolve exact owned saved pins on the
server,and review only that page. First-site design review stays explicit. If
edits arrive while preparing,stay in the writer instead of discarding them. The
release engine rechecks permissions and pins under its existing locks. This UI
entry needs no migration and can be removed without changing pending schedules.

### 2026-10-31 — One saved page difference vocabulary
Use one formatter for the editor review and Publish Ready. Resolve native repeat
fields by their saved item definitions,so changing a card's text or slide focus
is described even when order stays unchanged. Read the requested version under
RLS and verify the editor's saved pins;existing publication still checks CAS and
permissions. Show uses existing section selection. Custom source is described
without exposing it. Preserve existing dialog/button accessible names;record the
remaining layout differences. Reverting changes descriptions/UI only,no migration
or publication backfill is required.

### 2026-10-31 — Resume navigation after a private draft decision
Extend the existing committed-effect guard registry with explicit save/discard
callbacks and one shared root Dialog. Defer only the requested same-tab CMS link
or app Back action;resume it after successful private saves. Read callbacks
again at confirmation so a partially saved group does not retry stale closures.
Keep native protection for pending writes and writers not connected yet. Header
and Footer are the first rollout,without rewriting their commands or database
rules. Browser history and other writers remain open. Revert by removing these
callbacks and the shared prompt;no migration or saved content changes are needed.

### 2026-10-31 — Reuse Story leave review for requested destinations
Let a single writer-owned guard reuse its existing dialog and save flow,keeping
new-story receipts and saved-story conflict recovery intact. Resume the exact
requested CMS destination after successful save/discard. Search closes only when
handing off to a draft prompt;its original rejected-browser-warning behavior is
preserved for other writers. Existing pending-write and permission checks stay.
No migration or publication changes;reverting removes the optional UI callback.

### 2026-10-31 — Keep an opening private snapshot for page leave
Autosave advances the editor's saved baseline, so retain a separate opening
snapshot for the visit. Discard writes it through the ordinary checkpoint queue
and revision checks; conflict refuses to overwrite another saved draft. Keep
removes only newly inserted empty native repeat items and avoids duplicate
versions when the retained draft already matches. A shared committed-state
subscription keeps leave copy/progress accurate while autosave finishes. Native
document warnings still concern unsaved/pending work; CMS choices also cover
autosaved visit edits. Revert by removing these callbacks and the opening
snapshot; no migration or public content change is required.

### 2026-10-31 — Keep the History journey explicit after page leave choices
History links now pause for the approved private-draft decision. Update the two
owned saved-draft journeys to choose Keep draft and leave,retaining every
immutable-version,restore/public and raw-code sandbox assertion. No harness,
browser configuration or application permission change is involved.

### 2026-10-31 — Return tag-save outcomes to the shared leave flow
Separate the existing tag persistence operation from its transition wrapper so
the leave dialog can await the actual private-save result. Reuse the same tag
command,validation,revisions and role checks for both paths. Save failures keep
the tag fields;success closes the nested edit before resuming the requested CMS
link. Discard closes only unfinished local fields. No migration or publication
change. Revert these callbacks to remove this screen's three-choice rollout.

### 2026-10-31 — Keep Stories setup and policy navigation explicit
Make existing setup/policy saves return their actual outcomes to the shared
leave dialog. Separate ordinary setup navigation from save-before-leaving so
only the requested destination opens. Existing commands and idempotent creation
are reused;no extra feature records or publication commands are introduced.
Discard restores local defaults/saved policy. Revert callbacks and the navigation
flag without any migration or content conversion.

### 2026-10-31 — Await Story-list queue outcomes before leaving
Return a private-save outcome from the existing list drain operation. Reuse it
for leave-save with its own error dialog suppressed,so a failed retry does not
place a second modal over the leave choices. Keep existing normal error/retry
controls. Discard uses the current saved baseline after any acknowledged partial
saves;it never rewinds another saved story. Missing targets remain refused and
all normal command/revision checks apply. Revert these callbacks/outcome return
without migrations or public content changes.

### 2026-10-31 — Await font draft outcomes before navigation
Return the existing theme-draft command result to the shared leave prompt and
use an immediate in-flight ref for duplicate/pending protection. Include the
editable kit link in dirty state and enforce its existing approved URL/check
step. Keep normal transition-based Save and review publishing. Discard restores
local saved tokens;no database write or publication. Revert callbacks/outcome
return without any schema or font-asset change.

### 2026-10-31 — Connect site-look choices without changing publication
Use a dedicated private-save callback sharing the normal theme command and
immediate action lock. Keep the existing ordinary Save/Publish/revert transition
paths intact. Return actual validation/conflict/network outcomes to the leave
prompt. Discard restores only local saved choices. No migration,permission or
public theme change;revert the callbacks to remove this screen's rollout.

### 2026-10-31 — Save list items before changing the workspace
Reuse the normal entry save command through an awaited private-save callback,
with the existing action lock and selection epoch. Never save to a list selected
after the request began. Replace internal link/selector discard confirms with
shared leave requests;capture the requested list before awaiting a decision.
Discard restores the local saved entries/model without database writes. Normal
publication and review commands stay intact. Revert the callbacks/link routing
without migration;setup/field/CSV dialogs remain separate rollout work.

### 2026-10-31 — Register page-linked list fields separately
Capture the form's loaded values for dirty checks and return actual normal
inline-list save outcomes to the shared leave flow. Share an immediate action
ref between ordinary save and leave-save. Keep the existing parent canvas
refresh after a private save. Local Cancel closes only the item form;leaving
the whole page can address both page and item drafts through registered writers.
Unfinished photo/document picks require their explicit selection first. No
migration or permission change;revert the form callbacks and snapshot to undo.

Media leave keeps the existing direct library-metadata save;it does not invent
a draft engine. The shared prompt supports an explicit library save mode with
Save and leave and clear immediate-update wording. Normal page/story draft
wording stays unchanged. Close,Used on,Replace and lifecycle entry points use
the same decision;actual failed or unconfirmed writes keep the form open.
Owned Media handler tests mock the new navigation dependency,retaining all
existing in-flight and confirmed-save/failed-refresh assertions. No runner,
React scheduling or test-tool configuration is changed.

For native page editing,the maintainer’s hard content-only Editor rule takes
precedence over the RoleViews draft matrix's Editor add/move allowance. Hide
section management and appearance/visibility controls from content roles;keep
card/slide content flows and admin section move buttons. Imported-site editor
interfaces remain frozen. This is UI reduction,not a database authorization
change. Full role matrix remains a draft for review;other screens remain open.

Role-control compatibility checks keep the chapter setup save assertion and
let the site administrator set section visibility afterward,before volunteer edits.
The shared-list Editor journey checks absence of section management;the admin
role journey retains the toolbar-outside-canvas geometry check. Public-output,
page-scope,invitation and approval assertions remain. No test tools changed.

Symphony hero parity extends the shared definition with a version opt-in. Older
published pins and imported links keep their existing rules. Use real published
section anchors,normal readiness and the existing private page command for
copying. Copies go last/off;an existing newer destination definition is kept.
The date-aware runtime retains future slides for activation while the page
stays open;off slides/buttons are omitted. Eastern end minutes are inclusive,
with explicit spring-gap rejection and first-occurrence autumn behavior.
Presentation controls follow the native content-role hard rule. Reuse shared
Field counters,editor Cards,Media/focus and link components;no per-screen CSS.
The inspector source-access unit mocks the new owned copy-action dependency,
with its original source-permission assertions retained;no tools/config changes.

The retained third SAWSO introduction is230 characters. the maintainer’s exact-copy
preservation rule wins over forcing it into the new200 counter. UI and normal
readiness check the unchanged published baseline;new or altered overlong text
still requires200. Copy commands verify the source's published baseline too.
Black-to-blue75%black→35%navy and black50%use the exact SymHero markup;the
photo contrast check reports low samples instead of darkening the approved
look. White88%withdarkcopy and None are not pictured as selected states;record
that choice and actual photo checks under Needs administrator input.

Symphony Pages is limited to native sites;the frozen imported list and creator
are retained. Reuse header/footer/page commands and their normal transaction
checks. Operational page order uses the existing granted sort_index field
only after a site-admin check;an advisory transaction lock and loaded order
snapshot guard reorder races,and menu order remains a publication draft.
Keep external/group placements during page-sibling sorting. Shared dialog,
fields,counters,table,filters and leave review require no screen-specific CSS.
The existing80-character menu label limit remains;website creation explains
that limit rather than silently shortening a90-character title.

Section link rename is an atomic set of normal draft commands. Preserve old
anchor names as safe shared-renderer targets so publishing the source before
its old referring pages keeps those public links working. Do not alter prose
or guess where a fragment-only link in shared content points. Refuse that
ambiguous case for manual review. Source-version and related-head comparison
protect against stale rewrites. Related-head conflicts leave the source save
queue usable;source conflicts reload the source. Copies clear retired names
and use the existing insertion helper to avoid duplicate ids. No migration or
page-specific rendering code. Imported projections keep their old fragment
rules. Declared native-link readiness runs on the complete release simulation.

Symphony4:insertion previews are read-only renders of the saved page plus one
allowed existing section at the chosen gap. They never create a draft or a
sample record. Add alone enters the existing document history/save pipeline;
Cancel restores the saved canvas. Native library uses the left shared panel,
while imported screens and layout mapping keep their working path. Reverse by
removing native insertion-preview wiring;no database migration is required.

Symphony5:feature position and optional Author belong to Story entries so their
editing follows existing content permissions and normal immutable entry drafts.
An explicit administrator update adds optional fields;reads never upgrade data.
Newsroom selection prioritizes featured entries before its limit;tag-filtered
feeds and map/sector lists keep date order. The normal save command checks five
unique positions without expanding any role. Reverse the UI/order preference
while retaining optional saved metadata;no article copy needs replacement.

Repeated-hour scheduling uses the next future matching local instant and shows
its zone abbreviation before submission. This fixes an autumn-fold future time
being parsed as the earlier,past occurrence. Spring gaps refuse silently moved
clock times. Server timing,review and permissions remain authoritative. Reverse
by replacing the form conversion only;stored schedules remain absolute instants.

Scoped Story publication validates the combined proposed public feature set
after its existing authorization/revision/review checks,before writes. A group
reorder cannot partially replace a live position or add a sixth feature. The
normal rollback-only release simulation uses this same command,so the refusal
comes in review and schedules retain the same guard. Independent word changes
remain separate. Manual widgets explicitly decline automatic feature priority.
Reverse through a new forward migration that removes the function guard;no
content rows change. Do not edit applied migration history.

The dedicated native Title panel retains the ordinary selected-field marker
and inspector reference. Publish readiness links therefore keep their visible
selection/focus behavior after the cleaner title flow. The owned stale-
comparison test now expects the already approved named-difference wording,
with its exact-version refusal and refreshed-preview assertions retained.
Reverse the panel attributes alone;no database or permission change is involved.

Optional Story-control adoption preserves unchanged immutable entry heads. A
private internal predicate accepts identical existing field definitions and
only canonical optional Author/Newsroom order additions;identical-field policy
updates are compatible. Ordinary value/media/ownership/CAS/review/feature guards
remain. Other models and other field changes retain exact-version upgrade rules.
The same predicate is used by scoped and grouped publication,so a first edit
does not strand unrelated Stories in Ready. Reverse through a new forward
migration;no row backfill is performed. Code/database rollback remains paired.

Legacy Story models remain strict. Publish exposes their required content
upgrade as “Update editing controls for N stories” even if no words changed;
compatible optional controls need only the fields choice. This makes the old
upgrade explicit before an ordinary content save. The shared shape predicate
is invoker-scoped for read-only summaries and owner-scoped only inside existing
guarded commands;row access and editing permissions are unchanged.

Symphony Settings uses the existing site-settings version tables,not theme
tokens or a new storage service. A first draft materializes only the existing
published name as an immutable recovery baseline when needed;it introduces no
public values. Canonical General/Search/Social blocks publish through the
existing release commands and site shell,including timer and History recovery.
Legacy/imported output has no new behavior until explicit adoption. Social
Footer and site-social sections share one source;chapter-owned content links
follow the approved chapter map. Site name keeps its existing CMS/browser-title
meaning;logo text stays in Header & menu. Reverse with paired code/data restore
or a tested forward compatibility migration;never edit applied history.

### 2026-11-01 — Keep site settings in the normal release and recovery path

Use the existing site-settings head and immutable versions. A private save
retains the old public name before the first authored change; no read or
migration materializes new public values. Publication, scheduling and History
use the shared release commands and exact revisions. Verification tags are
structured supported tokens, never arbitrary head HTML. Copying substitutes
the destination name. Reverse through reviewed History recovery or a paired
local backup/application restore; do not edit migration 0187 after application.
Visible Settings screens and public account/search projection are subsequent
pieces, not completed by this foundation.

### 2026-11-01 — Explicitly connect existing Links sections to site accounts

The current library has no separate social section type. Extend its existing
On-page navigation definition with Links from, retaining This section as the
manual default. Only an explicit Site social accounts choice derives account
links. Footer switches affect Footer only. Original sites, old immutable pins
and chapter-owned links remain unchanged. Keep an existing TikTok service
rather than deleting it to match the five-row example. Reverse by selecting
This section or recovering the settings release through History; no page
content is overwritten by derived links.

### 2026-11-01 — Preview the sitemap privately while keeping staging noindex

The existing public sitemap refuses staging hosts. Preserve that boundary;
Settings View sitemap reads only published routes under the Admin's access and
returns private,no-store,noindex XML. Share the XML formatter with the public
route,whose live-host checks remain unchanged. Verification inputs accept only
supported quoted meta tokens;hints are escaped metadata. Reverse through
reviewed Settings recovery;no public domain or deployment is created.

### 2026-11-01 — Recover copied Settings with the complete first release

A site copy's Settings are private,so they have no previous public version.
Use the existing reviewed unpublish recovery intention for that case rather
than refusing complete-site recovery. Normalize newly imported name-only
Settings and substitute the destination name in all copied versions;preserve
canonical optional blocks. Existing source/retained versions are unchanged.
Migration0188 is forward-only;reverse a publication through normal History or
use a tested matching local backup/application restore.

2026-11-01 — General Settings adopts the existing versioned publication path.
Keep name and its descriptive fields in one atomic draft;published language and
fallback description apply only to native templates. Existing setup and
maintenance operations stay behind Settings groups,with Advanced as a recorded
extra to preserve backup/scripts/archive access. Original-design sites retain
their existing screen and output. Revert the screen/API integration to undo;
no new migration or retained data backfill is required.

### 2026-11-01 — Put the selected site before search and group native navigation

Use the approved site-first structure and Site-wide/Publishing headings,while
retaining existing global destinations under Workspace and management tools
behind Advanced. Hide native site-wide destinations for content roles without
changing database permissions or frozen imported-site behavior. Existing fold,
account and administration extras are recorded for visual review. Reverse the
shell/nav changes to undo;no content or database migration is required.

### 2026-11-01 — Use shared compact content rows for native Pages

Keep the approved desktop actions and shared menu commands. Use the existing
linked title as the tablet editing path while condensing its duplicate Edit
action;keep View live and More visible. Shared search,small pills and content
row density avoid screen-specific CSS. Menu parents and dates stay readable.
Original-design lists remain unchanged. Reverse the native layout opt-in to
undo;no content or database migration is involved.

### 2026-11-01 — Start native content accounts from their allowed tasks

Reuse scoped page,story-coverage and calendar readers for Home;opening it never
refreshes a source feed. Keep the selected site in the Home link and preserve
the existing Overview route. Short menus hide administration and Contributor
publishing,while existing lists and chapter scopes remain reachable. No
permission change is implied by a Home card. Contributor new-story creation is
an explicit remaining role-draft gap. Revert this native content branch to undo;
no content or database migration is required.

### 2026-11-01 — Version Echelon layouts as shared section variants

Use ordinary immutable library definitions for the approved Echelon opener and
jump links,with a shared template skin. No page stores code,and existing page
pins stay unchanged. Keep the national header/footer and site font. Complete
Media and the remaining map before replacing retained pages. Reverse by
choosing the previous definition pins;no retained data migration in this piece.

### 2026-11-01 — Keep Echelon body copy in shared field assembly

Version the approved purpose,photo collage and three pillars as shared variants
with ordinary editable values. National/chapter copy differences are explicit
and limited to reviewed text. Copy the matching reference CSS rules into the
shared skin;no per-page code or remote images. Preserve old pins until the full
map and Media are ready. Reverse by selecting earlier versions.

### 2026-11-01 — Reuse contact handling under the Echelon template

The Echelon form changes only its presentation,using the same endpoint,field
names,required validation and recording behavior. Native grouped details keep
FAQ usable withoutJavaScript. No new messaging service or page code. Standard
forms keep their labels;reverse by choosing previous section pins.

### 2026-11-01 — Import Echelon reference Media explicitly and once

Bind the11 local files to reviewed hashes,then use existing upload/receipt/
processor commands. Keep a private import record for safe repeat checks;mark
borrowed chapter photos for replacement. Exclude the unused banner and reuse
the shared shield. No source fetch or startup import. Reverse unused imports
through normal Media removal after checking references;keep the pre-import dump.

### 2026-11-01 — Reuse the board list for the Echelon chapter layout

Use existing repeated board fields and eight-first native disclosure,with the
approved chapter card skin. Keep names and photos optional where the reviewed
reference has placeholders;edit them through normal fields and Media. Contact
roles/name/email remain content,not page code. Reverse by retaining prior pins.

Library previews include the shared Echelon skin and ship as local generated
images. The original-site compatibility journey exposed missing previews for
the new variants;all nine are now included without changing existing images.

### 2026-11-01 — Keep national leadership in shared content fields

Use the supplied public national council text and locally imported photos in
a shared leadership variant. Do not invent identities or reuse chapter/SAWSO
photos. Keep group and portrait pictures independently editable through Media.
Reverse by restoring the prior page pins;no existing version is rewritten.

### 2026-11-01 — Reuse native lists for Echelon chapter engagement

Keep events as ordinary repeat fields and native details. Extend the existing
date presentation with a fixed calendar style and native date input;one date
controls its month/day display. Follow uses the existing Links projection for
optional saved site accounts,while chapter-owned links remain independent.
Examples stay explicitly labelled. Reverse through prior section pins.

Formatted date fields now request the canonical preview render instead of a
plain text patch,which removed their calendar markup. The displayed date is
selected normally and edited with its date input;public rendering is unchanged
for existing long-date fields. Empty-list instructions use panel and a/an.

### 2026-11-01 — Distinguish division pages from chapter-owned websites

Add a destination value using the existing address/contact fields,publication
commands and local reminder outbox. Keep HTTPS validation,tenant checks and
admin-only publication unchanged. New division links create no local page;prior
pages remain available separately rather than being silently removed. Do not
claim Page found without a permitted address check. Reverse through a normal
chapter draft;the additive enum must remain understood while versions use it.

The initial Ready list excluded all chapter links. Permit the new division
destination in the complete first release,keeping the normal mandatory first
site dependencies and Admin-only chapter publishing. Prior destination behavior
is retained. Show private contact differences in the authorized release review.

The seven-item initial division release exposed the confirmation's six-item
limit. Keep every selected item's name and plain summary in the existing
scrollable dialog so the final confirmation includes the new directory link.

### 2026-11-01 — Bind the national chapter map to published identities

Expose the existing immutable chapter slug alongside the already public name
and destination. Preserve publication,host and private-contact filters. Use
map outlines/marker facts extracted from the approved local reference;do not
copy its map JavaScript or embed its destinations. Keep unknown chapters in
the list and make map enhancement optional over native links/search. Reverse
unused presentation through normal pins;older readers ignore the additive slug.

### 2026-11-01 — Compose the reviewed chapter from shared variants

Keep the approved section order and wording in a single constructor,using
site-owned Media rather than page code or another site's photos. The explicit
composition marker opts into a shared white frame. Older authored drafts and
individual section previews retain their existing layout. Conversion remains
an explicit draft operation after the chapter permission checks;reverse through
History or a normal draft. No automatic retained-page conversion is added.

### 2026-11-01 — Enforce chapter availability behind the editor

Filter incompatible sections and saved templates,but enforce the boundary when
Postgres creates a version so copying or direct commands cannot add Stories or
national-only sections. Keep all existing page role predicates and legacy
shared locks;extend contributor locks for the reviewed About and common FAQ.
Generate jump links from visible sections instead of making editors maintain
them. The full division role map/local FAQ and one-source shared propagation
remain open. Reverse presentation through normal drafts;retain guards while
chapter templates depend on them.

### 2026-11-01 — Bound Content creator article creation to an own private story

Use a narrow database command after the existing list save in the same
transaction. It accepts only the creator's original, unpublished Stories entry,
validates its local story address and described site/shared Media, then creates
an unpublished article under normal page triggers. Preserve retry receipts and
list concurrency checks. General page creation and publishing remain denied.
Reverse by hiding the creation route and revoking this command; saved drafts
remain available. The paired submission/approval flow is still required.

### 2026-11-01 — Pair Story review with its article through the existing Inbox

Capture one immutable entry and preview when a Story article is submitted.
Use the normal page request,comments/return flow and reviewer role checks.
Approval takes page,collection/entry,then submission locks;it validates saved
values/settings and calls the existing selected-entry and page publication
commands atomically. Identical list version churn does not invalidate another
author's review. Private evidence never alters public rendering. Reverse the
new Submit affordance and hooks while retaining saved review evidence.

The real generic-site review exposed a fixed SAWSO Newsroom breadcrumb. Replace
it in the shared article definition with an optional library link;new drafts
choose the site's existing eligible Newsroom or omit it. This preserves readiness
and avoids creating unsolicited pages. Older article pins remain unchanged.

### 2026-11-01 — Put Reviews into the approved queue/detail layout

Keep /inbox and the existing review commands. Label it Reviews and use shared
Workbench,controls and comparison helpers so saved differences match Publish.
Put decisions at the top and separate preview/discussion from changes. Lists
retain their working dedicated panel;management work moves under Advanced.
Save an unsent comment only in browser storage scoped to the signed-in person
and authorized request;never send it through Save draft. Keep the embedded
Publish panel's layout. Reverse this presentation without changing review data.

### 2026-11-01 — Use site-owned Echelon photos at creation and publication

Resolve the approved imported Media by its saved source inside the current
site's RLS boundary. New chapter setup uses the reviewed shared composition;
library insertion and its private preview share the same starting values.
Preserve original image descriptions/focus and authored values. Missing choices
stay empty. Add a database publication guard against generic sample pictures on
chapter-enabled sites,with the same plain readiness explanation. Text-sample
consent cannot waive this check. Borrowed reference photos and empty board
entries remain replacement work. Reverse via normal versioned drafts and an
explicit policy migration,without changing Media ownership or page access.

### 2026-11-01 — Assemble national Echelon from native shared variants

Use the same parent and Media as chapters,with a national section map and no
events. Three ordinary linked cards preserve the supplied national teasers and
external destinations;full CMS articles wait for their missing text/dates.
Keep national social accounts in Settings,derive only their social group,and
preserve page links when accounts are empty. Fixed local Bootstrap brand SVGs
match the reference without an icon font or third-party runtime. Sources/file
hashes and MIT notice are retained with the renderer. Keep all approved public
words in the page and record missing source material instead of inventing it.
Reverse through normal page/settings drafts and immutable definition pins.

Derived empty-list examples can contain generic illustrations outside stored
page values. Project a fixed Echelon photo policy through the existing shell
builder and omit only those pictures during both preview and public rendering.
Retain Media and all text/links;ordinary sites remain exact. Keep0194's stricter
authored-picture publication guard. No backfill or execute-grant expansion.

The national section map is enforced in both library choices and normal saved
versions. Its previous marker prevents replacing the composition with chapter
events or per-page code. Trigger ownership and grants remain narrow.

###2026-11-01 — Site-owned numbers through existing settings releases

Use immutable site settings for named numbers;avoid a second publication engine.
Bind fields by stable IDs while preserving authored fallback words and labels.
Resolve against the explicit draft or published shell,never another site's
settings. A status change carries no automatic publication. Keep required
sources and usage visible;refuse deletion while current pages refer to a number.
Revert through existing settings History and normal reviewed drafts.

Remote number files use an explicit Admin-only server read with checked public
IPv4 addresses pinned to the HTTPS connection. Recheck each of at most two
redirects,never forward browser credentials,and bound DNS,time and1MB input.
Keep the existing CSP unchanged. Refuse the reserved SAWSO story feed here.
Local JSON/CSV goes through the same private review. No automatic sync.

The list's role gate resolves outside its loading boundary so unauthorized
requests return an unavailable response before any private number reads.
At tablet widths the common list/detail panel follows the full-width table to
keep columns and controls usable;desktop widths keep the remembered side panel.

###2026-11-01 — Complete fixed numbers and first-pick stat labels

Retain fixed historical values during file review and enforce explicit
unfreezing at the version boundary. Fill empty/example stat labels through
the existing atomic field-value update,with a record of the automatic label;
never replace an authored local label. The page-authorized picker prefers
published values for existing IDs and includes new private IDs without
publishing them. No backfill,policy weakening or new publication path.

### 2026-11-01 — Reusable report letters and financial rows

Keep the approved report bands/disclosures in shared library definitions,with
ordinary repeated fields for letters and financial rows. Calculate chart
proportions from amounts in the renderer;invalid amounts produce an empty bar
rather than CSS. Native details need no script. Fonts continue through the
site kit;exclude the reference preview-host overrides and external font imports.
Existing page pins stay unchanged;remove an unused section to reverse adoption.

### 2026-11-01 — Share the reference Media import flow

Reuse the existing receipt,upload and processor commands for report photos.
Keep the Echelon wrapper's chapter-only check and metadata unchanged. The
report operation accepts an explicit local manifest and kept dump;source URLs
are metadata only. Hashes and stored original objects are verified on repeats,
with an atomic private import record after each photo. Roll back unused imports
through normal Media removal after checking usage,or restore the kept local dump.


### 2026-11-01 — Reusable report stories and regional lists
Use one country-story definition with reviewed layout variants and a separate
native region-list disclosure. Normal photo, rich-text and repeating stat
fields retain exact report content and the existing draft/review path. Empty
optional parts stay absent. Global Presence continues using Stories World View.
This keeps the five-type report scope; page links remain the last new type.
Reverse by selecting another shared section on a private draft; immutable
existing page pins and all other sites remain unchanged.


### 2026-11-01 — Report page links follow named sections
Generate the report bar from visible primary section anchors and current
headings, in page order. Reuse the same sanitized links in a native phone
disclosure. Earlier anchor aliases preserve older destinations without
duplicating navigation. This avoids a second editable list becoming stale
after heading, order or visibility changes. It is the last of the five new
report types. Reverse by removing the bar from a private draft; other types,
site menus and existing immutable pins retain their behavior.


### 2026-11-01 — Compose the report from shared sections
Reuse the existing cover, text/photo, tiles, stats, FAQ and closing
sections alongside the five approved report types. A shared report composition
groups its normal instances into the source bands; a closed template marker
selects that layout, as with the existing chapter composition. No page HTML,
custom CSS or scripts are stored. Section fields retain shorter navigation
labels, photo captions, member counts and page/PDF links where needed. Existing
pins remain immutable; adoption is explicit and private. Reverse by removing
the composition marker on a new draft or restoring an earlier draft.

Repeated report instances validate their immutable definition once (November 2).
The complete report exposed repeated database CSS checks for the same story
version. The manifest materializes a unique definition-validation input, because the
database otherwise pushes the validation predicate through DISTINCT;
all instances, per-instance values, list resolution, bounds and permission checks
remain in order. Different versions still receive separate checks. Reversing the
migration restores repeated validation without changing saved report content.
### 2026-11-02 — Report links reuse normal page fields
Annual Reports adopts the existing text/photo section's Web page and PDF fields
as compact rows inside one shared white card. Previous descriptions and photos
remain in saved data. Fixed button labels and conditional destinations follow the
approved ReportLinks reference. PDF replacement reuses the existing site document
picker; its page wording is explicit. Published-page picker scope and normal
review stay unchanged. Reverse by restoring the earlier private index draft.

### 2026-11-02 — Preserve formatting around saved numbers
A rich-text binding keeps the page's authored paragraph and emphasis markup;
only the saved-number substitutions are escaped as text. The existing shared
rich-text sanitizer remains authoritative. Plain bindings retain their previous
escaping. A bound canvas field selects its saved-number controls; it cannot
accept an inline edit that resolution would ignore. Each number can be replaced
without losing the others. Detaching restores the resolved visual rich text.
Reverse by detaching the field on a normal draft; immutable earlier versions stay.

### 2026-11-02 — Define acceptance and deferred work
SPEC section 17 defines the release acceptance and deferred work. Chapter headings use their source names;
acceptance retains touched WebKit batches, the numbered walk and public-source
comparisons. A local install/migrate/restore rehearsal and a fresh-role simplicity
pass precede acceptance. Minor admin differences are recorded with their reason.
No hosting command or static export is added. Reverse only by a new release scope.

### 2026-11-02 — Chapter names identify their shared heroes
The chapter hero heading comes from chapter setup, initialized from the exact
source-list name. Creation and setup renames keep the other shared fields and
Media. Existing local pages receive heading-only drafts and the normal reviewed
release; unrelated private drafts are excluded. Reverse through page History.

### 2026-11-02 — Role wording follows the approved names
One display mapper names existing roles in People and account badges. Stored
identifiers, access commands and comment-only review roles are unchanged.
Assigned-page and division notes preserve scope; truncated badges expose their
complete label. Reverse the display mapping without a data migration.

### 2026-11-02 — One location for nested editor navigation
Native section panels provide a fixed action host. Cards and slides render
their existing controls there through a local React portal, retaining their
handlers, validation and cancellation. Only one set is visible. Original-editor
controls keep their fallback. Reverse the host wiring without altering content.

### 2026-11-02 — Keep an optional card introduction compact
Native repeated-card sections put the optional rich-text Introduction in a
normal disclosure, initially closed when blank and open when authored. Rail
selection opens it. Fields, values and renderer output are unchanged; this
removes no editing capability. Original imported fields keep their existing view.
Reverse the disclosure wrapper without a content migration.

### 2026-11-02 — Neutral local fixture identities
Local demo accounts use role placeholders; shared sample people and speakers
use numbered sample labels. The affected catalogue previews are regenerated
with the existing offline renderer. Existing known fixture accounts retain their
IDs, authentication, status and access through the normal provisioning command.
Authored/imported page and list versions stay intact. Reverse labels through the
same command; no credential or permission migration is involved.

### 2026-11-02 — Native Site overview is a factual workboard
Use the approved compact header, task cards and two-column attention/recent/
lists/people structure for native sites. Counts come from existing authorized
saved records. Story articles stay out of the page tree; the full tree and
archive tools remain below. People management stays Super-admin-only under the
current permission rules; others see their own access. Imported Overview is
unchanged. Reverse the native branch/component without a data migration.

### 2026-11-02 — Native Media keeps its library available
Use a bounded, nonmodal shared details panel beside the native image grid;
retain the modal drawer for imported sites. Switching image,search or filters
uses the existing leave decisions, and library refresh retries a read without
repeating writes. Library/Tag/Sort use a disclosure to keep the primary work
visible at1024. Existing image processing,metadata/usage/replacement commands
and separate Documents remain. Reverse the native presentation flag/panel;
no schema or content migration is involved.

### 2026-11-02 — Native History separates saved evidence from restoration
Use the shared queue/workboard and scriptless previews. The current draft stays
first; an older selection defaults to a comparison with it. Normal restore still
creates a new draft. Saved-form labels reuse Publish; full stored fields remain
in a Super-admin disclosure. Loaded-version filters are explicit, scoped users
stay on their page and archived sites cannot restore. Imported History retains
its existing screen. Reverse the native branch without a data migration.

### 2026-11-02 — Native Publish separates saved work from future requests
Use a compact saved-change table and header actions on native sites; put the
existing schedule queue in Scheduled. Informational author/time stamps use
RLS-protected saved-version records and stay separate from publication pins.
Missing evidence says Not recorded. Exact comparisons,review/approval,first-site
checks,scheduling and release recovery keep their commands. Imported sites keep
their existing presentation. Reverse the native flag/reader without a migration.

### 2026-11-02 — Admin Home starts with saved attention
Use Needs you,site cards and recent work in the approved order for Super admins
and Site admins. Site thumbnails use lazy scriptless saved-page previews rather
than invented drawings;no feed refresh or content write runs on entry. Existing
task shortcuts remain under More tasks,archive under its disclosure and worker
evidence stays Super-admin-only. Content-only Home retains its separate task
view. Reverse the AdminHome branch/optional card presentation without a migration.

### 2026-11-02 — Native editor gives publication decisions one bar
Move view/undo controls above the canvas and put All sites in More page actions.
Keep three desktop panels without redundant tabs. The unselected Inspector
lists real sections through the existing selection path;readiness and site-look
access remain in Page checks,opening on a failed report. Imported presentation,
role restrictions and save/review/publication commands stay intact. Reverse the
native conditional layout and optional outline props without a migration.

### 2026-11-02 — Lists starts with an authorized saved list
Use the existing first-list reader for entry,with a visible rail and factual
columns. Keep the index explicitly addressable,put creation in the header and
state unavailable requests before any item editor opens. Existing typed fields,
CSV,ordering,private saves and publication commands remain. Reverse the page
presentation/optional header portal without a data migration.

### 2026-11-02 — People keeps account changes beside their access evidence
Use the shared nonmodal detail panel with its named form region and fixed
Save/Cancel. Measure visible viewport space so the footer stays reachable below
headers;Media shares the same correction. Keep real account Status rather than
inventing last-active/provider facts. Existing scope assignments,Super-admin
commands,deactivation and invitation safeguards remain. Reverse the People
presentation/optional portal without a migration;the bounded panel remains reusable.

### 2026-11-02 — Native Redirects remains inside Settings
Keep the Settings heading and rail around the existing redirect workspace,with
its factual destination table before Add/import. Saved availability replaces
illustrated visitor totals. Clarify mixed Settings save behavior instead of
claiming all tabs wait for Publish. Imported presentation,redirect commands,
CSV review and authorization remain. Reverse the native presentation flag
without a migration.

### 2026-11-02 — Chapter Settings leads with choices and message previews
Use two radio choices for the existing chapter default and show both approved
reminder wordings through preview tabs. Put local recording/check tools under a
disclosure and unrelated Stories controls after chapter rules. Keep required
approval,chapter-owned division assignments and existing team commands;do not
invent approval turnaround figures or a permission switch. Reverse this
presentation without a schema or data migration.

### 2026-11-02 — Sign-in receipt and expiry have their own entry cards
Keep the provider and access commands unchanged. Show a generic receipt without
an email in the URL or a delivery guarantee;local mode names the recorded outbox.
Retry returns to email entry because the current flow does not retain the
address for resend. Preserve provider labels and the pending form guard;keep
Microsoft unavailable until IT supplies the prerequisites. Reverse the two
presentation branches and optional EntryPanel decoration without a migration.

### 2026-11-02 — Chapters reads saved setup beside its list
Use the bounded shared inspector for a chapter name;keep Set up and invitations
as explicit existing commands. Separate published directory destination from
saved setup so a private change is not described as live. Read assigned editors
through the existing scoped feed,with loading/retry and no invented people or
check dates. Move redundant columns into the inspector at 1024. Reverse the
native presentation flag without a data or schema migration.

### 2026-11-02 — Site look groups saved choices with one command bar
Keep presets and appearance/shared-area cards in the same scroller so a fixed
preset cannot clip font specimens. Put the existing save/revert/publish actions
together. Compact the four colour roles into rows while keeping every validated
field,full font/button choices and real-page preview. Dedicated shared screens
and imported Menu & footer keep their commands. Reverse the optional ThemeEditor
slots/native palette styles without a schema or data migration.

### 2026-11-02 — Prove local restore before hosted staging
Use a clean locked checkout, empty-database migrations and an independent dump/
media restore before planning a hosted promotion. Keep the dump outside Git and
temporary storage, compare all application tables and media, and run only the
public site on a restored review database. The rehearsal changes no retained
heads, roles or media. Document the existing loopback font flag rather than
changing delivery policy. ADR 0012 recommends incremental per-site static
releases with the shared renderer, while the dynamic path remains active until
parity/recovery gates pass. Reverse the architectural choice by retaining that
existing dynamic path; no exporter, provider or schema change was made here.

### 2026-11-02 — Lists review shares the readable queue/detail layout
Keep list review's saved-snapshot commands and permissions while bringing its
global Reviews view into the existing resizable workbench. Put decisions first,
compare actual changed values and positions, and retain complete snapshots under
All saved values. Absent items stay neutral; real additions/removals carry change
colours. Closed requests name their submitted values rather than promising an
approval. Reuse the browser-only comment draft/leave guard per account/request.
Inline Publish reviews keep their presentation. Reverse the optional fullScreen
branch without changing migrations, snapshots or publication history.

### 2026-11-02 — Inline review comments use the existing private leave flow
Pass the current account identity to Publish's page review and enable its and
the list review's existing comment-draft hook. Name both drafts when they coexist,
route tab/decision departures through the shared prompt, and keep private words
visible after a request closes. Saving a comment draft never posts it; posting
still requires Add comment. Keep commands, permissions, snapshot/layout policy
and native browser departure warnings. Reverse the inline hook opt-in without
a migration; saved browser drafts remain scoped to their account/request.
Allow the existing inline page-review decision bar to wrap so its approval
button cannot be clipped at1024; retain the same actions and sticky position.

### 2026-11-02 — List field edits use the shared leave choices
Register List settings as its own writing surface. Cancel, close, Escape and
CMS departures preserve, privately save or discard the field draft through the
existing validated command. Return its actual outcome from the existing action
wrapper so failed or stale saves cannot dismiss the prompt. Name the invalid
field in plain words instead of showing a raw parser error. Keep entry-save
requirements, version history, publication and rights unchanged. Reverse this
guard registration without a migration or retained-content rewrite.

### 2026-11-02 — New-list setup can be saved privately before leaving
Track changes to the existing preset/name/address/key setup. Reuse the normal
creation command for Save draft and leave, but refresh the list choices without
replacing the requested destination. Create list retains its direct-open flow;
an untouched or discarded setup creates nothing. Keep the same in-flight lock
and late-close result notice, and retain fields on invalid/uncertain results.
Reverse this guard and destination option without a migration; any explicitly
saved private list remains ordinary retained content.

### 2026-11-02 — Recover CSV dry-run source without implicitly importing rows
Save draft and leave stores raw CSV in this browser, keyed to the signed-in
account, site and list. Keep the existing validator and explicit Add to draft
action; recovering source never writes entries. Closing only the CSV step
checks its own source without discarding unrelated local item edits. Refuse
a failed browser save or saved-source removal instead of claiming success.
Clear the stored source before staging rows to prevent accidental reimport.
Reverse this recovery/guard without a migration or a retained-data rewrite.

### 2026-11-02 — Save unfinished uploads through the existing Media receipt
File objects are not browser-text drafts. Save and leave uses the normal signed
upload with a library-save explanation, description validation, one in-flight
request and its accepted receipt. Do not claim processing is readiness or insert
a late placement. Nested picker exits check only the upload, while whole-screen
navigation retains the parent writer guard. Keep a newer file open when a prior
receipt becomes ready. Reverse the guards/leave callback without a migration;
accepted files remain ordinary Media records.

### 2026-11-02 — Protect bulk Media input and its selected targets
Use the normal atomic organization command for Save and leave, with the same
rights/revision checks and immediate-library explanation as ordinary Apply.
Preserve failed work and distinguish confirmed writes from a failed refresh.
Resolve unsent metadata before switching to bulk; resolve bulk input before
opening image details or changing its target selection/filter. Retain a newer
upload form instead of opening a competing inspector. Reverse these guards
without a migration; existing metadata commands and publication stay unchanged.

### 2026-11-02 — Guard site setup without creating a site on leave
Reuse account-scoped wizard browser recovery for Save/Keep draft and leave;
keep Create site explicit. Only claim recovery after validation and a successful
storage write, and retain the last valid copy while current input is invalid.
Refuse failed save/clear operations while retaining visible fields. Guard local
CMS links and pending setup-file reads. Reverse the guards without a migration;
existing creation, rights and content import/export contracts remain separate.

### 2026-11-02 — Preview a selected template-update target first
The first listed site may need no update and may have a refused binding in its
preview. Defaulting to it blocked an independently selected valid target. Start
with the first chosen target,and clear old preview/error when the user chooses
another preview. Preserve binding refusals and all selected-site fingerprint
checks;the preview choice never selects an update. Reverse only this UI default
and recovery change without a migration or content rewrite.

### 2026-11-02 — Keep template-start setup private when leaving
Use account/context-site browser storage for setup leave saves instead of
implicitly copying a whole site. Validate with the existing start schema and
current source choices,retain the creation request for an uncertain retry,and
keep explicit Create private site separate. Failed saves/clear keep fields;
Discard restores opening choices. Reverse these guards/recovery without a
migration;normal source validation,rights and private creation stay unchanged.

### 2026-11-02 — Keep Publish-later intent separate from a schedule
Recover time and exception text privately in account/site/review-scoped browser
storage,using the shared leave choices. Restore no sample approvals,and retain
all normal pinned-review checks. Explicit scheduling alone queues work;storage
failures keep fields and an uncertain command retains its request. Reverse this
client recovery without a migration or changing the release engine.

### 2026-11-02 — Recover scheduling forms without repinning or queuing
Keep single-page and per-attempt retry setup in account/site-scoped browser
storage. Retain original saved-version selections and require explicit reload
when stale;restore reason text without its reviewed findings. Leave saves create
no job,and retry closure preserves independent single-page fields. Reverse this
client recovery without a migration;the scheduling engine stays authoritative.

### 2026-11-02 — Keep archive setup recoverable without importing on leave
Use an account-scoped IndexedDB record for the source and destination,avoiding
synchronous storage for archives up to64MB. Acknowledge transaction completion,
restore no file approval,and keep explicit site creation separate. Preserve an
unchanged uncertain request;failed save/clear retains fields. Reverse this client
recovery without a database migration or changing archive import permissions.

### 2026-11-02 — Use the ordinary section save before leaving
Wire visual/HTML draft leave choices to their existing checked library save,
requiring preview and note before accepting the departure. Keep each tool's
fields separate and discard back to opening values;do not update pages or
publish from leave. Reverse these client guards without changing the compiler,
immutable versions,permissions or page-update workflow.

### 2026-11-02 — Recover redirect intent without applying routing on leave
Use private account/site browser setup for individual redirects and CSV source.
Keep Edit's saved revision and restore no spreadsheet preview,so concurrent
changes still refuse. The explicit normal commands alone activate routing;
failed storage/writes retain work. Reverse these client guards/recovery without
changing redirect constraints,permissions or published page content.

- 2026-11-02 — People leave-save records private browser intent using the shared
  account-scoped setup hook. Access/invitation commands have immediate effects,
  so leaving cannot execute them. Preserve the original account revision on
  restore;do not silently rebase stale choices. Existing command authorization,
  deactivation confirmation and local invitation flow stay authoritative. Reverse
  by removing this form's browser recovery and returning to discard-only leave.

- 2026-11-02 — Give each chapter settings command its own private browser intent.
  Defaults/checks retain revision pins;normal accepted saves return their exact
  existing SQL revision and establish a clean baseline. The shared recovery hook
  can accept that baseline and guard later edits again. Staff removal and local
  message recording preserve unrelated unfinished fields. No leave action grants
  access or records mail. Reverse by removing these browser copies and restoring
  discard-only departure;the underlying commands and permissions are unchanged.

- 2026-11-02 — Documents uses the shared Media-library leave mode for category
  edits. Saving executes its existing revision-checked organization command;
  no separate browser recovery or page draft is invented. Guard selection,
  filters,refresh and upload starts;place refusal beside the category form.
  Confirmed metadata updates may leave even if only the later list refresh fails.
  Reverse by restoring explicit Save/Discard before changing selection.

- 2026-11-02 — Polish Admin Home against Main using shared page tokens,compact
  SiteCard summaries,Menu and Disclosure. Open/View and full saved counts remain
  available without a button bar on every card. Shared shell spacing and visible
  Home/chapter glyphs remove route-specific chrome drift;authorization still
  determines available destinations. Keep operator diagnostics closed under
  Super-admin Test tools. Reverse via the shared variants,without data changes.
  Original imports get a labelled tile because scriptless review deliberately
  omits their site files;no CSP or frozen-site changes are needed for Home.

- 2026-11-02 — Polish native Site overview against SiteOverview using the shared
  page rhythm,compact task grid,header buttons and card-action link styles.
  Keep the SPEC-required page tree below the cards;its single row menu retains
  Edit/View live and existing permission-checked management actions. The separate
  Pages view keeps its existing controls. Reverse through shared variants;no
  content,access or publication changes are required.

- 2026-11-02 — Polish the native editor against EditorClean/HeroSlides using
  shared button,menu,search,disclosure and compact-list variants. Keep structure
  filters and movement/visibility in menus;put layout choice in Style. Name the
  normal feature-slider role Hero slider while retaining deliberate custom names.
  Shared CanvasChrome installs native-only resting-field feedback in both canvas
  modes;no public renderer or original-site changes. Reserve zoom outside page
  content and a narrow context-tools row to avoid selection movement. Reverse
  through these shared variants without changing content or permissions.

### 2026-11-02 — Keep Stories tagging compact at both admin widths

Use the same tag-choice and checkbox styles for list rows and supporting panels.
At1440 tag labels form a fixed column;at1024 labels sit above their chips and
photo/action columns narrow. Every catalog tag,Reviewed,Hide from feeds and
Feature remains immediately available;Edit story is the sole row navigation
action. Source checks remain explicit administrator actions. Reverse through
the shared row/token styles without changing saved Story values or permissions.

### 2026-11-02 — Bound long values in the Story supporting panel

Use zero-minimum grid columns in the shared writing rail and field groups so
Advanced source addresses cannot widen the page. Shortened values keep the
full address on hover;HTML source remains editable for Super admins. Reuse
the list tag chips,Field counter and Disclosure controls without changing
story values,publication or permissions. Reverse through the shared writing
layout/styles;the long-value width check records the required containment.

### 2026-11-02 — Consolidate Tag manager row commands

The current release requirement limits rows to one action. Put Rename and Delete
in the shared Actions menu while preserving the reorder grip and its keyboard
path. Delete uses the shared selected choice-card row and destructive button.
Shared Field selects explicitly retain their chevron after the surface reset. Keep catalog names/IDs on one line with full values on hover;region areas
use shared checkboxes. All commands keep their original checked draft saves.
Reverse through the row presentation without changing tag identities or data.

### 2026-11-02 — Reuse compact controls throughout Header and menu

Use existing compact Card fields,pill choices and shared metadata chips for
menu types and header status. Stacked scope text spans the toolbar width;
button-card headings align with switches. Tracking help follows its field,
and names/destinations keep full-value hover. Existing page selection,nesting,
explicit saves,role access and exact private previews remain. Reverse through
the shared presentation components without changing frame/menu values.

### 2026-11-02 — Keep Footer controls compact and shared

Use the existing compact Card fields,Disclosure,TextLink,Badge and destination
choice pills on Footer. Rows show their full label on hover and one Actions
menu,retaining edit,reorder and removal. Preserve all approved footer content,
logo inheritance,preview and draft commands. Dedicated preset footers use the
same three-card organization with their existing grouped/contact/legal model,
without changing the original combined flow or converting stored data. The shared
Card body uses a zero-minimum grid track so long labels cannot displace actions.
These presentation changes preserve the public design. Revert these presentation
choices independently of the versioned footer data.

### 2026-11-02 — Use the shared compact controls for Site look

Replace oversized nested section headers with the same compact Card/Field and
Disclosure controls used elsewhere. Bound the preview selector so device choices
fit beside it;colour rows retain complete hex values with contrast and Reset on
the following line. All existing font,button,density,reset and draft/publication
commands remain. Label the already approved national red/white exception as
Approved pair rather than implying it passes AA or blocks publication. Keep its
explanation with Colours. This changes presentation,not the contrast policy or
published design,and can be reverted independently of the stored theme.
The captured pointer check also exposed a clipped resize hit area;keep shared
resize handles inside their own panels so the adjacent canvas cannot cover them.
An optional shared remaining-space bound keeps240px for Site look preview at1024,
while preserving the stored preference when a wider window is available.

### 2026-11-02 — Keep Lists records visible and commands separate

Use shared Card regions and compact record styles for Lists. Bound the saved
usage links in a disclosure,retain complete values on hover,and put keyboard
reordering in one row menu while preserving drag. A reusable RecordBoard gives
records and publishing commands separate layout space. The same saved update
facts remain in the item drawer at1024. All commands,fields,guards and access
rules remain;these presentation choices can be reversed without data conversion.
Captured drawer clipping is fixed with shared Field sizing and the compact
drawer margin;normal compact cards let their parent own inter-card spacing.

### 2026-11-02 — Use the shared Media controls and compact gallery

Keep actual photo thumbnails prominent. Show one-line names/full-value hover and
shared status chips;folder/dimensions remain in List view,and tags/credit/rights
remain in More details. Choose gallery columns from the available results width,
including beside the existing inspector. Shared tabs/disclosures/fields/buttons
also govern uploads and the Documents tab. Preserve all commands,permissions,
private byte access and leave decisions;reverse this presentation without data
conversion. Bound document details and align its content to the top rather than
stretching short forms across the viewport.

### 2026-11-02 — Keep Data values beside its bounded inspector

Extend shared ListDetail with separate header/body/footer regions and available
height measurement. Preserve remembered resizing while reserving list space at
both desktop widths. Shared factual columns collapse source/date only when
narrow;the full values stay in the inspector. Use one-line rows/chips,full-value
hover and the common source switch/link chips. Keep every field and publication
command;reverse the presentation without changing saved numbers or bindings.


### Private previews keep governed local styles — November 3, 2026

Read-only imported previews emitted immutable stylesheet links that their CSP
blocked. Private preview policies now name only the embedding Admin origin’s
`/site-files/` delivery path for local CSS, alongside the existing font hosts.
The delivery route retains session/RLS checks, immutable hashes, MIME inspection
and `nosniff`. Scripts, forms, connections, frames and top navigation retain
their restrictions; the only added source is the Admin’s governed file path.
Home explicitly requests an inert file-design tile before rendering authored
resources, so hidden thumbnail frames do not fetch original addresses from
Admin. Full original-path previews still need the isolated resource context;
the authenticated editor and public renderer keep that context unchanged.

Reverse by removing the owned stylesheet source from the private policy; linked
styles would then remain blocked in those previews.


### Shared hero colors and current feed fixtures — November 3, 2026

Restore the shared hero Red background and border to the approved national
control color, `#EF3E42`. Editor button previews and public slides read the same
palette. White remains an independent choice for the second button; a Donate
label does not change that choice. Reversal would change this one shared value.

The owned SAWSO feed fixture follows section 17's current grid contract: all
selected stories remain visible at phone widths, with one shared archive link.
It replaces the older phone cap in section 16.9. Native parity fixtures use the
current hero markers and explicitly enable their second sample button. Home
waits for its own site's lazy preview, and section authoring uses the current
New page and Add a section flows. Geometry, publication, version isolation and
role assertions remain in those journeys.


### Owned gate journeys follow current role controls — November 3, 2026

Update retired fixture navigation to the native library, New page dialog, compact
row menus and collapsed section tree. Keep Editor visual fields and Super-admin
HTML source separate; structural setup and cleanup use an admin session. Native
insertion previews are checked in the actual canvas under both site looks, with
page and published pointers unchanged. These are fixture corrections only;
shared helpers, product permissions and application behavior are unchanged.
Reversal would restore assertions against controls the current UI no longer has.


### Collection validation keeps the caller's Media access — November 3, 2026

The full database gate found four missing typed table declarations and a direct
validator that could confirm another site's private Media when given that site's
ID. Add the existing Story receipt/review and release scope/Settings tables to
the typed schema. Migration 0200 makes collection value validation use invoker
security, so direct Media queries retain the caller's RLS. Existing checked
commands and public list resolution keep their execution context, including
published rendering without a signed-in actor. No content or write permission
changes. The authenticated database role gains execution only on the immutable
URL predicate needed by this validator; that predicate examines supplied text
and reads no tables. Public and worker roles receive no execution grant.

The command audit records checked frame/fingerprint delegation and recognizes
the existing page-access predicate. Real-database checks cover own/foreign Media
and the bounded URL helper grant. Reversal must retain equivalent Media access
checks; use a new migration rather than changing an applied migration.


### Integration fixtures follow current native data contracts — November 3, 2026

Keep exact directory slugs, the current shared-library count, bracketed chapter
and role-based speaker samples, Reviews wording and the Split sector heading.
The focus fixture pins ready Media metadata through a page draft and checks both
placement history and unchanged library focus. Brought-in frame commands retain
their atomic save test; native pages explicitly refuse that legacy path.

Automatic Story counts use the existing UTC 13-month rule without changing any
source date. Hidden manual placements are omitted under section 17's explicit
visibility override; visible manual choices and saved records remain. Dedicated
article checks retain hidden 404, expiry access, restoration and foreign-host
refusal. These are owned fixture corrections; shared harnesses and product
permissions are unchanged. Reversal would reinstate obsolete expectations.

### Verify sandboxed Home thumbnails in console sweeps — November 3, 2026

The owned editor, focus and isolated-canvas browser fixtures recognize the exact
Chromium sandbox warning for both read-only preview URLs and their thumbnail
variant. Each reported URL must still return 200, forbid scripts through CSP,
retain its sandbox and contain no script element. All other console, page and
HTTP errors remain findings. Application policy and shared test helpers are
unchanged. Reverse this fixture correction if thumbnails stop using that
script-free preview contract.

The Home fixture requires the current thumbnail URL and targets its failure and
retry responses at that exact address. It scrolls its own lazy preview into view
before checking saved content, then returns to the top for Home captures. The
sandbox, private/public head comparisons and zero source-read assertion remain.

### Fresh repository setup evidence and seed scope — November 3, 2026

The handbook-only GitHub check started at `2ce6ebd`, used normal seeds on independent
ports and reused the local package/browser caches. Admin, SAWSO, Echelon and worker
health loaded; the disposable apps, database and data directory were removed.
The handbook records the earlier bundled Echelon starter and its two broken
sample-photo markers as remaining seed work. A reviewed bundled starter update
can replace that limitation; the retained national composition remains separate
reviewed data. No setup command or application policy changed during this check.

### Scoped chapter photo delivery — November 3, 2026

An assigned chapter editor could read the page but its photos returned 404.
Migration 0201 lets the authenticated media resolver follow an indexed photo
reference only when its version, page and site match and the caller can read
that page. Authorized history keeps working. Site-wide Media visibility, writes,
public delivery and lifecycle guards remain unchanged. Reverse with a new
forward migration restoring the previous resolver predicate.

### Native menu group hover — November 3, 2026

Closed dropdown groups were usable by click and keyboard but stayed hidden on
desktop hover. Shared header CSS now reveals the native disclosure content on
hover for the desktop menus, including the national header. The phone disclosure
and no-JavaScript click/keyboard flow remain native. Removing these shared hover
rules reverses the change; no page data or menu destination changes.

### Stable native card presentation — November 3, 2026

National feature tiles inferred their presentation from the current card count,
so adding a sixth card changed the existing five. A bounded three/four/five
layout hint now preserves the current presentation when the list changes.
Older sections retain their inferred look until edited; cancelling removes a
redundant hint. Shared styles render the same saved choice in preview and public
output. There is no new editor style control or database permission. Removing
the helper and shared style selection reverses this; the old renderer ignores
the saved hint.

The page inspector also uses the existing shared disclosure treatment without
its older second arrow. Picture addresses retain their existing disclosure and
fields. Repeat actions use the appropriate article, including Add an expense.

### Report control and heading parity — November 3, 2026

Report PDF styling used a sibling position that editor field wrappers changed.
The shared report renderer now identifies the secondary cover action explicitly,
including when the first action is absent. Country-story actions reuse the
existing report button class; source link and disclosure marks are restored.
The declared report heading sizes override the national hero's important rule.
Content, destinations, fonts and permissions are unchanged. Revert these report
markup/style changes to reverse them; no page data or definition migration is
needed.

### Site overview access link — November 3, 2026

The overflow People link uses the existing shared TextLink, matching the other
admin chrome links and preserving its guarded navigation and focus treatment.
No content, destination or access rule changes. Revert that component choice
to reverse the correction.

The owned overview fixture waits for its existing side-by-side layout condition
after viewport resizing, avoiding transient pre-style bounds. This changes no
shared test helper or browser configuration.

### Hero list photos and readable dates — November 3, 2026

The hero list reuses the existing story-photo parser to identify a local Media
photo saved as a source URL. Its normal thumbnail now appears for story-picked
slides, without changing the photo or Media permissions. Schedule fields reuse
the shared vertical form layout, keeping the full native date and time visible
at normal panel width. The list also labels disabled slide switches Off.
Revert those component choices to reverse the changes.

The owned hero fixture uses native Option-Tab for WebKit link navigation and
Tab for Chromium, then asserts the destination is focused before its outline.
The local WebKit walk confirmed ordinary Tab moves to an input and Option-Tab
moves to the next tile link. No browser flags or shared test tools change.

### Native story widgets inside reports — November 3, 2026

Report editorial typography already excluded embedded story widgets, but its
selector used an obsolete class. The exclusions now name the actual World View
and Split View roots. Their ordinary shared titles, links and buttons retain
the same styles they use elsewhere. Report text and controls keep their approved
styles. Revert the selector correction to reverse it; no page data changes.

### Complete section heading links — November 3, 2026

Native section heading links no longer shrink below their unwrapped text width.
The heading keeps its existing wrapping behavior, so a longer title cannot push
the link text outside the phone page. This uses the shared national heading row
and preserves the existing short-title layout. Revert the flex shrink setting to
reverse it; no section data or published content changes.

### New sites exclude archived source pages — November 3, 2026

Copying the retained Echelon content in the isolated walk exposed a guarded-save
failure: after import, the copy tried to repin an archived page. A new site now
keeps active pages and their saved history, pruning references to excluded pages
through the existing copy logic. An active page whose parent is excluded starts
at the root. Source pages, their archives and the full backup/restore format stay
intact. The ordinary copy size and permission checks remain. Revert the copy
filter to reverse this behavior; no migration or retained data change is needed.

### National header at tablet widths — November 3, 2026

The actual acceptance menu with the approved Adobe fonts pushed its action past
the 1024px page. From 992 through 1199px, the shared national header uses its
existing native Menu disclosure and retains the visible main action. The rules
reuse its existing phone menu styles, scoped above the stored component CSS;
wider desktop and phone rules stay in
place. No menu data, section versions or font configuration change. Revert this
shared responsive band to reverse it.

### Complete report source columns — November 3, 2026

The supplied report groups reading headings, copy and numbers in one column;
the initial native grid placed them on separate rows. Complete cover-selected
reports now compose the existing compiled field fragments into the supplied
response, reading and feature structure. The existing business, trafficking and
education bands select the wider program reading treatment. Field wrappers,
number references and safe links remain intact; standalone sections use their
existing layout. Empty manual stat grids are hidden, while bound readers remain.

The source portrait position applies to the image inside its native figure.
The closing quote uses its source frame and heading measure. No content,
media bytes, fields, section versions or data changes are needed. Revert this
rendering adapter and its styles to reverse it.

### Report source type and disclosure rhythm — November 3, 2026

Native report wrappers were overriding source sizes: the phone impact photo
became a full row, prose stayed at desktop size and directory counts stacked
under their titles. The shared report skin now gives those native fields the
source proportions and type rules, with source spacing between story blocks.
Ordinary sections and native story widgets keep their own styles. No saved
content or section definition changes. Revert these report-scoped rules to
reverse the correction.


### Saved versions without visible page changes — November 3, 2026

Overview status now uses Publish’s resolved content comparison. A saved number
link can preserve the same displayed words; that page shows Live, while Publish
plainly says No visible page changes and retains the normal review choice.
Metadata and code-approval changes still count as saved changes. No version or
publication command changed. Remove this read-only projection to reverse it.


### Compact readiness review — November 3, 2026

Publish now and Publish later share one readiness summary. Checked pages and
large selected-change lists use the shared disclosure; findings stay visible
with their existing Fix links. Every page preview and history restore link
remains available. Revert the shared summary to restore the expanded layout.


### Action notes and refreshed account revisions — November 3, 2026

Browser-only draft explanations now use one shared action note beside dialog
buttons, leaving the task fields first. The People recovery walk also exposed
an immediate-reopen race after a save: rows now wait for refreshed account
revisions before reopening. Server authorization and stale-save checks stay in
place. Revert the shared note and refresh barrier to reverse these changes.


### November 3 — fit the national header using its loaded fonts
The 992–1199 rule remains the minimum compact band. Above it, the existing native Menu is also used whenever the actual brand, labels, gaps and actions exceed the row. A viewport breakpoint cannot predict this: the header has a maximum width and editors can change seven labels, while approved fonts finish loading separately. One shared compact rule styles the same Menu; no second navigation UI is introduced. A fixed, immutable, self-hosted measurement file is permitted only by its exact hash on national-header pages, and remeasures after font loading, resizing or menu-label edits. It changes presentation only, makes no requests and reads no site content beyond rendered dimensions. Without JavaScript, the complete native Menu stays available; labels never wrap. Group-only labels inherit the same ink and border chevron as page dropdowns.


### November 3 — keep the native editor canvas readable at tablet width
Native and imported pages now use the same existing structure-panel fit rule: collapse the structure rail when the two side panels would leave less than 480 pixels for the canvas. At 1024 the native editor previously kept both panels open and reduced Fit to about 27%. The existing Structure toggle temporarily opens the same tree; choosing a section closes it. Panel resizing, every tree action, all fields and the SPEC zoom controls are retained. No new responsive mechanism or screen CSS was added.

### Balanced national cards and phone clearance — November 3, 2026

Six icon or photo cards use three columns at desktop widths, including saved five-column presentations; the current five-card national homepage remains five columns. Its approved two-column phone layout keeps an odd final card across the row so it is not stranded. The existing quick-links bar and body clearance share height, spacing and safe-area tokens. Native public disclosures share a border chevron and suppress the browser marker. Reverse these presentation rules without changing saved sections, menus or publication versions.

### Fit the complete compact Footer preview — November 3, 2026

The shared frame preview uses the footer’s measured height instead of a 260px crop. The isolated document sends only its bounded height to the exact parent origin; the parent checks the iframe window, origin and ticket channel. No parent reads the cross-origin site document. Long shared menu labels may occupy two lines so similarly named Footer links remain distinguishable at 1024. The shared required marker stays attached to the last label word. Reverse the sizing message or label clamp without changing site content or publishing behavior.


### Keep existing preset logo controls in Header & menu — November 3, 2026

Earlier preset headers now use the shared full and compact logo fields on the Logo tab, alongside their existing site name and show-name choice. Header buttons no longer repeat those identity controls. The same checked frame-size message used for Footer now measures Header, so its compact preview excludes the following page. Existing schema, site-name accessibility fallback, stored values and draft publication rules remain unchanged. An independent logo description is still absent from the older closed schema and remains an acceptance gap; it requires a deliberate schema, database validation and rendering change. Reverse the presentation grouping without converting templates or changing content.


### Keep Pages row actions inside their shared menu — November 3, 2026

The actual 1024 acceptance page clipped View live and More despite the fixture table fitting. Native Pages now reuses PageManagement’s existing navigation menu, as Site overview already does. The page title still opens editing; Edit, View live and all management commands remain available in one row action. This follows the maintainer’s one-row-action rule and reserves space for dates and menu/footer switches. Archived pages reuse Disclosure. Reverse the grouping without changing the page commands or draft data.


### Preserve report identity when sections move — November 3, 2026

An explicit annual-report cover selects the report presentation wherever it appears in the page. Previously the same cover lost the entire report skin when an editor inserted an ordinary section before it. Closed report metadata remains the authority; ordinary photo banners cannot activate it, and native section fields, band grouping, publication and permissions are unchanged. Reverse the predicate without changing saved section content.


### Use the shared record grid for Lists — November 3, 2026

Lists no longer overrides the shared RecordBoard columns or its tablet rail breakpoint. Header and body now use the same grid; the shared status token fits Changes not live. A saved field design awaiting application to items is described separately from edits made in this session, while the existing save and publication guards remain unchanged. Reverse these presentation changes without converting records or changing version commands.


### Preset logo descriptions preserve old header versions (November 3)

Keep the description optional when reading immutable preset headers, so their
existing site-name fallback still renders exactly. New Header & menu saves use
the stricter authoring schema and require it for either logo. The shared Field
and governed Media picker remain the controls; visible brand names suppress
duplicate image alt text. Migration 0201 changes validation only. Before stepping
back to a build that does not recognize the field, restore an older header
through the normal reviewed version flow; never rewrite stored versions.

Story visual follow-up (November 3): use the existing Eastern review-time formatter for the feed status, so summer and winter checks follow the same working-day clock. Newsroom order uses the shared wide-list/two-column layout, stacking at tablet, and shared order rows wrap full titles. Visitor preview cards use the shared minimum card-width token so the desktop side panel uses two readable columns and the tablet preview uses three. The renderer omits a Story card’s empty tag family rather than inventing a tag; populated families and the public tag toggles keep their own values. Stored definitions/content are unchanged.

- November 3, Round3 row21: national Story feeds own one white surface including archive links; phone jump actions stack equally. This closes the white-box gap without changing saved content. Reverse the national presentation rules to undo.

- November3,Round3 row30: Style opts into shared balanced choices (four options2+2,five3+2);the selected-section toolbar allocates remaining width to its title before truncation. No saved content changes;revert the shared control/toolbar rules to undo.

- November3,Round3 row42: Story presentation omits empty header tags and an opening summary already present at the first paragraph’s word boundary;the approved article stays unchanged. Tag catalogs opt into shared wrapping and secondary choices use the shared balanced group. Reverse those presentation rules to undo.

### Generic page-design layout compatibility — November 3, 2026

Generic core sections share balanced three-item grids, full-width text when their photo column is empty, and equal logo-card rows across native themes, including older panel snapshots. Imported original frames are excluded. Generic Echelon starters retain explicit sample images for useful private previews; reviewed composed Echelon sections still omit them, and publication still requires governed photos. Reverse the shared layout rules and starter-value policy to undo.

### Whole media thumbnails — November 3, 2026

The shared MediaThumbnail uses contain so logos and other wide assets remain whole in library tiles and picker previews. Delivery images and saved page crops keep their existing placement. Revert the shared thumbnail rule to undo.

### Portrait placement uses the saved focal control — November 3, 2026

The approved Echelon collage portrait is placed at16% across and50% down through the normal page editor, keeping the face visible in the narrow tablet crop. Reviewed local publication changes only that placement;restore the prior page version as a draft to reverse it. The focus-flow test supplies governed images for other starter fields while retaining its real hero-picker replacement and publication checks.

### Literal user text in derived markup — November 3, 2026

Report-link copies, Story tag headings and generated footer account links use replacement callbacks so dollar-sign sequences remain literal text. Existing escaping and sanitization still apply. Revert those callbacks to undo; focused regressions cover prefix/suffix/match/capture dollar tokens.


### Scheduled pages preserve newer live versions — November 3, 2026

A legacy page schedule cannot replace a newer manually published page version. Migration 0202 checks the pinned revision under the existing page lock, records the skipped schedule as failed with an explanation, and refuses retrying a version older than the live one. A later private draft still leaves a valid pinned schedule intact. Existing page-scoped publishing rights and reviewed-release guards are preserved. To reverse, use a forward migration restoring the prior functions; never rewrite migration or version history.


### Process interruptions respect retry limits — November 4, 2026

Migration 0203 counts abandoned leases toward the existing maximum attempts. A bounded claim-time sweep records exhausted work as failed, clears its lease capability and keeps the reason available for review; active leases and rows held by another transaction are preserved. Other eligible work continues normally, and existing queue-health monitoring reports the terminal failures. Reverse with a forward migration restoring the prior claim functions, leaving immutable publication and failure history intact.


### Feature markers are markup, not user text — November 4, 2026

Styles, fixed widget runtimes and CSP permissions use one structural inspection of rendered elements. Text, comments, script examples and inactive templates cannot activate them. The existing workspace HTML parser handles browser quoting and class lists; a bounded cache avoids repeated analysis of the same input. Saved content and output markup remain intact. Revert the detector and its rendering/CSP call sites together to reverse the change.


### A stopped media job has a stopped upload — November 4, 2026

Migration 0204 closes an awaiting upload when its own processing delivery becomes dead, including an abandoned final lease. It matches the owning site and intent, preserves ready images and other active deliveries, and writes the existing upload-failure audit. Existing stopped deliveries are reconciled once. Both media entry points close the accepted form on failure unless a newer upload is being edited, so retry starts cleanly without discarding unsaved work. Reverse with a forward migration removing the trigger and reverting the two polling branches; retain recorded failures and audit history.


### Native report wrappers keep the reference rhythm — November 4, 2026

Use shared report spacing tokens for band gutters, numbers, actions and phone stacking. Clear inherited row-item gutters in the mission section and preserve the closing frame's own inset. This removes wrapper-induced spacing without changing saved sections or text. The source comparison's mission, numbers and closing heights now match at 1440, 1024 and 390. Revert these presentation rules together to restore the previous spacing.


### Clearer default national button labels — November 4, 2026

Use a shared semibold label token and compact horizontal-padding token for national actions. Existing saved section padding cannot override the compact choice; explicit per-button appearance remains authoritative. The real SAWSO hero retains both phone actions on one row. Colors and saved content stay intact. Revert the national control tokens and their scoped padding rule together to restore the earlier typography.


### Empty native photo fields have no image box — November 4, 2026

Photo banners and text-and-image sections omit an unselected photo from their native photo slot, including the editor wrapper. Text-only report missions use the full column. Images inside story text, selected photos and imported markup remain intact. Revert the native-slot omission and matching mission grid rule together to restore the prior behavior.


### Social marks require a destination — November 4, 2026

Native chapter and national social navigation omit links with empty or fragment-only destinations, including encoded fragments. Empty social navigation is omitted. Real account links keep their destination, label and fixed brand mark; ordinary on-page jumps and imported sections remain intact. Saved chapter fields remain available for editing. Revert this filter to restore placeholder links.


### Narrow editing screens preserve work without phone editing — November 4, 2026

Use the shared writing-screen boundary below 768px: page editors keep Back, save/status and the larger-screen notice while their editing controls stay mounted and hidden. A hidden native dialog releases its modal lock, then resumes the same choice and focus when the window grows. The boundary includes page-review dialogs; their saved-version checks remain authoritative. Phone previews inside a larger editor stay editable. Reverse the boundary and scoped action-bar rules together to restore the earlier responsive behavior.


### Review entry points keep the current frame task selected — November 4, 2026

Header & menu opens Publish with only the saved menu and atomic header/footer frame selected. Footer selects the frame only. Other saved changes stay available for deliberate selection; permissions, initial-release requirements and exact reviewed-version checks remain authoritative. This avoids selecting unrelated page/list drafts during a frame task. Remove the two area hints and their selection cases together to restore the prior entry behavior.


### Media details fit their shared panel — November 4, 2026

Use the shared single-column constraint for image details so a long imported filename cannot enlarge the form beyond its panel. Stacked detail panels keep a viewport-sized scroll area when they start below the library. This preserves reachable fields and footer actions without changing saves or permissions. Remove the single-column constraint and stacked-panel height rule together to restore the prior layout.


### Responsive report rules measure the whole page — November 4, 2026

Native report sections inherit the complete report's named size container. Their inner report wrappers no longer establish a narrower container, which prematurely stacked leadership letters and narrowed country-photo columns at tablet width. Ordinary standalone sections and imported pages retain their own containers. Remove the scoped inner-container reset to restore the former breakpoints.


### Thumbnail retries verify the stored object — November 4, 2026

A matching thumbnail key skips rendering only when its stored bytes still exist and are nonempty. Missing or empty files are rendered again through the normal handler and recorded under their real content-addressed key. Storage read failures retry without replacing the database marker. This allows restoration of a database and incomplete object backup to repair derived library images, while repeat deliveries remain silent after recovery. Remove the object check to restore the database-marker-only guard.


### Report actions retain their button appearance — November 4, 2026

The report link reset excludes native buttons, and giving actions use the shared report button treatment with inline default sizing. Empty actions stay hidden, unselected contact photos omit their box, and text fills that empty photo column. Explicit button appearance and ordinary text links remain authoritative. Reverse the report button aliases and scoped presentation rules together to restore the earlier treatment.


### Reuse exact compiled CSS validation — November 4, 2026

Cache compiled stylesheet validation by exact CSS and section scope after checking the current policy. Retain at most 64 artifacts and one million characters, including refusal text; oversized inputs are checked without retention. Return independent results so callers cannot erase a refusal. No authorization or publication state is cached. Remove the bounded map and return the validator directly to reverse this optimization.


### Phone photo collages have a definite width — November 4, 2026

The shared Echelon collage fills its available phone column before its aspect ratio determines height. WebKit otherwise resolves the auto-width grid to its gaps, leaving loaded images with zero width. Existing photo focal points remain authoritative. The browser check requires visible image dimensions and decoded image bytes before capture. Remove the phone width declaration to restore the previous sizing.


### Report text, facts and giving rhythm — November 4, 2026

Photo-free report stories use the shared brief layout; fact sections retain their compact grid. Shared report tokens align headings, paragraph rhythm, country labels, quoted paragraphs, giving lists and legal text with the supplied reference. Field wrappers, selected photo layouts and explicit button choices remain intact. Remove the scoped presentation block and text-layout branch together to restore the previous treatment.


### Offline chapter demos leave photos unselected — November 4, 2026

The normal demo seed prepares only revision-one, unpublished pages of an initial chapter-enabled site. Generic sample pictures become unselected optional fields through the normal draft command. Authored or released pages stay untouched, repeat setup is silent, and the database still refuses generic sample photos at publication. This keeps a fresh checkout independent of private photo files and other sites’ media. Remove the demo preparation call to restore the former first-release refusal.


### Unselected chapter pictures omit broken image elements — November 4, 2026

The existing Echelon picture policy also omits blank board and gallery image elements. Selected local Media and captions remain intact; ordinary sites retain their existing output. Remove these two section aliases from the policy to reverse the change.


### Add product access independently of invitation mail — November 5, 2026

When invitation delivery is off, Super admins use Add person. A narrow database
command reuses existing membership validation and grants, records `user.add`,
and creates no invitation event or authentication credential. The existing fresh
sign-in requirement protects the action. Email verification and normal provider
sign-in remain required. This avoids queuing work no service can deliver. Reverse
by removing the action/UI and leaving the additive command unused; do not remove
audit history or memberships already granted.

### Organization owns Friday's Supabase authentication — November 5, 2026

The maintainer selected an organization-owned Supabase project to preserve the current
verified-email flow without an immediate provider migration. IT administrator custody of
billing, project administrators, callback origins and approved SMTP is a release
prerequisite. Supabase's built-in sender is team-only and currently two emails/hour;
no-mail membership does not solve delivery. Reversal is an explicit provider/project
migration with verified identity mapping and a tested callback rollback, never
personal-account credentials copied into the organization deployment.


### Friday stays on personal Supabase, Super admin only — November 5, 2026

The test-phase release preserves the personal Supabase provider and existing
Super admin subject, with Super-admin-only sign-in and no SMTP or real-editor
rollout. Long-term provider ownership requires platform-lead and IT review; see
[sign-in options](handbook/hosting/sign-in-options.md). The existing Add person
feature remains available, but does not establish email delivery. Revisit provider
ownership and delivery before inviting real editors.


### Friday database budget: micro first — November 5, 2026

The maintainer confirmed the manager-approved test budget at about $10/month. Default
bootstrap to `db-f1-micro`, matching review. The review environment’s 1.3s save, 1.8s publication
and ~7s previews are acceptable for the demo; migration 0205 fixed the 41-second
case. Dedicated `db-custom-1-3840` (~$51/month) remains an explicitly approved
future upgrade if real editing is slow, with backup, restart/downtime and
post-resize checks in hosting/speed-and-size.md. No instance is resized for this release.


## Correct the retained chapter reference, keep assertions — November 5, 2026

Approved November 4 behavior omits social links with empty or fragment-only
destinations. The Peoria text reference still listed Facebook, Instagram and
LinkedIn although all three destinations were empty. Correct only those three
labels in the supplied reference and version the current text in
`e2e/reference/echelon-chapter-text.txt`; the existing retained spec reads that
file and keeps all assertions/timeouts. This is a reference correction, not a
loosened assertion or a retained/public content change. Reverse the reference
correction only if the approved social behavior changes again.

The refactor merge gate is: no new failures against the
same-code baseline, rather than requiring pre-existing failures to disappear.
Record test identities and evidence for every baseline failure. A failure absent
from that baseline still blocks merging. Full engines, byte parity and the editor
walk remain required.


### Saved visitor previews use the existing isolated renderer — November 5, 2026

The hosted demo exposed compact scriptless visitor navigation versus full public
navigation at the same desktop width. The first fix (2fd7c072) also activated the
isolated editing canvas for national sites. Full engines exposed regressions in
World/Split, report and theme editing, so that broad activation is reverted.
Only saved visitor pop-outs now select the existing isolated renderer. Editing,
Design and History retain their original routes. Existing ticket issuance,
tenant/host checks, origin validation and governed script policy are unchanged.
Visitor tickets renew independently of whether the parent uses an isolated canvas.

The strengthened regression asserts the original editing route, visitor/public
headers at1440/1024/390 and real renewal after four minutes. Solo focused runs:
Chromium25/26 (Reviews unsent-comment recovery failed), WebKit25/27 (the two
recorded baseline failures: contact-card selection and DB-locked loading capture).
All previously observed World/Split/report/theme/font regressions pass unchanged.
No assertions, timeouts or skips weakened. Public renderer/schema are unchanged.
Reversal removes visitorPreviewOrigin and its pop-out selection/renewal changes;
it must not reactivate national editing isolation without separate verification.


### Read shared readiness facts once per locked phase — November5,2026

Scheduling profiled48page baselines and48future checks. Re-reading the same shell,
published-route anchors and draft anchors for every candidate made587queries.
Batch those three site-scoped reads within each existing locked, unchanged phase.
Keep ownership/manifest/document/media checks and rendering independent per version;
clone shared values before use. Single-version callers remain uncached. Facts
exist only inside one batch invocation, partitioned by site, with fresh maps for
baseline and future projection. No request/global cache, SQL migration, grants,
readiness exception or omitted page check is introduced.

Real-Postgres tests compare full reports, count deduplicated queries, change the
projection within the same transaction to prove fresh second-phase facts, and
prove identity/document and cross-site path isolation. A repeatable read-only
personal snapshot compares all before/after results byte for byte. Reverse by
restoring per-page evaluation in releases.ts; no data/schema rollback is needed.


## Read current SQL without rewriting migration history — November 5, 2026

Generate `packages/schema/current/` from a migrated disposable local database:
exact current function bodies and owner/ACL metadata, plus tables, policies,
grants and the migration ledger. A fresh-database test and check command reject
stale files. This is a reading reference, never executable migration input;
numbered migrations remain immutable and authoritative. Function source
whitespace is preserved deliberately, including existing trailing whitespace.
Reverse by removing the generator/reference/check and restoring the handbook
links; no deployed database change is involved.

Before runtime refactoring, capture every kept public page, owned asset and
private preview plus the complete schema/function definitions. Private local
canvas fixture tickets hold a fixed ten-minute created/expiry window with the
real constraint intact; deployed ticket lifetimes and grants do not change.
Keep private artifacts outside Git and delete capabilities after verification.
Any changed output byte or new failing gate leaves the refactor on its own branch.
Existing failures require the same-code baseline evidence described above.


## Password sign-in beside email links — November 11, 2026

Hosted sign-in accepts an email and password through the existing Supabase
Email provider, and a signed-in person can set their own password under
Password in the sidebar. Email links remain. Cause: the organization's mail
security opened a sign-in link eight seconds after it was sent and used it up
before its owner clicked (Supabase Auth log, November 11), and the built-in
sender allows two messages an hour. No migration, setting or key is added; the
admin still holds only the publishable key, and a password is set with the
person's own session. The confirmation page now says when a link was already
used. Reverse by removing the two provider methods, their actions, the
`/account/password` page and the second sign-in button; no data changes.

## Sign-in recovery and operator labels — November 11, 2026

Supabase may return failed email-link details in a URL fragment, which server
search parameters cannot read. An invalid confirmation therefore always offers
password sign-in or a new link, including when no query error is visible. This
changes the explanation only; invalid links still cannot issue a session.

The Super admin Home diagnostics are called System status because their worker
and queue evidence also describes hosted installations. Actual local chapter
test tools keep their existing labels and access restrictions. The editor sign-in
guide now covers password setup, same-browser email links and the gated Microsoft
provider rather than describing email-only login as the only available option.


## 2026-11-11 — Monday CMS follow-up guidance (DOC-1 / WS-8)

Add authenticated, searchable Help with work-area filters and contextual links from
saved-number publishing errors, story tags and domains. Explain unassigned tags
and tags without suggestion keywords without changing editorial assignments. A
reserved domain with no provider records says Preparing DNS instructions, rather
than implying that the DNS administrator already has actionable records.

Sign-in and both password-setting fields have explicit Show/Hide controls; the
password is hidden initially and revealing it never submits the form.

These changes do not grant permissions, publish content, retry failed hosting
work, configure Analytics, enable Azure or change DNS. Those operational steps
still require the owning administrator, approved identifiers and normal review.


## 2026-11-11 — Release workflow runner context

GitHub rejected the reusable release workflow before any job ran because
`runner.temp` was used in job-level `env`. Move `RELEASE_DIR` into the two
run steps that consume it, where the runner context is available. Keep
release target checks, environment approvals and deployment flags intact.
Cloud Build remains the current production deployment path. Validate the
workflow expressions with actionlint; a successful Google deployment alone
does not prove GitHub Actions parsed its separate configuration.


## 2026-11-11 — Pin database-reference CI tools

The restored CI run reached the database suite: 958 tests passed and the
generated catalog comparison failed. Its `ubuntu-latest` runner selected
Ubuntu 26.04, which supplies PostgreSQL 18 tools for a PostgreSQL 16 fixture.
The reference check passes on a new disposable PostgreSQL 16 cluster with
version 16 tools. Pin the checks job to Ubuntu 24.04 and assert the dump and
restore major before migrating. Preserve the exact catalog comparison and
all policy tests; no generated SQL or immutable migration is changed.


## 2026-11-11 — Role-first task help

Expand authenticated Help into role-first onboarding with searchable task guides
for adding people, changing site access, creating websites and the draft/review/
publication flow. Reuse the actual People labels and site-creation steps. Explain
CMS membership, provider sign-in and infrastructure access separately. Global
People and site creation remain Super-admin-only; selecting Help guidance grants
no permissions. Document browser-only saved account/setup choices, recent sign-in,
scoped chapter/division access and independent email/Hosting prerequisites.

Keep existing contextual topic IDs and shareable guide links. Search includes
steps and common user terms, with an explicit route to other roles' matching
help. Match the handbook to current workflows; retain the historical RoleViews
proposal as a proposal. No account/site action, migration, role change, invitation,
content publication or domain operation is performed by this documentation work.
