# CMS V2 screen design briefs

Screen requirements and reference images for the interfaces described in
[SPEC.md](../../SPEC.md). Start with the shared brief, then the relevant screen.
Use approved mockups under `docs/design/approved/` and inspect the implemented
screen at 1440/1024. Screenshots are design references, not runtime specifications.

Reference image paths inside the repository:

- V1 references: `docs/ui-reference/v1-cms-2026-10-02/images/` — especially
  `03-hni-editor-desktop.jpg`, `09-section-settings.jpg`, `10-docked-library.jpg`,
  `11-section-full-preview.jpg`, `18-section-library.jpg`, `27-event-content.jpg`.
- Current V2 ("before"): `docs/design/current-v2-2026-10-25/` (01–20).

---

## Shared design brief

```text
CMS V2 is a web-based content management system for the national digital team. Screen references use a 1440×900 light desktop layout with readable text and realistic content. Each screen follows the specified scope, shared design language and accessibility requirements. Record assumptions and design decisions for review.

WHAT THE PRODUCT IS
- A visual CMS that hosts a family of small websites: event sites (e.g., "Better Together 2027", a national conference in Kansas City, April 20–23, 2027), ministry/program sites (e.g., SAWSO, international development), chapter pages (Echelon young-adult chapters), resource sites (Human Needs Index).
- Non-technical people edit the REAL page: click text to type, click a picture to replace it, add pre-designed "sections" (hero, speakers grid, schedule, cards, call-to-action band) from a library, hide a section until it is ready, then publish.
- Users: Super Admin (platform lead), Editor (event coordinator; publishes), Contributor (volunteer; edits only what they are given and submits for review).

DESIGN DIRECTION
- Calm, modern, spacious, obviously easy. Think Webflow's editor clarity + Squarespace's friendliness + Linear/Notion's restraint + Shopify admin's tidy workspaces. Never cramped, never "dashboard of settings".
- The website being edited is the hero of the screen; the CMS chrome is quiet around it.
- Plain words. Never show technical terms such as schema, revision, definition, token, slug, record key, rem, renderer.

CMS CHROME VISUAL LANGUAGE
- Left app rail: deep navy #0D234F, white text, 232px wide (64px collapsed). Collapse is a small chevron icon button in the rail's top-right corner (NOT a full-width row).
- Workspace background #F5F7FA; white cards with 10px radius and a subtle border #DCE1E8; text #142238; muted text #5A6575.
- Type: system UI / Inter. 14px body, 12px meta, 16px emphasis, 20px section titles, 24px page titles. 8px spacing rhythm; card padding 24px.
- Buttons: Primary = filled navy; Publish = filled red #B4232C (only for publishing); Secondary = white with border; Tertiary = text-only; Destructive = red text, only in menus/confirmations. Icon buttons are 32px with tooltips.
- Status pills (rounded, small, colored text on a light tint): Live (green), "Live · changes not published" (amber), Draft (grey), Scheduled (blue), In review (purple), Hidden (grey dashed).
- Editor selection color: bright editor blue #2F6FED (outlines, name tags). Red is never used for selection.
- Every screen has a header row with a "← Back" control and a clickable breadcrumb (e.g., "All sites / Better Together 2027 / Pages").

THE PAGE EDITOR LAYOUT (used in many screens)
- Top bar (64px): ← Back to site · breadcrumb "Pages / Home" · status pill · Undo/Redo · Desktop/Tablet/Phone switch · save state ("Saved 2:41 PM") · Preview (secondary) · Publish (red) · ⋯ menu.
- Left panel "Page structure" (264px): list of the page's sections as compact rows with icons; drag handles; hidden sections show an eye-off icon.
- Center canvas: the real website page (Better Together 2027 look: white background, Salvation Army red accents, bold modern headings, photography of people at a conference), shown large with a soft grey surround.
- Right panel (360px, RESIZABLE by dragging its left edge; a subtle grip appears on hover): the inspector or the section library.

WEBSITE CONTENT TO USE IN MOCKUPS (Better Together 2027)
- Hero: "Better Together 2027 · April 20–23, 2027 · Kansas City, Missouri" with a "Register now" button and a "See the program" button.
- Sections on Home: Hero · Why attend (3 icon cards) · Speakers (6 people, photo + name + role) · Program highlights · Venue & hotels · Sponsors (logo strip) · Registration call to action.
- Use fictional people names (e.g., "Speaker (sample), Divisional Youth Secretary"); do not use real public figures.

ACCESSIBILITY
- Text contrast at least 4.5:1; focus rings visible; icons always have labels or tooltips; touch targets ≥ 32px in the admin.
```

