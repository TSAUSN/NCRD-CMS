# ADR 0011 — Connecting existing websites: tag, then import

Status: accepted, 2026-10-07.

**Owner clarification, October 10:** "connecting" here means importing a local
copy into the independent CMS. Current examples are the maintainer’s TSA rebuilds
or local files. This project does not connect Salvation Army production
websites, use their credentials or authorize any DNS cutover. Do not access
Zesty/cPanel to edit live pages for CMS work. This owner boundary governs the
future architectural options described below.

## Context

The CMS should eventually look after many Salvation Army websites: the Human
Needs Index, further Echelon events, Better Together, resource sites and new
ones. Most are small static or lightly scripted sites (HTML, CSS, a little
JavaScript, sometimes PHP includes) hosted separately today. Rebuilding each
by hand in the CMS does not scale, and neither did V1's approach.

V1 connected a site in three steps: redevelop its HTML, run `cms-tagger` to add
`data-block-id` / `data-editable` attributes to editable regions, then include
the shared `cms-inplace-embed.js` script in the site and register its origin.
Content lived in Firestore and was patched into the page in the browser. The
tagging step worked; the runtime step was the bottleneck. Every site carried
its own copy of the embed script, content appeared only after JavaScript ran,
previews of unpublished work needed the live site to load drafts, and editors
could change text and images but not add, move or remove sections.

## Options considered

| Option | How a site connects | Verdict |
| --- | --- | --- |
| A. Runtime injection (V1) | The site keeps its hosting and loads a script that patches CMS content into tagged regions. | Rejected. Per-site script upkeep, content invisible without JavaScript and to search engines, cross-origin editing bridge, no structural editing. |
| B. Headless API | The site's code fetches content from a CMS API at build or request time. | Kept for applications that must stay separate (below). Each site needs developer wiring and its own preview mode, so it is not the default for ordinary sites. |
| C. Git-based | The CMS commits content files to each site's repository; the site rebuilds. | Rejected. Needs a build pipeline per site and developer-style workflows; slow and fragile for non-technical editors. |
| D. Tag, then import (chosen) | The site's built HTML is tagged with editable regions, then imported once into the CMS as a private draft site that the CMS hosts. | Chosen. |

## Decision

**Ordinary websites move into the CMS by tagging their HTML and importing it.**

1. **Input:** the site's built pages (the HTML a browser receives), its
   stylesheets and its assets, as a folder. A PHP site is captured as rendered
   HTML first.
2. **Tag:** editable regions are marked with V1's vocabulary, so V1 knowledge and
   the existing tagger carry over:
   `data-cms-editable="text|richtext|image|link|skip"`, `data-cms-id`,
   `data-cms-section`. The importer proposes tags itself where none exist
   (the same heuristics as "Organize into blocks"); a maintainer can add or correct tags before importing. That work is an
   ordinary reviewable diff of the HTML, done once, at onboarding time. Nothing
   in the running product calls an external generation service.
3. **Import:** the importer splits each page into the shared header and footer
   (which become the site's authored header and footer) and its sections (which
   become site-scoped section definitions whose HTML and CSS are kept as written,
   with `{{field}}` tokens where the tags are). It copies images and documents
   into the media library, creates the pages as private drafts and reports
   everything it could not carry over: scripts, forms, third-party embeds.
4. **Result:** a private draft site that looks like the original and is edited
   on the canvas like any other site. Publishing, roles, history and hosting work
   as for every site. The original production site remains independent and
   untouched; importing files does not authorize connecting its domain.

Interactive behaviour is not copied as arbitrary script. Common patterns map to
built-in, script-free equivalents (disclosures for accordions, governed embeds
for video, maps, charts and forms); anything else is listed in the import
report for a decision, as HNI's FAQ search and Tableau charts were.

**Applications stay where they are.** A data dashboard, a form-heavy application
or a site that belongs to another vendor CMS keeps its own stack. It can show
CMS-managed content through the published-content read API (collections such as
speakers or resources, as JSON) or link to CMS pages. That API exposes only
published content through the public renderer's existing read-only database
role.

## Consequences

- Onboarding a site is: capture its HTML, tag (or accept the proposed tags),
  run the importer, review the draft site, publish. The V1 HNI and Echelon
  migrations followed this path with a V1-specific reader; the general importer
  reuses its parts (CSS closure, media transfer, frame components, provenance).
- Fidelity comes from keeping each section's own HTML and CSS rather than
  re-expressing it in the structured grammar. Sections can later be upgraded to
  structured definitions for richer editing, one at a time.
- Sites gain the CMS's security model on import: no arbitrary script in
  published pages, sanitized fields, tenant isolation.
- A site whose value is mostly custom JavaScript is an application, not a
  candidate for import.
