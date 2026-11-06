# ADR 0007 — the structured section model, designed from the V1 catalogue

**Status:** accepted; implementation begins with the M2 importer
**Date:** 2026-08-22
**Extends:** ADR 0006, which recommended structured definitions without yet
knowing what they had to represent
**Evidence:** `docs/v1-inventory/` — 118 definitions read from V1 read-only

## What the catalogue actually contains

ADR 0006 deferred this model until there was evidence. There is now. A read-only
survey of the three V1 site repositories and the generated registry produced a
per-definition inventory; the numbers below are from it, not from memory.

| | |
|---|---|
| Definitions, deduped | **118** |
| Shared across all three sites | **78** — which is where the SPEC's "78 shared v1 sections" comes from |
| Single-site only | 40 (27 HNI, 13 Echelon) |
| Categories | **15** |
| Editable slots, total | **1,244** across 112 definitions; 6 have none; the largest has 42 |
| Slot types | text 698, link 240, richtext 115, **icon 105**, image 86 |
| With a form | 4 |
| With an iframe | 5 |
| With a `<script>` | **0** |
| With an inline event handler | **0** |
| With an active-scheme URL | **0** |
| With inline SVG | **44** |

Three findings changed the model, and none of them was predictable from the
outside.

**There is no repeat primitive.** Repetition in V1 is hand-flattened into
numbered slot families — `amount-1-*` through `amount-4-*` — with the cardinality
baked into the HTML. 56 definitions have repeated units done this way. A
structured model that offers a real repeat node is not a nicety; it is the
difference between importing a donation block and importing four copies of a
donation block that can never become five.

**`icon` is a fifth field type, and V1 does not know it.** 105 slots across 32
definitions declare `data-editable="icon"`, and `icon` is absent from V1's own
`EDITABLE_TYPES` validator list — while `html`, which that list accepts, is used
by no definition at all. The vocabulary the catalogue *uses* and the vocabulary
its editor *validates* have drifted apart. Ours takes the used one.

**62 definitions depend on a stylesheet that is not theirs.** `INTERACTION_PRESET_CSS`
is injected once into the page as `#cms-interaction-presets`; 25 classes are
involved and 4 definitions are laid out by it. Importing those definitions
without it produces markup that parses, renders, and looks wrong — which is
exactly the "imported because its HTML parses" failure the importer is required
to refuse.

Two more facts constrain the importer rather than the model: 24 definitions have
HTML that **diverges between sites**, so "the" definition is not single-valued
for them; and 22 carry dangling `#` hrefs, with 41 cross-section anchor edges of
which 21 resolve to nothing in the catalogue.

## The model

A definition is a versioned document of typed nodes. Every value an editor can
change is a *field on a node*, never a position in a string.

**Element nodes** carry an allowlisted tag, static attributes fixed at authoring
time, and children. Tag and attribute *names* are never dynamic.

**Field nodes**, one per type the catalogue actually uses:

| Node | Backs | Policy applied at render |
|---|---|---|
| `text` | 698 slots | element-text escaping |
| `richtext` | 115 slots | the one rich-text sanitizer |
| `link` | 240 slots | the URL policy, plus label text |
| `image` | 86 slots | URL policy on `src`, alt required or explicitly decorative |
| `icon` | 105 slots | a **closed set of named icons**, not markup — the name selects from a compiled sprite |
| `repeat` | 56 definitions' flattened families | a bounded list of child instances |

**Style is data**, not a string: a typed declaration list per node, compiled
through the existing CSS policy, versioned as compiled artifacts already are.

**Bounded breakpoint visibility** is a node property, matching SPEC §6.4's D5
rule, not free per-viewport layout.

**Accessibility metadata** — accessible name, heading level, landmark role — is
explicit on the node rather than implied by whatever tag the markup happened to
use. 19 definitions carry element ids and 41 anchor edges depend on them, so ids
are modelled rather than left to chance.

**Behaviour nodes** exist for the things that should never have been markup: an
`embed` node with an explicit provider, sandbox policy, title and consent
posture; a `form` node with a named handler. Neither is imported automatically —
see below.

## Invariants

- Stored field values are data. They are never parsed as syntax, never
  concatenated into markup, and never reach a tag name, an attribute name, an
  event handler, a script, or a style source.
- URL fields always pass the URL policy; rich text always passes one sanitizer.
- The renderer serializes the tree. It does not concatenate fragments.
- Raw HTML is not a node with dynamic children. Static raw markup keeps the
  governed escape hatch of ADR 0005/0006 and gets no fields.
- Unknown node types, unknown field types, and unknown schema versions fail
  closed.
- The definition schema version and the renderer version are both explicit and
  both checked, the way sanitizer and CSS policy versions already are.
- Preview and public rendering call the same structured renderer.

## What is not imported automatically

The 9 definitions carrying forms or iframes are quarantined by default, and the
inventory says why in each case.

The three embed definitions (`map-embed-v1`, `video-embed-v1`, `form-embed-v1`)
already ship a sandbox and an empty `src` configured at runtime — they are the
best candidates for the first `embed` component. The two HNI ones
(`hni-explore-timeline-v1`, `hni-explore-map-v1`) point at `public.tableau.com`
with **no sandbox, no referrer policy, and no consent handling**, which is a
policy decision about a third party, not a mapping exercise.

The four form definitions (`hero-search-v1`, `locator-form-v1`,
`newsletter-signup-v1`, `contact-form-v1`) all post to `action="#"` — they have
no handler at all today. Importing them as markup would ship a form that looks
functional and collects nothing, which is worse than not shipping it.

## Consequences

- The importer maps the 78 shared generic definitions first, quarantines the 9
  active-content ones, and reports the 24 site-diverging ones as needing a
  decision about which site's version is canonical.
- `INTERACTION_PRESET_CSS` must be modelled as a real dependency before its 62
  dependants can be imported; a definition that silently loses its layout is a
  failed import that looks like a successful one.
- `icon` needs a compiled sprite and a closed name list before 32 definitions
  can move.
- The legacy interpolation compiler stays frozen. Nothing here is added to it.