---

## S1 — Home and All sites

References: `current-v2-2026-10-25/01-sites-dashboard.jpg`.

```text
Design S1: the CMS "Home" screen for a signed-in site editor, plus the "All sites" grid below it.

Purpose: people should land on what they came to do, not on statistics.
Layout:
- Left navy rail (expanded) with: product mark "CMS", Home (active), All sites, Inbox (badge 2), Activity; account at bottom. Small chevron collapse button in the rail's top-right corner.
- Header: "Welcome back" and the subtitle "What would you like to do?"
- A row of 4 large task cards generated from the person's assignments, each with an icon, a title, one line of context and an arrow: "Edit the Better Together 2027 home page" (Live · changes not published), "Update BT2027 speakers" (12 speakers), "Review 2 submissions" (from Echelon chapters), "Change the Human Needs Index site look".
- "Continue where you left off": 3 recent items (page thumbnails, page name, site, edited 2 h ago).
- "All sites": cards for Better Together 2027 (Event site), Human Needs Index (Resource site), Echelon (Chapter pages), SAWSO (Ministry site · Draft). Each card: small site preview image, name, kind, status pill, "Open" (primary) and "View live" (icon link).
Avoid: a statistics row (sites/pages/published counts) as the first thing on the page; walls of text.
```

## S2 — Site overview and Pages

References: `current-v2-2026-10-25/02-site-pages.jpg`.

```text
Design S2: the overview of one site, "Better Together 2027", with its pages list.

Rail: inside a site, the rail shows a site switcher at the top ("Better Together 2027 ▾", full name visible), then: Overview (active), Pages, Lists, Media, Site look, Publish, Settings, Sections. "All sites" link above the switcher.
Header row: "← All sites" and breadcrumb; title "Better Together 2027" with pill "Live · 3 changes not published"; on the right "View live site" (secondary).
Quick actions (4 tiles): Edit home page · Add a page · Update lists (Speakers, Program, Sponsors) · Change site look.
"Needs attention" card: "Home and Speakers have changes not published — Review & publish"; "2 sessions in Program are still sample content"; "Workshops section is hidden from visitors".
Pages: a TREE TABLE (not cards) with columns Title (child pages indented under parents), Address (/, /speakers, /program, /visit, /visit/hotels), Status pill, In menu (check), Last edited (avatar + "Site editor · 2h ago"). Row hover shows "Edit" (primary small) and a ⋯ menu. Toolbar above table: search, status filter, "Add page" (primary).
Avoid: a big green "Published" badge on a page that has unpublished changes.
```

## S3 — Page editor: nothing selected

References: `current-v2-2026-10-25/03-editor-nothing-selected.jpg`, `ui-reference/…/03-hni-editor-desktop.jpg`.

```text
Design S3: the page editor opened on the Better Together 2027 Home page with nothing selected. Use the editor layout from the brief.

Top bar: "← Better Together 2027" · "Pages / Home" · pill "Live · changes not published" · Undo/Redo · Desktop|Tablet|Phone segmented (Desktop active) · "Saved 2:41 PM" · Preview · Publish (red) · ⋯.
Left "Page structure": rows for Hero, Why attend, Speakers, Program highlights, Venue & hotels, Sponsors, Register — each with a small section-type icon and the section's auto name ("Hero — Better Together 2027"). Drag handles on hover.
Canvas: the BT2027 Home page shown large (about 90% scale), realistic photography and design. Show ONE hover state: the mouse is between "Why attend" and "Speakers", revealing a thin blue line with a centered pill "+ Add section".
Right panel: short help ("Click anything on the page to edit it. Double-click text to type."), then a prominent "+ Add a section" button with a caption "Adds after Register (end of page) · change", then quiet links: Page settings, Site look.
Bottom-right of canvas: a small zoom control "− 90% + · Fit".
Avoid: a second toolbar row over the canvas with technical dropdowns; tiny canvas; empty space below the page.
```

