# CMS V2 — product, UX and delivery specification

**Revision 8 · Product direction: the NHQ digital team**

Approved additions are incorporated in §16.

**Read [Current release state](#current-release-state) first.** It records what is done, open delivery requirements and the test-phase deployment requirements, and it overrides older out-of-scope lines.

**Round 3 is the active delivery scope (§17).** It supersedes older
presets, in-canvas site-wide editing, SAWSO-only Stories, priority order and
browser-run instructions wherever they conflict. The approved row 10 and
Echelon reference templates govern this finishing step. SAWSO and Echelon lead;
brought-in sites, Better Together 2027 and Human Needs Index are frozen.


Revision 8 replaces revision 7 (October 11). Revision 7 was a long engineering
contract: it kept the platform safe, but it said little about what editing should
feel like. The revision addresses editing flow, layout and usability. This revision
puts the editing experience first. It reflects the approved editing requirements and review of the current build. Revision 7's engineering contracts still apply (§15 lists
the ones you must not break). Revision 7 remains archived at
[docs/archive/SPEC-r7-2026-10-11.md](docs/archive/SPEC-r7-2026-10-11.md),
because code and tests cite its section numbers ("SPEC §8.6" means revision 7).

**How to use this document**

- **Authority:** the approved release scope → this SPEC → [docs/decisions.md](docs/decisions.md) → architecture/threat model → code. Passing tests do not redefine the target.
- **Read order for contributors:** §0, §3, then the section for the area you are changing, then §13 (work packages) and §15 (guardrails).
- **UI work is built from this SPEC and judged on screenshots.** Build screens to the written spec here. Do not wait for mockups. Show the maintainer screenshots (1440 and 1024 px, plus phone preview where relevant) before closing a UI item. If the maintainer later supplies a mockup in `docs/design/approved/`, match it. [docs/design/screen-briefs.md](docs/design/screen-briefs.md) is an optional tool the maintainer can use to make one.
- **Work package IDs** (`SH-`, `ED-`, `LB-`, `WS-`, `DY-`, `RO-`, `MG-`, `HO-`, `DOC-`) are stable; use them in commit messages and in the roadmap.

