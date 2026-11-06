# ADR 0009 — an element node carries the attributes a stylesheet can see

**Status:** accepted; implemented inside structured schema version 2
**Date:** 2026-08-22
**Extends:** ADR 0007, which drew the element-node attribute allowlist, and
ADR 0008, which did the same job one node type along and explicitly deferred
this question: "a wrapper element node can hold them if v2 ever wants the hook
— and that is an element-node allowlist question, not this one"
**Evidence:** importer run `d8de5f33e42694204da1ba53da4f2ccf`, source manifest
`c40fff5c3255f810`, over the same 118 V1 definitions as ADR 0008 — plus a
selector survey over every definition stylesheet and `INTERACTION_PRESET_CSS`.
Every number below comes from that run, not from memory.

## The measurement, before the design

`unsupported-attribute` is the third-largest reason code in the catalogue: **36
definitions** carry it, and it is the *only* code on **8** of them. That last
number is why this work was scheduled. It is also the number this ADR has to
correct, because it is not collectible.

### What the code actually fires on

141 refusals across those 36 definitions, naming 36 distinct things: 35
attribute names, plus `class` values the grammar refuses. In definitions:

| detail | defs | detail | defs | detail | defs |
|---|---|---|---|---|---|
| `data-cms-section` | 20 | `class` (value) | 13 | `style` | 12 |
| `src` | 8 | `type` `href` | 7 | `loading` `title` | 5 |
| `action` `autocomplete` `method` `name` | 4 | `open` `allow` `sandbox` `referrerpolicy` `hidden` `placeholder` `alt` `data-cms-embed-frame` `data-cms-embed-placeholder` | 3 | `required` `inputmode` `allowfullscreen` `data-block-id` `data-content-epoch` `data-current-through` | 2 |
| `rel` `target` `rows` `maxlength` `value` `aria-current` `data-cms-label` `data-fe-block` `data-visually-hidden` | 1 | | | | |

SVG is absent from that list, and deliberately. The catalogue is full of it —
`d`, `viewBox`, `fill`, `stroke`, `stroke-width`, `stroke-linecap` and
`stroke-linejoin` occur on elements in 44 definitions — and none of it is
reported here, because the converter refuses `<svg>` and does not descend, and
because most of it sits inside an `icon` field it never opens. Inline SVG is an
element and a field question (`inline-svg`, `icon-field`), and no attribute
allowlist of any size touches it.

### The filter the reason code does not apply, and this ADR must

**An attribute allowlist can only help an element the tag allowlist keeps.** The
converter records an unsupported attribute even on an element it has already
refused — `keepLooking` walks on so the census is complete — so most of that
table is a census of `<iframe>`, `<form>`, `<input>`, `<button>`, `<label>`,
`<textarea>`, `<select>`, `<option>`, `<details>`, `<th>` and static
`<a>`/`<img>`. Widening `STRUCTURED_ATTRIBUTES` reaches none of them: there is
no element node there to carry anything, exactly as ADR 0008's inventory said of
`field-attributes-lost` in the other direction.

Twenty-five of the thirty-six are in that category. Eleven are not, and this is
the table the rest of this document is about:

| detail | defs | tags it sits on | value shape | selected on by a stylesheet |
|---|---|---|---|---|
| `data-cms-section` | 20 | `section` `div` | one token, unique per definition | no |
| `class` (value refused) | 13 | `p` `div` `section` `h2` `h3` `span` `aside` | framework utilities | yes |
| `style` | 12 | `p` `span` `h1` `h2` `h3` `div` `section` | declaration list | it *is* the declarations |
| `data-cms-embed-placeholder` | 3 | `p` | empty | no |
| `data-block-id` | 2 | `div` | one token | no |
| `data-content-epoch` | 2 | `div` | integer | no |
| `data-current-through` | 2 | `p` | empty | no |
| `aria-current` | 1 | `span` | `page` | **yes** |
| `data-cms-label` | 1 | `div` | two to five words of copy | no |
| `data-fe-block` | 1 | `div` `h1` `p` | one token | no |
| `data-visually-hidden` | 1 | `h2` | empty | no |

### What any allowlist would buy

Greedy, the way ADR 0008's inventory is greedy, over the details the reason code
actually names. *Cleared* means the definition no longer carries the code;
*unlocked* means it has no reason code left at all, which is the only number
that puts a section on a page.

| # | add | newly cleared | cleared | unlocked |
|---|---|---|---|---|
| 1 | `data-cms-section` | 5 | 5 | **5** |
| 2 | `open` | 3 | 8 | 5 |
| 3 | `href` | 2 | 10 | 5 |
| 4 | `aria-current` | 1 | 11 | 5 |
| 5 | `type` | 1 | 12 | 5 |
| 6 | `class` values that are framework utilities | 1 | 13 | 6 |
| 7 | `style` | 7 | 20 | **8** |