## S4 — Page editor: section selected (Content tab)

References: `current-v2-2026-10-25/04-editor-section-selected.jpg`, `ui-reference/…/09-section-settings.jpg`.

```text
Design S4: the same editor with the "Speakers" section selected on the canvas.

Canvas: the Speakers section has a solid blue outline and a small blue name tag "Speakers" at its top-left. At its top-right, a floating toolbar (white pill, soft shadow) with icon buttons and tooltips: Move section up, Move section down, Duplicate, Hide, and ⋯ (menu with Change layout, Reset to live version, Delete in red).
Left panel: the Speakers row is highlighted.
Right inspector (resizable; show the grip on its left edge):
- Header: "Speakers — Meet our speakers" and a quiet chip "Layout: Speakers grid ▾".
- Tabs: Content (active) · Style · Visibility · Advanced.
- Content tab: "Heading" text field ("Meet our speakers"); "Intro" field; then a list-binding card in plain words: "Shows: Speakers (12) · All, in list order", with buttons "Edit speakers" and "Choose speakers…"; below, "Button" field group ("See all speakers" → Speakers page).
- At the bottom of the inspector a primary button "+ Add section below".
Visual hierarchy: one primary button; icon actions on the canvas toolbar; no rows of identical outlined buttons.
Avoid: "Position · Up/Down", "Add a section · Above/Below" button pairs; "Undo my changes"; "Editor label · Private".
```

## S5 — Page editor: Style and Visibility tabs

References: `current-v2-2026-10-25/05-editor-section-appearance.jpg`.

```text
Design S5: two side-by-side states of the inspector for the selected "Why attend" section (icon cards): left = Style tab, right = Visibility tab. Show the canvas behind them compressed (or design as two inspector panels on a neutral background with the canvas partially visible).

Style tab — only controls this section supports:
- Background: 5 large swatches with labels: White, Light, Brand, Dark, Photo (Photo greyed with tooltip "This section doesn't support a photo background").
- Spacing: segmented control Small · Medium · Large with tiny diagrams; "Default" marked with a small dot.
- Width: Narrow · Standard · Wide · Full, each with a small icon (no units).
- Alignment: Left · Center icons.
- Cards per row on desktop: 3 · 4 (only because this is a card section).
- "Reset style" text link at the bottom.
Visibility tab:
- "Show on" with three toggles and device icons: Phone, Tablet, Desktop; helper text: "Changes layout only — it doesn't hide content from people who view the code."
- "Hide until ready" switch with explanation "Visitors won't see this section. You can keep editing it."
- (Muted, labeled "Coming soon") Show from / until dates.
Avoid: dropdowns that say "Definition default", widths in rem, controls that do nothing for this section.
```

## S6 — Page editor: editing text on the page

```text
Design S6: the editor while typing directly in the hero headline on the canvas.

Canvas: the hero headline "Better Together 2027" has a text caret; a compact floating formatting bar sits just above the text (for rich text fields: Paragraph/H2/H3 menu, Bold, Italic, Link, Bulleted list, Numbered list, Quote). Plain headline fields show only a tiny tag "Headline · typing — Esc to finish".
A small blue dot marks this field as changed; hovering the dot shows "Changed — Revert to the version when you opened this page".
Inspector (Content tab) mirrors the field, highlighted with a soft blue background so the person sees where it lives.
Top bar shows "Saving…" briefly.
```

## S7 — Page editor: button and image fields

References: `ui-reference/…/08-link-inspector.jpg`, `ui-reference/…/07-image-inspector.jpg`.