**Contents:** [0 Why revision 8](#0-why-revision-8) · [1 Purpose and people](#1-purpose-and-people) · [2 Site portfolio](#2-the-site-portfolio) · [3 Principles](#3-product-principles) · [4 Shell and navigation](#4-app-shell-navigation-and-status) · [5 Page editor](#5-the-page-editor) · [6 Section library](#6-the-section-library) · [7 Site workspaces](#7-site-workspaces) · [8 Low-maintenance content](#8-low-maintenance-content) · [9 People and access](#9-people-roles-and-access) · [10 Design system](#10-design-system) · [11 Bringing existing sites in](#11-bringing-existing-sites-in) · [12 Platform and hosting](#12-platform-and-hosting) · [13 Delivery plan](#13-delivery-plan) · [14 Acceptance](#14-acceptance-the-first-time-editor-test) · [15 Guardrails](#15-guardrails-do-not-break) · [16 Approved additions](#16-approved-ui-additions-october-27) · [Appendices](#appendix-a--editing-requirements--implementation)

---

## Current release state

The release is `v2026.11.06`. Its runtime-identical review build was `e51b4b5`.
The hosted personal review copy is a separate deployment; the frozen tag does not
prove that copy runs the same revision. Organization deployment, public-invocation
policy, notification delivery and the ordinary-browser acceptance route remain
administrator gates. See [known issues](docs/handbook/start-here/known-issues.md).

The release includes isolated browser ports, the render/schema oracle, current
SQL reference and maintainer map. Verify tablet navigation and CSS precedence
when changing the editor or shared styles.
Baseline complete engines recorded Chromium 629/631 and WebKit 626/631, with no
skipped or flaky cases; the failures remain listed rather than waived.
The golden oracle covers 356 artifacts: 75 public pages, 121 assets, 150 direct
previews, eight isolated canvas documents and two schema/function artifacts.

The test phase covers SAWSO and Echelon on native pre-production addresses, with
Super admin sign-in through the existing personal Supabase provider. SMTP,
real-editor rollout, provider migration and custom-domain cutover are separate
work. Better Together 2027 and Human Needs Index remain frozen. The Google
project administrator performs organization commands using the ordered
[deployment runbook](docs/handbook/hosting/friday-go-live.md).

### Implemented capabilities

| Area | State |
|---|---|
| Page editor, section library, templates, undo/redo, leave prompt, History restore | Built. Walked as Super admin and SAWSO Editor on the hosted review copy. |
| Stories for any site: list, tag chips, Manage tags (main and secondary levels), Overview, World View, Split View, Newsroom, stories on sector pages by tag | Built. Matches `stories-tool/MUST-HAVE.md` except the "Check for new stories" proof with real new or removed stories (row 42). |
| Header, menu and Footer as site-level workspaces; logo; Site look and fonts (Adobe kit) | Built and published on the hosted copy. |
| Chapters: divisions, per-chapter setup, scoped division/chapter roles | Built. Site admin scenario walked; division and chapter-contributor scenarios not yet walked on the hosted copy. |
| Roles: Super admin, Site admin, Editor, Contributor, page/division/chapter scope | Built. Editor and Contributor restrictions checked by screen and direct address. |
| Publishing: review, schedule, releases, readiness checks | Built and walked. |
| Hosted review copy (personal project) | Running: 75 public pages and 121 assets match the retained source. |
| Automated suites | Frozen baseline: Chromium 629/631 and WebKit 626/631, no skipped/flaky cases. See known issues for exact failures and keep release-specific receipts private. |

### Built, but not yet proven where it matters

1. **Editor canvas and previews can stall** (Header, Footer, Site look, Fonts, hero-slide add, phone preview). On the personal review copy, an inline Footer frame has stayed blank while the standalone or retried preview opened. Verify that the real preview renders; a successful HTTP response is insufficient.
2. **Check the saved preview and public header at 1440.** The standalone SAWSO Home preview and public page matched in the personal Chrome check. Repeat on the exact deployment; a scriptless comparison may not exercise responsive navigation.
3. **Hosted speed.** Saves and publishes on the shared-core database sometimes sit at "pending" or "preparing". One image check took 41 seconds before migration 0205. Review measurements and sizing are in hosting/speed-and-size.md; repeat the slowest steps on the organization deployment.
4. **Remaining role scenarios:** Echelon national page and media (11), division team member (12), chapter contributor (13), Symposium Editor (14), urgent fix (8), contributor review (9), all-roles screens (15).

### Open delivery requirements

These were not specified, or were explicitly out of scope, but the next milestone needs them. Each one needs a decision or a plan before deployment.

| # | Gap | Why it matters | What to do |
|---|---|---|---|
| G1 | **Empty-project deployment** | First organization install remains a Google project administrator execution gate. | Eight-phase bootstrap, explicit scope guards, local-input validation, offline dry run and 10 safety units complete; no second paid SQL instance or organization command. See hosting/bootstrap.md and friday-go-live.md. |
| G2 | **Editor onboarding deferred** | The test phase is Super-admin-only under the approved release scope. | Already completed/tested no-mail Add person stays; no SMTP or further onboarding work. Built-in personal Supabase sender is team-only/two-per-hour; real-editor rollout remains blocked until a future approved delivery path. |
| G3 | **Long-term sign-in ownership deferred to the platform lead** | Personal Supabase remains the test-phase Super-admin-only provider. | hosting/sign-in-options.md compares organization Supabase, Identity Platform/Firebase and Entra, including existing Super admin subject mapping, effort, IT prerequisites and switch/rollback. |
| G4 | **Custom domains partly proven** | Ownership passed; certificate activation and routing remain unproven. | hosting/domains.md records a controlled personal-domain test, exact UI/record steps and DNS rollback. No DNS/certificate/cutover is claimed or performed for this release. |
| G5 | **Organization public-access policy** | Effective folder constraints can block the public Admin/Site required by Hosting. | hosting/public-access-it.md explains public surfaces/publishable keys and IT-approved allUsers or disabled invoker IAM check. Worker stays private; if policy blocks both, stop for IT. |
| G6 | **Backup/restore** | Recover content without overwriting later edits. | Same-instance restore rehearsed with 81 tables/schema/functions/roles exact. Bootstrap installs twice-daily encrypted backups, absence/failure alerts and first-backup verification; organization scheduling/delivery remain administrator execution gates. |
| G7 | **Public sites depend on the CMS being up.** Static publishing (ADR 0012) is deferred. | A database or service outage takes SAWSO and Echelon offline. | Accept this for the test phase and say so plainly. Monitoring alerts must reach the maintainer. |
| G8 | **Maintainable handoff.** | Keep editing, rendering, and site-specific policy easy to find. | Follow the [maintainer map](docs/handbook/maintainers/where-things-live.md). Before a new release, verify public output, both browser suites and the admin tablet drawer. Review any intentional visual changes. |
| G9 | **Open role and maintenance questions:** whether Editors may "hide until ready" (§1.2 vs the Site admin rule); who edits Echelon chapter pages (chapters on the CMS, or national staff only); who maintains SAWSO content after handover. | They decide which role walks matter. | Confirm these role and maintenance decisions with the platform lead. |
| G10 | **Current roadmap pointer.** | Readers need a stable release status. | The roadmap links here and separates implemented scope from deferred work. |

### Release acceptance order

1. Resolve or document the known baseline failures and complete the ordinary-browser route.
2. Verify deployment, sign-in, public access, monitoring, backups and recovery in the target environment.
3. Keep structural refactors isolated until their complete behavior and visual gates pass.
4. Deploy only a verified release ref; check its image/health version and repeat the demo route.

## 0. Why revision 8

**Editing problems addressed by this revision** (reference screenshots in `docs/design/current-v2-2026-10-25/`):

1. **New sites get a bare library.** Creating a site copies two seed sections ("hero" = a heading and a paragraph; "prose") plus generated listings, named "· site starter". V1's catalogue of 118 designed sections exists only as per-site copies inside Human Needs Index and Echelon. Every new site, including the fictional event used in demos, looks unstyled and breaks down on phones.
2. **The editor has no visual hierarchy.** Every control in the inspector is the same outlined button: Up/Down, Above/Below, Change layout, Duplicate, Undo my changes. The labels use internal terms ("Definition default", "42rem", "tokens", "visual builder"). Controls are shown even where they cannot work: "Column order on phones" on a section with no columns, or "Use layout" for layouts that will then refuse the content. The panels have a fixed width.
3. **Workspaces show the data model, not the task.** Content leads with "Schema live · revision 3 · 8 fields · Design fields · Publish schema · CSV tools". Media leads with processing statistics. Navigation previews a mock list instead of the real header.
4. **Wayfinding and status are weak.** There is no back button. The "Collapse the menu" row takes the full width of the rail. A page with unpublished changes still shows a green "Published" badge. Spacing differs from card to card because all styling lives in one 3,937-line `globals.css` with no shared components.
5. **Real-site hosting is part of the scope.** The platform must support the existing InMotion/cPanel sites, Echelon chapters and SAWSO, alongside local examples.

**What changes:**

1. **One shared, beautiful core library** (§6), themed per site, with designed sample content and mobile-first layouts. Inserting a section never produces an empty block.
2. **An editor organised by intent** (§5): resizable panels, insertion points on the canvas, a floating section toolbar, and inspector tabs (Content · Style · Visibility · Advanced) that show only the controls that work.
3. **Task-first workspaces** (§7). Lists, Media, Site look and Publish speak the editor's language and preview the real site.
4. **Real sites as the reference** (§2, §11): Better Together 2027 from its local source copy, Echelon chapter pages, and a SAWSO ministry page using the national "Zesty" look replace the fictional event as the showcase.
5. **A clear platform path** (§12): the organisation-owned Firebase/Google Cloud project, static publishing for public sites, and a cost brief the platform lead can take to the department.

## 1. Purpose and people

### 1.1 Purpose

CMS V2 is the platform the NHQ digital team uses to **host and maintain its family of small websites**: event sites, ministry and program sites, resource sites, chapter pages. On it, the people who own the content keep it current themselves, and the platform lead is no longer the go-between for every edit. A non-technical person sees the real page, clicks what they want to change, adds well-designed sections from a library, and publishes when ready.

Two recurring requirements guide the platform:

- **A reusable event site template.** Event sites recur every year and need editable speakers, schedules and registration.
- **Sites that stay fresh when nobody tends them** . Evergreen text plus dynamic content (stories by tag, stats from one data source, automatic expiry), so a neglected site does not go stale.

### 1.2 People

| Person (example) | Role in the CMS | What they need | What they must never face |
| --- | --- | --- | --- |
| Platform lead | Super Admin | All sites, people, domains, hosting; confidence it will not break or cost a surprise | Being asked to fix routine edits |
| Developer / maintainer | Super Admin | Build sections and templates, import sites, run releases | Undocumented setup only one person understands |
| Event coordinator | Editor on one site | Add and edit speakers and sessions, hide a section until ready, publish | Schemas, record keys, CSS |
| Program or communications editor | Editor or Reviewer | Change text and pictures, review submissions, keep pages current | Hunting for where a field lives |
| Chapter volunteer (Echelon) | Contributor, scoped to **one page** | Update their chapter's paragraph, photo and optional board, then submit | Seeing other chapters or site-wide settings |
| IT administrator | None (infrastructure) | Hosting, SSO, backups, written runbooks | Reverse-engineering the setup |

### 1.3 Top tasks (design for these first)

| # | Task | How often | Target for a first-time editor |
| --- | --- | --- | --- |
| T1 | Change text or a photo on a page | Weekly | Under 30 s; no help |
| T2 | Add, edit or reorder a speaker, session, sponsor or member card | Weekly in event season | Under 60 s per item |
| T3 | Add a section from the library at a chosen spot | Monthly | Under 45 s; it looks finished immediately |
| T4 | Hide a section until it is ready, then show it | Monthly | Under 20 s |
| T5 | Publish and confirm what went live | Weekly | One screen; statuses agree everywhere |
| T6 | Create a new event or chapter page from a template | Per event | Under 10 min to a credible draft |
| T7 | Change a site's colours or logo and see it on real pages | Rarely | Under 5 min |
| T8 | Find the way back to the previous screen | Constantly | One click from anywhere |

## 2. The site portfolio

The CMS exists to run real sites. The table is the plan of record for what moves in. Source audits are private `AUDIT.md` files supplied with approved local site copies. Keep credentials and private audit material outside the repository.

| Site | Today | Moves into the CMS | Stays an application | Priority |
| --- | --- | --- | --- | --- |
| **Better Together 2027** (bettertogether2027.org) | InMotion; PHP includes + Google Sheets CSV; sponsor registration and booth system (PHP/MySQL); live registration | All marketing pages (home, workshops, sponsorship, exhibitors, hotel, Kansas City, manifesto, FAQs) | Sponsor registration, booth selection, sponsor dashboard, forms — keep their hosting, or re-platform later; same domain via path routing | **P0 showcase** (local copy); live cutover only with the platform lead's planned outage window |
| **Human Needs Index** | V1 rebuild already migrated into V2 | Whole site | Tableau data views stay embedded | P1 |
| **Echelon** national page + chapter pages | Symphony (IHQ, being retired) + 15 underused chapter sites | One national page set and a **one-page chapter template**; each chapter edited by its own volunteers | Chapter charter application dashboard (PHP/MySQL/Wufoo) | P1 |
| **SAWSO** (sawso.org) | Symphony (static; being retired) | Standalone site in the national ("Zesty UX") look: evergreen pages + stories feed by tag + stats from data | SAWSO Stories tagging utility is the feed source | **P0**, standalone site; target live before January 1, 2027 |
| **AO Hub** (aohub.org) | InMotion; PHP includes only; Google Sheets data | All pages; Sheets data → synced lists (§8.4) | — | P1 |
| **Event template** (next symposium, any event) | — | Template and core library (§6.6) | — | **P0** |
| **learn.salvationarmyusa.org** | InMotion; large PHP/MySQL/Wufoo portal (EDS tools, certificates) | Public landing and role-chooser pages, if wanted | EDS tools, certificates and training back end | P2 (SharePoint migration considered separately) |
| **Snippets** (snippets.usnsandbox.net) | Component playground + ZIP API | Its HTML patterns seed the national section set (§10.5) | ZIP/division APIs | Reference only |
| Migration Tracker, Echelon dashboard | PHP/MySQL CRUD tools | — | Yes (internal tools) | Out of CMS scope |
| CoinCatch, KettleCatch | Static games | Hosted as static bundles (no editing) | — | P2 |
| belonging2025.org | Central Territory site hosted by NHQ | Decide with the platform lead | — | Later |

**Classification rule for any new site:** (A) *content site* → pages and sections; (B) *content + small app* → CMS pages plus an application route that shares the site frame; (C) *application* → stays separate, and the CMS may supply its header/footer HTML; (D) *static bundle* → hosted as uploaded files without editing.

**Operational safety boundary:** use approved local source copies for migration. Organization commands belong to the Google project administrator; live Zesty/cPanel edits, production DNS changes and site cutovers require explicit platform-lead authorization and a rollback plan.

## 3. Product principles

1. **The page is the product.** Edit on the real page. A separate screen exists only for bulk or site-wide work, and even then it previews the real site, never a mock.
2. **Task words, not model words.** No "schema", "revision", "definition", "token", "slug", "record key", "rem" or "renderer" on an editor's screen. Technical controls live under *Advanced*, shown by role.
3. **Beautiful by default.** Every library section has designed sample content and looks finished at phone, tablet and desktop the moment it is inserted.
4. **One library, many brands.** Sections are shared and follow each site's theme. Site-specific sections exist only where a migrated design needs them.
5. **Show only what works here.** A control appears only if it has an effect on the selected thing. An option that would fail is not offered.
6. **Hierarchy you can see.** One primary action per area. Secondary actions are quieter, destructive ones are red and confirmed, and rare ones live in a menu. Icons carry labels or tooltips.
7. **Always know where you are and how to get back.** Every screen has a back control and a breadcrumb; the editor names the site and page.
8. **Honest status.** "Live", "Live · changes not published", "Draft", "Scheduled", "In review", "Hidden" mean the same thing everywhere, and saving is shown separately from publishing.
9. **Room when you need it.** Side panels resize and remember their width. Library and inspector can grow; closing them restores the page.
10. **Low maintenance beats high polish.** Prefer dynamic lists, feeds and expiry dates over static copy that someone must remember to update.

## 4. App shell, navigation and status

### 4.1 Shell (work package SH-2)

- **Left rail:** 248 px expanded, 64 px collapsed (icons with tooltips). The collapse control is a **28 px icon button in the rail's top-right corner** (chevron, tooltip "Collapse sidebar · ⌘\"), not a full-width row. The state is remembered per person.
- **Rail content:** product mark → **Home** → **All sites** → (when inside a site) a **site switcher** showing the site name in full (dropdown to jump to another site) and that site's areas: Overview · Pages · Lists · Media · Site look · Publish · Settings · Sections (Site Admin+) → bottom: Inbox (count), People (Super Admin), Activity, account menu.
- **Page header pattern on every screen:** a row with **← Back** (to the logical parent, e.g. "← Better Together 2027") and a clickable breadcrumb (`All sites / Better Together 2027 / Pages`) → title (24/32) with status pill → primary action on the right. The editor uses a compact version of the same pattern (§5.2).
- **"Go back to where I was":** Back returns to the screen the person came from when it is inside the CMS (history-aware). Otherwise it goes to the logical parent.

### 4.2 Screens and names

| Today | Becomes | Why |
| --- | --- | --- |
| Sites (dashboard) | **Home** (role-based tasks, §9.3) + **All sites** | Start from "what are you here to do?" |
| Site → Pages | **Overview** (quick actions, needs-attention, pages tree) + **Pages** | A site needs a home |
| Content | **Lists** (Speakers, Program, Stories, Sponsors…) | Editors think in lists, not collections |
| Design + Header & footer + Navigation | **Site look** (one workspace on the real site; §7.5) | Same job, three competing screens today |
| Section library | **Sections** (admin), plus the in-editor library | Authoring belongs to admins |
| Publishing | **Publish** | Verb, matches the button |
| Settings | **Settings** (General · Address & domains · Backup · Danger zone) | Destructive actions separated |

### 4.3 Status vocabulary (component `StatusPill`, SH-3)

| Pill | Meaning | Colour |
| --- | --- | --- |
| **Draft** | Never published | Grey |
| **Live** | Published; no unpublished changes | Green |
| **Live · changes not published** (short form "Live · edits") | Published, with saved changes waiting | Amber |
| **Scheduled · Nov 3, 9:00 AM** | A publish/unpublish is booked | Blue |
| **In review** | Submitted, awaiting a reviewer | Purple |
| **Hidden** | Section or item hidden until ready (editor only) | Grey, dashed |
| **Archived** | Removed from the site; restorable | Grey, muted |

Saving has its own indicator in the editor ("Saving…", "Saved 2:41 PM", "Couldn't save · Retry", "Offline"). A page list never shows green "Live" for a page that has waiting changes. Counts on Home, All sites, Overview and Publish must match.

## 5. The page editor

Reference: V1's editor (`docs/ui-reference/v1-cms-2026-10-02/images/03-hni-editor-desktop.jpg`, `09-section-settings.jpg`, `10-docked-library.jpg`). V1's layout stays; the work below is about clarity, room and hierarchy.

### 5.1 Layout and resizable panels (ED-1)

- Three regions: **Structure** (left), **Canvas** (centre, the real page), **Inspector/Library** (right).
- **Both side panels resize by dragging their inner edge.** Handle: 12 px hit area, 2 px visible line on hover, `col-resize` cursor. Keyboard: focus the handle, ←/→ moves 16 px, Home/End jump to min/max. Double-click resets to the default width.
- Widths: Structure 240–360 px (default 264). Inspector 320–720 px (default 360). Library 360–900 px (default 520). Each width is remembered per person (per-viewer convenience; local storage is fine).
- **The library and the inspector remember separate widths.** Opening the library uses the library width. Closing it returns to the inspector width ("once I close it, it goes back to the normal editing experience").
- The canvas keeps at least 480 px. When space runs out, Structure collapses first (to a 48 px strip with a toggle), then the right panel overlays the canvas as a drawer at tablet widths.
- In Fit mode the canvas re-fits its zoom on every resize. Coordinates, caret and drop targets stay correct.
- **Focus mode** hides both panels; a floating "Exit focus" control and Esc bring them back.

### 5.2 Top bar (ED-2)

Left to right:

1. **← Back to {site}**, then `Pages / {page title}` (the title never truncates below 16 characters; long titles get a tooltip)
2. Status pill (§4.3)
3. Undo · Redo
4. Desktop · Tablet · Phone
5. Save state
6. **Preview** (opens the page as a visitor would, in a new tab, including hidden-state choice)
7. **Publish** (primary). Contributors see **Submit for review**.
8. **More (⋯):** Page settings, History, View live page, Duplicate page, Discard all unpublished changes. History also has a visible toolbar shortcut.

Remove from the canvas toolbar:

- "Site design: Live". Move it into Preview as "Preview with saved site-look changes".
- "Show hidden sections". This becomes the hidden-section banner of §5.9.
- "Zoom: Fit · 65%". Keep only a small zoom control (− 100% + · Fit) at the bottom-right of the canvas.

### 5.3 Canvas (ED-3)

- **Selection:** hover outlines in a light editor blue. Selection shows a solid outline plus a **name tag** ("Hero" for a section, "Hero · Title" for a field). Selection never uses red; red is reserved for errors and destructive actions.
- **Insertion lines:** hovering the gap between two sections shows a line with a **"+ Add section"** pill. Clicking it opens the library with that exact destination. This is the main way to add sections. Keyboard equivalent: "Add section below" in each section's menu in Structure.
- **Floating section toolbar** on the selected section (top-right corner, inside the canvas): `Move up` · `Move down` · `Duplicate` · `Hide` · `⋯` (Change layout, Reset to live version, Copy section, Delete). Icon buttons, 32 px, tooltips. Delete is red and asks for confirmation unless the section is empty.
- **Direct text editing:** click once to select, again to type (V1 behaviour, kept). A formatting toolbar floats above rich text.
- **Repeating items** (cards, steps, logos): hovering an item shows a small item toolbar (move left/right, duplicate, remove), and an **"+ Add card"** ghost card sits at the end of the group.
- **List-backed items** (speakers, sessions): see §5.10.
- **Sample content** shows a small "Sample" chip on each field that has not been replaced yet (editor only; §6.4).

### 5.4 Inspector (ED-4)

**Nothing selected:** short help ("Click anything on the page to edit it"), a **Page outline** summary, and quick actions: Add section at end · Page settings · Site look. The **"+ Add a section"** button names its destination: "Add after *Overview* (end of page)".

**Section selected.**

- **Header:** the section's name (auto-named from its first heading, e.g. *"Hero — Better Together 2027"*; renaming is under Advanced) and a quiet layout chip ("Layout: Split hero").
- **Tabs:**
  - **Content:** every editable field, in visual order. Selecting a field on the canvas opens this tab and scrolls to and highlights that field.
  - **Style:** only the controls this section supports (driven by its capability flags, §6.3).
    - *Background:* swatches — White · Light · Brand · Dark · Photo (if supported).
    - *Text colour:* automatic for contrast, with an override only if supported.
    - *Spacing:* a segmented Small/Medium/Large with a mini diagram. The default is labelled **"Default"**, never "Definition default".
    - *Width:* Narrow · Standard · Wide · Full, each with an icon and no units.
    - *Alignment:* Left · Centre.
    - *Image position:* Left/Right, for image + text sections.
    - *On phones:* "Image first / Text first", only for two-column sections.
    - A **Reset style** link sits at the bottom.
  - **Visibility:**
    - *Show on:* Phone · Tablet · Desktop toggles with icons, plus the note "This changes layout, it does not hide content from people who look at the code".
    - *Hide until ready:* hides the section from visitors while it stays editable; published pages leave it out.
    - *Show from / until dates* (P2, §8.3).
  - **Advanced** (Site Admin+):
    - *Section name* (only editors see it; formerly "Editor label")
    - *Anchor link name* (for in-page links)
    - *Custom CSS for this section* (scoped)
    - *Edit HTML* (Super Admin; governed by the existing sanitizer)

**Field controls by type:**

- **Text:** an inline input that mirrors the canvas.
- **Rich text:** the same engine as the canvas; headings H2–H4, bold, italic, lists, quote, link.
- **Image:** picture-first: big preview, *Replace* (media library) and *Upload*, then:
  - *Description for people who can't see it* (alt), with an *It's decorative* toggle
  - *Focus point*: click on the preview
- **Link/button:**
  - *Button text* and *Goes to:* a picker for site page / section on a page / file / web address, plus *Open in new tab*
  - *Style*: Primary · Secondary · Text link, shown as visual chips using the site's styles
  - Size and full width only if the section supports them
  - A note "Button colours come from Site look → Buttons" with a link
- **Icon:** a visual picker (search, recent icons), from the site's icon set (Material Symbols for the national theme).
- **Repeating group:** an item list with drag handles, add, duplicate and remove; each item collapsible with a preview label.

### 5.5 Section actions: hierarchy and labels (ED-5)

V2's inspector stacks Up/Down, Above/Below, Change layout, Duplicate and "Undo my changes" as identical buttons. Replace that with:

| Action | Where | Visual weight |
| --- | --- | --- |
| Add a section here | Canvas insertion lines; "+ Add section below" button at the bottom of the inspector | **Primary** (filled) |
| Move up / Move down | Floating toolbar and Structure drag | Icon buttons with tooltips "Move section up" |
| Duplicate · Hide | Floating toolbar | Icon buttons |
| Change layout | ⋯ menu and the layout chip in the inspector header | Menu item |
| Reset to live version | ⋯ menu; confirmation names the scope ("Restores this section to what visitors see now. Other sections are unchanged.") | Menu item |
| Delete section | ⋯ menu | Destructive (red), confirmed |

"Position" and "Add a section" headings with paired buttons are removed. Labels say what happens: "Move section up", "Add section below".

### 5.6 Adding sections (ED-6)

- **Destination is always explicit.**
  - With a section selected, it is *below the selected section*.
  - From an insertion line, it is *exactly that gap*.
  - With nothing selected, a destination menu defaults to "End of page" and lists every gap ("After Hero", "After Overview"…).
  - The library header repeats the destination ("Adding after **Hero**") with a *Change* link.
  - This replaces today's behaviour, where the page-level "Add a section" silently appends to the end.
- **After inserting:** the new section is selected, scrolled into view and briefly highlighted. Its Content tab opens with the first sample field focused, and the library closes, restoring the inspector width.
- **No empty sections.** Inserted sections carry their designed sample content (§6.4). Today's text block inserts blank and is invisible until typed into; that bug is closed by this rule.
- **Drag and drop from the library** onto an insertion line still works, with the same rules.

### 5.7 Change layout (ED-7)

- Offer **compatible layouts first**: same family, or fields that map without losing content. Each option shows a **live mini-preview of this section's actual content** in the new layout.
- Layouts that would drop content sit behind "Show other layouts", with a plain warning per option ("Your 6 speakers won't appear in this layout"). Layouts that **cannot** work, such as a list layout for a section that has no list, **are not offered at all**. Never show a "Use layout" button that leads to a refusal.
- Applying keeps the old version in history, and Undo restores it.

### 5.8 Undo, redo and reverting (ED-8)

- **One undo history for the page:** typing, field changes, style changes, moves, inserts, deletes, duplicates and layout changes. ⌘Z/⌘⇧Z and the top-bar buttons share it. Native undo inside a focused text input stays with that input.
- **Remove "Undo my changes" from the section panel.** Its section-wide scope is broader than a single undo action and overlaps the shared undo history.
- **Per-field revert:** changed fields show the existing dot. Hovering it offers "Revert to the version when you opened this page".
- **Reset to live version** (section ⋯ menu) and **Discard all unpublished changes** (page ⋯ menu) are explicit, named and confirmed, and both create a new draft (history kept).

### 5.9 Hidden sections, "hide until ready" (ED-9)

Editors can build a timeline privately and reveal it when ready. Preserve the existing hide/show behavior.

- A hidden section stays on the canvas with a **dashed outline, 50% faded content and a "Hidden from visitors" tag**.
- A thin banner above the canvas reads "**1 section is hidden from visitors.** [Preview without hidden] [Show me]". Wording stays plain; no "Publish to apply" phrasing.
- In Structure, hidden sections show an eye-off icon. Unhiding is one click on the floating toolbar or in Structure.

### 5.10 Lists inside pages: speakers, sessions, sponsors, members (ED-10)

Content editors can add/remove speakers and build schedules without leaving the page editing workflow.

- Clicking a speaker card (or a session row) selects **that item**. A popover offers **Edit speaker** · Hide on this page · Move.
- **Edit speaker** opens a **right drawer** with the speaker's fields: photo, name, role/organization, short bio, links.
  - A note explains that it is shared: "Updates this speaker everywhere they appear (Home, Speakers)."
  - Saving updates the canvas immediately as a draft.
- An **"+ Add speaker"** ghost card at the end of the list opens the same drawer, empty.
- The section's Content tab shows the list binding in plain words:
  - *"Shows: **Speakers** (12) · All, in list order · [Edit speakers] [Choose speakers…]"*
  - Choices: All · Pick specific items · Newest N · Filter by tag/category.
- A list section must look good with 0, 1, 3 and 30 items. An empty list shows a designed empty state in the editor (and nothing, or a chosen fallback line, to visitors).

### 5.11 Header, footer and menu from the page (ED-11)

Shared-element editing must clearly identify that the change affects every page on the site.

- Clicking the header or footer on the canvas selects it and shows a banner in the inspector: "**Header — on all 6 pages.** Changes appear on every page." It offers one button, **Edit header**.
- **Edit header** enters *site-wide mode*:
  - The canvas outline turns purple and the top bar reads "Editing site-wide: Header".
  - Menu items are editable in place: rename by clicking, drag to reorder, "+ Add page to menu", indent to make a dropdown.
  - **Done** returns to the page.
- Site-wide changes publish as "Site look" changes (§7.6) and are listed separately from page changes.

### 5.12 Responsive preview (ED-12)

- Phone and tablet previews render the **actual site at 390 px and 768 px** inside a device frame. The canvas never reflows the desktop view to fit the column.
- Every core section and the site frame must be **mobile-first**:
  - the header collapses to a menu button on phones (today's preview prints the whole menu as a list on phones)
  - text sizes scale
  - card grids become 1–2 columns
  - speaker cards are compact (photo, name, role; the bio is behind "Read bio")
  - schedules become a day-by-day list
- There are no per-device layouts. Phone/tablet visibility toggles (§5.4) are the only per-device control.

### 5.13 Page settings (ED-13)

Page settings open in a drawer (from ⋯ → Page settings) with three groups:

- **Page:** title, address (with collision check), shown in menu (yes/no), parent page.
- **Search & sharing:**
  - Search title and description, each with a character meter
  - Social image
  - A **"Page checklist"**, e.g. "✓ has a main heading · ✗ 2 images missing descriptions · ✓ description length OK"
- **Danger zone:** Unpublish, Archive.

### 5.14 Copy changes in the editor

| Today | Use instead |
| --- | --- |
| Definition default | Default |
| Editor label · Private | Section name (only editors see this) — under Advanced |
| Shown when published / Hide | Hide until ready (toggle) |
| Position · Up / Down | Move section up / Move section down (icon buttons) |
| Add a section · Above / Below | Add section here (insertion line) · Add section below |
| Undo my changes | (removed) → Undo in the top bar; Reset to live version in ⋯ |
| Reading · 42rem maximum | Narrow |
| Column order on phones | On phones: Image first / Text first (only on two-column sections) |
| Background & text · tokens | Background (swatches) |
| Site design: Live (canvas toolbar) | Preview → "with unpublished site-look changes" |
| Site tools | (removed) — site areas are in the rail |
| 4 editable regions on this page | (removed) |

## 6. The section library

V1's library was the maintainer’s favourite part of V1 (`docs/ui-reference/v1-cms-2026-10-02/images/18-section-library.jpg`, `11-section-full-preview.jpg`). Each section had real-looking content that explained itself ("A bold statement, front and center"; "Introduce the page in one or two sentences…"), clear names and categories, and real rendered thumbnails. V2 imported those sections only into HNI and Echelon. This chapter makes them the shared foundation.

### 6.1 One shared core library (LB-1)

- **Core library:** global-scope section definitions (the `global` scope already exists in `section_defs`). Every site sees them, and they render in each site's theme through design tokens (§10.5). Shared modules inherit each site’s CSS.
- **Site sections:** site-scoped definitions created by import or for a site's special needs. They appear in a "This site" category. HNI and Echelon keep their faithful V1 variants.
- **Site creation uses the core library.** Delete the "· site starter" path in `apps/admin/src/lib/site-creation.ts`, which copies seed `hero`/`prose` definitions per site. New sites compose their pages from core sections and page templates (§6.6).
- **Existing sites** keep their pinned definitions (immutable versions). Adopting a core section is a deliberate Change layout (§5.7).

### 6.2 Core catalogue (LB-2)

Rebuild from V1's catalogue (`docs/v1-inventory/definitions.csv`, V1 source `tsa-cms-admin/src/sections/registry.generated.js`). Build it on the national design system (§10.5): mobile-first, accessible, token-themed. **P0 = the 24 sections marked ●**; the rest follow.

| Category (editor-facing) | Sections |
| --- | --- |
| **Page openers** | ● Split hero (photo + headline + text + 2 buttons) · ● Photo hero (full-bleed with overlay) · ● Statement hero (centred, no photo) · ● Event hero (dates, place, register button) · ● Page header (inner pages: title + intro) |
| **Text & stories** | ● Text block (reading width) · ● Text + image (left/right) · ● Quote · ● FAQ (accordion) · Steps / timeline · Tabs |
| **Cards & highlights** | ● Icon cards (3–4 up) · ● Image link cards (programs/ministries) · ● Stats · ● Logo strip (partners/sponsors) · Sponsor tiers |
| **People** | ● Speakers grid (from the Speakers list) · ● Team / leadership grid (from a People list; Echelon rosters) · Person spotlight |
| **Events** | ● Schedule (from the Program list; grouped by day, filterable by track) · ● Venue & travel (map, address, hotels) · ● Registration call to action (deadline, price tiers) · Upcoming events |
| **Calls to action** | ● Call-to-action band · ● Ways to give / donate · Two-choice call to action · Join / sign-up (governed form embed) |
| **Media** | ● Image gallery · ● Video · Map |
| **From your lists & feeds** | ● Resource library (documents & downloads) · Stories feed (by tag, §8.1) · Locations / chapters directory |
| **Page helpers** | ● On-page navigation (anchor tabs) · Announcement bar · Related pages |

### 6.3 Section quality bar (every core section must pass)

1. **Mobile-first:** designed at 390 px first, then 768 and 1280. There is no horizontal scroll at any width, and no card taller than one phone screen. Long text truncates with "Read more" where appropriate.
2. **Sample content explains the section** (§6.4) and looks like a finished page.
3. **Themed only through tokens** (colours, fonts, radius, spacing scale, button style). There are no hard-coded brand colours, so one section works for BT2027, Echelon, SAWSO and HNI.
4. **Capability flags** declare which Style controls apply: background, image position, phone order, width, spacing, button style. The inspector shows only those (V1 had the same idea: `readsSectionFg`, `hasCta`, `usesMobileOrder`).
5. **Accessible:** semantic headings (one H1 per page, from the page header or hero), alt text fields, 4.5:1 contrast in every theme preset, keyboard-operable accordions and tabs, reduced-motion support.
6. **Edge cases designed:** 0/1/3/30 items for lists; long names; missing photo, which shows an initials avatar rather than a broken image.
7. **Consistent rhythm:** shares the vertical spacing scale and container width with neighbouring sections, so alignment lines carry through the page . No white-on-white padding blocks without a border or background change.
8. **Has a thumbnail and a one-line purpose** ("Introduce the page with a photo and two buttons").

### 6.4 Sample content rules (LB-3)

- Copy says what the field is for, in the voice of a finished page. Examples: "Better together, closer to our communities" (headline); "Introduce the event in one or two sentences. Say who it's for and why it matters." (intro); "Speaker name" / "Role, Organization".
- Images come from a **built-in sample media set** shipped with the CMS: neutral photography or illustration cleared for reuse, in square, 4:3 and 16:9. No Salvation Army people photos are used as samples without rights confirmation (platform lead decision, §12.6).
- Sample values are flagged in the instance (for example, a `sample: true` marker per field value or a per-section set of untouched fields). The editor shows a "Sample" chip. **Publish readiness lists remaining sample content** and requires an explicit "Publish with sample content" confirmation.

### 6.5 Library UI in the editor (LB-4)

Reference: V1's docked shelf (`10-docked-library.jpg`) and full preview (`11-section-full-preview.jpg`).

- **Docked library** (right panel, resizable, §5.1):
  - **Header:** "Add a section", the destination line ("Adding after **Hero** · Change") and a close button.
  - **Body:** search; category chips with counts (wrap, never overflow); a ★ Favourites chip; then a **responsive grid**:
    - 1 column below 420 px, 2 columns at 420–680, 3 columns above 680
    - each card: a large thumbnail (16:10, legible), name, one-line purpose, and **Add** (primary) / Preview (secondary) buttons that **never overflow the card**
- **Browse all** (button in the docked header) opens a large sheet over the canvas: a category rail on the left, a big thumbnail grid and hover-to-enlarge. The destination line stays visible.
- **Preview** (modal):
  - Renders **only the section**, without the site header and footer, at Desktop/Tablet/Phone in the site's theme, with sample content.
  - Shows its height naturally, with no empty full-page area below. Today's preview renders the whole site frame and an empty page, which looked broken.
  - Footer: "You can edit: Title · Body · Buttons" chips, plus **Add here** (primary) and Back.
- **Thumbnails** are rendered by the worker from the section's sample content in the site's theme at 1280 px and cropped to the section. They show a skeleton while processing and fall back to a designed category illustration. Today's thumbnails are miniature whole pages and are mostly blank.
- "Request a custom section" is a quiet link at the end of the grid. It has normal spacing, not a box glued to the cards above it.

### 6.6 Page templates (LB-5)

Page templates are named, ordered compositions of core sections with sample content. They are used by "Add a page" and by the site wizard. P0 templates:

| Template | Sections |
| --- | --- |
| Event home | Event hero · Icon cards (why attend) · Speakers grid (6) · Schedule teaser · Venue & travel · Sponsor logo strip · Registration CTA |
| Speakers | Page header · Speakers grid (all) · CTA band |
| Program / schedule | Page header · On-page navigation (days) · Schedule · CTA band |
| Plan your visit | Page header · Venue & travel · FAQ · CTA band |
| Sponsors / exhibitors | Page header · Sponsor tiers · Text + image · CTA band |
| Chapter page (Echelon) | Chapter banner/photo · Shared What is Echelon (locked) · Optional chapter paragraph · Chapter inquiries · Optional social links, events, board, photos and member login · Shared Join us form (locked). No member roster or stories. See §16.8. |
| Ministry page (SAWSO) | Page header · Text block (evergreen, ~2 paragraphs) · Stats (from data values) · Stories feed (sector tag; 13-month expiry) · CTA band |
| Resource page | Page header · Text block · Resource library · FAQ |
| Landing page | Split hero · Icon cards · Text + image · Stats · CTA band |

### 6.7 Authoring and updating sections (admins) (LB-6)

- The existing creator (visual builder and "Organize into blocks" for pasted HTML/CSS) stays for Site Admins (site sections) and Super Admins (core sections, raw HTML). Restyle it to the design system.
- **Update a section everywhere**. Editing a core section creates a new version, then the screen offers "Update pages that use it":
  - a list of pages with before/after previews
  - "Update all", "Update selected" or "Leave as is"
  - placed instances stay pinned until updated (the existing immutable-version model)
- New core sections must pass the quality bar (§6.3) and include sample content and a thumbnail before they show in the library.

### 6.8 Request a custom section (LB-7)

Keep the existing request flow (contributors explain what they need; admins answer in Inbox). Show it as a link at the end of the library and in empty search results ("Can't find it? Request a section").

## 7. Site workspaces

### 7.1 Home and site overview (WS-1)

- **Home** (personal):
  - A greeting and "What would you like to do?" task cards derived from the person's assignments (§9.3), for example "Edit Better Together 2027 home page", "Update BT2027 speakers", "Review 2 submissions".
  - Below them, recent work and the All sites grid.
- **Site overview:**
  - Header with site name, status, and **View live site**.
  - **Quick actions:** Edit home page · Add a page · Update lists · Change site look.
  - **Needs attention:** pages with unpublished changes, items in review, content expiring soon (§8.3), sample content still on live pages.
  - The pages tree (§7.2).

### 7.2 Pages (WS-2)

- A **tree table**, not cards, because sites will have dozens of pages:
  - columns: title (indented by parent), address, status pill, in menu, last edited (who, when)
  - actions: Edit (primary on row hover), View live, ⋯ (Rename, Duplicate, Move, Unpublish, Archive)
- Search and filter by status.
- **Add page** offers a template (§6.6), a duplicate of an existing page, or blank (blank gets a Page header section, never an empty page).

### 7.3 Lists (formerly Content) (WS-3)

Reference: V1's event content screen (`27-event-content.jpg`, `28-event-record.jpg`). Simple tabs, records with photos, Import/Export CSV, Publish changes. It was clearer than V2's.

- **Lists index:** tiles per list (Speakers 12 · Program 24 sessions · Sponsors 18 · Stories), each with "Used on: Home, Speakers" and a status pill. Admins also see "New list".
- **Inside a list:**
  - **Header:** title, count, status pill, primary **Add speaker** (singular noun from the list), secondary **Import / Export ▾** (CSV; Excel Events template mapping for BT2027, §8.4), ⋯ (List settings, for admins).
  - **Table or cards** toggle. The table shows photo, name, role, status and last edited; drag handle when the list is manually ordered. Search; filter: All · Live · Draft · Hidden.
  - **Click a row** to open a right drawer form with plain labels, required markers, help text under fields and a photo picker. Save keeps it as a draft.
  - When there are draft changes, a sticky bar reads "**3 changes not published** · Review · Publish list".
  - Bulk select offers Hide, Show and Delete.
- **List settings (admin only):**
  - fields with plain types (Short text, Long text, Photo, Link, Date, Time, Choice, Tag)
  - ordering (manual or by a field)
  - expiry rule (§8.3)
  - "Advanced" shows the record key and reader key
- The words **schema, revision, design fields, publish schema, record key** do not appear outside Advanced.

### 7.4 Media (WS-4)

- **Top:** title, search, primary **Upload** (drag-and-drop anywhere on the page also works), and tabs **Images · Documents**.
- **Left:** folders (collapsible). **Main:** a thumbnail grid; tiles show their own processing or error state.
- **Click a tile** to open a right drawer: preview, *Description for people who can't see it* (+ decorative toggle), *Focus point* (click on the image), *Used on* (pages), Replace, Delete. Credit/attribution and tags go under "More details".
- **Remove** the statistics band (matching / ready / processing / needs attention / deleted). Show a "Needs attention (2)" filter chip only when the count is above zero.
- **Pickers** opened from the editor use the same grid in a dialog, starting with search and recent images.

### 7.5 Site look (Design + Header & footer + Navigation) (WS-5)

One workspace, built like the page editor. The **real site is the canvas**, with a page switcher ("Preview page: Home ▾") and device toggle. Controls sit on the left in a resizable panel:

1. **Theme preset:** National (Salvation Army USA), Better Together 2027, Echelon, SAWSO, Neutral. Choosing a preset fills the controls below.
2. **Logo and name:** full logo, compact logo, show site name, partner/presenter ("In partnership with…").
3. **Colours:** four swatches — Brand · Accent · Dark · Light — each with a colour picker and contrast check against its text colour. "Advanced colours" lists the full role table (admins).
4. **Fonts:** curated pairings, each shown as a specimen, using self-hosted fonts.
5. **Buttons:** visual choices (shape, filled/outline, hover), previewed on real buttons.
6. **Header:** layout (Standard, Centred, Compact), sticky on scroll, utility links, header button.
7. **Menu:** a tree editor (drag to reorder, indent for dropdowns, hide/show, add page/link). Every edit shows on the real header in the canvas, with the dropdown and the phone menu openable. This replaces today's mock list preview.
8. **Footer:** columns of links, contact, social links, legal line.

Changes are drafts until **Publish site look**, which lists every page affected. Fine-grained per-field overrides stay in the page editor (§5.4). Site look owns the defaults, and the page editor links to it ("Button colours come from Site look").

### 7.6 Publish (WS-6)

- **Changes ready to publish**, grouped as Pages · Lists · Site look. Each row has a human summary (for example "Home: 3 text changes, 1 new section (Ways to give)"), **View changes** (side-by-side visual diff) and a checkbox (all checked by default).
- Primary **Publish selected (4)**. Secondary **Publish later…**, a friendly date/time picker with presets (Tomorrow 9:00 AM, Monday 9:00 AM) and the person's time zone shown.
- **Before publishing**, readiness findings appear inline with "Fix" links that open the exact field: missing descriptions, broken links, remaining sample content, missing main heading.
- **In review** (Editors and up): submitted items with Approve / Send back (with note).
- **History** tab: releases (who, when, what). "Restore this version as a draft" brings an older version back as a new draft.
- Keep the existing atomic release, publish-together and recovery engine. This is a presentation change.

### 7.7 Settings (WS-7)

- Cards with **identical internal spacing** (24 px padding; 16 px between fields; actions row 24 px below the last field), in this order:
  - **General:** site name, site type
  - **Address & domains:** preview address, custom domains (Super Admin; existing flow)
  - **People on this site:** who has which role here (link to People)
  - **Backup:** download content archive, with its privacy note *above* the button
  - **Danger zone:** a red-bordered card at the bottom with Archive site, confirmed with the site name
- The destructive Archive button never sits next to a routine Save.

### 7.8 Sections (admin) (WS-8)

- A grid of core and site sections, in the same visual style as the in-editor library (§6.5).
- Filters: category, Core/This site, ★.
- Section detail: preview at three widths, fields, "Used on N pages", versions, Update pages (§6.7), Edit (creator).

## 8. Low-maintenance content

Use evergreen page text with stories selected by tag, a shared JSON statistics source, a 13-month feature-story expiry and age-based review reminders. Analytics remain separately scoped.

### 8.1 Feeds (DY-1, P0)

- A **Stories feed** core section shows items from a feed source, filtered by tag(s). Settings:
  - max items
  - hide items older than N months (default 13)
  - sort (newest)
  - "when empty": hide the section, or show a fallback line ("Check back soon for stories from this program")
- **Feed sources:** (a) a CMS list (Stories); (b) an external JSON feed registered by an admin. The first is the SAWSO Stories utility output, which adds tags to the public JSON from sawso.org. (c) RSS later.
- Rendering keeps the server-rendered, no-JavaScript content contract (approved site scripts in §11.1 may enhance it):
  - the server (or static publish, §12.3) renders feed items into HTML
  - a scheduled worker job refreshes feeds (hourly or daily) and republishes only the affected pages
  - no visitor-side fetch is required
- External sources are allow-listed per site and fetched by the worker with size and time limits, then cached and sanitized with the existing rich-text policy.

### 8.2 Data values (DY-2, P0)

- A per-site **Data** table of named values: label, value, unit/format, source, "as of" date. For example, "Meals served (2025)" = 2,300,000.
- Stats sections bind to data values, so updating one value updates every page that uses it. A value can be typed in, or synced from a JSON URL or Google Sheet (§8.4).
- The "as of" date can show in small print ("As of FY2025").

### 8.3 Expiry and review dates (DY-3, P0)

- Lists and sections can have **Show from / Show until** dates. Expired items drop from published output on the next scheduled publish, and the worker handles this automatically.
- **Review-by dates:** items or pages past review-by show in Site overview's *Needs attention* and in Inbox ("Hurricane Melissa response — 8 months old, review or remove").
- Click counts and analytics are a later feature. Design the place in Needs attention, but do not build an analytics product.

### 8.4 Bringing data in (DY-4, P1)

- **CSV import** exists. Add **saved mappings**, for example the Excel Events speaker/session templates the platform lead uses for BT2027 registration, so a coordinator can re-import updates.
- **Google Sheets sync** (AO Hub and BT2027 use Sheets): an admin links a published sheet/CSV URL to a list or data table. The worker pulls it on a schedule and shows a diff before applying. Results publish only on approval (or automatically if the admin chooses).

## 9. People, roles and access

### 9.1 Roles (carried from revision 7, plus page scope)

| Capability | Contributor | Editor | Site Admin | Super Admin |
| --- | --- | --- | --- | --- |
| See assigned sites (or assigned pages/lists); edit drafts; use media | Yes | Yes | Yes | Yes |
| Submit for review; comments; request a section | Yes | Yes | Yes | Yes |
| Publish; approve/reject; create pages; edit menu, header, footer content | No | Yes | Yes | Yes |
| Site look, list settings, site sections (visual) | No | No | Yes | Yes |
| Core sections, raw HTML/CSS, frame definitions | No | No | No | Yes |
| Sites, people, domains, hosting, imports, utilities | No | No | No | Yes |

Enforcement stays in Postgres (RLS and commands); hiding things in the interface is only a convenience.

### 9.2 Scoped access (RO-1, P1)

Echelon chapters need volunteers who edit **only their chapter page**.

- Add **scope** to a membership: a whole site (today), specific **pages**, or specific **lists**. A scoped contributor sees only those items, and their Home shows "Edit Kalamazoo chapter page".
- Implement it as membership rows with an optional page/list scope, checked in the same commands and RLS policies. Add real-role database tests for allowed, foreign-page and foreign-site cases.

### 9.3 Role-based home (RO-2, P1)

Home prioritizes the signed-in person’s allowed sites and routine tasks.

- Home builds its task cards from assignments: sites and scoped pages, lists the person maintains, items waiting for their review, and utilities they can use (§9.5).

### 9.4 Sign-in and SSO (RO-3, P2)

- Keep the email-link sign-in for the pilot.
- Prepare, but do not configure without IT, a **Microsoft Entra ID (Azure AD) OpenID Connect** provider behind the existing auth port. Map Entra groups to CMS memberships, for example "EDS editors" → Editor on the EDS pages.
- Deliver a one-page IT brief: what to register, redirect URIs, required claims, group mapping, and who owns it. Include the prerequisites IT needs to review.

### 9.5 Utilities hub (RO-4, P2)

The CMS can provide a shared utilities hub for the digital team.

- Reserve a **Tools** area for small authenticated utilities that share sign-in and roles: the SAWSO Stories tagging manager, the NHQ employment sync status, and Zesty API helpers for EDS disaster and job listings.
- Each tool is a separate module with its own permissions. None of them may edit production systems without the existing administrator authorization.
- Specify the module contract; build tools only on request.

## 10. Design system

Admin screens use shared tokens and components. The October29 approved mockup governs the light frame, compact controls and white panels; remaining legacy styles migrate through these shared components.

### 10.1 Tokens (SH-1)

Create `apps/admin/src/styles/tokens.css` with these tokens; nothing else may use raw values.

| Group | Tokens (starting values; verify contrast with tooling) |
| --- | --- |
| Colour — chrome | `--rail` #FAFBFC · `--rail-hover` #EEF0F4 · `--bg` #F6F7F9 · `--surface` #FFFFFF · `--surface-sunken` #EEF0F4 · `--border` #E6E8EC · `--border-strong` #DDE1E7 |
| Colour — text | `--text` #0F1729 · `--text-muted` #5B6474 · `--text-on-dark` #FFFFFF |
| Colour — action | `--primary` #0D234F (filled buttons) · `--publish` #C8102E (Publish only) · `--danger` #B4232C · `--focus` #2F6FED · `--editor-select` #2F6FED |
| Colour — status | Live #1E7F4F · Pending #8A4B00 · Scheduled #2459D6 · Review #5B3BB0 · Draft/Hidden #5B6474 (each with a 10% tint background) |
| Type | System UI stack (or self-hosted Inter); 13/18 meta · 14/20 body · 16/24 emphasis · 20/28 section · 24/32 page title. Weights 400/500/600 |
| Space | 4 · 8 · 12 · 16 · 24 · 32 · 48 (`--space-1`…`--space-7`) |
| Radius | 7 controls · 12 cards · 14 sheets/dialogs · 999 pills |
| Elevation | `--shadow-1` cards · `--shadow-2` popovers/floating toolbar · `--shadow-3` dialogs |
| Motion | 120 ms (hover), 180 ms (panels), ease-out; respect `prefers-reduced-motion` |

### 10.2 Components (SH-1)

Build these primitives in `apps/admin/src/components/ui/` and migrate screens onto them, removing the matching rules from `globals.css` as you go:

`Button` (Primary · Secondary · Tertiary/ghost · Destructive · Publish; sizes S/M) · `IconButton` (32 px, required tooltip) · `SegmentedControl` · `Field` (label, help, error, required) · `TextInput` / `Textarea` / `Select` / `Toggle` / `Checkbox` · `SwatchPicker` · `ColorPicker` · `Card` (header/body/footer) · `PageHeader` (back + breadcrumb + title + actions) · `StatusPill` · `Tabs` · `Drawer` · `Dialog` · `Popover` / `Menu` · `Toolbar` · `ResizablePanel` · `EmptyState` · `Toast` · `Skeleton` · `Tooltip`.

Signed-out routes use the shared centered420px entry card with32px padding and44px form controls; the existing provider and sign-in labels remain.

Settings cards use flush outer padding, a divided compact heading and 16 px body padding.

Media details use the shared compact 360 px drawer, bounded by the viewport; its footer keeps the existing save action visible.

### 10.3 Layout rules

- An 8 px rhythm everywhere. Card padding is 24 px (16 in side panels). Fields are 16 px apart. Groups are 24 px apart with a 12/16 heading. Action rows sit 24 px below content, with buttons 8 px apart.
- One primary button per region. Destructive buttons never sit beside a primary unless in a confirmation dialog.
- Labels never overlap borders or controls. Pills and badges sit inside layout flow, not absolutely positioned over inputs. This fixes the "Private" tag overlapping its input.
- Text truncates with an ellipsis and a tooltip; it never pushes buttons out of their container.
- **Authoring-device requirement:** the CMS is for laptops/desktops. Design and check admin screens at 1440 and 1024 px. Below 1024, the editor uses one side panel at a time (drawer). Below 768, show read-only status plus "Use a larger screen to edit" with save state. Build no phone editing workflow. Public pages and the editor's Phone preview still work and are checked at 390 px.
- Enforce with `stylelint`: disallow raw colours and pixel spacing outside `tokens.css`, and fail CI on new violations.

### 10.4 Interaction states

Every interactive component has default, hover, focus-visible (2 px `--focus` ring), active, disabled and loading states. Loading never blocks unrelated controls. Errors name the problem and the fix, and keep the person's input.

### 10.5 Site-side design system: the "national" theme (LB-8)

- Core sections are built on **Bootstrap 5's grid and utilities**, as the national site and the volunteer-page design are. Add the site theme's custom properties on top: `--site-brand`, `--site-accent`, `--site-dark`, `--site-light`, `--site-font-heading`, `--site-font-body`, `--site-radius`, `--site-space-scale`, `--site-button-*`.
- **National preset**, matching salvationarmyusa.org (the approved national appearance):
  - primary red `#EF3E42` and navy secondary `#002056`, from the approved
    October 27 measured national-theme reference (supersedes the provisional red)
  - grey canvas `#D9D9D9`, white rounded panels (20 px), soft fill `#EFEFEF`,
    ink `#1C1B1F`, 8 px button corners and a navy-dominant Echelon variant
  - Material Symbols icons
  - kicker labels above headings
  - card and grid patterns from the volunteer page
  - take exact values from the Salvation Army style guide file (approved local source) and the national stylesheet; record them in `docs/design/national-theme.md`
- **Presets** for BT2027 (its brand document), Echelon and SAWSO (national-based) are colour, font and logo sets over the same sections.
- Self-host fonts (Open Sans, Material Symbols, licensed brand fonts only with rights confirmation, §12.6). No runtime CDN.
- **Font requirement:** National and Echelon use the organization's local
  Creato Display files for this local demo. Keep Open Sans as fallback. Confirm
  the font licence before public hosting; keep a text Echelon wordmark until
  the official chapters logo file is supplied. Never substitute the Leaders
  Symposium logo.

## 11. Bringing existing sites in

### 11.1 Importer fidelity (MG-1, P0)

**Source-fidelity requirement:** an imported site must look and behave exactly like its original local source: styling, hover effects, transitions, animations, carousels, pop-ups, menus and filtering. Losing behavior is a defect, not an accepted limitation.

The importer (`pnpm import:website`, ADR 0011) must preserve styling, fonts, animation and behavior:

- **Vendor remote assets** at import time:
  - download listed stylesheets, fonts and images into the site's media/assets with a provenance record
  - rewrite URLs to point at the local copies
  - fonts with unknown licences are flagged for rights review, not silently dropped
- **Keep `@keyframes`** that pass the CSS policy (allow-listed properties), and respect reduced motion.
- **Detect repeated patterns** (speaker cards, workshop rows, sponsor logos) and propose them as **lists plus a list-bound section**, so "add a card" works natively after import.
- **Map PHP `include` templates** (header/footer) to the site frame. Treat `$pageTitle`/`$metaDesc` as page settings.
- **Editability report** in plain words: what became editable text, images, links and lists; what stayed static HTML (editable by admins only); what was left out and why.
- **Preserve original markup**, browser layout mode, classes and data attributes, including Swiper containers/slides, popup links and table attributes. Lists must emit the exact repeated markup the original scripts expect. Keep site stylesheets, hover/transition rules, media queries, approved keyframes, vendored fonts and icon fonts (including Font Awesome and Material Symbols).

#### Approved site scripts (P0, Super Admin only)

- A site may carry approved, self-hosted script files. For BT2027 these include jQuery, Bootstrap or its bundle, Swiper, Magnific Popup, jQuery Easing, `scripts.js` and the bootstrap-table files used by the local source. Download CDN files linked by the local copy into site-owned assets; never depend on a runtime third-party origin.
- Only a Super Admin can add, replace or remove scripts, after a review showing each file, size and source. Retain every immutable version and record all changes in activity. New or changed scripts publish through the normal atomic site release.
- Serve approved files from the site's own address, on all or chosen pages, in their original order and position. Validate exact approved bytes; an altered or unapproved file is refused. Site isolation applies to storage, delivery, bindings and publication.
- Extend each site's public CSP only for its exact approved files, by hashes or exact site-owned paths. No inline scripts or other origins. Sites without approved scripts retain their existing policy. Editors cannot add scripts; all section fields remain sanitized as before.
- Run approved scripts in the editor canvas too. Keep direct editing reliable inside carousels and other interactive elements, pausing autoplay while editing where needed. Server-rendered content must remain available without JavaScript; scripts enhance it.
- Tests prove approved rendering, changed/unapproved file refusal, no cross-site delivery and matching CSP headers.

#### Source-fidelity verification

Use the approved local source and digest-verified offline asset cache. Compare
all marketing pages at 1440, 1024 and 390 pixels, including interactive behavior.
Record each visible or behavioral difference with its source and reason.
Normal-zoom differences require review; subpixel and antialiasing differences
are assessed separately.

Serve the approved local BT2027 source on the local workstation (for example PHP on `127.0.0.1:8099`); never fetch the live site. Compare every marketing page against the local CMS-published output at 1440, 1024 and 390 pixels with side-by-side screenshots and Playwright behavior checks: carousel advances, popup opens/closes, mobile menu opens, workshop filtering works, and hover states change. Normal-zoom visible or behavioral differences are Major findings; fix and recheck against the same source. List every remaining difference and its reason in private verification receipts and the final report.


### 11.2 Better Together 2027 as the showcase (MG-2, P0)

**Imported-site controls:** BT2027 is a brought-in site. Keep its
original reviewed design files and skip theme/site-look controls for it. Finish
its Speakers, Sponsors and Workshops lists, menu/footer text and link editing,
and support the demo walkthrough. Theme controls for ordinary CMS
sites remain as built. Sponsor registration, booth and dashboard stay outside
the CMS. The footer-editing task in §14 replaces BT2027's accent-colour task.

- Import the marketing pages from the maintainer’s **local copy** (the approved offline release folder). Do not fetch from or connect to the live site.
- Replace the fictional event in `pnpm demo` with this import, plus HNI and Echelon. Keep the fictional event only as a test fixture.
- Target: a coordinator can add a workshop, a speaker and a sponsor logo on the imported site using §5.10, without code.
- The sponsor registration, booth and dashboard applications stay outside the CMS (§2), linked from the CMS pages.

### 11.3 Echelon chapters (MG-3, P1)

- **Chapter-site requirement:** build one new
  **Echelon chapters** site, separate from Echelon Symposium, using shared core
  sections and the national-based Echelon preset. Include the national home,
  Find a chapter and the Chapter page template (§6.6, §16.8).
- National home: visible Echelon wordmark/logo, navy colour-block hero with a
  photo, chapter search near the top, three pillars, leadership cards, news,
  FAQ and contact form. No national events list.
- Chapter pages have shared What is Echelon and Join us sections, chapter
  inquiries, and optional chapter paragraph, social links, this year's events,
  board, photos and member login. **No member roster, news or stories.** Board
  display is everyone or first eight with Show all. Social links can lead.
- Chapter volunteers have page-scoped Contributor access (§9.2); shared parts
  are locked in database rules and commands. Division web staff edit/review
  their division's pages; national staff are backup. Remind approvers after
  five working days; do not publish automatically.
- January/July checks send one message per chapter point of contact, with
  wording for its update mode. Local tests use the recording outbox.
- Use the supplied 41-row CSV for chapter identities and current link types.
  Public prose comes only from the supplied national public-text file; every
  other content field uses neutral
  placeholders and invented people labelled "(sample)".
- **Fallback while chapters still live in Zesty or a divisional site:** an admin can **export a section as HTML** (static, styled with inline-safe classes) to paste into another CMS. The export produces portable HTML. It stays a fallback, not the main path (revision 7's vendor-integration boundary).

### 11.4 SAWSO in the national look (MG-4, P0)

Build a full standalone site on the national-based SAWSO preset: Home, Ways we
help, all eight sector pages, Newsroom, story pages, redirects from old sawso.org
addresses and a switch-over plan. Target: live before January 1, 2027. Stories
come from the site-owned Stories list by sector tags (§8.1, §16.9); data values
and show-until/review dates remain P0 follow-on work.

The local demo uses approved sector HTML, the October 26 local stories
feed and the maintainer-approved `sawso-hifi/reference/home-page-text.md`, word for
word. The October 29 high-fidelity screenshots govern public layout: floating
rounded header, photo heroes, small-caps canvas headings, white panels, sector
photo tiles, story pills, red calls to action and rounded navy footer. Preserve
all eight approved sector names; Sustainable Solutions / Health/HIV naming is
an platform lead decision. Every story uses one shared template bound to its list item.

The supplied official shield is a local theme asset beside World Service Office /
Hope in Every Language in header and footer. Import the explicitly approved S3
story and sector/hero photos once through normal Media, with focus points and
review descriptions. Public pages use those copies; original URLs remain data.
The maintainer-approved reference colors take precedence over contrast for this
local SAWSO preset: #EF3E42 controls use white text. The named, immutable theme
marker records that exception; other theme contrast checks remain enforced.
Resolve the exception before hosted reuse. Alt text, focus, labels and semantic
heading order remain required. Other live-site fetches and all hotlinks remain prohibited. Missing content is
a labelled sample tracked by readiness. Confirm photo rights and replace
descriptions before hosted use. Trajan Pro 3 and Proxima Nova remain administrator review items;
use existing self-hosted stand-ins without font downloads.

SAWSO leads the demo, followed by Echelon and BT2027. After its chapter
step Echelon receives fixes only; its long-term home is undecided. BT2027 is
frozen and its live switch-over comes last. Local demo work does not authorize
hosting operations or a production switch-over.

### 11.5 Human Needs Index (MG-5, P1)

- HNI is already migrated faithfully. Plan its commissioning with the platform lead (domain, Tableau embeds, maintainer, cutover window). That is a launch task, not a rebuild.

## 12. Platform and hosting

### 12.1 Keep the core

Keep the TypeScript/Next.js monorepo, Postgres with row-level security and narrow commands, immutable versions, the shared sanitizing renderer, and the outbox worker. They are sound, and §15 lists their non-negotiables. Moving to Firestore would be a rewrite with no user benefit. Do not do it.

### 12.2 Where it runs (HO-1, P0)

- **Now:** the separate personal pilot remains a testing environment.
- **Target:** the organisation-owned Google project **NCRD CMS**. Ownership,
  payment and account actions require the maintainer; hosting changes require a separate approved operation.
- The CMS remains on Postgres, using Cloud SQL or Supabase. Old PHP/MySQL apps
  that move share one MySQL server, or may later convert to Postgres alongside
  the CMS. The CMS does not move to MySQL.
- Sign-in stays on Supabase until Microsoft sign-in (RO-3) is built.

### 12.3 Static publishing for public sites (HO-2, P0; ADR required before building)

**Recommendation:** on publish, render each changed page with the existing shared renderer into static HTML, and deploy it with its assets to the site's Firebase Hosting site (incremental upload of changed files only). Visitors then never reach Cloud Run or the database.

- **Why:**
  - Public sites keep working if the CMS is down or being changed.
  - Public traffic falls within free/cheap Hosting limits (this matters for the low-cost hosting goal and the InMotion replacement).
  - Pages are fast and there is less attack surface.
- **What changes:**
  - Scheduled publishing and feeds (§8.1) re-render affected pages.
  - Forms and apps stay as application routes (rewrites).
  - Preview stays dynamic and authenticated.
- **Write ADR 0012 before SAWSO goes live, and before building static publishing.** Compare it with the current dynamic site renderer behind Hosting on cost, cache invalidation, scheduled jobs, domain handling and failure modes. Then decide.

### 12.4 Cost brief for the platform lead (HO-3, P0, documentation only)

Produce `docs/hosting-cost-brief.md` for the CMS plus 5–10 existing cPanel sites, including the InMotion replacement and an overlap period. Verify estimates against current price pages and date the brief:

- line items: Hosting storage/transfer, Cloud Run requests/CPU/memory (admin and worker scale to zero), Postgres options, object storage, backups, build minutes, domains and certificates
- three usage scenarios
- what the MySQL-backed apps need (they are not CMS sites; options per app)
- Do not spend or upgrade plans. Keep "do not lift caps" in force.

### 12.5 Handover documentation (DOC-1, P0)

Provide IT-ready documentation covering architecture, GitHub-to-Google deployment, local setup and recovery.

- Consolidate it into `docs/operations.md`: a **one-page quick start**, a deploy runbook for the organisation project, and a restore runbook.
- Add a 10-minute editor training video script to `docs/editor-guide.md` once the new UI lands.

### 12.6 Maintainer decisions still open

- Rights to reuse Salvation Army photos, logos and fonts in sample content and themes
- Who maintains SAWSO after handover
- Who owns and pays for the organisation's Google project
- Who controls sawso.org's DNS
- Live cutover timing for BT2027 and HNI
- Whether IT wants SSO before launch

## 13. Delivery plan

P0 covers the release requirements; P1 and P2 are subsequent work. Each UI package requires the screenshot walkthrough in §14 before acceptance.

### Phase 0 — Documentation and source control

| ID | Work | Done when |
| --- | --- | --- |
| DOC-0 | Adopt this SPEC, the trimmed docs and the new roadmap. Pick **one canonical checkout and branch** (§13 note). | AGENTS.md, README and roadmap point here; obsolete documents removed |
| MG-2a | Demo uses imported BT2027 (local copy), HNI and Echelon; the fictional event becomes a test fixture | `pnpm demo --reset` shows BT2027 as the first site |

### Phase 1 — Design system and shell

| ID | Work | Done when |
| --- | --- | --- |
| SH-1 | Tokens + UI primitives (§10.1–10.2) + stylelint rule | New components used by shell, Settings and Pages; no new raw values |
| SH-2 | Rail with icon collapse toggle, site switcher, PageHeader with Back + breadcrumb on every screen (§4.1) | From any screen, one click reaches the parent and All sites |
| SH-3 | StatusPill and status rules (§4.3) across Home, All sites, Overview, Pages, editor, Publish | A page with saved changes shows "Live · changes not published" everywhere; counts agree |
| WS-7 | Settings rebuilt on the components with Danger zone (§7.7) | Spacing identical across cards; Archive separated |

### Phase 2 — Core library

| ID | Work | Done when |
| --- | --- | --- |
| LB-1 | Global core library; site creation uses it; remove the "· site starter" copy path | A new site's pages use core sections |
| LB-2 / LB-8 | P0 core sections (24) on the national design system with presets | Each passes §6.3 at 390/768/1280 in 3 presets (screenshot review) |
| LB-3 | Sample content and sample media; "Sample" chips; readiness warning | Inserted sections look finished; publish lists remaining samples |
| LB-4 | Library panel, browse sheet, section-only preview, worker thumbnails (§6.5) | No overflowing buttons at any panel width; thumbnails legible |
| LB-5 | P0 page templates (§6.6) | "Add page → Event home" yields a credible page in one step |

### Phase 3 — Editor

| ID | Work | Done when |
| --- | --- | --- |
| ED-1 | Resizable panels with remembered widths (§5.1) | Library opens wide, closes back to the inspector width |
| ED-2 | Top bar (§5.2) | No truncation of title below 16 characters; Preview and Publish clear |
| ED-3 | Canvas insertion lines, floating section toolbar, selection styling (§5.3) | Adding a section between any two sections takes one click |
| ED-4 / ED-5 | Inspector tabs, capability-driven Style, action hierarchy and copy (§5.4, §5.5, §5.14) | No control shown that has no effect; no "Definition default" |
| ED-6 / ED-7 | Explicit insertion destination, no empty inserts, compatible-only Change layout (§5.6–5.7) | Every offered layout can be applied |
| ED-8 | One undo history; remove "Undo my changes"; per-field revert; Reset to live (§5.8) | Undo after Duplicate removes only the duplicate |
| ED-9 | Hidden-section treatment (§5.9) | Hidden sections obvious on canvas and in Structure |
| ED-10 | In-context list editing: Edit/Add speaker drawer (§5.10) | Add a speaker from the Speakers page in under 60 s |
| ED-11 | Site-wide mode for header/footer/menu (§5.11) | Editing the header always shows "on all N pages" |
| ED-12 | Mobile-first frame and core sections in phone/tablet preview (§5.12) | Header collapses on phones; no oversized cards |

### Phase 4 — Workspaces

| ID | Work | Done when |
| --- | --- | --- |
| WS-1 / WS-2 | Home, Site overview, Pages tree (§7.1–7.2) | First-time editor reaches their page in ≤ 2 clicks |
| WS-3 | Lists (§7.3) | No schema/revision words outside Advanced; add/edit in a drawer |
| WS-4 | Media (§7.4) | Upload, describe and pick an image without reading instructions |
| WS-5 | Site look on the real site, including the menu tree (§7.5) | Colour or menu change visible on the real header/pages before publishing |
| WS-6 | Publish screen (§7.6) | One screen to see, publish or schedule everything waiting |

### Phase 5 — Real sites and platform

| ID | Work | Priority |
| --- | --- | --- |
| MG-1 / MG-2 | Importer fidelity; BT2027 showcase (§11.1–11.2) | P0 |
| HO-3 / DOC-1 | Cost brief; IT-ready operations quick start and runbooks (§12.4–12.5) | P0 |
| HO-2 | ADR 0012 static publishing, then build if accepted (§12.3) | P0 |
| HO-1 | Move to the organisation's NCRD CMS Google project (administrator actions) (§12.2) | P0 |
| MG-3 / RO-1 / DY-3 | Next authorized local step: Echelon chapters, shared-section locks, division review, January/July checks and acceptance (§16) | Now, after BT2027; local only |
| DY-1 / DY-2 / DY-3 | Stories feeds, data values, expiry/review dates (§8) | P0 |
| MG-4 | Full standalone SAWSO site in the national look (§11.4, §16.9) | P0 |
| RO-2 | Role-based Home (§9.3) | P1 |
| DY-4 | Saved CSV mappings; Google Sheets sync (§8.4) | P2 |
| RO-3 / RO-4 | Entra SSO brief and provider; Tools hub (§9.4–9.5) | P2 |

**Source control (DOC-0):** Use the frozen release tag for deployment.
Continue structural cleanup on a separate branch and merge only reviewed,
verified commits. See the maintainer refactor gates before including runtime changes.

## 14. Acceptance: the first-time editor test

The usability standard is **a brand-new user who can complete routine tasks without assistance**. Run these tasks at 1440 × 900 and 1024 × 768 on the BT2027 import, as an Editor who has never seen the CMS, and record time and wrong turns. Contributors perform this walk with screenshots at every step (see AGENTS.md). The maintainer or a real first-time person is the final judge.

1. From Home, open the BT2027 home page in the editor (≤ 2 clicks).
2. Change the hero headline and swap the hero photo; check it on Phone.
3. Add a **Speakers grid** below the hero: it appears finished, with sample content, at the chosen spot.
4. Add a new speaker (photo, name, role, bio) from the page itself (< 60 s).
5. Hide the Workshops section until ready; preview the page without it; unhide it.
6. Move a section up, undo, redo. Duplicate a section, undo (only the duplicate disappears).
7. On BT2027, change footer text and a footer link and see them on two real pages before publishing; its original design stays unchanged.
8. Add a "Hotel information" page from a template and put it under "Plan your visit" in the menu.
9. Publish everything from the Publish screen; statuses read "Live" everywhere afterwards.
10. Return to All sites from the editor in one click.

Pass when every task completes without documentation, no screen shows a term from the "Not" column of Appendix C, no control on screen fails when used, and the maintainer approves the screenshots (matching any mockup the maintainer supplied).

## 15. Guardrails (do not break)

These carry forward from revision 7. Details and proofs are in [revision 7](docs/archive/SPEC-r7-2026-10-11.md) §§3–5, 8–9 and 12 (shape limits, preview contexts, performance budgets, release journeys), [docs/architecture.md](docs/architecture.md) and [docs/threat-model.md](docs/threat-model.md).

1. Tenant isolation and permissions are enforced in Postgres (RLS + narrow `app.*` commands). The UI only reflects them.
2. One shared sanitizing renderer produces preview and public HTML. Section fields cannot introduce scripts. Only immutable site-owned script files explicitly reviewed by a Super Admin and published through the normal release may execute (§11.1), with exact per-site CSP approval, no inline script and no runtime third-party origin. Sites without scripts retain their policy. Public content remains server-rendered and works without JavaScript; approved scripts enhance it and run in the editor canvas with direct editing preserved.
3. Every save carries the loaded revision. A stale save returns a conflict and keeps local work. Saving is never shown as "Saved" before the server acknowledges it.
4. Versions are immutable; placed sections stay pinned until deliberately updated; restore creates a new draft.
5. Publishing goes through one policy (editor, review, release, schedule) and is atomic; readiness findings are honest.
6. Media and documents are validated server-side and delivered only through authorized references.
7. Hosted configurations never accept local test logins or adapters. No secrets in the repository, prompts, logs or screenshots.
8. Contributors follow §2's operational safety boundary: no Salvation Army credentials, no live Zesty/cPanel/DNS changes, no cutover without explicit maintainer and platform lead authorization.

---

## 16. Approved UI additions (October 27)

These eight additions adopt the supplied UI direction without changing the
architecture or imported sites' original design. Mockup site previews are
drawings, not replacements for the real rendered site. Reuse existing tokens,
components, routes, immutable versions, releases, roles and database rules.

### 16.1 Two kinds of sites (addition 1)

One editor supports **brought-in sites** with their own reviewed design files
and **sites built in the CMS** from shared sections/templates and a preset.
Site kind is configuration. Brought-in sites keep Style locked; a Super Admin
reviews changed design files. Editors change words, photos, links, list items,
visibility and order, and may add the site's sections or scoped shared-library
sections. Native sites additionally offer the preset's supported style choices.
Publishing, approvals, history, access and checks are the same for both kinds.
A brought-in site can later be rebuilt natively page by page by platform-lead choice.

### 16.2 A site's settings (addition 2)

Each site carries look, lists/fields, allowed sections, page templates, people,
page scope and approval rules. These settings configure the shared product;
they do not introduce a separate editor or a bespoke code path for each site.

### 16.3 Shared parts and scoped editors (addition 3)

Sections can be marked **site editors only**. Page-scoped Contributors cannot
alter, replace, hide, move, duplicate or remove those instances or their shared
values. Enforce this in save/restore and related commands plus database rules,
with real-role tests for allowed, denied and foreign-page/site operations.
What is Echelon and Join us are locked shared chapter parts.

### 16.4 Redirects per site (addition 4)

Store old path → new page redirects per site, with add/edit and spreadsheet
import. The public site resolves only the selected site's redirects, validates
destinations and rejects loops/conflicts. Preserve old chapter addresses such
as `/chapter/peoria` → `/chapters/peoria`; no live-site access is necessary.

### 16.5 Search or jump to (addition 5)

A sidebar search, also opened by ⌘K, finds accessible pages, list items and
common actions. Use the existing permission rules for every result; scoped
editors must never discover unassigned content through search.

### 16.6 Chapter contents (addition 6)

§6.6 and §11.3 use an optional board list, never a member roster or chapter
stories. National news remains a national-page feature.

### 16.7 Picture focus point (addition 7)

Use the stored focus point as a draggable dot on the picture, with live card,
Phone and wide crops. This is a UI over the existing picture model.

### 16.8 Per-chapter setup (addition 8)

Each chapter carries:

- **Find a chapter sends visitors to:** this chapter page, its own website
  (URL, no CMS page required), or not listed yet. Draft pages do not appear as
  live directory destinations; publishing makes the page available.
- **How the page gets updated:** division web team makes changes (the new-chapter
  default in Settings), or chapter editors sign in and submit for division
  approval. National staff can edit/review every chapter.
- **Point of contact:** one name, role and email. January/July checks use one
  message per contact and the appropriate update-mode wording. Editor mode asks
  them to check their page; division mode asks for changes together or an
  all-good reply. Use the local outbox only in the verification process.
- **Optional sections:** chapter paragraph, social links (optionally leading),
  this year's events, board, photos and member login. Shared parts remain locked.
  Board display is everyone or first eight, followed by **Show all N board
  members**. Hidden/empty optional parts do not leave empty space for visitors.

Demo setups use the approved Peoria, North Texas, Indianapolis, Detroit,
Boston, `[A rebuilding chapter]` and a new Maryland draft. Their modes and
visibility demonstrate configuration, not unverified real-world chapter status.
Use neutral placeholders, invented labelled sample people and approved public
copy; use approved public sources for every product artifact.

Not added: word-count meter, editor-guidelines text, donation source codes,
offline saving, an admin pin map, automatic form replies, analytics settings
or an in-product page-by-page sameness report. SAWSO is outside this step.

### 16.9 SAWSO (addition 9, approved October 29)


Each sits on existing pieces (lists, section visibility, releases, comments, redirects, page scope). The feed, data values and show-until dates are already in SPEC §8 (DY-1 to DY-3).

- **Stories list fields:** title, summary (up to 200 characters, used on cards and in search), lead photo with focus point and required description, story text (headings, lists, links, quotes), sectors (several), region, countries, published date, an optional show-until date, and the old address when imported. A site admin or editor uses Add story in Stories to create a private record and its page together, chooses a ready Media photo, and edits it in the story editor. A newly written story has no old address; its initial body is labelled sample text until replaced. Each story gets a page from one story template, with "more stories" from its first sector.
- **Stories section rules:** stories come only from tags (no hand-picking). Show up to 3, 6 or 9; 3 per row on computers; on phones the first 3, then "More stories". With fewer stories, show what there is. With none, show a line or hide the section. Leave after 13 months (site default); stories stay in the newsroom.
- **Newsroom page:** every story, newest first, with sector and region filters as links (works without JavaScript) and "Older stories" paging.
- **Comment-only reviewers:** a page-scoped Contributor who can see and comment on the pages they're asked to review, plus a "Done reviewing" button that tells the web team. It reuses email-link sign-in and page scope.
- **Moving in (temporary site view):** where each old page goes, the story text still to copy, the redirect list (§4) and the switch-over steps. It disappears after switch-over.
- **Numbers hidden until checked:** a Stats section can stay hidden while any data value it uses is marked "Needs checking".

Release implementation boundary: local Stories-list sources only; evaluate the
13-month cutoff at publication. Scheduled refresh and external feed sync follow
later. The demo body placeholders are explicitly sample content, not copied
story text. Newsroom filters and pagination use ordinary links. Sector pages
below 1024 px show three cards and a More stories link. Family Care has approved
text and no stories section until tagged stories exist.

Comment-only reviewers, Moving in, data-value binding and the overview launch
plan remain subsequent roadmap work. No automatic feed synchronization is
claimed for this demo.

## Appendix A — Editing requirements → implementation

| # | Requirement | Fix |
| --- | --- | --- |
| 1 | Sites → Open → no Back button; breadcrumb is weak | §4.1 PageHeader with Back + breadcrumb (SH-2) |
| 2 | Publish tags may be wrong for each page | §4.3 StatusPill rules (SH-3) |
| 3 | Fictional content on web.app | §11.2 BT2027 showcase replaces fictional demo (MG-2) |
| 4 | Red dot on changed field | Kept; adds per-field revert (§5.8) |
| 5 | "Editor label" is confusing | Renamed "Section name", moved to Advanced, auto-named (§5.4) |
| 6 | "Private" tag overlaps the input border | §10.3 layout rule; component Field (SH-1) |
| 7 | Hide/"Publish to apply" states need polish | §5.9 (ED-9) |
| 8 | Change layout panel cramped; "Use layout" overflows | §5.7, §6.5 responsive grid (ED-7, LB-4) |
| 9 | Site starter layout fails at tablet/phone widths | Core library replaces starters (§6.1–6.3, LB-1/2) |
| 10 | Program listing not mobile-first | Schedule section as day list on phones (§6.2, ED-12) |
| 11 | Speaker cards giant, long scroll | Compact speaker cards; bio behind "Read bio" (§5.12, §6.3) |
| 12 | V1 library was the key; SPEC needs rewriting | This revision; §6 |
| 13 | "Use layout" offered then refused (collection binding) | Impossible options not offered (§5.7) |
| 14 | Position Up/Down labels confusing | "Move section up/down" icon buttons (§5.5) |
| 15 | Library layout is inconsistent; right panel cannot be widened | §5.1 resizable panels; §6.5 library (ED-1, LB-4) |
| 16 | Preview shows title/body, then the site footer, a line, a big empty block | Section-only preview (§6.5) |
| 17 | Inserted text block is empty until typed | No empty inserts; sample content (§5.6, §6.4) |
| 18 | Sections should be as well planned as V1's | Quality bar (§6.3) |
| 19 | Link/inspector panel needs more room | Resizable inspector (§5.1) |
| 20 | All section buttons look the same; Add a section is uninviting | Action hierarchy (§5.5); insertion lines (§5.3) |
| 21 | Undo my changes removed more than the duplicate; duplicates top-bar undo | One undo history; remove the button (§5.8) |
| 22 | Section appearance: "Definition default", widths in rem, background buried; no custom CSS/HTML found | Style tab with plain controls first; Advanced tab holds CSS/HTML (§5.4) |
| 23 | Unnecessary controls confuse | Principle 5; capability flags (§3, §6.3) |
| 24 | Page-level Add section adds at the end without saying so | Explicit destination (§5.6) |
| 25 | Visit the site works | Kept |
| 26 | Content overwhelming (schema, design fields, CSV tools…) | Lists workspace (§7.3) |
| 27 | Should have used the real BT2027 code | §11.1–11.2 |
| 28 | Support Echelon, SAWSO and national-style sites | §2, §11.3–11.4, §10.5 |
| 29 | V1's editing layout felt better | V1 layout kept, hierarchy and room added (§5) |
| 30 | No way back to Sites from Content; giant Collapse button | §4.1 (SH-2) |
| 31 | Media overwhelming; Content vs Media confusing | §7.4; Lists vs Media named by task (§4.2) |
| 32 | Design granularity vs in-context editing | Site look owns defaults; page editor overrides in context (§7.5, §5.4) |
| 33 | Navigation preview is mock content, not the site | Menu edited on the real header (§5.11, §7.5) |
| 34 | Section library page; Request custom box spacing | §6.5, §7.8, §10.3 |
| 35 | Publishing overwhelming; overlapping text and buttons | §7.6; §10.3 |
| 36 | Settings spacing inconsistent | §7.7 (WS-7) |
| 37 | A new user would need help adding a speaker | §5.10, §7.3, §14 test |

## Appendix B — Platform requirements → where addressed

| # | Requirement | Where |
| --- | --- | --- |
| J1 | Move off InMotion before Feb 1; Firebase in the NCRD project; cost estimate; preserve CMS capabilities within the hosting budget | §2, §12.2–12.4 |
| J2 | HNI commissioned from the CMS | §11.5 |
| J3 | SAWSO: Symphony going away; standalone with Zesty UX; evergreen + story embeds by tag; 13-month expiry; stats from JSON | §8.1–8.3, §11.4, §10.5 |
| J4 | Echelon: one-page chapters, roster, stories, join form; volunteers edit their own page; blocks not HTML | §6.6, §9.2, §11.3 |
| J5 | Site-scoped roles; content creator vs editor; Microsoft SSO with groups | §9.1–9.4 |
| J6 | CMS as a master utility hub | §9.5 |
| J7 | Shared modules with each site's CSS; admins add/edit modules; placeholders that explain themselves; editable icons | §6 |
| J8 | Solid event template; editors manage speakers and schedules; hide until ready; reuse next year | §6.6, §5.9–5.10 |
| J9 | Global elements clearly site-wide | §5.11 |
| J10 | WordPress-style menu editor | §7.5 |
| J11 | Basic SEO and a "this page needs…" helper | §5.13 |
| J12 | No per-device editing; fluid responsiveness | §5.12 |
| J13 | Bootstrap 5 + national stylesheet; consistent sections; implied lines | §6.3, §10.5 |
| J14 | Documentation so others can run it after handover | §12.5 |
| J15 | Excel Events CSV templates for BT2027 speakers/workshops | §8.4 |

## Appendix C — Words for the interface

| Use | Not |
| --- | --- |
| page, section, list, item, picture, document, site look, menu, header, footer | schema, definition, instance, collection, token, slug, revision, record key |
| Live · Draft · Live · changes not published · Scheduled · In review · Hidden · Archived | Published (when changes are pending), Schema live, Saved content matches live |
| Default | Definition default, As designed (V1) |
| Narrow · Standard · Wide · Full | 42rem / 60rem / 72rem |
| Hide until ready | Shown when published / Hide |
| Section name (only editors see this) | Editor label · Private |
| Description for people who can't see the picture | alt text, assistive technology |

## Appendix D — Reference images

- V1 (the maintainer’s preferred editing experience): `docs/ui-reference/v1-cms-2026-10-02/images/` (28 captures; index in `docs/ui-reference/v1-cms-2026-10-02.md`).
- V2 as of October 25, 2026 (the "before" state for this revision): `docs/design/current-v2-2026-10-25/`.
- Approved mockups: `docs/design/approved/`. They are optional; the maintainer adds one when a built screen should look different.

### Editor publish confirmation
The editor’s Publish button opens a compact review dialog with the page name, available section-change summary and Cancel / Publish. No publication occurs before confirmation. Existing sample consent, readiness and permission checks then run unchanged.

### New page chooser
Name and address precede A template / Copy of a page / Blank page. Existing SAWSO Home, Ways We Help, Health and Annual Reports designs are offered only when those pages exist; they use the existing duplicate and page-details commands together in one transaction, keep the chosen name/address and open a private draft. No menu or parent controls are added. The optional starting outline is collapsed until requested.

Pages presents the existing All pages / Live / Changes not published / Draft statuses as filter pills, with compact rows and actions kept together.

### Global domain inventory
Super Admins can open Domains for a read-only list of existing site addresses and stored connection states. Each row opens the existing site settings. The inventory performs no provider checks or mutations and adds no domain-management permission. Other roles keep their existing site-level access.


## 17. Round 3: national template and clean editing (October 30)

Source precedence: approved national look, approved
copy, then accessibility that preserves the look. Security, authorization and
Postgres row isolation always apply. Visible differences in spacing, type,
layout or wording from row 10 are Major unless recorded with a reason.

### 17.1 Sources and boundaries

Read the maintainer’s `cms-v2-ui-direction/README.md`, `screenshots/INDEX.md` row 10,
and the exact markup, spacing and words in MasterTemplate, HeaderMenu,
PagesSorted, FontLibrary, StoriesHub, TagManager, StoryAdd, PublishChoices,
HeroSlides, EditorClean, PublicRules, EchelonTemplate, RoleViews, Environments
and Handbook under `mockup-src/`. Row 10 wins over older drawings.

The only Stories reference is `/ABSOLUTE/APPROVED/stories-tool/`:
README, admin-ui.html, lib.php, embed.js, worldmap-data.js and taxonomy.json.
Port its behavior, suggestions and map into existing CMS commands, storage,
sign-in and permissions; never execute the PHP or copy its authentication or
JSON file store. No embed-code authoring UI.

Theme sources are `cms-v2-demo-sprint/national-theme.md` and
`cms-v2-ui-direction/sawso-hifi/reference/jon-zesty-preview.css`. A one-time,
read-only fetch of the public Zesty theme files named there is authorized;
retain local references with URL, digest and unresolved license under Needs
maintainer. This overrides the older no-fetch/no-local-copy restriction for those
files only. No font download or bundling.

Local only, $0: no cloud commands, deployment, DNS, live changes, Microsoft
sign-in, staging-setup-folder changes or real email. Do not change `deploy/`
for a real project. Never reset the retained demo. Dump before data changes.
Use only approved public content in product text, seeds and documentation;
bracketed placeholders stay placeholders.

### 17.2 One parent template (R3-1)

SAWSO and Echelon use one national parent template, replacing separate presets.
Sites configure logo, menu, footer text, content, tags and an approved heading
font. The per-site permission to change colours exists and is off for both.
Shared sections belong to the template. Review a template update and apply it
to selected sites as drafts, without changing their public versions. Start a
private site from a site copy or saved template set, with words and stories
independently optional. Reuse the existing library, archive and release model.

Rebuild the national skin from the approved CSS and public theme sources,
including behavior. Enforce white containers around all content other than
section titles on grey, including Annual Reports, Financial Accountability,
Meet Our Team and pages created from templates. Imported sites keep their
original skins and remain frozen.

### 17.3 Fonts (R3-2)

Connect Adobe kit `https://use.typekit.net/euh2hvn.css` through FontLibrary.
SAWSO headings use `trajan-pro-3, serif`; body uses `proxima-nova` with existing
stand-ins as fallback. Echelon headings remain sans-serif. Narrowly allow only
the necessary Adobe stylesheet/font origins in CSP, without weakening other
sites' policies. Load kits only at approved domains. Show address-not-allowed
and list required domain additions under Needs administrator input when local addresses
are not authorized. Adobe font bytes must not be vendored.

Implementation contract: Fonts reports only the staging address actually checked;
future live addresses say Check at launch. The failure state distinguishes
unavailable loading from proof that an address is licensed. The fixed kit has
four families; Echelon retains its supplied sans. The public preview CSS controls
button weight, so the Fonts screen uses the body family and template weight
rather than promising a separate semibold setting. Save remains a draft and
Publish goes through the existing saved-change review.

### 17.4 Public behavior (R3-3)

HeroSlides is a repeatable slide list: add, cancel, remove, reorder, enabled,
optional start/end dates, chevrons and dots. Preserve the three current SAWSO
slides word for word. Automatic advance pauses on hover and keyboard focus,
and honors reduced motion. Without JavaScript show the first slide and keep
other slides reachable. PublicRules defines fixed hover/focus outlines on
service tiles; editors do not choose that style.

Hero contract clarification: the public carousel advances every six seconds.
The round Next slide button uses an icon-set open chevron, bottom right beside
the dots in their pill. Stable section-scoped anchors replace the former fixed
feature-1/2/3 IDs. One visible slide hides its controls. The start date begins at
midnight in the displayed time zone; the end date is included. Windows are
checked when loading the page. An unfinished enabled slide cannot pass the
shared publication checks. The existing approved preview-CSS dimensions and
white pill placement remains. Dots and the next chevron support keyboard use.
The editor stays on the selected slide and shows a slide list followed by one
slide’s fields, never the old flat numbered fields. Add/remove/reorder/off have
no fixed limit in normal use, within the established content-size safeguards.
The exact hero correction advances the parent to version3: one icon-set next
chevron, immediate stationary editing and one navigation row per slide. It
removes the special12-slide ceiling, retaining the existing48-item repeat and
content-size safety bounds. Manual canvas navigation also selects that slide’s
fields. These implementation checks do not replace numbered app acceptance.

### 17.5 Site-level header, menu and footer (R3-4)

Site admins and Super admins reach Header & menu and Footer from the site
menu. Extend existing navigation/global-element commands. Support two-level
drag reorder/nesting, page/website/dropdown items, per-site logo with required
description, header buttons including Donate destination and tracking code,
and footer text, links and logo.

Dropdown groups are native disclosures without a destination, with at least
one child link. Ordinary parent links retain their destinations. Button
tracking is stored separately as query parameters, merged into the destination
without losing its existing query or fragment. The optional second button
is absent until enabled. Header buttons use Label, Goes to and Tracking code.
Goes to offers A page, A website, Email and Phone through the shared destination
fields. Page choices are published pages on this site. Existing website rules
remain internal paths or credential-free HTTPS; email/phone use only their
non-executing contact schemes. The authorized header save validates these
button destinations too. Phone input removes visual spaces. Tracking remains
stored separately and applies only to page/website links; switching to contact
links preserves the code for later use without appending it to mail or phone. A national frame upgrade adds the approved initial
logo only where the old design had no logo field; existing choices survive.

Remove these controls from page details and canvas editing. Details only says
where the page appears in the menu; clicking a canvas header/footer offers a
link to its site screen. New page retains Add to the menu when it's published
through the same navigation commands. Page settings cannot change the shell.

The dedicated Header & menu screen is `/sites/:siteId/header`, available only
to Site admins and Super admins. Separate-area saves reuse the global-element
command with an explicit changed-area mode: an unchanged footer keeps its
version and draft pointer. Existing combined callers retain their paired-save
contract. Both modes retain validation, head locks, strict conflicts and audit.
Header forms reuse compact Card fields,pill destination/add choices and shared
status/type chips. Stacked headings put scope text below the whole toolbar;
button-card headings align with their switches. Menu labels/destinations stay
on one line with full-value hover,and tracking help follows its field.

The dedicated Footer screen is `/sites/:siteId/footer`, with a real private
preview and Logo and name, Text and Links cards. An opted-in national footer
uses the header logo unless its own logo is chosen; its pinned fallback remains
the approved shield. A custom image needs a description. Rendering and database
media-reference checks resolve the same inherited image, including when the
header landmark is off. Public delivery uses only the published header choice;
draft/history references retain the existing ownership and readiness checks.

Footer cards use shared compact fields and disclosures,with a styled Social
accounts link. The dedicated preset Footer also uses Logo and name,Text and
Links cards,keeping its layout,visibility,contact,grouped and legal fields under
shared disclosures without converting its stored design. Each sortable row keeps one Actions menu and a single-line
full-hover label;Add/Edit uses the same compact destination choice pills.
Footer links are edited as a compact sortable list using the existing rich-text
link storage. Cancel/Escape restores the complete pre-addition draft. Unknown
formatting stays in a visual rich-text field rather than losing words or links.
Plain mission paragraphs use a plain text field; address and legal fields remain
under More footer text. Footer saves preserve the header/menu/page heads and
reuse the changed-area command and strict header/footer conflicts. Imported
sites keep their existing combined flow. Native Site look is appearance-only. It previews the saved header/footer/menu
without mounting a hidden shared-area editor. Site admins have links to the
dedicated Header & menu and Footer screens. Its legacy page-frame save action
rejects native sites before opening a write transaction; original-design sites
retain their combined Menu & footer path. Template-owned page layout cannot be
switched to a different skin in appearance controls. Publishing readiness uses
the database's existing, exact national red/white reference exception; it does
not describe that pair as passing AA or exempt other contrast failures.
Shared sidebar grouping, the remaining Colours/Buttons structure, role-specific
appearance visibility and the three-choice leave guard remain separate work.

### 17.6 Stories for any site (R3-5)

The approved Stories tool keeps its existing look and way of working wherever
practical, fitted into shared CMS components. The required list below comes
from `cms-v2-demo-sprint/stories-tool/MUST-HAVE.md`; only heading levels are
adapted. Every required item is an acceptance-walk check. Any unfinished item
must be named under Needs administrator input; Stories cannot be reported done without it.

The Stories catalog belongs to each site's existing versioned list model.
It has main and secondary tag group names, stable tag IDs, labels, ordering,
keyword suggestions, secondary-tag map areas and the publish-unreviewed policy
(on by default). Renaming keeps IDs; deleting offers move or remove for stories
and does not silently retarget page filters. A story may have multiple tags in
either group; old single-region records remain readable. Filters use OR within
each group and AND between groups; an empty group means any. Keywords match
whole words or phrases in the title and description. Re-suggest leaves reviewed
stories alone. Catalog changes are private drafts until the normal reviewed
release; chip saves are immediate draft saves and mark the story reviewed.
Existing list permissions, immutable versions and conflict checks apply.
Manage tags is reached from Stories and is visible only to Site admins and
Super admins. Its two compact catalogs show labels, stable IDs, keyword summaries
and actual story counts. Add/Rename edit the full keyword list; secondary tags
also choose approved world-map areas. Drag or keyboard reordering changes the
catalog order. Delete explicitly offers move to another tag in the same group
or just remove it. Re-suggest requires a review confirmation and preserves
reviewed stories. Article text, photos and source addresses stay intact.

TagManager uses one shared Actions menu per row for Rename and Delete,beside
the existing reorder grip. Names and IDs stay on one line with full-value hover;
keyword previews also retain their full value on hover. Region-area checkboxes
use the same shared choice style as the list. Delete uses the shared choice
cards for move/remove,with a separate page-filter warning and destructive button.

The catalog foundation alone does not complete any Stories screen or required
acceptance item. The required list below remains the completion contract.

The Stories list follows StoriesHub/SymStories with aligned tag-group labels,
shared tag and checkbox controls,one Edit story navigation action per row and
a single-line title at1440 with its full title on hover. At1024 the photo/action
columns narrow and tag labels sit above their chips,keeping every tag available.
The explicit source check remains a Site-admin capability in the header.

The Stories list uses photo/content/tag rows from StoriesHub, with an immediate
draft save for each tag, Reviewed or Hide from feeds change. Tag clicks mark the
story reviewed. Search covers title and description; status and both tag-group
filters combine and show the result count. Missing tags are a valid draft state;
unknown assigned IDs are refused. Queued intentions apply in order with current
catalog/list conflict checks. Failed choices remain available to Retry or Discard,
including when reloading loses its connection. Full article text and source-image
URLs are excluded from list summaries and mutation inputs.

Automatic public story feeds use published hide/source/review-policy flags.
Private previews use draft flags. A hidden story's own article remains reachable
through its manual binding. Other list readers keep their existing selection
rules. New starters include the configured model; legacy adoption is an explicit,
backed-up draft update through normal Site-admin commands.

The shared feed-choice contract supports several main and secondary tag IDs:
a story must match at least one chosen ID in each nonempty group. Empty groups
allow any. The same rule applies to private draft previews and published choices,
with existing visibility/review policy, bounds and permissions. Other list
readers reject the Stories-only setting. Old single-tag and manual article
choices remain readable. Catalog renames keep IDs; an absent/deleted filter ID
matches no story unless retained story data still carries that exact ID.
The shared public grid follows the approved tool’s count-based full-row
preference (four, then three), centered last row and half-width lone card. At
narrower widths it reduces to three, two and one columns without hiding selected
stories. Filtering and paging precede its count. Frozen imported sections do not
opt in.

The native Stories section panel uses site-owned main and secondary tag chips,
with OR within each group and AND across groups. Empty allows any; unavailable
saved IDs stay selected until removed. It preserves the excluded article and any
separately authored earlier intersection. Choices load through the existing
identity-scoped collection endpoint; only tag IDs/labels travel in its new catalog
property, never keywords or article bodies. Loading, retry and no-library states
keep the saved selection. Maximum stories is 1–200, with the SAWSO sector-page
control capped at6. Heading remains its own content field. Archive link (optional)
uses the existing Change dialog, with one value shared by desktop and phone;
the duplicate More stories field is hidden on the native section panel. Clearing
the archive destination removes both links.

Stories list Preview opens a separate authenticated full-page view. It carries
search, status and both tag filters; uses saved drafts, current review policy,
13-month/future-date rules and the shared actual Story cards/site shell. The
private explanation distinguishes matching list records from feed-eligible ones.
It pages 24 cards at a time without JavaScript. Card/tag links open owned draft
previews, and Back to Stories preserves the filters. It sends private/no-store,
noindex and the existing scriptless preview policy, contains only card fields
(no full article bodies), and writes no content. Queued/failed tag saves must be
resolved before Preview opens. Live filtering continues to use published policy
while a draft review-policy change waits for publication.

The manual source check uses only the approved fixed SAWSO feed URL and must be
button-triggered. Its parser decodes form-encoded JSON once, preserves literal
plus signs in text, normalizes image-key spaces, applies published/menu gates
and stable source order, and rejects malformed/duplicate/unsafe data atomically.
The merge compares each current field with its last source baseline: only text
still following the source advances. The first check uses the approved CMS
import snapshot as its baseline, never the current draft. Body, chosen photo,
photo description, tags, reviewed/hidden state and CMS article address stay kept.
Vanished source stories are marked out of feeds, not deleted; CMS-authored and
human-archived stories are preserved. Only new stories receive keyword suggestions
and Needs review, with no sample item/photo/body inserted. New article paths avoid
existing pages. This pure parser/merge foundation is verified separately; button,
network orchestration, persisted check status and transaction integration remain
required before the manual-check item can pass. No live feed read is used during
foundation verification.

Automatic Story feeds use the story date and a fixed13-month window on UTC
calendar days. Future dates wait for their day. The renderer rechecks the window
on every response before Newsroom paging; cached clients revalidate against the
changed HTML. Expired feed rows never become definition samples. An older story's
manual article page remains available. Live list/filter counts use the same
published-date window; a published row outside feeds says Not in feeds. Use
Schedule to keep the whole story private until its release time. Other readers
retain their existing date choices. The status filter is wide enough for its full
Missing sector or region label at1440 and1024.

Overview follows the same Stories header and role gate. It keeps catalog order
and zero-count tags, current/draft and live/published counts, linked story titles,
configured page links and untagged stories at the bottom. Current coverage uses
the13-month age rule and excludes future dates; published counts use published
values/policy. Leaving soon covers30 days. Missing tags link to the list filter.
Stories remains the main-list tab name; Leaving soon opens its cutoff details.
These are saved-data summaries, not a claim that automatic feed aging is complete.

Site admins can turn on an empty Stories library from site Settings, with their
own main and secondary group names. Setup is idempotent and copies no content,
tags or feed connection. Include unreviewed stories in feeds defaults on and can
be changed in Settings as a draft; public feeds use the published policy.

#### Stories: required behavior in the CMS

The Stories tool in this folder must become part of the CMS, as close as possible to how it works and looks today. People already use it and like it. Every item below is required unless marked otherwise. Test each one in the acceptance walk.

##### Stories list
- One row per story: photo, title, description, date, status.
- Click a tag chip to turn it on or off, in the list, without opening the story. It saves at once and marks the story reviewed.
- Reviewed checkbox. Hide from feeds checkbox (keeps the story, removes it from every page and feed).
- Search titles and descriptions.
- Filters: All, Needs review, Missing a sector or region, Live, Hidden, No longer in the feed. Plus sector and region filters and a count.
- Status line: how many are live, how many need review, and when the feed was last checked.
- Preview opens a full-page preview using the filters selected in the list.
- Edit story opens the CMS story editor. Add story creates a new one.

##### Getting stories in
- "Check for new stories" reads the public feed.
- New stories get suggested tags from keywords and are marked Needs review.
- A story that leaves the feed is marked "No longer in the feed" and stops appearing on pages. It isn't deleted.
- A check never overwrites tags or reviewed status. It also never overwrites text someone edited in the CMS.
- A site setting decides whether unreviewed stories appear on pages right away (default) or only after review.
- Stories written in the CMS use the same tags and behave the same way.

##### Overview
- Every sector, with how many current stories carry it and how many are live.
- Click a sector to see its story titles, linked to each story.
- Stories with no sector are grouped at the bottom.
- A sector with no stories stays visible, so gaps are obvious.

##### Manage tags
- Two sets: Project Sectors and Regions on SAWSO. Other sites use the same two levels, as main and secondary tags, under their own names.
- Add, rename and delete. Renaming keeps the id, so pages keep working.
- Keywords per tag, for suggestions. "Re-suggest tags for unreviewed stories."
- Map area per region.
- Available to every site, not only SAWSO.

##### Stories on pages
- Sector pages and any other page show stories by tag automatically, with no code to paste.
- A story needs at least one chosen sector and at least one chosen region; an empty group allows any.
- A story shows on every sector it's tagged with.
- Settings: sectors, regions, heading, maximum stories, optional archive link.
- Grid: 1 story is a centered half-width card, 2 are halves, 3 are thirds, 4 or more fill rows of 4 or 3, preferring full rows, with a centered last row. Fixed columns are optional.
- Several story sections can be on one page.
- Keep the agreed SAWSO rules: up to 6 on sector pages, 13 months in feeds. These replace the tool's defaults on those pages.

##### World View
- A section for any page: a clickable map, with visitors choosing a region and seeing "Our Stories from [region]" beneath it.
- Pins show story counts per region. Regions with no live stories stay grey.
- Settings: heading, region shown on open, stories per region, limit to chosen sectors.
- Pins are by region, not by country.

##### Split View
- A full news page section: heading, introduction, then a switcher with Recently Published, By Project Sector and By Map.
- Settings: heading, introduction, view shown first, stories per "Show more".
- Recently Published has Show more and shows the sector and region pills.
- By Project Sector shows a tile per sector with its count, then that sector's stories.
- Links can open a chosen view directly.
- Use this for the SAWSO Newsroom.
- Keep the original's animation, and respect reduced motion.

##### Not needed in the CMS
- "Get embed code", "Copy code" and embed scripts, because pages use sections instead.
- The tool's own sign-in and JSON file storage.
- A public JSON address, unless another system needs one. List it under Needs administrator input.

##### Ideas, not required now
- Hiding stories over two years old (the 13-month rule covers this for now).
- Country-level pins or project data.
- Automatic scheduled refresh: only the manual check is required for now.

Round 3 also retains the maintainer-required tag reorder and stable-ID rename,
delete with move-or-remove choice, optional campaigns as ordinary tags,
Overview gaps/leaving-soon/missing-tag summaries, and Coming up calendar with
ready/no-date stories draggable onto a day. Add story uses the shared photo
picker with upload, required description and Where it will show. World View
uses the approved map data; Split View and map remain plain links/lists without
JavaScript. This does not permit a stories option on Echelon chapter pages.

**Public-read exception:** Check for new stories is the one allowed read of
SAWSO's public stories feed and runs only when a user presses that button.
No startup fetch, scheduled refresh, background polling or general live-site
fetch is authorized. CMS-authored stories use the same tags and rules.
A manual check has a persisted request ID and a short exclusive lease per library.
Retries reuse the saved result and never start the same read again. Source
baselines are site-owned and visible only to Site admins; check status is visible
to site members. The merge, normal draft commands and successful check result
commit together. Failed or expired checks keep saved stories and public heads.
The journal and authenticated same-origin orchestration are implemented. The
server permits one bounded, non-redirecting request to the fixed feed only after
an authorized request lease starts, with no cached/background reads. A narrow
command locks the latest saved collection; ordinary entry/page commands create
private drafts. Synthetic checks cover CMS edits made during the read, failures
and retries. The list exposes Check for new stories only to Site admins with the approved
source configured. Status shows last success, progress, errors and counts; a lost
response retries the same request ID. Quick tags and Preview pause during a
check, without replacing the list controls. New stories link to Needs review.
Both admin widths are checked with synthetic data; the single final acceptance
walk and approved public-feed read remain required.

Shared Story widgets use an optional, closed catalog snapshot in the resolved
Story binding: main/secondary group names, stable tag IDs/labels and approved
region areas and the fixed SAWSO sector display limit only. Never include keywords, source configuration or review policy.
Public output pins the published catalog; explicit draft previews pin the draft
catalog. Other readers and old envelopes retain their shape and behavior. Catalog
changes still require normal reviewed publication. The catalog foundation and World View library section are locally verified.
The World View hub is implemented separately below. Split View remains required.

World View and Split View add two global definitions (40 total, preserving the original24 P0
sections and every existing page pin). It is one shared library section with heading, region shown on open,
chosen main tags and stories per region. SAWSO sector pages cap the visible
cards at6 even for All; the catalog pins this fixed display rule without exposing
the source connection. Private previews use the content page path for this rule. It uses the supplied Natural Earth map
geometry, site-owned region areas and saved Story bindings. Regions with no
eligible stories stay grey; counts are by region, not country. Map regions and
plain region links lead to server-rendered cards without JavaScript. A fixed,
code-owned enhancement may update only its same-origin section, preserve the
URL, show loading/retry and respect reduced motion. Several widgets keep separate
query state. The page editor uses a region picker and ordinary content controls;
no embed/code field. The hub's World View screen uses this same renderer and
settings. Its private, scriptless preview keeps the site skin without the site
header/footer, supports ordinary region/story links and offers Back to map
preview. Choices are stored in the current address; changing them does not write
content. Add to a page opens searchable choices for Site admins only, excluding
Story articles and chapter pages. Cancel/Escape create nothing. Add as draft
appends one configured section through the normal optimistic save, preserving
existing page content/meta and published heads. A same-choice retry of exactly
that saved head returns the existing addition; unrelated head changes conflict.
No source feed is read. Split/Coming up tabs arrive with their working screens.

Split View is one shared section with heading, introduction, view shown first
and stories per Show more. The server renders Recently Published, By this site's
main tag and By Map, with scoped direct links and scriptless fallbacks. Recently
Published grows by the chosen step and offers remembered main/secondary pill
switches when enhanced. Sector tiles count eligible stories, omit zeroes and lead
to that tag's cards; Map reuses the approved World geometry and region data.
Pinned SAWSO sector pages keep the six-card display cap; source counts remain
complete within the existing200-record binding bound. No separate page code or
embed field. Native editor settings use this site's tag name for the view choice.

The fixed same-origin runtime preserves approved transition timing with native
browser animation: old view fade/lift, eased stage height, incoming fade/rise,
sliding tab underline and staggered cards/tiles. Reduced motion finishes active
animation and disables new motion; keyboard tabs and Show more keep useful focus.
Failures preserve current cards and offer retry or a normal link. Public response
fetches never read a source feed. The Split View hub reuses this renderer and owned card projection. Its four
settings stay in the address and create no content until confirmed. A bounded,
scrollable desktop preview matches the approved frame; Preview opens a larger
cancellable dialog with Done and a return from nested stories. Site admins use
the shared searchable page choice and exact-head private draft append, preserving
all previous content/meta/published pointers and safe same-head retries. Other
roles see only the preview/settings and a short Site-admin note. Reviewed SAWSO
Newsroom adoption uses the same single Split section and exact approved heading/
introduction, preserving its page identity, metadata and menu position. It remains
private until the page and saved tag catalog pass the normal review. Existing
sector/region/view links choose the corresponding view; earlier combined filters
and text searches keep matching cards with a plain active-filter notice and Show
all stories. Old page numbers expand the corresponding Show more step. Original
#stories view bookmarks normalize to scoped query links without extra history.
New setup uses Split View for Newsroom; Home keeps its existing section. Earlier
phone-feed test expectations update to the required complete-card behavior.

### 17.7 Saving and publishing (R3-6)

Page and story editors place Save draft, Schedule and Publish together. Every
Publish first reviews plain-language changes generated from saved differences;
the Publishing Ready list uses the same summary. Reuse scheduling and release
commands. Only offer end/change-back dates if the existing engine supports
them; otherwise record the limitation. Leaving unsaved work offers Keep
editing, Save draft and leave, Discard. Cover every writing surface. Verify
local demo release completion and show progress for releases taking a minute.

### 17.8 Editor and roles (R3-7)

Follow EditorClean: consistent Back/Done, Cancel/Escape, nested card flow,
shared panel/list/spacing components, remembered wider panels and searchable
icons with recently used. Add/cancel never leaves an empty or sample item;
new content previews while typing. Selection controls cannot cover the header
or toolbar. PagesSorted uses compact rows, sector groups and excludes stories;
search still finds stories and routes into Stories.

Selection never changes any card section’s public layout. What We Do keeps its
five tiles in one row at the same canvas width; Add card belongs in the panel,
never as a layout-changing tile. Plus/selection controls cannot cover content
such as Ways We Help. Keep the left page list and click-to-jump, with sections
collapsed initially and expanded one at a time to show fields. Clicking a title
edits that section’s title with its outline retained. Link behavior, including
new tab and nofollow, opens behind Change. Preserve the link panel’s page,
website, email and phone choices; focus point and Card/Phone/Wide previews;
site-wide page-count note; section move buttons; and Material Symbols names.
Native top-level heading/title selection opens Section title with Title, its
section relationship and the adjacent link summary. Back returns to that
section's content; Done returns to This page. The section stays outlined while
its title changes. A newly added section opens its complete content panel rather
than entering the title-only step automatically. Sample/revert indicators remain.
Native links use the shared Change dialog with four explicit destination choices,
new tab and nofollow. Values preview immediately; Cancel, close and Escape restore
the pre-edit field, including absence and its sample marker, without discarding
unrelated work. Existing link object properties stay intact. Button appearance
is behind Advanced for roles already allowed Advanced, hidden from Editors.
Original-design link editing remains compatible. These native Title/Change labels
supersede the older flat Heading/address panel assertions for selected titles.

Clicking either frame changes no field. It retains the Header/Footer: on all N
pages note and offers Open Header & menu. No inline menu additions, labels,
identity fields or Edit header field editing remains in the native page editor.
Returning preserves the current page edits.
Native frame handoffs open the matching Header & menu or Footer screen in a
new tab, leaving the page’s current editing session intact. The Footer link is
named Open Footer because it has its own approved site screen. Roles without
site-admin access receive the shared-scope note without a site-screen link.
Page details sends an explicit preserve-menu value. The database rejects an
explicit native membership change through that command and preserves existing
automatic menu labels when a native page rename is published. Original-design
page-details/menu behavior stays compatible; first-publication additions and
unavailable-page removals keep the existing engine.
 Compare What We Do before and after
selection with screenshots in the numbered acceptance ledger.

Native canvas layout policy is display-only and validated in the isolated
preview protocol. It adds no children to a card/list grid when selected, and
keeps section actions outside content. Add card remains in the panel. Brought-in
sites keep their existing controls while frozen. Native cards open one item at
a time with Back/Done and Cancel for a new item; they start empty, preview as
typed, and cancel all newly composed fields/sample markers. Untouched items are
removed when changing selection by stable section origin; typed work remains a
draft. Existing fields, image focus/crops, icon choices, section moves and write
commands remain. A display flag cannot grant command permissions.

Native page navigation stays alongside the page at 1440/1024, begins collapsed
and opens one section at a time. Search/Changed only may reveal matching rows.
Each manual card has one navigation row retaining all original member fields
for search, selection and change markers. Selected rows keep move/visibility
actions; original-design sites retain their previous controls. Native panel
widths remember the preference but are bounded to leave the rail and a visible
preview at the current window size. Outer native workspace panels clip instead
of scrolling when a selected iframe field comes into view.


Apply RoleViews as a **draft for review**, never relaxing database permissions.
Editor sees content and tasks, not spacing, code, section management or site
settings. Contributor and scoped page editor see only their allowed work and
Send for approval. Super admin retains capabilities behind tabs. Hide controls
that cannot be used; use a one-line note only when it explains a necessary
restriction. Publish is the only red button; one primary action per screen.
All empty/loading/error/conflict/no-access states explain the next action.
Native content-only roles see fields directly, without a one-option Content
tab. Admin grouped tabs and imported-site interfaces remain. Scoped chapter
volunteers submit for approval; division staff keep their existing chapter
approval capability.

### 17.9 Echelon templates (R3-8)

Use `cms-v2-ui-direction/echelon-reference/README.md`, template-review.md,
chapter/national markup, CSS, captures, text and assets. These replace drawn
EchelonSite pages. Chapter wording is exact from chapter-text.txt. National
wording is national-text.txt with only the exact template-review replacements.
No second banner or reference-site header/footer/QA buttons.

Preserve the navy split hero and visible Echelon logo; highlight bars on jump
links; three pillars Service/Fellowship/Fundraising; national leadership/form
and no national events; chapter events, named Membership Chair contact and a
long board with faces. Chapters have no stories section or option to add one.
Shared section applicability is national/chapter/both; no page-specific code.
Keep chapter setup, access, invitations and January/July reviews working. Record
the editing map as draft. Import reference assets once through Echelon Media,
with focus points and descriptions; do not borrow SAWSO photos. Keep sample,
borrowed and placeholder assets labelled. Use sans-serif headings and list
unavailable licensed fonts. Dump before resolving the 26 unpublished demo
changes: publish approved work through normal releases, discard test work.

### 17.10 Handbook and upgrade plan (R3-9)

Small Markdown topics under `docs/handbook/` have title, summary, audience and
last-checked date. Cover Start here, Editing, Publishing, Site setup, People,
Hosting, Upgrades and Fixing things, with a task-oriented index. Update
the matching guide in each feature commit. Assume Google hosting, no InMotion;
distinguish verified behavior from a plan. Under `docs/handbook/upgrades/`, plan
separate Staging/Production, branch/review/staging/production GitHub flow,
backups, rollback and database migration constraints. Record administrator setup for the target Google project. Deployment requires
separate administrator authorization. Environments/Handbook screens are deferred
until the required product workflows pass acceptance.

### 17.11 Explicitly out of scope

Automated drafting; Handbook Ask a question until an approved service;
organization commands performed by anyone other than the Google project administrator;
live domain cutovers; Microsoft sign-in; Better Together and
Human Needs Index changes. A plain Handbook browser is optional after core
completion. Existing imported sites' regression tests must keep passing.

### 17.12 Verification and finish

Feature completion includes row-10 comparisons at admin 1440/1024 and public
390, with reasons for every visible difference. One acceptance walk after the current polish,simplicity and second-maintainer
checks uses fresh Site admin, Editor, Contributor, page editor and Super admin
accounts; exercise the full specified routes, publishing, History,
scheduling, unsaved guard, template creation/update and both public sites.
Capture every step and inspect it. Remove test records/accounts afterwards,
including test-named pages/stories, preserving the retained demo.

Run type/style checks, unit and database tests, production builds and the
browser coverage required for the release. Keep test assertions and timeouts
intact, isolate disposable test data and report any cases not run. Compare the
same source/fixture on both sides of a behavior-preserving change. Record known
baseline failures by test identity; new failures block acceptance. Preserve the
retained demo, approved content and private verification evidence.

Needs administrator input begins with theme/asset licenses; Adobe allowed local domains;
licensed Echelon sans-serif file if absent; national Who we are paragraph three;
sample chapter event; draft chapter FAQ contact answer; national replacement
review and final template sign-off. These are open reviews, not permission to
reword approved text or loosen enforcement.


### 17.8b Full admin design pass (R3-7b)

Match the approved mockup's layout and structure, beyond tokens and spacing.
Start with demo-route screens. Cover sidebar and site switcher (Pages.png,
SiteOverview.png), Home (Main*.png), Site overview, Lists, Media, Site look,
Publish, History, Reviews, People, Chapters, Settings, sign-in, empty and error
states. Row 10 still wins wherever newer. Remove additions absent from the
mockup, including the extra Back beside breadcrumbs, unless a reason is
recorded. Preserve working features and test-visible names, or update this
specification in the same screen commit. Inspect comparison screenshots at both 1440 and 1024. Record Matches or Differs
with reasons in private verification receipts; token changes alone do not establish
acceptance. Deferred screens remain explicit roadmap items.


Admin Home follows Main's Needs you,Your sites and Jump back in structure.
Its shared page/card spacing and title rhythm match Main;site thumbnails remain
real saved previews;original imports instead identify their design because the
scriptless thumbnail excludes their approved site files. Compact cards keep actual counts and Open/View actions in
an accessible Actions menu. Waiting badges count real saved changes;the complete
status is available on hover. More tasks and archived sites use the shared
Disclosure. Super-admin diagnostics stay inside closed Test tools (this computer
only). Shared navigation icons remain visible in all expanded contexts;global
Home lists authorized sites and preserves the same workspace item order used
inside site screens. Names and role permissions are unchanged.

Native editor chrome follows EditorClean and HeroSlides with matching bar
buttons and Back,full-width This page Add a section,and shared disclosure/link
styles. Page structure options sit with search;row menus retain visibility and
movement commands. Hero slider replaces only the feature role’s default label;
deliberate custom labels remain. Fields outline only on hover/selection;zoom
sits outside content,and narrow canvases reserve context-tool space so selection
does not push the page. Compact card/slide summaries retain full hover values,
real icons/photos,switches and row actions. Layout choice is under Style. All
existing fields,permissions,Back/Done and grouped save/schedule/publish remain.

Native Site overview uses the same title spacing and shared controls as Home,
with the reference task-card rhythm at 1440/1024. Keep its required page tree
below the work cards. Each overview tree row has one Actions menu containing
Edit,View live when available,and its authorized existing management commands.
The overview table uses a single-line Changes not live chip with the full
status on hover. Card-heading links use shared chrome styling. Original imported-site workspaces
retain their frozen behavior.

Native Redirects uses Settings as its page heading,with Redirects as the card
heading and selected Settings tab. Native sidebar Settings stays selected there.
The saved destination table precedes Add/import;availability and Edit/Remove
remain factual. Existing redirect names,commands,CSV review and authorization
stay. Each Settings section explains its actual save/publication behavior.
Imported Redirects keeps its previous standalone heading and layout.

Chapter Settings presents the existing new-chapter default as two radio choices
under New chapters start with,instead of New chapters get updated by. Publishing
and approval keeps the named Chapter defaults region and fixed approval guard;
assignment links and division-team commands stay. Chapter Stories controls remain
under Stories settings. Review reminders keeps the Chapter checks region and
uses two Email preview tabs;the old Preview the two messages disclosure becomes
Check settings and local tools for saved check settings and local recording.
January/July semantics,approved message wording,command names and roles stay.

Sign-in uses separate receipt and expired-link cards within the existing entry
layout. Receipt keeps the generic account-safe status and offers Use a different
email;local mode says Check the local outbox and No email was sent. That link has
expired offers Request a new link back to email entry. Local explanation is in
About local sign-in. Existing provider/button labels,invitation checks,pending
protection and authentication commands remain;no Microsoft provider is added.

Native Chapters uses a saved-record list beside a bounded read-only chapter
panel. The first visible chapter opens initially;chapter-name buttons select
this panel instead of opening Set up. Set up remains explicit on rows and in
the panel;the existing setup/add/invitation commands and dialogs stay. Today it
links to uses published chapter setup,while Saved destination identifies private
setup. Editor access loads through the existing scoped reader,with error/retry,and
refreshes after invitations. The panel is inert while setup/invitation modals
are open. Linked destinations offer Open saved address in a new tab without
claiming the address was checked.
At1024,the panel retains Updated by and Set up while their redundant table
columns hide. Imported Chapters keeps its former name-button setup behavior.
Do not invent next-check dates,board/person counts or external address checks.

Native Site look groups its existing preset under Starts from and its dedicated
Header & menu/Footer links under Logo and shared parts. Preset and appearance
cards share the controls scroller,so full font specimens remain reachable.
Save draft,Revert to live and Publish site look stay together in the fixed
command bar. Four Brand/Accent/Dark/Light rows retain picker,hex,contrast and
reset controls;Advanced colours retains all roles. Curated fonts and every
existing button shape,fill,hover and advanced control remain. The real-page
preview,scope,private saves,contrast/template rules and imported Menu & footer
presentation retain their commands and contracts. The current polish uses
shared compact Cards/Fields/Disclosures,status chips and a bounded preview-page
selector at both widths. Palette rows keep the whole hex value visible with
contrast/reset below;the approved national exception is labelled Approved pair,
not AA. Its explanation stays with Colours,leaving the command bar compact.
Shared resize handles sit inside their panels so adjacent previews cannot
intercept pointer resizing or double-click reset. Site look reserves240px for
its real-page preview when a remembered wider panel meets a narrower window;
the shared panel reports its actual available width to keyboard users.

Native Media keeps the library visible beside its bounded, nonmodal Image
details panel at 1440/1024. Existing dialog names and metadata/focus/usage/save/
replacement actions remain. Changing image, search or filters runs the shared
leave choices before dropping unsaved details. Imported sites retain their
modal drawer. Library,Tag and Sort remain under More filters in native Media.
Images/Documents stay separate; no Toolkit integration is added. Current polish
uses shared compact fields,buttons,tabs,disclosures and status chips. Native
gallery names remain on one line with full-value hover;metadata moves to List
view or details,and column count follows the space beside the inspector. More
filters opens below the command row. Documents uses the same title spacing,
compact controls and bounded panel beside its library at 1440/1024;file bytes,
category saves,archive/restore and existing leave choices keep their contracts.

Native Page history uses the shared version queue and read-only comparison
workboard. It still opens the current draft; choosing an earlier version compares
it with the current draft unless an explicit comparison or Close comparison is
chosen. Arbitrary comparison, automatic saves, exact paging and restore stay.
This page/Whole site preserves the existing site-release History destination;
scoped page users have no whole-site link. Filters describe only loaded versions.
Plain changed fields reuse Publish's saved-form vocabulary; Super admins keep
All saved fields behind a disclosure. Imported History stays on its existing
screen. Back to editor is retained as the explicit return to the writing task.

Native Publish uses the compact What/What changed/Who/When saved-change table,
with its primary selection/review actions at the header. Informational stamps
are separate from immutable release pins and say Not recorded when unavailable.
Ready,Scheduled and In review show actual counts; their existing accessible
work names remain. History stays as the existing fourth tab. Native scheduling
is in Scheduled instead of below Ready. View changes,selection,first-release
checks,consent,progress,publication and recovery commands remain. Imported
Publish keeps its existing grouping and embedded scheduling. Archived sites
show a clear read-only state and a History next action.

Lists in Reviews uses the same full queue/detail workbench as page reviews, with
search, decided-request history, top decisions and Changes/Discussion tabs. Saved
list changes compares actual item fields, additions, removals and positions; All
saved values retains both complete snapshots and their Advanced details. Closed
requests name their approved/submitted values rather than promising approval.
An unavailable exact request never falls back to another list. List comments use
the existing browser-only save/leave guard, scoped to the account and request.
The existing list decision names, exact saved submission, field-change approval
restriction and stale refusal stay. Inline list reviews in Publish retain their
existing layout; no fabricated page preview or readiness check is added.

### Round 3 template implementation details

Template is a Super-admin destination for eligible native sites. Its update
review renders a real saved page before and after, then saves selected sites
as drafts through existing commands with a reviewed-state fingerprint. Changed
field types/removals require a page-editor review. Start a site supports a
private copy, saved page set or Home; optional words/stories, retained item
counts/layout and shared global pins. Existing 64 MB and image-decoding limits
still apply. Reusable compact page headers, summary cards and notes match the
reference density without changing other screens' default structure. The
existing catalogue is labelled Shared sections without the mock's fixed count
of 24, so it accurately retains the working library. The wider sidebar and
site switcher match remain R3-7b work; this screen has no extra Back link.


### 17.13 Required numbered pass/fail acceptance

The following acceptance checklist records the approved Round 3
source. Build against it throughout the work. In the real-app acceptance walk,
record every numbered item as Pass or Fail with its screenshot in private
private verification receipts. Tests alone never establish Pass. Any item
unfinished at handoff remains numbered Fail or Not built, with its reason in
the final report. The exact hero/editor corrections above take priority next,
immediately after Footer; keep the existing link/focus/move/icon capabilities.

# Round 3 pass/fail checklist

Each item is either done or not done. Check every one in the acceptance walk, in the real app, and record Pass or Fail with a screenshot in private verification receipts. Anything that fails stays listed. Don't mark an item done because tests pass.

## Header and menu
1. Site admin opens Header & menu from the site menu, without opening any page.
2. Add a page to the menu; it appears in the header on every page after publishing.
3. Add a website link and a dropdown group. Drag to reorder and nest one level. Delete an item; deleting never deletes the page.
4. A draft page can be added, but shows in the menu only once it's published.
5. Dropdowns open by click, keyboard and hover on desktop, and work in the phone menu.
6. Page details has no menu label or menu controls, only a one-line note with a link to Header & menu.
7. Clicking the header or footer on the canvas changes no field. The panel keeps the "Header: on all N pages" note and offers Open Header & menu. No menu fields and no Add page to menu appear in the page editor.
8. Editors don't see Header & menu, Footer or menu controls.
9. Upload a different logo per site, with a required description. SAWSO and Echelon show their own. Logo size stays right on desktop and phone.
10. Donate label, destination (page, website, email, phone) and tracking code change in one place and update every page after publishing. Keep the existing link panel and its choices.
11. Footer text, links and logo are edited in one place, for the whole site.
12. Menu, logo and footer changes save as drafts, and appear in Publish in plain words.

## Hero
13. Add, remove, reorder and switch off slides, with no fixed limit in normal use. 1 slide hides the controls. The panel shows slides as a list, not a flat list of numbered fields.
14. Each slide has its own title, text, photo, focus point and 2 buttons.
15. The round button beside the dots, bottom right of the hero, shows an open chevron instead of the arrow with a tail. Keep the dots in their pill, in the same place.
16. On the live page, slides change by themselves about every 6 seconds. Dots and the chevron work, also by keyboard. Auto-change pauses on hover and focus, and respects reduced motion. In the editor canvas, it stays on the slide being edited.
17. Start and end dates work, or are listed as not built.
18. Without JavaScript, the first slide shows and the page still works.

## Look
19. SAWSO section titles and headings use Trajan Pro 3 from the kit where the domain allows, with the listed fallback elsewhere. Echelon stays sans-serif.
20. On desktop, service tiles get an outline on hover and keyboard focus. There's no editor setting for it. Phone is unaffected.
21. On every public page in both sites, nothing but section titles sits directly on grey. Check the pages made from templates too.
22. A new page from any template follows rule 21 without manual fixes.
23. Icons in a set look alike: no mix of white-background images and clean icons in What We Do or similar sections.
24. Preview opens the current draft in the real look, for the page and with site-wide changes.

## Editing
25. The section title belongs to its section. Clicking it edits the title with the section still outlined. Moving a section moves its title. The panel doesn't open with link-behavior options such as nofollow; those stay behind Change.
26. Sections can be reordered by drag on the page or in the list, and by keyboard, with the up and down buttons too.
27. Add card creates exactly one card. Cancel removes it. No sample or empty card is left over. Selecting a section never rearranges the page: 5 tiles in a row stay 5 in a row, and Add card doesn't change the layout.
28. The icon picker has search, recently used and Material Symbols, and saves the choice by name.
29. Keep the focus point control and its Card, Phone and Wide previews. It works for hero, tiles, cards and story photos, on desktop and phone.
30. Every panel has Back and Done in the same spot, and can be widened.
31. An Editor's panel shows only content fields. A Super admin's panel keeps the rest behind tabs.
32. Keep the left page list. Clicking an item jumps to it on the page. Sections are collapsed by default, so the list stays short, and open to show their fields.

## Pages
33. The Pages list opens without stories in it. Sector pages are grouped. Filters work.
34. Search finds pages and stories. A story result opens in Stories.

## Publishing
35. Save draft, Schedule and Publish appear together in the page editor and story editor.
36. Schedule a story for a date; it stays off the site until then, then appears everywhere it's tagged, without anyone doing anything.
37. Publish shows what changed in plain words, per page. Nothing says only a technical name.
38. Leaving with unsaved work offers keep editing, save draft and leave, or discard.
39. Publish shows progress, finishes, and says so. A slow release never looks stuck.

## Sites
40. SAWSO and Echelon visibly use one template. A change to a shared section can be applied to both as drafts.
41. Start a new site from a copy; only its logo, menu, footer and content need changing.
42. Stories: every required item in stories-tool/MUST-HAVE.md passes.
43. Echelon: every item in echelon-reference/template-review.md passes.

## Handoff
44. docs/handbook has a guide for every item above, and an index for editors and maintainers.
45. Staging, GitHub flow, stepping back and recovery are written out, with what's verified and what isn't.

## Added: numbers, annual report, chapters
46. A number has one home. Change it, publish, and every page using it shows the new value.
47. A number can't be saved without a source. Numbers marked Needs checking are listed, and their pages don't change by themselves.
48. Publish says what changed in plain words, with the page count.
49. An Editor can pick a number for a stat and can't change the list.
50. Annual Report 2026 matches report-text.txt word for word and number for number.
51. The page matches captures/ at 1440 and works at 390 and without JavaScript. No section holds pasted page HTML.
52. An Editor can change a financial row, a stat and a story from the panel.
53. A copy of the report page opens as a private draft.
54. A chapter set to Their division's page links there from Find a chapter, has no page to edit here, and shows in its own filter.

### 17.14 Added work: numbers, annual report and chapter destinations

The updated approved checklist adds46–54. Follow row11 for DataNumbers,
AnnualReport and ChapterWhere; DataNumbers replaces the older DataValues screen.
The existing permissions, frozen-site boundary and UX requirements apply.

- **R3-5A Data values:** after Stories, before non-demo7b screens. Site-owned
  named numbers have value, page label, required source, as-of, status and page
  usage. Site admins manage; Editors pick a number in a stat and may reword its
  local label, but cannot edit the number list. Draft changes use the existing
  reviewed publication path, with a plain before/after and affected-page count.
  Needs checking never changes pages by itself. Fill-from-file with explicit
  review is last; no background sync. Seed from the saved report with page
  references. The October31 follow-up supersedes the earlier freeze on disputed
  figures: update current SAWSO figures through normal drafts using the report
  as authority, connect them to Data values and record every old/new/page/source
  in private verification receipts. Preserve story, biography and past-event
  figures. Unsourced figures stay unchanged and Needs checking. See17.15.
- **R3-5B Annual Report2026:** afterA, as a child/link of Annual Reports and a
  private draft pending report-reviewer approval. Read saved annual-report/README,
  report-text.txt, report.html/report.css, captures and assets; never the live
  preview. Exact words/numbers and approved report-only public people content
  stay on this page, not in docs or unrelated seeds/tests. Normal reusable
  sections only: section links, expandable letters, country stories/stat/source,
  expandable region lists and editable financial summary. Top four stats bind
  to Data values. Import photos once through Media with descriptions/focus.
  Match1440/390, support no-JS letters/lists/jumps, retain the white-container
  rule and record report-band exceptions. A copy stays private for next year.
- **R3-8C Chapter destination:** during Echelon, distinguish Their division's
  page from Their own website or social page. Keep address/contact; link from
  Find a chapter, give it its own Chapters filter and no local editing page.
  Existing January/July checks ask the contact to confirm the address. Reuse
  existing chapter/link-check commands and permissions.
- **R3-9D Handbook:** after core upgrades docs, plan-only simultaneous two-test-
  subdomain verification, DNS handoff and per-site routing proof; ADR0012 static
  publishing options/recommendation/cost/release-and-rollback implications.
  Verify Event starter still works; change it only if broken.

CutD, thenC, thenB if necessary; never cut sections1–8 for these additions.
A local Bootstrap reference is present and checksum-audited without a refetch;
the old404 receipt conflicts with it. Source attribution/custom-theme licence
remain Needs administrator input; the Bootstrap header alone is not a theme licence.

Check the corrected national-theme source: only bootstrap.css exists at the
listed address; never look for site.css. Keep reference CSS in private storage outside Git and the product build; the licence remains Needs administrator input.

### 17.15 Source authority, exact report and deferred work

This section supersedes conflicting source requirements in §17.14. Preserve
the existing site/data boundaries and verification requirements. Stories provide
the shared foundation for the Data values and report work.

**Current SAWSO figures.** The saved2026 report is authoritative. Confirm exact
wording against report-text.txt: Home “more than $57 million worth of projects”
becomes “more than $50 million worth of active projects” (p4 area); “Active
projects on five continents” becomes “Active projects on six continents”
(pp18–19); “Assisting approximately 4 million people around the world” becomes
“Supporting 152 projects in 69 countries” (p4). List the last wording change
under Needs administrator input. Update via normal drafts and Data values, with report page
source. Search every SAWSO page/section for other report-covered current figures;
record old value,new value,page,source in private verification receipts. Story
articles, staff biographies and past-event figures remain exact. Anything absent
from the report stays unchanged and Needs checking; that status never mutates a
page by itself.

**Exact report.** Updated row11 AnnualReport uses the report's own markup/styles,
replacing drawn versions. Saved full-1440*.png/full-390*.png and row11 are exact
section/order/spacing/type/photos/colors/open-and-closed targets. Use the normal
site Header & menu/Footer, Adobe kit or listed fallback, reusable CMS sections
and the Stories World View for Global Presence. No page HTML dump or page code.
Compare every section and every opened panel at1440/390 before committing;
visible differences are Major unless recorded with a reason. Existing private
report-editor-review gate stays enforced.

Additional final acceptance items, each Pass/Fail/Not built with screenshot:
55. Annual Report 2026 matches the captures section by section at 1440 and 390, with all panels open and closed.
56. The Global Presence map is the World View section.
57. numbers-updated.md lists every change, and no story or biography number changed.

**Deferred work after acceptance.** After sections 1–9, add-ons and final
acceptance, address the following through separate reviewed changes. Preserve
the retained demo and list unresolved failures explicitly:
1. Fix remaining checklist Fail and UX Differs, or record concrete reasons.
2. Complete7b and remaining mockup states in rows1–11.
3. Prove local staging upgrade/step-back with its own database and real migration;
   restore backup into empty DB and verify pages/drafts/history. Correct handbook;
   distinguish unprovable hosting behavior.
4. Prove two localhost addresses, each with isolated site/drafts/media/people.
5. If ADR0012 recommends static publication, build local export off by default:
   published files/incremental updates/schedule/expiry/rollback and serving while
   CMS/database stopped; no deployment or deploy/ changes.
6. Audit approved local SAWSO URLs/feed for redirects/full stories/photos/tags/dates,
   per-page missing details and administrator launch checklist; no extra public reads.
7. Time clean new-chapter setup through invite/approval/publish/directory/reminder,
   simplify excess steps and document it.
8. Environments and Handbook screens per row10, no Ask feature.
9. Public all-page1440/1024/390, keyboard/labels/compatible contrast/performance/
   images sweeps; small unrun-WebKit batches within limits, honest remaining count.
10. Answer30 new-user questions using handbook alone; fix gaps and maintain index.
11. Remove test records, refresh demo route and report Part2 completed/remaining.

Still excluded: automated drafting, Ask feature, Microsoft sign-in implementation,
real deployment/domain changes, Better Together/Human Needs Index changes.
Write only a brief Microsoft sign-in handbook note listing what IT must provide.

Story creation foundation: creating a draft adds no sample article
text. An optional supplied body is sanitized under the existing100000-character
article bound. The shared article section hides the old-address link when no
old address exists, including a newly created empty-body draft. Governed lead photo requires its site-owned/shared ready wide
rendition and a description; keep its bounded x/y focus through collection
validation, saved values, preview and published rendering. No arbitrary image
properties or foreign/unready media are accepted. Existing collection/date/role
rules remain enforced; full StoryAdd layout, date-less drafts and scheduling are
still separate unfinished work, not completed by this foundation.

Individual Story publication foundation: an explicit server-checked
Story entry scope may travel in the existing collection_entries release item.
Resolve IDs only from that site’s active Stories list; derive labels from saved
titles. Include only its own changed article page and required field dependency.
Keep normal permissions, pending-approval gate, whole-site review/fingerprint,
immutable receipt, sample consent, rollback-only preview, readiness and leased
release timer. Migration0177 publishes only selected Story pointers/order and
retains every unselected private/public record exactly; normal full-list commands
are unchanged. Keep the list visibly dirty while other drafts remain. Plain saved
comparisons/counts include only selected stories. History retains the complete
before/after collection capture and pinned versions through existing recovery.

This foundation is not the calendar or StoryAdd UI. Existing whole-site conflict
rules still invalidate a planned/scheduled release when site state changes;
independent queued Story schedules amid other editing remain an unresolved
calendar requirement. Do not silently rebase or broaden a reviewed intention.

Undated Story drafts: the canonical Story date is optional while
writing, including any-site starters and explicit catalog upgrades. The Add form
starts without a day, says that a date does not schedule publication, and Cancel
clears the unfinished form without saving a Story/page. Keep supplied full text,
photo description/focus and tag choices. A draft without a day stays out of feeds.
Migration0178 rejects a canonical Story becoming public without its date across
both full-list and scoped publication/recovery paths; draft-only changes remain
allowed. Story-specific review asks for a date before planning publication or
scheduling. Existing dated articles/values stay exact. New field label is Story
date (optional), replacing Published in the Story forms. The full StoryAdd layout,
ready list/calendar, clean toolbar/role controls and three-choice leave flow
remain open; this date foundation is not a completed screen design pass.

Story review controls: Save draft, Schedule and Publish appear together
for publishers in the existing Story editor; roles without publishing rights see
neither publication action. Save draft replaces the old Save story button label.
Publish/Schedule save changed content first and prepare only the server-selected
Story and its own changed article page. No action publishes before review and
confirmation. An absent Story date focuses the date field and explains that drafts
may stay undated. A private site gets an explicit Review first site publication
step rather than silently broadening the individual-story scope.

When title/summary changes, save matching article search metadata through the
normal page command, locking its page before the collection. Preserve article
content and unrelated metadata. Review uses saved differences, human tag names,
photo descriptions/focus words and direct View changes comparisons; keep IDs out
of those Story comparisons. The selected review and final confirmation use the
same descriptions. Schedule opens the existing reviewed timer form in the device
time zone. Publication shows clear in-progress text and the ordinary receipt.

This functional connection does not complete the StoryAdd/Publish design pass:
full editor layout, role/Advanced grouping, three-choice leave guard, real feed
placement calculation, every Ready-row description, conflict recovery and calendar
remain open. Existing whole-site schedule invalidation is still enforced. End or
change-back dates for a complete Story/feed release are unsupported and omitted.

### Private preview fonts — Round3 correction
Private editing, history, release, library and copied srcDoc previews permit only
the approved Adobe stylesheet hosts use.typekit.net/p.typekit.net, font host
use.typekit.net and licensing image host p.typekit.net. Parent admin policy must
permit the same resources for inherited srcDoc documents. No Adobe script or
connection grant, wildcard, font download or arbitrary stylesheet is introduced.
The RLS-scoped site staging address survives a private placeholder shell for
existing renderer kit-host selection; actual Adobe address entitlement remains
separate and fallback fonts remain required.

### Stories Coming up — checked implementation contract
Coming up is a separate tab from Overview's Leaving feeds soon. Its month grid
shows all seven days so weekend schedules remain visible; this intentionally
differs from the mockup's five-weekday example. Ready, no date yet is a searchable
list of unpublished, reviewed, undated stories with text, description and photo,
excluding hidden/source-removed/already queued records. Drag to a day and an
accessible Choose day button open the same cancel-safe choice. Cancel/Escape
writes nothing. Review schedule saves only the chosen field values through the
normal collection command, then prepares the existing exact Story release.
Publishing permission, first-site review, monitored scheduling, normal immutable
review and confirmation remain enforced. The proposed 9AM device-zone time is
editable in the normal schedule dialog. Calendar reads owned existing timers;
whole-list legacy jobs remain in Publish rather than guessing their membership.
The normal engine still invalidates scheduled reviews on unrelated site changes;
independent queued schedules remain open. Unchanged, current-field Story versions
are preserved on save; a true no-change save adds no version or dirty counter.

### Story save version preservation — Round3
The existing guarded collection save command preserves a Story row only when
its values, stable key, order, active status and field version are identical.
Validation, ownership, media checks and mandatory compare-and-set revision run
first. Real edits, additions, reorder, removal/restoration and field upgrades
still version normally. A complete no-change Story save keeps list counters and
public/draft heads exact. Other lists retain their previous save behavior. This
is a dependency for independent Story scheduling, not completion of that work.

### Independent individual Story reviews — Round3
A fresh single-Story review with published/current fields and the registered
shared article records a separate server-owned before/after dependency hash.
The recorded choice list and version identities never change. Under the existing
site locks, the global list CAS counter may advance for other stories; only that
execution counter is refreshed after the exact story/article/dependency pins
match. Other Story edits/publications and their new article pages do not stale
this review. The target record, its existing or selected article, fields, shared
settings, ordinary pages/lists, relevant media, domains and executable files
remain checked. Editable story URLs alone cannot classify an ordinary page as
an article. Multi-item/site-wide, custom/imported and legacy reviews keep their
original complete-site checks; no old review is silently converted.
The existing monitored timer, authorization/approval, media validation, policy
version, saved comparisons, rollback-only trial and confirmation still apply.
Readiness compares new effects with both the original review and fresh published
baselines; a private article's missing public Story uses the existing incomplete
preview reader with published lists only. Other drafts never supply exceptions.
Unchanged already-public findings are separately audited; new findings still
require review. Recovery captures unrelated current state at application so
undoing this publication preserves other publications and undated private work.
Normal history restore may create new versions. Native shared Story articles
never automatically add themselves to the header menu; explicit links, ordinary
page additions/removals and imported-site menu behavior retain existing commands.
Coming up shows a changed queued target as Needs review immediately and opens
its Story. Cancel an old timer in Publish before scheduling its replacement.

### Story lead-photo editing — Round3
The saved Story editor reuses Media with Upload inside it and the existing focus
point control, including Card, Phone and Wide previews. A Story photo always
requires a description; the decorative choice is unavailable in this use only.
Cancel/Escape returns without changing the Story. The server constructs the
visitor URL from a ready site-owned/shared wide rendition, validates description
and bounded focus, and saves through ordinary collection CAS/permissions.
Replacing a sample photo clears only its photo sample marker/note; changing its
crop or description preserves its existing marker. Existing source addresses,
other Story versions and every published pointer remain unchanged until review.
The full StoryAdd layout/placement/three-choice leave work is separate.
Needs administrator input: StoryAdd's supplied photo/filled captures show a blank body, and its
markup omits the reserved sidebar's required photo/tag/placement controls. Follow
the valid header/form reference and existing CMS controls until captures exist.

### Story writing layout — Round3
Use the shared full-width ContentEditor action bar and Card editor density:
Back, site/Stories context, story title, save state, Preview, Save draft, Schedule
and Publish. Title/summary precede the visual Story text; remove the large preview
from the writing surface. Preview saves local changes as a private draft and
opens the existing scriptless saved preview with loading/progress and Done.
The right supporting panel starts at340px, widens to480px without covering the
content, and remembers its width. Shared grid/field sizing bounds long source
addresses in Advanced;they shorten with the full value on hover. Tag choices
reuse the list chips and fit side by side. Summary uses the shared inline counter,
and focus/placement/review disclosures use the shared chevron. Lead photo and focus/crops, tags and optional
date retain existing controls. Focus details collapse to keep tags closer.
New/edited summaries use155 characters; unchanged imported summaries up to the
existing200-character field bound remain intact. Do not truncate approved text.
The single Details tab becomes a Details card heading. Saved story preview keeps
its name but is opened by Preview. These are intentional test-visible structural
updates. The formatting toolbar retains its existing functional list/link actions.
HTML source is available only to Super admins on the Advanced tab; Content is
the default tab for them. Other roles see only content and no tab switch. Ordinary
Story writing stays visual. The source sanitizer and database permissions remain.
Back offers Keep editing, Discard changes and Save draft and leave. Escape keeps
editing; a failed save stays in the dialog with the words retained. This does not
complete the shared leave guard for other writers or every browser history path.
Real feed placement, full new-story screen and the57-item acceptance walk remain
open. The supplied missing sidebar/blank state captures remain Needs administrator input.

### Story placement explanation — Round3
Where it will show is computed from actual saved page bindings. On an established
site, use other published Story values/order and published page versions/addresses;
exclude unrelated private records, page edits and address changes. Overlay only
the current Story draft and include its own article draft, matching the individual
publication scope. First-site setup instead labels its saved draft context clearly
and explains that the initial review determines what goes live.
Reuse collection tag/date/filter selection, definition-owned feed date opt-in,
and the public World/Split region/sector/recent selection and limit functions.
Honor hidden sections, sm/md/lg restrictions, custom filter/date fields, date
ordering and creation order. A future day is explained as a projection from that
UTC day; blank/invalid dates, hidden/removed/unreviewed policy and display limits
have plain-word explanations. Show reachable Show more and region-link states;
do not claim a map pin when the tag has no map area. Group related-article feeds
separately, not as a long undifferentiated list. Tag/date changes update the
explanation before saving and never write a record. Transport only the criteria
fields needed for other stories. The RLS-scoped loader is read-only; failed reads
show Try again and keep the form. Publication checks remain authoritative.
The current200-story widget source bound remains open. This explanation describes
the current public behavior; it does not close the required Hide from feeds work
for every manual placement/direct article or the full new-story screen.

### New Story save recovery — Round3
A new Story creation request carries one stable request id for its authored
intention. An author-scoped, site-scoped immutable receipt is written atomically
after the normal private entry/page commands. Replaying the same intention
returns those original ids without another entry, page or version. A changed
intention, foreign actor/site, archived result or invalid permission is refused;
receipts grant no direct writes and are unreadable to public rendering. Collection
revision and media checks remain enforced on the original transaction.
After an unconfirmed transport result, preserve the form and lock its fields.
Retry draft save checks that same request before allowing further edits. Ordinary
confirmed validation failures keep the form editable. No sample body or empty
leftover is inserted. No-tag and ordinary-site creation keep optional links empty
rather than inserting a sector placeholder or a nonexistent Newsroom address.
This is recovery behavior; the current Add story dialog still differs from the
approved full writing screen and remains required work.

### Full New Story writer — Round3
Add story from every Stories hub navigates to an empty full writing screen. Reuse
the saved Story ContentEditor, title/155-character summary/body controls, governed
photo picker with upload/required description/focus, tag groups, Countries and
optional Story date. Super admins keep source under Advanced; other roles do not
see it. Keep the same resizable remembered supporting panel and actual page-bound
Where it will show explanation. Project an unsaved candidate read-only: never
insert an empty entry/page merely to open or cancel the screen.
Save draft creates the normal private entry/article with the authored body.
Preview first saves privately, then opens that saved preview. Schedule/Publish
first save privately and open the existing exact Story review; they cannot
publish immediately. First-site publication still needs its explicit separate
review. Discard before saving creates nothing. Back with work offers Keep editing,
Discard changes, or Save draft and leave. Lost creation responses use the stable
request receipt, preserve the form and lock changes until Retry draft save.
A server refresh must not replace a new form's words or request identity.
The old dialog's Create story draft action becomes Save draft in this shared
writer; Add story keeps its test-visible name. No new screen-specific CSS. The
reference reserves a sidebar but omits its required controls and its photo/filled
captures are blank; record that gap and the existing missing inline Photo action,
not a full visual Matches or completion of all Stories requirements.

### 17.16 Editing parity: approved row13 targets
The following follow-up is approved. Implement its eight pieces after the required
Stories work and before Echelon's final checks, in the supplied order. Original
Round3 sections1–9/add-ons/final acceptance take priority if time runs short; cut
parity from the bottom. Stay within the full-screen page editor and existing site
menu. No new site-menu destinations or section types for this parity work.
Row13 and this follow-up govern these additions; preserve the previously approved
national public look, current Story row and all existing security/permissions.
Mockup role labels are superseded by the explicit role-name instruction below;
permission ids/rules are unchanged. ReportLinks row12 is the only newly approved
row12 piece here; CampaignTags,ToolkitPhoto and ToolsHub remain out of scope.

Round 3 editing parity follows the approved local references and existing UX, scope and verification requirements.

People moving to this CMS already use Symphony. Where they'd expect a feature, it should be here, in this CMS's plain words and on the normal draft and Publish path.

Read /ABSOLUTE/APPROVED/ui-reference/screenshots/INDEX.md, row 13. FeatureMap lists each feature and the decision. Markup and wording are in mockup-src/Sym*.dc.html. Real screens are in /ABSOLUTE/APPROVED/ui-reference/symphony-tour/, for reference only. Don't log in to Symphony.

# Order
Do these after Stories and before the Echelon section's final checks, in this order. Sections 1 to 9, the add-ons and the acceptance walk still come first if time runs short: cut from the bottom of this list. Every screen stays in the approved shell: the full-screen editor for page work, and the existing site menu with no new items.

1. **Hero slide panel (SymHero).** Keep the working slider, autoplay, dots, chevron, on/off and dates. Add:
   - Text position (left, center, right) and shade behind the text (Black to blue, Black, White, None), with contrast checked for each.
   - An optional different picture on phones, off by default.
   - Counters at 100, 200 and 20 characters.
   - Each button is its own block: Show switch, the button drawn as it really looks, Button text, Color (Red, White, Outline), then Goes to with its destination and Change. Never one field holding both the label and the link.
   - The link panel keeps page, website, email and phone. When a page is chosen, add an optional Jump to a section, and confirm it scrolls to that section on the live page, with and without JavaScript. If the section is later removed, list the link in Needs attention.
   - Replace "Show only between dates" with a Schedule this slide switch, off by default. Show from and Show until appear only when it's on.
   - Slide menu: Edit, Duplicate, Copy to another page, Delete. A copy goes last on that page's draft, switched off.
   - Confirm the SAWSO Home hero slides on the retained demo at 1440, 1024 and 390.
2. **Pages list (SymPages).** Keep the approved Main pages and Ways We Help tabs, with all eight sector pages. Add In the menu and In the footer switches and a drag handle. The switches change the same data as Header & menu, as a draft, and show on Publish in plain words. No publish switch on the row. Site admins and above. New page: title with a 90 counter, address shown and changeable, description with a 155 counter, Start from including A link to another website, which makes a menu item with no page to edit.
3. **Section tools (SymSection).** Add to the section's More menu: Copy link to this section, Change link name, Copy to another page. Changing a link name updates anything linking to it. A copied section goes on that page's draft at the chosen spot.
4. **Add a section (SymLibrary).** Step 1: blue Add here lines between sections on the real page, plus Add above and Add below in the section menu. Step 2: the library opens on the left and says where it's adding, with Change spot, and the page stays visible. Step 3: choosing one shows it on the page at that spot with sample text, Move up, Move down, Cancel and Add this section. Search also matches Symphony names, shown as a small "In Symphony" line. No new section types.
5. **Stories (SymStories).** Keep the Stories list exactly as it is, with every sector and region chip, Reviewed and Hide from feeds. Add one Feature star under them. Add a Newsroom order tab: Featured, up to 5, dragged into order; everything else newest first by story date; and beside it what visitors see. Sector pages stay by tag and date. Summary limit becomes 155 with a counter, and add an optional Author in the approved story screen.
6. **Settings (SymSettings).** Use the existing Settings layout. Add a Social accounts tab that Footer and social sections read from. In Search & sharing add verification tags, hints and View sitemap. In General add description, country, language, contact and address. Don't add analytics settings.
7. **View page or PDF (ReportLinks in row 12).** Annual Reports shows each button only when it exists. 2026 links to the new page.
8. **Role names.** In People and role screens, use Super admin, Admin, Site editor and Content creator for the existing roles, keeping their permissions, and keep comment-only reviewers as they are. Update the handbook.

# Don't build
Analytics settings, story limits per device, campaigns, Red Shield Toolkit, the Tools area, a separate Events screen, a site alert screen, new section types, section background pictures or parallax, video heroes, dragging all stories. Ignore row 12's CampaignTags, ToolkitPhoto and ToolsHub.

# Handbook
A page, "Coming from Symphony", with old name, new name and where it is, for every row in FeatureMap. Add guides for each item above.

# Add to private verification receipts and the acceptance walk
58. Each slide's position, shade and phone picture work, and the hero still slides at all widths.
59. A button shows as it looks, with its own link under it. Jump to a section really scrolls there.
60. Show from and Show until appear only when Schedule this slide is on, and a scheduled slide starts and ends by itself.
61. In the menu and In the footer change the same data as Header & menu, as a draft, and show on Publish.
62. Copy link, Change link name and Copy to another page work on a section.
63. A new section is chosen at a spot on the page, shown there before adding, and lands exactly there. Searching "Theater Space" finds the hero slider.
64. The Stories list is unchanged apart from the star. Featured stories stay first in the Newsroom in the chosen order, and sector pages don't change.
65. Social accounts update Footer and sections from one place.
66. "Coming from Symphony" covers every row in FeatureMap.

### Explicit Story visibility — Round3 required correction
Hide from feeds and a published source-removal flag remove the Story from every
resolved placement, including manual choices. Keep the entry, words, photos and
article record editable. A canonical registered Story article becomes a neutral
404 and leaves public route/sitemap results. An ordinary page containing a manual
Story selection stays public; its hidden Story content is omitted. Unhide and
publish restores the same records/addresses. Draft flags never change live output.
Older visible direct articles remain accessible after the13-month feed window;
manual article visibility does not acquire the automatic-feed review/date rules.
Only explicit hidden/source-removal flags change this behavior. Invalid manual
keys,duplicates,unknown entries and foreign access remain refused. Private preview
and actual placement use the same explicit visibility rule. No empty Story
container or definition sample replaces deliberately hidden content. Bound the
new recursive projection before normal renderer validation; do not trust malformed
bindings or expand permissions. Reuse normal guarded publication and route rebuilds.
This supersedes the earlier development assertion that a hidden article stays
public. Its retained record stays; its public article does not. Normal expiry is
still different: expiry removes a feed item while leaving the direct article.

### Complete managed Story widget sources — Round3
World View and Split View automatic sources use all eligible stories within the
existing2,000-entry library capacity. Counts,All,sector/map selection and Show more
must reach beyond200. Preserve authored repeat bindings/their200-row limit and
all other readers'200-row envelope bound. Keep SAWSO sector pages capped at6 and
the13-month/review/visibility/tag rules unchanged. The stored legacy All value200
continues to mean All;it is not a hidden200-story display cap.
Only managed core-story-world/core-story-split slots carrying their corresponding
storyWidget metadata expand automatically. Ordinary feeds and manual selections
keep their own chosen limits. Private page previews,standalone widget previews and
Where it will show use the same source scope. Source helpers stay private;normal
page ownership,model/media validation,publication commands and the1.8MB manifest
guard remain enforced. No new public JSON endpoint,menu item or section type.
Validate full records before projecting card data. Keep required fields,photo/
focus,tag/date/visibility/review fields and sample markers;omit unused optional
article bodies and notes from managed widget snapshots. Do not alter the source
records or fabricate schema ids. Aggregate the result once within existing bounds.
0183 changes functions only. Stored page bindings are unchanged;normal subsequent
publication/rebuild refreshes published widget snapshots. A rollback after a
widget with more than200 entries has been published needs matching code/database
state;see the upgrade guide. No deployment or restore rehearsal is claimed here.

### Saved Story conflict recovery — Round3
A refreshed saved Story never replaces dirty local fields silently. Different
fields can be combined;overlapping fields require an explicit Mine/Saved choice.
Photo description/focus stay with their photo,and region fields stay together.
Cancel/Escape retain the local words;Review saved changes reopens recovery.
Keep selected changes updates the local draft and its saved baseline only.
Saving still uses the existing revision check and role rules,with no publication
or automatic force-save. A later intervening save requires another review.
Clean refreshed forms load the saved Story;new unsaved forms keep their retry key.

### Page editor Schedule entry — Round3
Save draft,Schedule and Publish are adjacent for people who can publish. Schedule
flushes canvas edits and the existing save queue before preparing a normal release
review of that exact saved page. The server selects the owned page;no header,
footer,menu,list or other page draft is silently included. First-site publication
requires its normal separate review. Conflicts or later edits keep the writer
open. Reuse the existing Publish later review,timer and cancellation commands.
Only date/time scheduling is offered here;no new end/change-back engine is built.

### Plain saved page review — Round3
The editor saves canvas/queued edits before opening its Publish review. The
server reads the exact saved page,checks its revision/version and publishing
access,and uses the same saved-difference formatter as Publish Ready. Say which
named section/card/slide changed;detect native repeated-item fields even when
the item order is unchanged. Distinguish additions,removals,reorders,paragraph
edits,photo descriptions and focus. No schema ids,item keys or custom source
appear in ordinary review words. Page name,address and search-description
changes use their actual saved snapshots,not a generic metadata count.
Show returns to the changed section without publishing. Cancel/Escape retain the
draft. Schedule instead reuses the exact saved release review. The existing
accessible names Publish this page,Cancel and Publish are retained for working
flows/tests;the remaining PublishChoices/7b layout pass must record differences.
Existing sample/readiness/approval checks still run before any publication. A
newer local or remote save requires another review. Field comparisons read the
requested version,rather than substituting a later draft.

### Shared draft-leave choices — Header & menu and Footer rollout
Same-tab CMS navigation and the app Back link offer Keep editing,Discard changes,
Save draft and leave for opted-in writers. Header & menu and Footer use their
existing save commands;validation,stale heads and permissions still prevent
leaving on a failed save. Discard restores the last saved local form without a
server write. A save shows progress and prevents duplicate leave actions.
Successful save resumes only the original destination and does not publish.
The shared registry is populated by committed client effects only;server
rendering never retains another request's editor. Existing link callbacks,
replace/scroll behavior and new-tab clicks remain intact. Other writers keep
their existing guards until their callbacks are connected. Browser document
departures retain native warnings;browser history integration remains required
work. This rollout does not claim the all-writer leave requirement is complete.

### Story leave destinations — Round3
Saved and new Story writers use their existing Before you leave dialog when
a same-tab CMS search result requests navigation. Keep editing/Escape preserve
words. Save draft and leave saves privately then opens the originally requested
destination;new creation still uses its stable receipt,with no intermediate
writer navigation. Failed validation or saves keep the dialog and words open.
Discard of an unsaved new story creates no record. The normal Back button keeps
its Stories-list destination. Search closes when a three-choice prompt opens,
while existing browser-warning cancellation on other writers keeps search open.
Browser history/document departures remain separate required work.

### Page leave choices — Round3
Page navigation offers Keep editing, Save draft and leave, and Discard my edits.
After autosave, say Keep draft and leave and explain that the edits are private.
Discard restores the private draft present when this editor visit began, including
its page details; it does not discard earlier private work or publish anything.
Use the existing save queue and revision checks. If another writer saved, refuse
the discard and keep the local words. Keeping a draft removes only newly inserted,
untouched native cards/slides, preserving authored additions and existing items.
CMS History links use the same decision. Browser Back/Forward and other writer
rollouts remain required work; this does not close the all-writer requirement.

Page History compatibility:after saving private visit edits,existing History
journeys explicitly choose Keep draft and leave. Immutable previews,restore/live
separation,raw-code sandbox and all original assertions remain in place.

### Tag editing leave choices — Round3
Unfinished tag fields and tag-group names use the shared Keep editing,Save draft
and leave,Discard changes flow for CMS navigation. Reuse the existing normal
tag command and its revision/permission checks;failed validation preserves all
fields and stays on the writing screen. A successful private save resumes the
chosen destination. Discard creates no tag or leftover. Existing direct Save,
rename identity,keyword suggestions,map areas and publication rules stay in place.

### Stories setup and policy leave choices — Round3
Changed setup names/review choice and the Stories feed-review setting use the
shared three-choice CMS leave flow. Reuse turn-on and tag-policy commands with
existing validation,role/revision checks and idempotent setup retry. On leave,
a successful setup opens the requested destination directly;ordinary Turn on
Stories still opens the library. Discard setup creates nothing. Policy changes
are private until published. Failed validation or connection keeps the choices.

### Failed Story-list choices on leave — Round3
When instant list changes fail,keep their optimistic chips and queued choices.
CMS navigation offers Keep editing,Save draft and leave,Discard changes. Saving
retries the same normal queue,waits for every acknowledgement,and resumes only
on success. A failed retry keeps the choices and one active leave dialog.
Discard drops only unsaved queued choices and shows the latest saved stories.
If a story/tag disappeared,explain that it cannot be retried and offer discard.
Pending saves or manual source checks continue to block departure. Normal list
tagging/review/hide,conflict refresh and publication rules are unchanged.

### Font choices on leave — Round3
Typed kit-link changes and font choices use the shared CMS three-choice leave
flow. Validate the fixed approved kit and require Check kit before saving a new
connection. Reuse normal theme-draft save/revision checks and await its result.
Failure preserves choices;Discard restores saved tokens and the approved kit
field. Saving remains private,including when Adobe is unavailable and stand-ins
are shown. No font downloads,CSP changes or new publishing paths are introduced.

### Site look choices on leave — Round3
Unsaved site-look choices join shared CMS leave review. Save draft and leave
validates and saves through the existing theme-draft command and revision checks,
then opens the requested destination. Discard restores local saved choices.
Failed saves keep the choices. Ordinary Save,Publish and revert flows retain
their existing checks and review;the leave path never publishes or reverts.

### List item drafts on leave — Round3
List item edits use shared CMS leave choices for links,list switching and opening
a new-list step. Save draft and leave uses the normal entry command,validation,
rights and revision checks,then resumes the exact requested destination. A failed
save keeps item fields. Discard restores only local saved items and selection.
Internal list links use the shared guarded link instead of a second native
discard prompt. Pending actions also retain document-departure protection.
New-list setup and List settings fields now use the same shared choices,
through their ordinary validated private commands; normal Create still opens
its new list. CSV source uses private browser recovery as described below.

List leave validation reuses field messages such as "Name is required." before
the server save,so the new review does not expose technical entry identifiers.
The normal server checks still run for a valid save.

### Page-linked list forms on leave — Round3
List forms opened from the page register their own unfinished fields alongside
the page writer. CMS navigation offers shared Keep editing,Save draft and leave,
Discard choices. Reuse the normal inline-list command,plain field validation and
revision/permission checks. A successful save keeps its existing canvas refresh
and closes the form before resuming the requested destination. Discard creates
no item. Cancel in the item form still leaves the page's own edits in place.
Finish an open photo/document choice before saving the item;explain this in one
line and keep the picker fields. Pending writes retain immediate protection.

### Media details on leave — Round3
Unfinished image details use the shared Keep editing,Discard changes,Save and
leave choices for CMS navigation,drawer close,Used on,Replace and lifecycle
entry points. Save uses the existing metadata command and revision checks,
awaits acknowledgement and library refresh,and retains fields on failure.
The prompt explicitly says that image details update the Media library
immediately;it must not promise a private draft or content publication.
Empty descriptions require a description or Decorative choice. Discard resets
only local metadata;source bytes,page/story content and saved placements are
unchanged. Pending operations retain immediate navigation/unload protection.
Upload drafts and bulk organization inputs remain separate writer work.

### Native page content roles — Round3
On native pages,Editor,Contributor and page-scoped roles retain content fields,
click-to-jump,the page list,cards,slides,photos,links,undo and their existing
publication/review access. Section add/reorder/duplicate/hide/delete/layout,
spacing,device visibility and site-look preview controls are hidden from these
roles. Site admins and Super admins retain the grouped controls. Existing
imported-site interfaces are frozen and keep their previous controls. Normal
save/release commands and database permissions are unchanged.

Role requirement:RoleViews' draft matrix allows Editors to add/move sections,
but the Round3 hard UX rule says Editors see content fields without section
management. Follow the hard rule on native pages;keep admin move buttons. The
full matrix is recorded as a draft in handbook/people/roles.md. Sidebar,Home,
other screens and the remaining role/access review are still open.

Native content roles also use the visual rich-text field without its HTML
source switch;reuse its existing sourceMode setting. Imported fields and
authorized administrative source controls keep their existing behavior.

### Symphony hero implementation contract
The reviewed hero template version opts into heroEditingParity;older pinned
versions keep their existing presentation until a normal draft update. Keep
all three retained slide content values. The new version supplies Left/Center/
Right,Black to blue/Black/White/None,and an optional phone photo with its own
description and focus. Native content roles retain words,photos and links;
presentation controls follow the hard role rule for administrators.

Title/Introduction/Button text counters are100/200/20 in the shared Field
component. Each button has its own Show,noninteractive public-palette preview,
text,color and destination with Change. Four destination types,new-tab and
nofollow stay. Published page snapshots supply optional section jumps;only
opted-in native hero links add missing-anchor checks. Imported fragments keep
their existing behavior. A removed published target appears in Needs attention.

Schedule this slide is off by default. Eastern Show from/Show until are shown
only while on;the end minute is included. Reject the spring clock gap and use
the first repeated autumn hour. The public date-aware runtime activates and
expires slides on an already open page;disabled slides/buttons stay out of
visitor HTML. No-script output shows current slides and real anchor links.
Automatic change defaults to6seconds,pauses on hover/focus,reduced motion and
hidden documents;the approved list controls allow2–30seconds or off.

Slide actions retain reorder plus Edit,Duplicate,Copy to another page,Delete.
Copy uses the current authored fields and the normal private destination page
command under its existing role/revision checks. Copy last,switched off;preserve
other content and a newer destination definition. An older shared hero may
update as a draft;an absent one may be added as a shared section. No publication
or page-specific code. A copied secondary hero does not add another page h1.

Photo contrast feedback samples local media only;it is conservative feedback
rather than certification. Keep the approved palette;record any contrast or
reference differences under Needs administrator input. Development checks do not close58–60
or replace the66-item final acceptance walk.

Preservation exception:The retained third SAWSO slide has a230-character
introduction. Keep it word for word. The 200 counter still shows the length;
normal publication permits an overlong introduction only when it exactly
matches that page's existing published slide. New or changed overlong wording
is refused. Record the existing copy under Needs administrator input;never silently shorten.

### Symphony Pages implementation contract
Native Pages keeps stories out of the ordinary rows,groups Main pages and Ways
We Help (all eight SAWSO sectors),and searches both pages and the managed Story
list. Story results open in Stories. Drafts is a separate filter. Compact rows
put the address below the name. Site admins/Super admins see menu/footer draft
switches and reorder handles;content roles see no site controls. The native
Pages header omits the extra Back/breadcrumb row and uses Edit menu/New page.
Imported-site Pages and creator stay frozen. No per-row publication switch.

Switches call the existing Header & menu/Footer draft commands,check their
loaded revisions,and preserve the other frame content. Native footer links
with unsupported formatting link to Footer instead of flattening the content.
Drag changes the operational page-list order and saves corresponding menu
sibling order as a draft;external links/group locations stay. The handle's
Up/Down keys provide the same command. Concurrent reorder snapshots are
checked;public menu/footer pins change only through normal Publish. Ready and
review describe added/removed menu/footer links by their saved labels.

New page uses the shared guarded dialog:90-character title,address preview
with Change,155-character description,four starting choices (blank,shared
design,same-site page copy,external website for admins). A website creates
only a menu draft. Pages are private;the admin's Add to the menu when it's
published uses the same menu command. A copied page retains its content and
new title/address/description under normal duplicate/details/draft commands.
Normal permission checks stay;non-admin creators cannot change the menu.
Existing menu-label capacity is80;an external link name over80 is refused
plainly rather than truncated. Unknown create results require checking Pages
before retrying,preventing an accidental repeated create.

The optional new-page menu switch starts off,as shown in SymPages. Use the
existing choice-card layout for Start from;radio inputs retain keyboard access
and their shared card receives a visible focus outline. Search description
is a single-line field. These choices do not change imported creators.

### Symphony section tools implementation contract
Native section More adds Copy link to this section,Change link name and Copy
to another page for administrators;the hard content-role rule stays. The
existing clipboard Copy section stays as a compatibility fast path. The link
and copy steps reuse the remembered-width inspector,Back/Done,shared fields
and local draft leave choices. The page remains visible and temporarily
read-only while its nested step is open;page actions resume after Done/Cancel.

Link-name review counts saved destinations and affected drafts. Save checks
the exact source version plus the reviewed related heads,then saves the source
and all unambiguous related page,menu,header/footer and list references in one
normal transaction. Prose and unrelated formatting stay exact. A changed
related draft can reload its review;changed source asks for a page reload.
Ambiguous shared fragment-only links and unsupported formatted links refuse
rename for manual review. Earlier names remain safe public scroll targets
while related drafts are reviewed. Copies drop earlier names and allocate a
unique primary link name. Imported-site fragment behavior stays unchanged.

Normal readiness checks declared native section links against the current
public projection;the existing release simulation judges the complete future
selection. Review the source and its referring drafts together in Publish.
The existing hero missing-section rule remains. Legacy undeclared fragments
retain compatibility rather than becoming new findings. Plain saved-difference
review names the section-link change;no hidden publication is added.

A section copy reads the exact saved source,only offers other ordinary pages
on that site,requires an explicit place and the loaded destination revision,
and uses the existing section insertion helper and page draft command. Text,
tags,settings and other destination content stay;no page-specific code. An
unconfirmed copy asks the person to check the destination before retrying.

The native Advanced link-name control also opens the reviewed link step;it
cannot bypass related-draft updates. The original-editor control stays frozen.
The owned r8 editor journey now uses that step and retains its authored-anchor,
layout/recovery/Undo,clipboard/paste and public-output assertions. No test
timeout,tool,configuration or retry changes. Link save returns through Done
to a reloaded source draft;its normal checkpoints remain in History.

### Symphony section-library implementation contract
Native insertion chooses an allowed page gap before browsing. Add here lines
are shown only while choosing a spot,with Add above/Add below also in More.
The library docks on the left beside the real page,with Change spot. Choosing
a section renders a private temporary sample at that gap,without a page write;
Move up/down changes the gap,Cancel removes it,and Add this section uses the
existing insertion and draft commands exactly once. The sample values are the
same starting values used by insertion. Search matches approved Symphony names
including Theater Space for the existing hero slider;no new section types.
Imported-site library and layout-replacement behavior stay unchanged.

The owned native core-library journey follows this approved insertion review
instead of the former modal section-only preview and Browse all modal. It
keeps focus-mode,remembered resize,error/loading,phone,sample-field,Publish
confirmation and cleanup assertions. Browser tools,helpers,configuration,
timeouts and retries remain unchanged. The native shared card compact mode
leaves existing/imported card defaults intact. Add at end remains a fast path.

Native library labels use Cards,Questions and answers,Service tiles,Stories by
tag and Hero slider for the corresponding existing definitions. Search keeps
the earlier CMS names through their slugs and the approved Symphony aliases.
Preview/Add/Cancel controls stay in the shared panel,clear of page content;the
catalogue remains visible. This control placement differs from the mockup's
controls around the sample to preserve the no-overlap editing rule. Existing
Add at end,favourites,templates and clipboard insertion remain fast paths.

Native core-library cards use the existing local generated core thumbnails;
this avoids unavailable older media-thumbnail paths on the retained demo.
Site-owned cards keep their stored picture. Imported card defaults are frozen.

### Symphony Stories implementation contract
Keep the existing list,tag chips,Reviewed,Hide from feeds,filters and writer.
Add one Feature star and a Newsroom order tab. Up to five featured stories have
site-owned integer positions;drag or keyboard controls reorder only those five.
Everything else remains newest first by story date. The visitor preview uses
the same eligible draft selection as the Newsroom. Hidden,removed,future and
expired stories still obey existing rules. Sector feeds remain by tag/date.
Order/star changes save private drafts and require normal Publish review.

Optional Author and newsroom position are ordinary optional Story fields added
through an explicit administrator Stories update. New sites start with them.
Entries keep stable IDs and all existing article words/photos. Editors use the
existing entry save command and collection revision checks;database permissions
stay. At most five unique positive positions are enforced in that command.
Connected feed refresh never owns these fields. Summary gains its155 counter;
unchanged longer imported summaries retain the existing exception. Author is
optional,validated,covered by recovery and shown only when supplied.

### Scheduling repeated local times
Schedule forms preserve device-zone wall times. A nonexistent spring clock time
asks for another time. During the repeated autumn hour,use the next future
occurrence and show its date,time and zone abbreviation before confirmation.
Keep the normal one-minute/two-year limits,review pins and permission checks.
Apply the same interpretation to releases,single pages and schedule retries.

### Publishing a featured group
A one-Story publication or schedule must leave the combined public featured
positions unique and at most five. If another feature change is needed,refuse
during normal review before publication and direct the editor to publish the
Newsroom group together. Independent story words can still publish separately.
Manual Story selections retain their date/selection behavior rather than
implicitly adopting automatic Newsroom priority.

### Publish fix links and refreshed comparison wording
A readiness link to a section title opens the dedicated Title panel with that
field visibly selected and its section still outlined. Preserve the existing
selected-field marker and inspector reference used by focus/reveal behavior.
Refreshing an out-of-date comparison shows the latest saved named differences
(such as “Hero: changed heading · Hero: changed intro”),then compares that saved
version. This supersedes the older generic “2 text changes” assertion;no checks,
permissions or stale-version protections are removed.

### Optional Story controls preserve unrelated drafts
Adding Author and Newsroom order does not require unrelated stories to gain
new draft versions on the next content save. Preserve an unchanged Story head
only when every existing field definition is identical and new fields are
limited to the exact approved optional controls. Identical-field policy updates
are also compatible. Validate all values/media/ownership/revision as before.
Scoped and grouped publication accept those compatible immutable versions,with
normal review and feature integrity enforced. Other field additions,removals,
reordering or changed definitions retain the existing explicit upgrade rules.

Older,structurally different Story models receive an explicit “Update editing
controls for N stories” Publish choice. That reviewed normal update preserves
existing words/photos and adds approved control defaults. Compatible optional
additions do not create a zero-change items choice. The read-only compatibility
check uses the caller's existing row access;it grants no record access.

### Symphony Settings delivery contract
Reuse the existing versioned site_settings/site_setting_versions records for
General,Search & sharing and Social accounts. Keep site data separate from
visual theme tokens. Add guarded draft/publish commands and integrate them
with the existing release review,scheduling,History and recovery;do not create
a second publishing path. Site admins and Super admins manage these values;
existing database tenant and role checks remain enforced. No change on read.

The Settings workspace uses the approved vertical groups. Social accounts
becomes the single source for Footer and sections explicitly using site social
accounts. Existing chapter-owned content links remain content unless the
approved chapter map assigns them to the site source. Reuse an existing Links
section and its shared controls;no new section type. Preserve old/native and
imported output until the site publishes a Settings change. Existing TikTok
accounts remain supported as an existing service;the default table is the five
accounts in the approved mockup.

Save draft,Schedule and Publish use normal review and shared leave choices.
General includes name,155-character description,country,language,contact email/
phone and mailing address. Search & sharing includes safe verification meta
tags,optional plain hints and View sitemap. Raw scripts,analytics settings and
arbitrary head markup are excluded. Page descriptions and automatic canonical
links remain page-owned. A site description supplies a fallback only.

Keep existing Chapter setup,reminders,redirects,addresses,people,export and
archive access working behind the appropriate Settings groups/advanced tools.
Record any extra controls needed to preserve them as Differs with reasons.
Deliver the release integration first,then the Settings states one piece per
commit with1440/1024 comparison. Old Sign-in,Better Together and brought-in
site behavior remains frozen.

### Settings foundation verification boundary (2026-11-01)

The Settings implementation reuses `site_settings` and immutable
`site_setting_versions`, with guarded admin-only draft/publication commands.
`site_settings` is a normal reviewed release target, including scheduling,
context pins, friendly saved differences and coordinated History recovery.
The first explicit save retains the already-public name as the recovery
baseline. Optional General/Search/Social blocks do not backfill existing sites.
Copies replace the source name with the destination name in settings versions.
The three approved Settings screens and their public Social/Search behavior
remain separate unfinished work until their real-app checks pass.

### Symphony6 Social accounts ownership (2026-11-01)

Settings → Social accounts uses the five approved rows. Preserve an existing
TikTok row as the only extra service; do not invent account addresses. A normal
private settings draft supplies Footer visibility and explicitly connected
existing On-page navigation sections (Links from → Site social accounts).
No new section type. Older immutable definitions and chapter-owned manual
links remain unchanged. Generated account links cannot edit a page-owned copy.
Their heading remains page content. Empty connected sections are hidden from
visitors; editor guidance points to Settings. A later save conflict retains
fields and links to saved settings in a separate tab. Native document departures
keep the browser warning; guarded in-app navigation uses the shared three choices.
The existing Settings General controls remain pending their own approved pass;
Search & sharing is added in its own next screen commit. The Social screen's
Save draft/Schedule/Publish actions are required by the maintainer-wide UX rules
although not drawn in SymSettings.

### Symphony6 Search & sharing delivery (2026-11-01)

The approved verification/hints/sitemap screen uses the same Settings editor
controls and private-save/review path as Social accounts. Supported quoted
verification tags become structured tokens,not raw head HTML. Public metadata
is escaped and disappears when cleared and published. Keep page descriptions,
automatic canonical addresses and staging noindex unchanged.

View sitemap is an authenticated,admin-only XML preview of published routes,
using the public sitemap's formatter. Public staging sitemap404 is intentional
and remains enforced. The extra one-line preview/live-address explanation is
required to avoid implying that a local staging address is indexable. No domain,
DNS or deployment change. The General screen and remaining grouped settings
continue separately;the shared header/nav does not constitute their completion.

### Copied Settings first-release recovery (2026-11-01)

New copied Settings versions use schemaVersion1 and the destination name.
Preserve supported canonical General/Search/Social blocks;translate older
name-only versions as new destination-owned records. Never rewrite the source.
When the first public Settings version had no predecessor,coordinated History
recovery uses the existing reviewed unpublish action and preserves its private
draft. Keep Admin authorization,owned version pins,CAS and complete-site
first-release recovery checks. No content backfill of retained sites.

### Symphony6 General screen and retained Settings tools (2026-11-01)

Native sites open Settings on the approved General fields. Site name is a
private draft until normal reviewed publication,alongside the other fields.
General saves name and the General block atomically;Search and Social blocks
are preserved. Country/contact/address begin empty unless previously saved;
English is the existing public fallback. A published language sets native HTML
language,and the site description is used only when a page has no description.
These fields do not overwrite Header & menu or Footer content.

Publishing & approval retains Stories policy and chapter defaults/teams.
Review reminders retains January/July tools,or explains their unavailability.
Advanced retains addresses,people,scripts,backup and archive operations;this
extra group preserves existing working tools outside the approved General form.
Existing names of those operations remain. Stories setup Back/Cancel returns
to Publishing & approval. Original-design sites retain their existing Settings
layout,name behavior and output. Native content roles do not see Settings.

The older foundation check now follows Settings → Advanced for maintenance
tools and Overview to return. Native Site look already omits the extra Back
link/breadcrumbs under its approved screen;the assertion reflects that behavior.
Unrecognized older Settings fields cannot be silently replaced by opening the
new General form;require compatibility review first.

### Round3 site sidebar and switcher structure (2026-11-01)

Place the selected site above Search or jump to. Use the approved compact
initial badge,full site name and chevron. Native sites group Header & menu,
Footer and Site look under Site-wide,and Publish/Settings under Publishing.
Hide native Site look and Settings from roles that cannot administer this site;
being an administrator elsewhere does not grant controls here. Existing database
rules and frozen original-design access are unchanged.

Existing section/template management stays grouped in a collapsed Advanced
control;it is not shown to content roles. Workspace groups global destinations
below the site work. Record existing All sites,Domains,Activity,explicit fold
and Sign out controls as functional extras during the comparison;they preserve
working administration and account access. Editors' task Home and further role
cleanup remain separate required work. Original-design sites keep their labels
and controls;the shared switcher position follows Pages/SiteOverview. A new
layout does not itself establish Matches in the comparison ledger.

### Pages list compact layout at1024 (2026-11-01)

Native Pages uses the shared compact header,toolbar,search field,small filter
pills,content-table density and guidance Note. Search remains labelled for
assistive technology without a second visible label. Menu-parent labels and
last-edited dates stay on one line;controls retain their existing shared draft
commands. At tablet width,the linked page title is the direct editing path and
the duplicate Edit button condenses. View live and More remain visible. Desktop
retains Edit as drawn. All actions and role checks remain;original-design Pages
keeps its existing list and data. Keyboard move guidance stays on the drag
control while the visible note follows the approved wording.

### Native content-role Home and short menu (2026-11-01)

Content-only accounts start on their tasks for an accessible native site:
Add a story,Edit a page and Coming up where existing permissions allow them.
Contributor accounts see existing-story work and their approval requests;
assigned-page accounts see their assigned pages and existing chapter setup
access. Use saved story coverage/missing tags and existing calendar jobs for
attention,without a source refresh. Current site remains a link to its existing
Overview so bookmarked workflows remain available. Keep the product title Home;
the role-state mockup heading is not a new navigation name.

Use the native short menu:Home,Pages,Stories,Media and Publish for an Editor;
include Lists only when there are non-story lists,hide Publish for Contributors,
and retain scoped chapter access. Existing Inbox appears when there are requests
or while viewing it. Site switcher retains All sites. Reviewers,administrators
and original-design-only accounts keep their existing Home until their own pass.
Home does not change database rules. The subsequent private Story creation
command explicitly grants existing Contributor members one bounded operation:
create the private article for their own validated, unpublished Stories row.
General page creation, publishing, scheduling and site controls remain denied.
Opening or cancelling Add story creates nothing; a save atomically stores the
entry, shared-template article and retry receipt. Page-only accounts are excluded.
The paired single-story submission/approval flow is locally checked through
the existing review commands;the final Contributor acceptance walk stays open.

#### R3-8 Echelon template section conversion

The approved split hero and jump links are shared versioned variants of Split
hero and On-page navigation in the national library. They have ordinary text,
Media,button and repeated-link fields;the national parent retains the frame
and per-site sans-serif font. Fixed navy/photo columns and highlight bars come
from the final reference CSS. These variants add no per-page code or style
controls. Older definitions and all retained page pins remain unchanged until
the complete section map and Echelon Media conversion can be reviewed together.
The full chapter/national conversion,exact wording,remaining sections and clean
26-change state remain required;this opener piece does not close R3-8.

Echelon body conversion uses three further shared variants:Feature statements,
Text and photo collage,and Three pillars. Cards,icons,paragraphs,buttons and
all three photo focus points are normal fields. The shared assembly chooses
only the approved national/chapter wording differences. About us and What we
do are shared in the draft role map;database-lock expansion and full retained
page assembly remain required before declaring the conversion complete.

Echelon FAQ uses ordinary question/answer fields and native grouped details,
so opening one question closes the previous one withoutJavaScript. Contact
panel text,benefit lines and resource link remain fields;its form reuses the
existing contact endpoint,required fields,validation and local recording.
Echelon displays Message for the existing comments field and the approved
placeholders. Standard forms retain their current labels. Named-person delivery
configuration and chapter FAQ/shared locking remain part of full conversion.

Echelon reference Media is an explicit local import of the11 reviewed raster
files. The unused outer banner is excluded;the shared shield remains a theme
asset. Source hashes are checked before upload. Use normal upload receipts and
image processing,with descriptions,focus points,source metadata and replacement
tags for chapter-borrowed photos. Repeats verify the saved import record and
ready object instead of creating duplicates. Importing Media never publishes a
page or changes another site's assets. Photo rights remain for reviewer approval.

Echelon chapter contacts keep the reviewed Membership Chair,name and email
fields and the two supporting roles. The board is a normal repeating list of
photo,name and role fields,using the existing eight-first/native Show all
behavior. Missing chapter names/photos remain placeholders;no person is invented.
Shared template CSS adapts the existing board disclosure,with four columns
on desktop and two on phones. Full page assembly/role map remain required.

Every shared Echelon section also ships its local library thumbnail. Offline
preview generation includes the shared Echelon skin;new previews must not create
missing-image requests on native or brought-in sites.

Echelon national leadership uses the reviewed group photo,feature copy and
four public council portraits/names/roles from the supplied national template.
Every image is a normal Media field. Chapter board remains separate;full
national/chapter availability and shared role enforcement follow the section map.
New section starting links preserve supported New tab and Nofollow boolean
choices;arbitrary metadata stays excluded and rendering still sanitizes URLs.

Echelon chapter events keep the reviewed three examples,marked Sample events,
with one native date input per event and automatic month/day display. Event
details use native disclosure and ordinary rich text;no Events screen is added.
An empty event list hides publicly. Follow our chapter supports chapter-owned
links and the existing saved site accounts;empty lists hide publicly. Example
social links are marked samples and must be replaced. National has no events.
Empty repeating lists in the editor say “This list is empty. Add a card from
the panel.”,using the item name and the appropriate a/an article.
Formatted date fields keep their code-owned display in the canvas when edited;
they use the normal date field rather than inline editing the displayed month.

ChapterWhere adds Their division’s page as a distinct destination,with an HTTPS
address,private contact and Division’s page filter. Its flat form has Cancel
and Save draft;other chapter setup paths retain their sections/people steps.
The destination question is Where does this chapter send visitors? with native
radio choices. Division destinations create no local page and expose no chapter
page editing or invitation action. Publish changes the directory through the
existing release command. January/July checks ask the contact to check the
address. This local-only build says Address not checked;it never requests a real
division website. Existing Not listed behavior and contact privacy remain;the
mockup's contact-only public listing requires separate review.
The chapter form guards Cancel,Escape and navigation with Keep editing,Save
draft and leave,and Discard changes. Invalid saves keep fields and the form.
Previously assigned local pages are retained separately when a destination
changes;they are not silently archived or deleted.
Division links can be reviewed in a complete first site release. The existing
first-release requirements for a page,Site look,header/footer and menu remain
enforced. Chapter contact differences are shown only in the Admin release
review;public directory output excludes contacts.
The Chapters header follows ChapterWhere's “Every chapter, and where it sends
visitors.” wording and omits the extra Back/breadcrumb row. Existing update
mode and setup/invitation actions remain available pending the full Chapters
7b pass;this feature does not claim that complete screen Matches.
Publish confirmation names every selected change in its scrollable review;
it never hides the seventh or later item behind a “more changes” count.

The Echelon national directory uses the existing published same-site chapter
reader,with an immutable chapter slug for stable map identity. Draft/unlisted
chapters and private contacts remain excluded. Approved local US outlines and
marker positions supply appearance only;all destinations come from published
chapter records. Unmapped chapters remain in the list. Native links and GET
search work without JavaScript. A fixed code-owned enhancement adds marker
details and filtering under its exact script hash. No external map library
or website request is used. Source outline licensing remains Needs administrator input.

The reviewed Echelon chapter composition is eleven existing shared variants:
hero,jump links,About us,Who we are,What we do,events,chapter contacts,Follow,
board,FAQ,and contact panel/form. It takes site-owned Media explicitly and
keeps the supplied wording and marked placeholders. Its explicit template marker
selects one white shared page frame;standalone library sections keep their
existing frame. Hidden chapter options remove corresponding generated jumps;
with events off,related calls to action lead to contacts. Existing authored
chapters are not automatically rewritten by reads or demo startup. Full shared
permissions,retained conversion and national assembly are required before R3-8
is complete.

Chapter pages exclude Story feeds,chapter finders and other national-only
sections from the library and incompatible saved template choices. The same
boundary is enforced on every new page version,including direct command calls,
copying and History. A reviewed chapter composition also rejects page-owned
code;existing trusted-code checks remain. About us and the common FAQ join the
existing contributor shared-section locks. The common FAQ block stays Shared
per the approved editor;local question editing and the complete division/shared
propagation audit remain unfinished parts of the draft role map.

Reviewed chapter jump links are generated from visible sections and their
current link names. Their panel explains that and has Back,Done and Escape.
Option changes keep authored text/photos and return Follow to its approved
place after contacts when social-first is off. Legacy chapter ordering and all
existing invitation/review permissions remain enforced.

### Single-Story Contributor review (2026-11-01)

Content creators use Save draft,Preview and Submit for review together in the
normal full-screen Story editor. Submit first saves privately,then shows the
saved plain-word difference,what will be sent and an optional note. Cancel and
Escape return to the saved story. The request goes to the existing Inbox;comments,
Return with feedback and reviewer permissions remain unchanged.

A page submission for a Story captures that entry,its fields/tag labels and an
immutable article preview. Review/History evidence uses those saved words,even
after the working Story changes. Body,photo,tags,visibility or field changes
supersede an open request. An unrelated Story save that merely creates an
identical version does not. Approval verifies current values and published
settings,then publishes only the selected Story and its submitted article in
one transaction through existing commands. Other Story drafts remain private.
The first-site review,date,Media,readiness and trusted-code checks remain.
Public article rendering continues reading the published Story;it never reads
private review snapshots. General pages and whole-list reviews retain their
existing flows. This does not close the final fresh-account acceptance walk.

New Story articles use a shared,optional Story library link instead of a fixed
SAWSO Newsroom address. Keep the reviewed SAWSO breadcrumb where that page
exists;omit it on sites without a published (or first-release) Newsroom. Do not
create an empty page or waive readiness to satisfy a missing destination.
Existing immutable article pins retain their reviewed definition until adopted.

### R3-7b Reviews page structure (2026-11-01)

The existing /inbox address is labelled Reviews,matching ReviewInbox. Keep the
current approved shell;use the shared queue/detail Workbench rather than extra
Back links,summary cards and stacked empty management groups. The remembered
queue width starts at300px. Search and status choices stay above its requests.
Requests show the mockup's relative age,with the exact Eastern time in the
time element's title and machine-readable datetime. Show actual request
titles,authors and saved differences;illustrative mockup
text is not seed content. The selected request puts Open in editor,Return with
feedback and Approve and publish at the top. Publish is the sole red primary
action;unavailable role actions are hidden. Header actions wrap at1024. Keep
the existing Return with feedback working name for the mockup's Ask for changes.

Changes leads with the same plain words and values as Publish,including added
and removed card/slide fields,and the saved checks. Preview and Discussion
are separate tabs. Submitted Story evidence remains immutable;working drafts
keep their current preview. Existing list reviews remain in their dedicated
working workbench under Lists. Administrative requests and failures move under
Advanced,within their existing permissions;content-only accounts do not see
empty management areas. This page does not redesign the embedded Publish panel.

Unsent review comments use the existing three-choice leave prompt. Save draft
keeps the comment only in this browser under the signed-in person and request;
it never posts a comment or publishes a page. Restore it only for an authorized
request. Add comment sends it and clears the local copy. Database permissions,
submissions,approval,code/sample checks and the comment-only reviewer boundary
remain unchanged. Empty,loading,failed and unavailable states give a next step.

### Echelon source and photo requirements

National and chapter pages use imported Media with focus/descriptions and the
reviewed shared templates. Compare the approved local source at 1440/390. No
generic sample picture may remain on a published Echelon page or new chapter;
library additions cannot publish with an unmarked sample picture. Borrowed
photos and empty board entries remain marked for replacement. Missing approved
national content requires content review and must not be invented.

### Echelon photo creation and publication contract

On chapter-enabled sites,the editor library and new chapter setup resolve only
ready,described imported reference Media belonging to that site. Preserve its
focus points and original objects. New chapter setup uses the reviewed shared
composition when its reference set is available;without chosen photos image
fields stay empty. Never silently use another site's Media or generic sample
pictures. Empty board names/faces remain marked replacement entries. Publication
rejects a generic sample picture at the database boundary on all such pages,
even with sample-text consent or an administrator override. The normal readiness
review explains the required Media choice before publication.

### Echelon national composition and shared social accounts

The national page composes10normal shared sections:hero,page links and social
accounts,chapter directory,About us,Who we are,three pillars,three community
story cards,leadership,FAQ and contact. Apply only the approved wording changes.
The national Image link cards variant is unavailable on chapters. Keep the
supplied article destinations until their full text/dates are provided;never
create empty CMS articles. Every picture is site-owned described Media.

National social links read the existing Settings accounts and open a new tab as
in the reference. Their derived group does not replace page jump links;an empty
account list never hides navigation. Chapter-owned social links remain manual
unless explicitly connected to the site accounts. Use the reference's Bootstrap
brand marks as fixed local SVGs,with their source hashes/MIT notice retained;
Material Symbols remains the editor icon set. National and chapter compositions
share the same national-parent white frame and site-level header/footer.

Echelon's projected template policy also omits generic illustrations in previews
and public output,including definition examples resolved by an empty list. A
sample-text consent or readiness override cannot make those pictures visible.
Authored generic-picture values remain refused by0194. Other sites keep their
existing rendering. New policy projection does not backfill or rebuild frozen
sites;it is included when Echelon publishes normally.

National Echelon pages cannot add chapter events or chapter-only sections,
including through copied templates or direct save commands. Reviewed national
compositions use shared definitions rather than per-page HTML or CSS.

### R3-5A implementation contract

Data values live in the existing versioned site settings,as a separate admin
workspace. Stable IDs bind stat/text fields;authored labels remain local. Public
output resolves only published site values;an explicit draft preview resolves
drafts. Sources and as-of text travel with each number;small-print source is
optional. Status alone never edits a page. Existing settings save/review/release,
scheduling and History remain authoritative. Number changes show plain old/new
values and unique affected-page counts. Site admins manage;page editors only
pick through a page-authorized read. No permission or background-sync expansion. Current polish keeps the remembered
Number details panel beside the table at 1440/1024,with a bounded scrolling body,
Back/Done header and grouped fixed Save draft/Schedule/Publish footer. Its width
reserves room for the list. Shared compact rows keep names,values and status
chips on one line with full-value hover;source/date columns move to the inspector
when the table is narrow. Source display uses the shared switch,and page links
use shared chips/link styles. The file step uses the shared640px entry dialog
and760px review for required source fields,with normal form spacing. Existing
fields,actions and guards remain.

Number review wording follows DataNumbers: “[Number] changed from [old] to
[new]”,with its distinct page count. The Ready list and review share it.

Data values also has the required Doesn't change status. Fixed values stay
unchanged in file review and require an explicit status change before numeric
edits. The database enforces it. The stat picker fills empty/sample labels,
then preserves labels reworded on that page. Existing numbers in the picker
use their published values until an Admin publishes their saved changes;new
private numbers can be chosen and must publish with their first page.

Report library delivery starts with two of the five approved new types:
Letters with full message and Financial summary. All letter text/photo/source
fields and every expense,revenue and statement row are normal editable fields.
Native details work without JavaScript. Expense bars and revenue proportions
derive from the saved amounts;no page HTML,code or authored chart CSS is needed.
Other report sections,the retained report draft and source-number updates remain
open until their own pieces pass the actual-app/reference comparisons.

Report photographs use the same explicit local upload/receipt/processing flow
as other reference Media. A private source manifest binds each local file to
its hash,description and focus point. Keep a dump first and an import record
for safe resume/repeat verification. No source URL is fetched. Report images
stay site-owned;importing them changes no page or published content.


Report country stories and region lists use the next two approved reusable
types. Country stories have template-owned response, feature, reading and
text layouts with normal photo/caption, story, repeated number, impact,
related-story and source fields. Optional empty parts stay absent. Region
lists use a native View all disclosure and visual rich-text country lists;
the map remains the existing World View section. These library foundations
do not close exact retained report assembly, source-number updates or final
section-by-section acceptance. No per-page code or public source read.


The fifth approved report type is Page links bar. It derives current labels,
order and destinations from visible sections with a primary link name and
heading, using only the current page content. Earlier link-name aliases do
not create extra items. Duplicate/invalid names are omitted rather than
guessed. The phone disclosure reuses the same sanitized links and works
without JavaScript. Derived links are not editable fields; the phone list
label remains ordinary content. Heading edits refresh the real canvas so
the link words change immediately. Existing save/review/rename rules apply;
no extra page code, script, menu destination or public read is introduced.


The complete report composition reuses the normal cover, text/photo, tiles, stats,
contact, FAQ, World View and closing types alongside those five report types.
A closed shared template groups instances into report bands, with the normal
SAWSO header/footer and no page HTML, custom CSS or script. Optional Page link
label fields preserve the supplied short labels; when blank, headings supply
the bar labels. Exact report copy and Media choices live in its private draft.
Report-reviewer approval remains required before publication.

Rich saved-number bindings retain authored rich-text parts and escape only the
number substitutions before the shared rich-text sanitizer. Plain bindings keep
their prior escaping. Bound canvas fields select the ordinary number controls;
they do not accept ignored inline edits. Replacing one number retains the other
parts. Explicit detach restores resolved visual rich text on a normal draft.

### Section 17 scope and verification requirements

The numbered checklist, reference comparisons, admin 1440/1024 and public 390
requirements remain the acceptance baseline.

1. Each published chapter hero uses its own name from the approved source list.
   Preserve the other shared fields and verify two chapters through normal publication.
2. Run the required browser coverage on current builds and disposable fixtures;
   preserve assertions/timeouts and report any cases not run.
3. Public SAWSO, Echelon and annual-report differences require a recorded reason
   and review. Admin screens preserve the approved layout, order and wording;
   unresolved visual differences remain explicit defects or reviewed deferred work.
4. Update SPEC when a contract changes and keep the corresponding handbook guide
   current. Verification receipts belong in private storage outside Git.
5. A clean local installation must apply all migrations to an empty database.
   Independently restore a verified retained-content dump and check SAWSO/Echelon
   pages, drafts and History. Preserve separate databases and media roots.
6. In the usability walk, a fresh Editor changes a hero slide, adds a story tag,
   changes a number and publishes one change; a Site admin adds a menu item.
   Record clicks and wrong turns. Group Save draft/Schedule/Publish, retain
   Back/Done and required fields, and disclose unrelated options without removing capabilities.
7. Deferred work includes remaining defects, upgrade/recovery proof, source/story
   audits, independent local addresses, handbook coverage, environments, chapter
   setup and public-page sweeps. Static publishing follows ADR 0012 and its own gates.

Native section, card and hero panels share one fixed Back/Done header. Nested
controls use their own validation and Cancel behavior in that same location;
a second outer set is absent. The hero's former All slides button is labelled
Back, with its destination in the hint. Escape returns within the active nested
flow before closing its section. Icon choice has explicit Cancel. Original
imported-editor interfaces retain their existing controls.


Native Admin Home presentation: Super admins
and Site admins see Needs you,Your sites and Jump back in,in that order. Home
remains the page name;the visible New site action retains Create a site as its
accessible name. Saved home-page thumbnails are read-only,sandboxed and lazy;
counts and attention use authorized saved records. More tasks preserves existing
page/list shortcuts. Worker evidence remains Super-admin-only,archived sites
retain their disclosure,and the content-only Home is unchanged.


Native editor scaffold: at 1440/1024 the
single decision bar keeps saved state,History,Preview,Save draft,Schedule and
Publish;Undo/Redo and named device choices move above the real canvas. All sites
moves into More page actions. Structure/canvas/Inspector stay visible without
redundant pane tabs. This page shows a clickable saved-section outline and the
shared-header/footer note;the existing Add section at end action is visibly
Add a section while retaining its accessible name. Page settings and readiness
remain available;failed readiness opens Page checks. Imported editors retain
their prior presentation and every command/role rule remains unchanged.


Lists workspace presentation: Lists opens
its first authorized saved list by default,beside the existing list rail. All
lists preserves the index at ?all=1;an unavailable requested list shows that
state and the index rather than silently opening another list. New list moves
to one page-header action where permitted;the narrower List selector remains.
Table separates configured title/subtitle,status and saved update facts;Cards,
private item editing,CSV,ordering,bulk,schema and review/publication commands
retain their behavior and test-visible names. Current polish uses shared Card
regions and compact record rows,full-value hover,one reorder menu and a bounded
usage-link disclosure. At1024,saved update facts move to the item drawer. A
shared record board scrolls rows separately from the command region so the last
record is never covered. Item fields and dialogs use the shared Field/Button
controls;compact drawers keep their top/bottom edges within the window. No
schema or permission changes.


People presentation: People & access keeps
its sidebar label and address;the Super-admin page heading is People and its
visible Invite someone action retains Invite a person as its accessible name.
The factual table and role guide stay beside a shared,bounded nonmodal account
panel,with fixed Save/Cancel and the existing named account form region. Status
remains factual;no last-active time or sign-in provider is invented. Chapter/
division links,scope preservation,invitation controls,deactivation/reauthentication
and account commands remain unchanged. Non-Super-admin Your access stays scoped.


### CSV source recovery on leave — Round3
CSV inspection remains a dry run. Keep editing preserves its raw source;
Discard changes restores the last browser-saved source; Save draft and leave
keeps that source only in this browser, scoped to the account, site and list.
No rows are created by saving source, including incomplete CSV. Reopening
revalidates against the current field design. Add to draft remains the explicit
row-staging action and clears the saved source before adding, to avoid a repeat
import; normal item Save draft/review/publication are separate. Closing this
step preserves other item edits, while leaving the whole screen checks both
writers. Storage failure retains the source and refuses the leave save.


### Unfinished Media uploads on leave — Round3
A selected, unaccepted image file joins shared Keep editing/Discard/Save and
leave choices. Save runs the existing signed upload, validates description or
decorative purpose, awaits accepted bytes and reports verification/processing
without claiming the image is ready. It changes the Media library, with an
explicit explanation, and never inserts or replaces page/story content.
Failure retains the file and description; pending acceptance prevents leaving
and duplicate submission. Nested picker close/toggle/confirm checks only its
upload work, preserving parent drafts. A late ready receipt cannot hide a newer
unsent file. Accepted descriptions are edited later in normal image details.


### Selected-image organization on leave — Round3
Bulk folder/tag input joins shared Keep/Discard/Save and leave, with the explicit
immediate Media-library explanation. Selection changes,clear/select-page,
search/filters and CMS navigation check this work. Save awaits the existing
all-or-none organization command with current selected revision pins; rejected
or unconfirmed saves preserve input/selection. Confirmed writes may leave even
if the later library refresh fails, with the existing no-repeat feedback.
Discard restores last applied input choices without a write. Native details
and bulk forms resolve each other's unfinished work before changing tasks.
Starting a new target selection leaves room for bulk input; an unfinished
upload cannot be hidden by organization completion. Deletion remains separate,
requiring organization input to be applied or explicitly discarded first.


### Site setup browser draft on leave — Round3
The existing Super-admin wizard keeps its steps, choices, file import/export and
explicit idempotent Create site command. CMS exits,Cancel setup and the content
archive link offer shared leave choices. Save/Keep draft and leave validates and
keeps setup only in this browser for the account,then opens the requested
destination;it creates no site or address reservation. Discard clears this setup
and browser copy. Autosave reports recovery only for valid,successfully stored
choices;invalid changes retain the last valid copy without claiming to save.
Storage failure keeps fields and refuses save/discard exits. Pending file reads
and site creation block departures;confirmed browser recovery supports reload.


### Template review preview target — Round3
Review starts Preview on with the first site selected for an update,falling back
to the first available site only when none needs an update. Preview selection
does not change the update selection. A new preview clears stale HTML/error
while loading;an invalid binding still blocks creation,while a later valid
preview can recover. Normal application rechecks every selected fingerprint.


### Template Start-site setup on leave — Round3
Typed setup in Start a site from this uses shared Keep/Discard/Save draft and
leave for Cancel,close,Escape and CMS departures. Save validates the existing
start payload and keeps choices only in this browser,scoped to account/context
site;it never creates a site. Reopening restores choices;Discard restores opening
values,and Clear saved setup removes the browser copy. Invalid/unavailable
sources or storage save/clear failure keep fields. Explicit creation retains
normal rights/request reuse and one in-flight command;successful creation clears
the browser copy when storage permits. Pending creation blocks departure and field changes.


### Publish-later intent on leave — Round3
Changed time/exception fields use shared Keep/Discard/Save draft and leave for
CMS navigation,review selection and closing Publish later. Leave-save stores
only choices and the unchanged request in this browser,scoped to account/site/
review;it never schedules or publishes. Reopening that review restores choices,
not approvals. Discard returns to opening/saved choices;Clear removes recovery.
Storage/command failure keeps fields. Only explicit Schedule selected changes
queues the pinned review with existing rights/readiness/staleness/time checks;
pending commands block departure. Accepted commands clear recovery when possible.


### Single-page and retry schedule intent on leave — Round3
The Scheduled publishing form and retry dialog use shared private leave choices.
Browser recovery is scoped to account/site,and separately to each failed attempt.
It preserves time,action,reason and saved version/revision selections,never
queues work on leave and restores no reviewed findings. Restored stale/missing
pages require explicit reload/selection. Closing retry protects only retry
fields;another local form stays intact. Storage failures preserve inputs;normal
explicit scheduling/retry retains rights,readiness,reviewed findings,request
reuse and pending guards. Clearing recovery resets intent;accepted commands clear
its browser copy where possible,without changing page heads or failed history.


### Archive import setup on leave — Round3
Super-admin archive import uses shared Keep/Discard/Save draft and leave.
Leave-save keeps the source archive and destination in asynchronous browser
storage scoped to account;it creates no site. Restore revalidates the source
and resets site-file/layout approval. Storage save/clear failure keeps visible
fields;Discard returns to opening/saved choices. Archive replacement protects
current setup and file reads/imports block departure. The unchanged uncertain
request survives recovery;only explicit Create private draft copy imports under
existing rights and review checks. Accepted imports clear recovery when possible.


### Advanced section authoring on leave — Round3
Visual and HTML section tools participate in shared Keep/Discard/Save draft and
leave. Local drafts survive mode switches. Save uses the existing library save,
requiring the current checked preview and change note;no page content or public
version changes on leave. Discard restores opening fields and clears preview
state. Failed/stale saves retain fields;pending previews,file reads and saves
block departure. Saving both tools follows their normal independent commands,
without relaxing rights,placement or expected-version checks.


### Redirect setup on leave — Round3
Add/Edit redirect and spreadsheet source use account/site-scoped private browser
recovery with shared Keep/Discard/Save draft and leave. Local departures and
file replacement protect inputs;storage failures keep fields. Leave-save never
activates routing. Edit recovery retains its old revision check,and spreadsheet
recovery stores source rather than an approved preview. A refused import refreshes
current routes and requires preview again. Only explicit Save redirect/Import
changes routing under existing rights,revision and all-or-none checks. Pending
file reads/writes/removal block departure;accepted commands clear recovery where
possible. Native and original-design routes keep their current presentation.

### People access intent on leave — Round3
People access and invitation forms use shared private leave choices for closing,
account switching and CMS navigation. Save draft and leave records raw choices
only in account/person-scoped browser storage,including the opening account
revision. It never updates permissions,deactivates,creates accounts or sends
invitations. Explicit commands retain normal rights,validation and deactivation
confirmation. Stale restored revisions refuse without overwriting current access;
unavailable saved sites require clearing/reopening. Save/clear failures preserve
fields,pending actions block departures,and accepted account commands alone clear
the recovery copy. Discard restores the opening/last browser-saved baseline.

### Chapter settings intent on leave — Round3
Chapter defaults,new division names,division staff choices and review-check
settings have separate account/site (and division) browser recovery copies.
Shared leave-save never changes defaults,creates a team,grants/removes access or
records messages. Default/check recovery retains its opening revision;accepted
explicit saves use the exact command-returned revision as their new baseline.
Saving one form preserves another form's unfinished choices. Removing staff
preserves an unfinished new-staff entry. Pending commands block departures;
failed saves/clears retain fields. Check preview tabs/month/year are read choices
and create no drafts or messages. Explicit local message recording does not save
or discard unfinished check settings. Normal authorization/commands stay intact.

### PDF category changes on leave — Round3
Documents offers shared Keep/Discard/Save and leave for unfinished category
changes. Save and leave performs the ordinary checked document-organization
command and updates library metadata immediately;it never changes page/story
content or publishes a PDF. Document selection,search/filter/paging,refresh and
starting an upload preserve the originally requested destination until save or
discard succeeds. Failed/stale saves retain category and selected PDF. Pending
metadata commands/uploads block exits. Archive/restore remain explicit and
require resolving category changes first;existing PDF bytes and links stay intact.


### Everyday admin screen acceptance

Everyday admin screens use the approved layout and shared controls, spacing,
panels and lists. Inspect authoring at 1440/1024 and public output at 390, with
no controls overlapping the page.

0. Item 38 covers existing leave choices on everyday writers. Additional leave-choice workflows remain deferred; preserve the native Back/Forward fallback.

1. Review these screens: Admin Home,Site overview,page editor (whole frame,both panels,canvas chrome),Stories list/story editor,Tag manager,Header & menu,Footer,Site look,Lists,Media,Data values,Publish,History,Chapters,People,Settings. Compare each beside row10 or its earlier mockup at 1440/1024;fix every visible defect using shared components/tokens,no one-off CSS. Resolve existing visual defects before accepting these screens. Required corrections:
- Align every title's top spacing with Admin Home;fix Chapters' top-edge title/buttons.
- Identical sidebar groups/order and an icon on every item,following Main,Chapters,SiteSettings;Home/Header & menu/Chapters must agree.
- Sticky Settings section navigation,without an empty column while scrolling;mockup switches for on/off rules and choice cards for options instead of native checkboxes.
- Put all local recording tools,including Try a contact check,Record contact check,Record waiting review messages and Local outbox,inside one closed “Test tools (this computer only)” disclosure visible only to Super admins. Preserve capabilities/checks.
- Same button style/height within a bar;fix the editor Preview that currently reads as plain text beside History/Save draft,using the mockup’s matching button treatment.
- This page's full-width Add a section aligns with Sections.
- Name the opening section for its actual role,including hero slider,in Page structure/Sections rather than only Featured stories.
- Shared disclosure/link styling replaces native triangles and default blue underlined chrome links,including Page checks,Header & menu and Advanced.
- Canvas field outlines only on hover/selection;floating/zoom controls never cover content.
- Detail panels fit tags side by side;no mid-word breaks;truncate long emails with full-value hover.
- Single-line table names at1440;consistent status chips including Own website and Draft;at most one row action,with Set up/Invite secondary actions in panel/menu.
- Chapters header: title,one help line,filters,Add a chapter as sole primary;Local outbox in Test tools.
Record the reference and any remaining difference/reason for each screen. Run the checks appropriate to its changed behavior and the release gates.

2. Usability acceptance: fresh SAWSO Editor changes hero slide,adds story tag,changes number,publishes one change;Site admin adds menu item. Record clicks/wrong turns,disclose irrelevant options without removing capabilities,and retain grouped Save draft/Schedule/Publish,Back/Done and required fields.

3. Maintainer onboarding: clone the reviewed GitHub release into a new checkout. Follow the handbook with a normally seeded demo on independent ports/database, without a restored dump. Confirm Admin, SAWSO and Echelon. Document exact tools/versions and correct incomplete instructions. Preserve the retained demo; retire only the explicitly disposable test copy.

4. Complete the SPEC acceptance walk, including required browser coverage and admin comparisons against the approved mockups. Resolve failures or record reviewed deferred work before release acceptance.

5. Release only reviewed, verified commits. Preserve the retained demo and record remaining work and administrator decisions.


### November 11 scope addition — GA4 fields and tracking

Cagatay's current request adds per-site GA4 Measurement ID fields and governed,
opt-in public tracking as the first phase of Jon's Analytics request. This
supersedes earlier Analytics-settings exclusions for that narrow feature.
The existing administrator-only draft/publication flow and tenant isolation
remain required. Tracking defaults off, test addresses require a separate
choice, and private previews/CMS screens are excluded. In-CMS reporting remains
a later Data API integration; the initial Measurement ID setting does not
provide report access. Migration 0210 requires operator review/application
before the matching application is deployed.