Steps 2, 3 and 5 are the trap the "cleared" column sets: `open` is on
`<details>`, `href` on a static `<a>`, `type` on `<button>` and `<input>`, so
each clears a definition of *this* code while leaving it refused for its
element. Adding them would buy three, two and one row in a table and nothing on
any page.

So the eight definitions decompose exactly:

- **five** turn on `data-cms-section` alone;
- **one** additionally needs a class grammar that admits framework utilities;
- **two** additionally need an inline `style`.

The last two are refused by ADR 0008 and by ADR 0007 before it, and nothing here
reopens them. Which leaves the whole of this decision resting on one attribute
name, and that name is the one this ADR refuses.

## `data-cms-section` is an identity, not an attribute

It is the largest thing in the census by definition count, the only lever on the
five unlocks, and it has a clean grammar: all twenty values match
`STRUCTURED_TOKEN`, are kebab-case of two or three words, are at most twenty
characters, and no two definitions share one. If presence in V1's markup were
the standard it would be admitted on the first page of this document.

Four measurements say it is not an attribute question at all.

**It restates the definition's own name.** For all 20 of 20, the value is a
substring of the definition id that carries it, once the two are normalised. It
sits at the top level of the document, once per definition, never twice and
never below. v2 already knows which definition a section is, because a row says
so — with a uniqueness the markup does not have.

**Nothing on the page reads it.** No definition stylesheet and no rule in
`INTERACTION_PRESET_CSS` contains `[data-cms-section`. Carrying it or dropping
it produces the same rendered page, which is the opposite of ADR 0008's case for
`class`, where 222 of 244 occurrences appear in a selector and moving one changes
which rules match.

**What reads it is a mechanism v2 does not have.** V1's `render-sections.js`
resolves `[data-cms-section="…"]` with `querySelector` to find a hand-written
block inside a static page so an authored payload can be swapped into it. There
is no static page in v2 and no swap: a page is composed of section instances and
rendered from the document. The attribute is the seam between V1's static sites
and V1's CMS, and this model is the thing that replaces the seam.

**`querySelector` returns the first match.** That is what makes it an identity
rather than a label, and identity is the thing this model does not yet keep
unique. A definition can be placed on a page more than once — that is what a
catalogue is for — and two copies would answer to one key, with V1's own
selector silently choosing one. ADR 0008 refused `id` on a field node in exactly
these words, and admitting the same shape under a `data-` prefix would be
refusing it by name and accepting it by spelling.

So it is refused, and the refusal has a cost that this ADR states rather than
hides: **five definitions that could be importing today are not.** The next
section says what collects them, and it is not in this package.

## The one addition: `aria-current`

The allowlist gains one name.

| attribute | grammar |
|---|---|
| `aria-current` | one of `page`, `step`, `location`, `date`, `time`, `true`, `false` |

It is the only name in the whole census that is carried by an element this model
keeps *and* matched by a rule: `INTERACTION_PRESET_CSS` has one
`[aria-current="page"]`. That is the standard, and it is ADR 0008's standard
stated for element nodes — an attribute earns its place when the page looks
different without it, not when V1 happened to write it.

It buys one definition's worth of clearing (`breadcrumb-v1`) and zero unlocks
today, because that definition also needs a repeat node, a `nav` tag and its
static text. Under ADR 0008's own arithmetic — "every further attribute costs a
value grammar, a renderer branch and a database check, and buys zero
definitions" — that would be a refusal. The arithmetic is different here, and
the difference is worth writing down: an element node's attributes are emitted
by one generic loop over the map, so a new name costs **no renderer branch at
all**. It is a row in a list, a `case` in one function, a `WHEN` in one SQL
expression, and the tests. A field node's attribute costs an emission slot in a
hand-written start tag, which is why ADR 0008 could not say this.

### The whole keyword set, not the one keyword V1 wrote

V1 writes only `page`. The grammar takes all seven states the specification
gives the attribute, following the choice ADR 0008 already made three times:
the inventory found only `async` for `decoding` and only `high` for
`fetchpriority`, and both took their full set. The set is closed *by the
specification*, so narrowing it to one catalogue's usage would invent a second,
undocumented restriction that the next definition author hits and nobody can
explain.

`true` and `false` are in the set and are not booleans in the `aria-hidden`
sense: `aria-current="true"` means "this one, kind unspecified", and `false` is
the default said out loud. Both are inert. Neither means the same as the
attribute being absent, which is why the empty string is refused —
`aria-current=""` and no `aria-current` are different bytes, and a document
should say which it means. That is the same rule that refuses an empty class
list on a field node.