```text
Design S7: two inspector states shown side by side (canvas partially visible).

A) The "Register now" button is selected.
- Button text field.
- "Goes to" picker with four tabs: A page on this site (searchable list: Home, Speakers, Program, Plan your visit, Register) · A section on a page · A file · A web address. Checkbox "Open in a new tab".
- "Style" as three visual chips rendered in the site's style: Primary (red filled), Secondary (outlined), Text link.
- Size: Regular · Large. Toggle: Full width on phones.
- A quiet note: "Button colors come from Site look → Buttons" with a link.

B) The hero photo is selected.
- Big image preview with "Replace" (opens media library) and "Upload new".
- "Description for people who can't see it" field with helpful placeholder ("Two volunteers greeting attendees at registration"); a switch "It's decorative".
- "Focus point": the preview shows a draggable circle on the subject; caption "Keeps the subject in view on phones."
```

## S8 — Add a section: docked library

References: `current-v2-2026-10-25/07-editor-add-section-library.jpg`, `ui-reference/…/10-docked-library.jpg`.

```text
Design S8: the section library open in the right panel, widened to about 600px by dragging (show the drag grip), while the canvas stays visible on the left.

Library header: "Add a section" and below it "Adding after Why attend · Change", close (×).
Controls: search field "Search sections"; category chips that wrap neatly: All 36 · Page openers · Text & stories · Cards & highlights · People · Events · Calls to action · Media · From your lists · Page helpers · ★ Favorites.
Grid: 2 columns at this width (3 when wider). Each card: a large, legible thumbnail rendered in the BT2027 look (16:10), name ("Speakers grid"), one-line purpose ("Photos and roles from your Speakers list"), and two buttons that fit inside the card: "Add" (primary) and "Preview" (secondary). Include cards: Speakers grid, Schedule, Venue & travel, Registration call to action, Icon cards, Logo strip.
Canvas: a blue insertion line with the label "New section goes here" between "Why attend" and "Speakers".
At the end of the grid: a quiet link "Can't find it? Request a section".
Avoid: tiny blank thumbnails; buttons overflowing card edges; a "Request custom section" box glued to the cards.
```

## S9 — Library: browse all and section preview

References: `current-v2-2026-10-25/08-editor-library-preview.jpg`, `ui-reference/…/11-section-full-preview.jpg`, `ui-reference/…/18-section-library.jpg`.

```text
Design S9: two states.

A) "Browse all sections" — a large sheet covering most of the editor (canvas dimmed behind). Left: category rail with counts. Main: 3–4 column grid of big thumbnails. Top: search, "Adding after Why attend · Change", close.

B) Section preview modal for "Speakers grid":
- Header: name, one-line purpose, Desktop | Tablet | Phone switch.
- Body: ONLY the section rendered at the chosen width in the BT2027 look with designed sample content (6 speakers with photos, names, roles) — no site header or footer, no empty space below the section.
- Footer: "You can edit:" chips (Heading · Intro · Speakers · Button), and buttons "Back" (secondary) and "Add after Why attend" (primary).
```

## S10 — Change layout

References: `current-v2-2026-10-25/06-editor-change-layout.jpg`.

```text
Design S10: the "Change layout" panel for the selected Speakers section.

Header: "Change layout for Speakers" and the explanation "Your 12 speakers and heading carry over."
List of compatible layouts, each as a card with a LIVE mini preview of THIS section's real content in that layout: Speakers grid (current, checked), Speakers carousel, Speakers list with bios, Featured speaker + grid. Each card has "Use this layout" (primary on hover).
Below: collapsed row "Show other layouts (some content won't carry over)". When expanded, each shows a plain warning such as "Your speakers won't appear in this layout".
Footer note: "You can undo this."
Never show an option that will be refused.
```

## S11 — Editing a speaker from the page

References: `current-v2-2026-10-25/10-editor-speakers-tablet.jpg`, `ui-reference/…/28-event-record.jpg`.

