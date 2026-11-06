# SAWSO: five-minute local demo

Start the retained demo without resetting it:

```sh
CMS_DATA_HOME=/private/tmp/cms-v2-live-adaptation-demo CMS_PG_PORT=54329 pnpm demo --build
```

Open [CMS Home](http://localhost:3000) and sign in as `admin@example.test`.
SAWSO leads Home, All sites and the site switcher. Public pages live at
[the local SAWSO address](http://sawso.staging.localhost:3001). Publish here
changes only this local copy. The normal restart preserves saved drafts.

1. **0:00–0:45 — Home.** Open SAWSO. Show the approved national header,
   photo hero, sections, eight Ways We Help tiles, stories and footer.
   Narrow the public window to phone width: menu and bottom links still work.
2. **0:45–1:15 — Health.** Open Ways We Help → Health. The six newest eligible
   stories form two rows; at phone width there are three and More stories.
3. **1:15–3:15 — One edit, every placement.** In CMS → SAWSO → Stories, find
   “Primary Health Care to Support the Growing Chikankata Community.” Open it,
   add Education, and Save story. The saved preview uses the real template.
   Click the screen's Publish action; review the selected list and affected
   pages. Confirm the labelled sample-content warning if one is shown, then Publish selected.
   Allow up to a minute for the local release. Open Education and Newsroom →
   Education to show the story in both. Its original Health tag stays selected.
4. **3:15–3:45 — Empty and complete states.** Show Livelihoods' empty stories
   line. In Stories → Gaps, show the sector counts and Family Care's zero;
   Family Care has approved page text and no stories section.
5. **3:45–4:20 — One story template and old links.** Open “Life in Ukraine,
   Years into War.” Its main article now comes from the maintainer-supplied local file.
   Visit `/sawso/story/life-in-ukraine-years-into-war` on the local public
   address: it redirects to `/stories/life-in-ukraine-years-into-war`.
   All34 imported stories now have full article text. The old address remains
   in Details. Do not open external source or donation links during the demo.
6. **4:20–5:00 — Echelon, then BT2027.** Switch to Echelon chapters for the
   national home/directory and chapter workflow ([chapter guide](DEMO-ECHELON.md)),
   then Better Together 2027 for its original design and native lists.

For the admin walkthrough, open an existing page to show the editor's saved
state and History. The editor’s **Publish** first opens a review with Cancel /
Publish; confirmation then runs the usual checks. **New page** offers existing
SAWSO page designs, a copy or blank and opens a named private draft. Publish it, then use Page details → Show in menu and publish the
menu change. **Stories → Add story** accepts title, summary, photo, sector,
region and published date; one publish places it on its sector page and in the
Newsroom. These two creation journeys were verified with a fresh SAWSO site
admin and their sample records have already been removed. They are optional
extensions to the five-minute route above.

After a new-page rehearsal, remove its menu entry and publish that removal, then
archive the page in Page details. After a new-story rehearsal, archive its page,
remove its Stories list record and publish the list change. Wait for the saved
confirmation before leaving each screen. Preserve normal deleted history.

After rehearsing, remove Education from that Health story, Save story and
publish the removal. The starting Gaps counts are Disaster Relief & Recovery17,
Health11, Education7, Business & Economic Development5, Anti-Human Trafficking3,
Capacity Building1, Family Care0 and Livelihoods0. The newsroom retains the
June17,2025 Fostering Hope story after its sector-feed window has ended.

All34 stories share one core template. Their approved feed titles, summaries,
dates and tags remain unchanged. All34 now have full article text: three from the
supplied local files and31 from the frozen live-page capture. The Venezuela
article has all20,695 characters, with no trimming. Rich-text body fields allow
100,000 characters; other text retains20,000.

Meet Our Team, Annual Reports and Financial Accountability now use copied public
content in the CMS's SAWSO sections.39 additional copied images are in normal
Media, including the original Global Needs illustration. All79 SAWSO images are
local Media copies. Privacy Policy links to the maintainer’s external policy address;
the unused local Privacy page is archived with its history retained. The nine approved
ministry/hub pages are unchanged.

Needs administrator input: **copied from live site, needs review** applies to the live article
copy, the three information pages and copied assets. Confirm photo rights and
replace descriptions; supply Trajan Pro3/Proxima Nova/Inter and final impact icons;
resolve sector naming and the recorded red/white and muted-label contrast
exceptions. Hosting, DNS, maintenance and live switch-over remain separate owner work.

The original native database cluster was absent on startup; the normal demo
command restored committed demo sites without reset. Earlier local edits outside
those archives could not be verified. The frozen capture and its safe local replay
command are in demo/sawso-content/README.md.

## Verification and publication boundary

The retained demo is a local content fixture. Check the exact release revision
and [known issues](docs/handbook/start-here/known-issues.md) before presenting it.
Historical test counts and editing-session receipts are private evidence, not
current acceptance. Review only the intended page/list/shared changes before
publication; preserve unrelated drafts and approved public content.