### It is a state, so it belongs to the definition

ADR 0008 refused `aria-label` on a field node with a sentence worth reusing: an
accessible *name* describes the content, and the content is the author's value,
so a definition that fixed one would announce the same words for every page
using the section. `aria-current` is not a name. It is a state of the element —
"this is the current page in this navigation" — which is a fact about the
structure the definition author wrote, and it says nothing about, and cannot
leak into, any stored value. That distinction is why this ADR admits one
`aria-*` attribute without reopening the category.

## Versioning: the number does not move, and that is the harder half

`STRUCTURED_SCHEMA_VERSION` stays at 2. ADR 0008 moved it from 1, so the
difference has to be said precisely.

The test is not "did the set of valid documents change" — it did, both times.
The test is **can a build read a document and put the wrong thing on the page.**

A *new key on a node* fails that test. A reader that has never heard of
`staticAttributes` has to choose between ignoring it and refusing, and ignoring
it emits an anchor without the class that styles it: markup that parses,
renders, and is wrong. There is no third option, so the version is what stops
the reader ever seeing the document.

A *new name in a closed allowlist* does not. Every reader checks the name
against its own list and there is no ignore-path in either direction:

- an older build meeting `aria-current` refuses the whole document —
  `node-refused` in `structuredSectionDefects`, a defect sentence in
  `app.structured_node_defect` — so the section is visibly absent and the
  storage gate never accepted it;
- a newer build meeting an older document reads it byte for byte identically,
  because a document that never used the name is unchanged by the name existing.

Both directions fail closed, which is the property the version exists to
guarantee and which is already guaranteed without it.

What settles it is the cost of moving it. This number is checked in three
places against each other — `app.current_structured_schema_version()`, every
row's `structured_schema_version` column, and the `schemaVersion` inside every
document — and the TypeScript and the SQL land in separate commits. Between
those commits the two disagree. With the version moved, that disagreement is
catalogue-wide: every structured definition fails to save and every structured
section on every page renders nothing, **including the ones nobody touched**.
Without it, the disagreement is confined to the documents that actually use the
new name, and it is confined in the safe direction — the database refuses what
the compiler now accepts, which is a definition that will not save rather than a
page that has gone blank.

A version is for a change in what nodes *mean*. This is a change in what one of
them may *say*.

### Existing documents render byte for byte

Asserted in bytes, not re-derived. `packages/renderer/src/structured.test.ts`
holds the exact output of an element node carrying each of the nine attributes
the allowlist had before this ADR — singly and all nine at once — on both the
public and the preview path, and asserts that the compiler hands back the
document it was given so the `renderHash` a page pins cannot move.

The reason it holds is structural rather than lucky: attributes are emitted by
iterating the stored map in its own key order, and a name that no document
mentions contributes nothing to that iteration. Nothing is reordered, nothing is
normalised, and no document is rewritten — this ADR ships no data migration,
because there is no stored row whose meaning changed.

## What stays refused, and why each one

The list of names measured on elements this model keeps is short, so every one
of them gets a sentence rather than a category.

**`style`** (12 definitions). Unchanged from ADR 0007 and 0008. An inline
declaration list is a second CSS sink outside the one CSS policy — authored CSS
goes through `scopeCss` and `validateCompiledCss` and is versioned as a compiled
artifact, and a `style` attribute would be a stylesheet no policy saw and no
scope bounded. It is the largest single thing this ADR could have collected —
seven of the twenty definitions cleared at the widest allowlist, and two of the
eight unlocks — and it is still the easiest refusal in the document.

**The framework-utility class grammar** (13 definitions). Measured rather than
assumed: of the 95 `class` values refused on elements this model keeps, the
failing tokens are variant
prefixes (`sm:`, 12 definitions), bracketed arbitrary values (10), slash opacity
suffixes (7) and dots (4), and **no definition** is cleared by admitting
separator slack alone. So this is the same refusal ADR 0008 made for field
nodes, on the same grounds: admitting `:`, `[`, `]`, `/` and `.` makes
`STRUCTURED_TOKEN` accept very nearly any string, which is the same as having no
grammar. The right answer, when that definition matters, is a compiled utility
layer with a closed name list.

**`data-cms-section`** (20 definitions). Above. An identity, refused for the
reason `id` is refused on a field node, and reclassified as plumbing rather than
markup.