```text
Design S11: editing one speaker directly from the Speakers page.

Canvas: the speaker card "Maria Alvarez — Divisional Youth Secretary" is selected (blue outline) with a small popover: "Edit speaker" (primary) · "Hide on this page" · "Move". At the end of the grid a dashed ghost card "+ Add speaker".
Right: a drawer titled "Edit speaker" with: photo (round preview, Replace), Name, Role / title, Organization, Short bio (rich text, 2–3 lines), Links (website, LinkedIn), Tags (Keynote, Workshop leader). A note at top: "Updates this speaker everywhere they appear (Home, Speakers)". Footer: "Save" (primary) · "Cancel"; status text "Saved as draft — not published yet".
```

## S12 — Hidden section and phone preview

References: `current-v2-2026-10-25/09-editor-program-phone.jpg`.

```text
Design S12: the editor in Phone preview (390px device frame centered in the canvas) on the BT2027 Program page.

Above the canvas, a slim banner: "1 section is hidden from visitors · Preview without hidden · Show me".
Phone frame content (mobile-first): compact header with logo and a menu (hamburger) button (menu NOT expanded); a page header "Program"; day tabs (Tue · Wed · Thu · Fri); a schedule as a clean list of sessions (time on the left, title bold, room and speaker in muted text, track tag); a hidden "Workshops" section shown faded with a dashed outline and a tag "Hidden from visitors".
Left panel: Page structure with an eye-off icon on Workshops.
Avoid: giant cards, the full navigation menu printed as a list at the top of the phone screen.
```

## S13 — Editing the header and menu site-wide

References: `current-v2-2026-10-25/14-header-footer.jpg`, `current-v2-2026-10-25/15-navigation.jpg`.

```text
Design S13: site-wide editing mode for the header, entered from the page editor.

Top bar shows a purple strip: "Editing site-wide: Header — appears on all 7 pages" and a "Done" button.
Canvas: the real BT2027 header is outlined in purple. The main menu items are directly editable: one item ("Program") shows an inline rename field; another ("Plan your visit") has its dropdown open showing child pages "Hotels" and "Kansas City"; a ghost item "+ Add page to menu" at the end. Drag handles appear on hover.
Right panel: "Header" settings — Logo (preview + Replace), Layout (Standard / Centered / Compact as visual thumbnails), Keep visible while scrolling (switch), Header button ("Register now" → Register page), Utility links (Donate, Contact).
The rest of the page is dimmed slightly to show it is not being edited.
```

## S14 — Lists (Speakers)

References: `current-v2-2026-10-25/11-content-lists.jpg`, `ui-reference/…/27-event-content.jpg`.

```text
Design S14: the Lists workspace for Better Together 2027, Speakers list open.

Header row: "← Better Together 2027" breadcrumb "Lists / Speakers"; title "Speakers" with "12 speakers · Live · 2 changes not published"; buttons: "Add speaker" (primary), "Import / Export ▾" (secondary), ⋯ (List settings).
Left: list switcher: Speakers 12 · Program 24 · Sponsors 18 · Stories (each with "Used on" in muted text).
Main: a clean table with photo, Name, Role, Tags, Status pill (Live / Draft / Hidden), Last edited; drag handle column (manual order). Search + filter chips All · Live · Draft · Hidden.
One row is open in a right drawer (same form as S11).
Sticky bottom bar: "2 changes not published · Review · Publish list".
Avoid: words like schema, revision, design fields, publish schema, record key; a long expanded form for every record at once.
```

## S15 — Media

References: `current-v2-2026-10-25/12-media.jpg`.

```text
Design S15: the Media workspace.

Header: "Media" with tabs Images | Documents; search; "Upload" (primary). Hint: "Drop files anywhere to upload".
Left: folders (All images, Speakers, Venue, Sponsors, Logos).
Main: a calm thumbnail grid of conference photos; one tile shows a processing spinner, one shows "Needs a description" tag.
Right drawer for a selected photo: large preview; "Description for people who can't see it"; "It's decorative" switch; Focus point; "Used on: Home, Speakers"; buttons Replace / Delete (delete in a ⋯ menu). "More details" (collapsed): credit, tags.
Avoid: a statistics band (ready/processing/deleted counts) across the top; filter overload.
```

## S16 — Site look

References: `current-v2-2026-10-25/13-design.jpg`.

```text
Design S16: the "Site look" workspace for Better Together 2027.

Layout: like the editor — left settings panel (resizable), big real-site preview on the right with page switcher ("Preview page: Home ▾") and Desktop/Tablet/Phone.
Left panel sections (accordion, one open at a time): Theme preset (cards: National, Better Together 2027 (selected), Echelon, SAWSO, Neutral) · Logo & name · Colors (four big swatches: Brand, Accent, Dark, Light — each opens a color picker and shows a contrast check "Text on Brand: 6.5:1 ✓") · Fonts (pairing cards rendered as specimens) · Buttons (visual shape/style choices rendered as real buttons) · Header · Menu · Footer.
Top: "Changes are private until you publish" and "Publish site look" (red) listing "Affects 7 pages".
Show the preview updating: the accent color changed to a warmer red and the buttons on the real page reflect it.
Avoid: a long table of hex inputs; a tiny thumbnail preview.
```

## S17 — Publish

References: `current-v2-2026-10-25/17-publishing.jpg`.

```text
Design S17: the Publish screen for Better Together 2027.

Header: "Publish" with subtitle "4 changes ready".
Groups with checkboxes (all checked): Pages (Home — "3 text changes, 1 new section: Ways to give"; Speakers — "1 new speaker"), Lists (Speakers — "1 added, 1 edited"), Site look ("Accent color").
Each row: summary, "View changes" link (opens side-by-side before/after).
Readiness card: "1 thing to fix before publishing: Home — 1 image needs a description · Fix" and "Sample content still on Program — Review".
Primary "Publish 4 changes" (red); secondary "Publish later…" (opens a friendly date/time picker with presets "Tomorrow 9:00 AM", "Monday 9:00 AM", time zone shown).
Tabs at top: Ready to publish · In review (2) · History.
```

## S18 — Settings

References: `current-v2-2026-10-25/18-settings.jpg`.

```text
Design S18: site Settings, with perfectly consistent spacing.

Cards in order, each with 24px padding, 16px between fields, action row 24px below the last field:
General (Site name, Site type) · Address & domains (preview address shown as a copyable chip; "Custom domains" link for Super Admins) · People on this site (avatars + roles, "Manage") · Backup (explanation ABOVE the button "Download content archive"; note "Includes unpublished drafts — keep it private") · Danger zone (red outline card at the bottom: "Archive this site" with explanation; button opens a confirmation that asks to type the site name).
Avoid: a destructive button next to a Save button; uneven gaps between text and buttons.
```

## S19 — Echelon chapter page for a volunteer

```text
Design S19: what a Contributor sees when they can edit only one page — the "Echelon Kalamazoo" chapter page.

Home shows one task card: "Edit the Kalamazoo chapter page".
Editor: same layout, but simpler: no site areas in the rail (only "My pages"), Publish replaced by "Submit for review" (primary navy), status pill "Draft".
Page content (national Salvation Army look, red/navy, clean cards): hero with chapter photo and "Echelon Kalamazoo"; "Who we are" text; "What we do" icon cards; "Our leadership" roster grid from a People list (photo, name, title, member since); "Stories from our chapter" (hidden when empty); "Join us" button; social links.
The leadership card for one member is selected with a drawer "Edit member" (photo, name, title, member since).
Banner: "Your changes go to Echelon national for review before they're published."
```

## S20 — Component sheet (design system)