**`data-block-id`** (2 definitions). V1's own slot marker, found on two
elements that are *not* editable regions — a marker that lost its region. The
field path already consumes it via `CONSUMED_BY_FIELD` because the field node
re-derives it, and carrying the orphans would store a slot reference that
resolves to nothing.

**`data-cms-label`** (1 definition). Two to five words of human copy naming a
region for V1's editor. Its v2 spelling exists and is `StructuredFieldDef.label`
— a declared field's label, in the document's `fields` array where the editor
reads it, rather than an attribute the page ships to every visitor.

**`data-fe-block`, `data-visually-hidden`, `data-current-through`,
`data-content-epoch`, `data-cms-embed-placeholder`** (1, 1, 2, 2 and 3
definitions). Behaviour and build hooks. No stylesheet contains a selector for
any of them, and what each one *means* lives in V1 JavaScript that does not
exist in v2 — the same finding ADR 0008 recorded for `data-registration-cta`,
`data-form-action` and `data-tone`, and the same conclusion: carrying them would
produce definitions that look imported and behave inertly, which is harder to
notice than a definition that was refused.

**Arbitrary `data-*`.** Not widened, and the eight names above are the whole
reason it does not need to be. Every one was checked individually and every one
is inert or is an identity. There is no residue for a general rule to cover.

**Arbitrary `aria-*`.** Also not widened. `aria-current` is admitted by name,
with its own closed keyword set, because it is a *state* and because a rule
matches it. `aria-expanded` is the near miss, and it is instructive:
`INTERACTION_PRESET_CSS` selects `[aria-expanded="true"]`, and **no element in
the catalogue carries the attribute at all** — V1's JavaScript sets it at
runtime. `data-mobile-order` is the same shape, with four selectors and no
carrier. So the selector survey is run against the markup rather than read
alone: an attribute nothing writes is a behaviour v2 does not have, and adding
it would be widening on evidence that only looks like evidence.

**Event handlers, `srcdoc`, raw HTML, dynamic attribute names.** Unchanged from
ADR 0007 and 0008, and re-tested here at the element-node boundary rather than
inherited. A structured definition contains no executable code and no position
that accepts any; the allowlist is a literal list in TypeScript and a literal
list in SQL, both read at the point of emission.

**`href`, `src`, `alt` on an element node.** Refused for a reason that is
stronger here than on a field node: the tag allowlist has no `a` and no `img` at
all, precisely so that every URL in a structured definition goes through
`safeUrl` on a field. An element node that could write an `href` would put a URL
sink back into the one model built so there is exactly one.

## What this does not decide, and who decides it

**The five definitions.** They are collected by the importer consuming
`data-cms-section` the way it already consumes `data-block-id` and
`data-editable` — a `CONSUMED_BY_SECTION` beside `CONSUMED_BY_FIELD`, justified
by the same test that justified those: a marker the v2 model re-derives, whose
absence changes no rule and no rendered byte. That is a conversion decision in
`packages/importer/src/convert.ts` and it is not this package's to make. It is
the single highest-value item left in the `unsupported-attribute` census, and it
needs no schema change at all — which is the useful half of this measurement.

**Everything else the census names.** `<svg>`, `<iframe>`, form controls,
`<details>`, `<nav>` and static anchors are element questions, not attribute
questions, and each is a separate decision with a separate risk. Nothing here
brings any of them closer.

## Invariants this adds to ADR 0007's and 0008's lists

- An element-node attribute earns its place by being matched by a rule, not by
  appearing in V1's markup.
- No attribute names a thing. Element nodes carry the `id` ADR 0007 counted and
  no second identity under any other spelling.
- Attribute names and values are re-checked at the point of emission, so "it was
  validated upstream" is never load-bearing — unchanged, and now tested from the
  element-node side.
- A document carrying an attribute this build does not know renders nothing at
  all, rather than the element without it.
- Widening the allowlist does not move the schema version, and every document
  written before a widening renders identically after it.

## Consequences

- `packages/importer/src/convert.ts` needs no change to benefit: it calls
  `isStructuredAttribute` and `isStructuredAttributeValue` directly, so the
  classification run picks the name up from the schema. Re-run over the same
  manifest, `unsupported-attribute` falls from 36 definitions to 35. The
  sole-reason count stays at 8, because `breadcrumb-v1` carries four other
  codes — which is the honest shape of this change and the reason the
  paragraph above says the arithmetic is different for an element node.
- The admin inspector is unaffected. Element attributes are static, are not
  editable, and are not part of what an author is offered.
- Migration 0026 replaces `app.is_structured_attribute` and
  `app.is_structured_attribute_value` and nothing else. No stored row is
  rewritten, no `render_hash` is recomputed, and
  `app.current_structured_schema_version()` is untouched.