```text
Design S20: a single design-system sheet for the CMS chrome (not the websites).

Show, in a tidy grid with labels: Buttons (Primary navy, Publish red, Secondary, Tertiary, Destructive) in default/hover/focus/disabled/loading; Icon buttons with tooltip; Segmented control; Text field with label/help/error; Select; Switch; Checkbox; Swatch picker; Status pills (Live, Live · changes not published, Draft, Scheduled, In review, Hidden, Archived); Tabs; Card with header and footer actions; Drawer header; Dialog; Toast (success, error with Retry); Empty state; Page header (Back + breadcrumb + title + actions); Resizable panel edge (grip on hover); spacing scale 4/8/12/16/24/32/48 shown as blocks; type scale 12/14/16/20/24.
Colors: navy #0D234F, background #F5F7FA, surface #FFFFFF, border #DCE1E8, text #142238, muted #5A6575, publish/danger #B4232C, focus/selection #2F6FED, status green #1E7F4F, amber #9A5B00, blue #2459D6, purple #6B46C1.
```

## S21 — The core sections themselves (the websites, not the CMS)

These prompts design the **library sections** that end up on real sites. This is
the part that made V1's library feel "perfectly planned". Ask for desktop **and**
phone versions.

```text
Design S21a: a showcase board of website sections for a Salvation Army event site ("Better Together 2027"), in a modern, warm, accessible style based on Bootstrap 5 proportions: Salvation Army red #EE3A43 as brand color, deep navy for text/dark bands, generous white space, rounded 12px cards, Material Symbols icons, real photography of diverse people at a conference.
Show each section at desktop width (1280) with its phone version (390) beside it:
1) Split hero: photo left, "Better Together 2027" headline, date/place line, two buttons.
2) Event hero: full-bleed photo with dark overlay, dates and "Register now".
3) Icon cards "Why attend": 3 cards with icon, title, 2 lines.
4) Speakers grid: 6 people (photo, name, role), compact; phone shows 2 columns.
5) Schedule: day tabs + session list (time, title, room, speaker, track tag); phone shows a single-column list.
6) Venue & travel: map image + address + 2 hotel cards.
7) Sponsor logo strip (tiers: Presenting, Gold).
8) Registration call to action band with deadline and price note.
All sections share the same container width, spacing scale and left alignment line.
```

```text
Design S21b: the same section family in the "National" theme (salvationarmyusa.org feel: red #EE3A43 + navy, clean white cards, kicker labels above headings, Material icons) for a ministry page about global health (SAWSO):
1) Page header with kicker "Global health" and title "Healthier communities, closer to home".
2) Text block (two short evergreen paragraphs, reading width).
3) Stats band: 3 big numbers with labels and an "As of FY2025" note.
4) Stories feed: 3 story cards (image, date, title, "Read story"), with a "More stories" link; plus the empty state "Check back soon for stories from this program."
5) Call-to-action band: "Support this work" with a Donate button.
Desktop and phone versions side by side.
```

```text
Design S21c: an "Echelon chapter page" one-pager in the National theme: hero with chapter photo; "Who we are"; "What we do" icon cards; leadership roster grid (photo, name, title, member since); "Join us" sign-up band; social links row. Desktop and phone.
```

---

## Design review feedback

```text
Feedback on <screen id>:
Keep: <what works>
Change: <what to change, as specific as possible — e.g., "the inspector tabs are too small; make them full-width segmented">
Remove: <anything that adds clutter or jargon>
Add: <missing element from the spec>
Constraints reminder: plain words, one primary action per area, real website large in the canvas, nothing cramped, buttons never overflow their cards.
Record the corresponding revisions for review.
```

## Review feedback

```text
Review the shared brief and screen requirements: the real website remains central, controls use plain words, each area has one primary action, and unavailable capabilities are absent. Revisions preserve the defined scope.
```

## Design acceptance checklist

- [ ] The screen’s purpose is clear within a few seconds.
- [ ] One primary action per area; destructive actions are not next to it.
- [ ] No technical words (schema, revision, definition, token, slug, rem…).
- [ ] The real website is large and readable in the editor screens.
- [ ] Every control looks like it does something useful here.
- [ ] Spacing is even; nothing overlaps or overflows; labels are not covered by badges.
- [ ] Status pills match the vocabulary (Live, Live · changes not published, Draft, Scheduled, In review, Hidden).
- [ ] Back/breadcrumb is present and obvious.
- [ ] It would work for a volunteer who has never used a CMS.
