# ADR 0008 — a link or image field node carries the attributes its definition chose

**Status:** accepted; implemented as structured schema version 2
**Date:** 2026-08-22
**Extends:** ADR 0007, which defined the node model and gave field nodes no
attributes at all
**Evidence:** `docs/v1-inventory/field-attributes.md` — every number below comes
from importer run `2aaf032e9d507d254d4860553c675004`, not from memory

## The problem, stated as the inventory states it

ADR 0007's `link` and `image` field nodes render their own element: the node
*is* the anchor or the image. That was the right call — it means there is no
authored position anywhere in a structured document where a URL can be written
down, so "did this URL pass the policy?" has one answer for the whole model. It
also meant those two nodes had nowhere to put anything else.

The inventory counts what that costs. Across the 118 V1 definitions there are
**240 link field elements in 79 definitions** and **86 image field elements in
40 definitions**, and on them:

| | occurrences | definitions |
|---|---|---|
| `class` on a link | 215 | — |
| `class` on an image | 29 | — |
| `width` on an image | 85 | 39 |
| `height` on an image | 85 | 39 |
| `decoding` | 74 | 32 |
| `loading` | 71 | — |
| `fetchpriority` | 10 | 10 |
| `rel` | 3 | 1 |
| `target` | 3 | 1 |

Occurrences are summed from the inventory's value-shape rows. A definition
count is only given where the inventory reports one for a single row: `class`
and `loading` appear under several value shapes whose definition sets overlap,
and adding them would invent a number.

Losing a class is losing the styling — V1 styles every anchor and image by
class — so the importer refuses those definitions rather than importing markup
that parses and looks wrong. `field-attributes-lost` is the largest single
obstacle in the catalogue: **77 definitions** carry it.

## Why the immediate unlock count is not the metric

A maximal allowlist clears `field-attributes-lost` from **68 definitions** and
leaves only **3 of them with no reason code at all**. Three. If the question
were "how many sections does this ship?", the answer would be that it does not
pay for itself and the work should wait.

That is the wrong question, for three reasons the inventory makes checkable.

**It is a prerequisite, not a release.** `field-attributes-lost` is almost never
the only thing wrong with a definition. The 68 it clears are largely the same
definitions that also need a repeat node, an icon sprite, or
`INTERACTION_PRESET_CSS` modelled as a real dependency. Each of those is a
larger, riskier piece of work, and none of them imports a single extra
definition while a link still cannot carry the class that styles it. Attributes
are the cheapest item on the critical path, and the only one that is cheap.

**68 is the number that stops being re-earned.** Every other piece of work in
the catalogue is scoped against a population that still has this problem. Doing
attributes first means the icon-sprite work is measured against definitions
whose remaining obstacle is the sprite, rather than against definitions with two
obstacles of which one is this. The inventory's "blocked by exactly one
remaining thing" table only exists because the attribute question was answered
first; it names 4 definitions waiting on `site-divergence`, 2 on
`repeat-family`, 1 each on `interaction-preset-css`, `unresolved-anchor` and
`unsupported-attribute`. Those are plannable numbers. They were not, before.

**The alternative is worse than waiting.** The pressure a missing attribute
creates is for somebody to import the definition anyway and fix the styling by
hand afterwards — which produces a v2 definition that is not the V1 definition,
in a repository where the conversion is supposed to be readable against the
original. A closed allowlist with a value grammar is what makes "converted node
for node" a claim anybody can check.

So: three definitions unlocked, and the whole rest of the import made
measurable. That is the case, stated at its weakest so nobody has to discover
the weakness later.

## The boundary this ADR is really about

A structured definition has two kinds of content in it and they have never been
confused, because until now field nodes had no content of their own beyond a
name. Schema v2 gives them some, so the boundary has to be said out loud.

**The definition is trusted.** It is authored by a super admin through
`app.upsert_section_def_version`, it is versioned, and a page pins the exact
version it was built with. What the definition says about an element is a
decision by somebody who is allowed to make decisions about markup.

**Page content is not.** The URL, the label, the alt text, the rich text — these
come from `values` on a page instance, are edited by contributors, and go
through `safeUrl`, `escapeText`, `escapeAttribute` and `sanitizeRichText` every
time.

The two never cross, in either direction, and both directions matter:

- **No stored value can become an attribute.** Static attributes are read from
  the *node*, which lives in the definition. A page value shaped like
  `{ url, label, class: ['evil'], onclick: 'alert(1)' }` contributes nothing but
  its `url` and its `label`, because those are the only two keys the link
  renderer reads out of it.
- **No definition can become a URL.** `href`, `src` and `alt` are absent from
  the allowlist and always will be. A definition that could write an `href`
  would put a second URL sink into a model built so that there is exactly one.

This is why the key is `staticAttributes` and not `attributes`. An element
node's `attributes` is a map of strings; a field node's static attributes are
token lists, enumerated keywords and integers. One key holding two shapes means
every reader — the Zod schemas, the renderer, the preflight,
`app.structured_shape_defect` — has to remember which one it is looking at, and
migration 0021 exists because a measurement that assumed the wrong shape
measured nothing at all.

## The allowlist, and the grammar of each entry

Closed. Nothing else, ever, without another ADR.

### Link field nodes

| attribute | grammar |
|---|---|
| `class` | an array of 1–32 distinct `STRUCTURED_TOKEN`s |
| `rel` | an array of 1–32 keywords from a closed set; duplicates permitted |
| `target` | one of `_self`, `_blank` |

### Image field nodes

| attribute | grammar |
|---|---|
| `class` | as above |
| `width` | an integer, 1–8192; present if and only if `height` is |
| `height` | an integer, 1–8192; present if and only if `width` is |
| `decoding` | one of `sync`, `async`, `auto` |
| `loading` | one of `lazy`, `eager` |
| `fetchpriority` | one of `high`, `low`, `auto` |

`STRUCTURED_TOKEN` is `^[A-Za-z][A-Za-z0-9_-]{0,63}$` — the same grammar an
element-node class and a slot id already have.

### Class is a list, not a string

An element node's `class` is a single string, split on one space here and
matched by a repeated-token pattern in SQL. Those two spellings agree only
because somebody went and found the cases where they would not: `a  b`, `a `,
a leading space, the empty string. Each produces an empty token on one side and
fails the pattern on the other, and each is a test in
`packages/renderer/src/structured.test.ts` today because each was once a
disagreement.

A field node's `class` is an array. There is nothing to split, the separator is
the renderer's and never the author's, and a token that is not a token is one
array entry rather than a substring nobody knew was there. The element-node
spelling is not changed to match, because changing it would change what every
stored v1 document means — and this ADR's other promise is that no stored
document changes at all.

Duplicates are refused. A class list is emitted verbatim and in the order it was
written, so the markup can be read against the V1 markup it was converted from;
a list that says one class twice is a document somebody edited badly, and the
model can say so.

### Rel is assembled, not copied

`rel` is the one attribute the renderer contributes to. `target="_blank"` hands
the opened document a live `window.opener` back to this page, which it can
navigate; the fix is `rel="noopener"`. Every version of that fix which has ever
failed has failed by trusting somebody to remember it, so the renderer adds it
from the fact that the link is `_blank` or off-site rather than from the
definition having asked. Modern browsers imply `noopener` for `_blank`
themselves, but "modern" is a property of the reader and this is a property of
the page.

That makes the emitted `rel` a set assembled from two sources, so it is
normalised deterministically: duplicates collapse, and tokens are emitted in the
order `STRUCTURED_LINK_RELS` declares them — which is alphabetical, so anybody
can re-derive it without looking. Two definitions asking for the same
relationships produce the same bytes; a definition that already asked for
`noopener` on a `_blank` link ships `rel="noopener"` once, not twice.

Duplicates are *permitted* in the stored array, unlike `class`, and the
asymmetry is deliberate: the stored `rel` is a request rather than the bytes, so
exactly one function decides the emitted value and there is no second place for
the two sources to disagree.

The keyword set is `alternate author bookmark external help license next
nofollow noopener noreferrer prev search tag`. Every one is inert — it describes
a relationship and causes no user agent to fetch anything. `prefetch`,
`preload`, `preconnect`, `dns-prefetch`, `prerender`, `modulepreload`,
`stylesheet`, `icon` and `manifest` are excluded because each of them turns an
anchor into a request, which is the one thing a link in a section may not do
before somebody clicks it.

`opener` is excluded, and it is the interesting omission. Its only effect is to
undo `noopener`. A closed keyword set containing the keyword for "please
reintroduce the vulnerability" would need a conflict rule and a test for the
conflict rule; leaving it out means the conflict cannot be written down at all.

### Target is two values

`_parent` and `_top` are refused because they name a browsing context the
section does not own. In the editor every section renders inside the canvas
iframe, so a `_top` link navigates the admin shell out from under the person
editing — the same markup behaving differently in preview and in public, which
is the one difference this renderer exists not to have. A *named* target is
refused for the reason `id` is refused on a field node: a name is an entry in a
namespace shared by the whole page, so two sections that pick the same one start
steering each other's links.

`_self` is the default stated out loud, and it is inert here in a way it is not
in general HTML: `<base>` is not a tag any structured document can carry, so
there is no document-wide default for it to override.

### Width and height: is zero valid?

**Zero is conforming HTML and this model refuses it.** That sentence is written
this way round because somebody will one day read the specification, find zero
permitted, and file the check as a bug.

The specification: `width` and `height` on an `img` are parsed by the rules for
parsing non-negative integers. Zero is a non-negative integer. `width="0"` is
valid markup and every browser accepts it.

The product contract: the attribute is supported *because* the inventory found
it on 85 of 86 image field elements doing the one job those attributes do —
reserving the box before the bytes arrive so the page does not jump. A zero
dimension reserves nothing, so a definition declaring one has asked for the
attribute and refused its only effect. And a `0`×`0` image is a request that
fetches and displays nothing, which is the shape of a tracking pixel rather than
of a picture. A definition author who wants an invisible image can still write
one in CSS — but not by accident, and not invisibly to whoever reads the
document.

So the grammar is 1–8192. The upper bound is more than twice the long edge of a
4K frame, so every raster the catalogue could plausibly ship fits, and small
enough that the reserved box is a page rather than a denial of layout.

The value is a JSON **number**, not a string of digits, so `"0080"`, `" 12"`,
`"12px"` and `"1e3"` are not values this model can hold. TypeScript tests
`Number.isSafeInteger`; SQL tests `trunc(v) = v` rather than a digit pattern,
because `jsonb` keeps `12.0` as the text `12.0` while `JSON.parse` gives
TypeScript the integer `12` — and a pattern would refuse a document the other
layer stores.

`width` and `height` arrive together or neither does. One alone is the case that
looks harmless: the pair is what gives a browser an aspect ratio to reserve
space with, so a lone `width` leaves the other axis unknown, the box is still
wrong, and the page still jumps. The attribute has been paid for and none of its
effect collected. The inventory agrees the pair is how they occur — the same 85
elements carry both.

## Wrappers: a class stays on the element it was written on

The inventory labels some classes "wrapper-capable", meaning a wrapper element
node could carry them instead of the field node. This ADR does not do that, for
either the link or the image case.

A class authored on a V1 anchor stays on the rendered anchor, because moving it
changes which CSS selectors match. `.btn` on the anchor and `.btn` on a
surrounding `<span>` are different pages: `a.btn`, `.btn:hover`, `.btn + .btn`,
`.card > .btn` and every specificity calculation involving them all change.
Proving a particular move safe would mean proving an equivalence over the
definition's own stylesheet *and* over `INTERACTION_PRESET_CSS`, once per
definition, for every definition involved — and the inventory records that 222
of those 244 class occurrences appear in a selector somewhere. Nobody has that
proof, and the failure it would produce is a section that renders, parses, and
looks wrong: the exact outcome the import policy exists to refuse.

The seeded `feature` definition demonstrates the rule rather than describing it:
its stylesheet says `.feature-image`, and `.feature-image` is on the `<img>`.

## What stays quarantined, and why each one

**`style`.** An inline declaration list is a second CSS sink outside the one CSS
policy — the hole `STRUCTURED_ATTRIBUTES` was drawn to close. Authored CSS goes
through `scopeCss` and `validateCompiledCss` and is versioned as a compiled
artifact; a `style` attribute would be a stylesheet that no policy ever saw and
no scope ever bounded. The inventory finds it on 3 definitions, and 3
definitions is not a reason to have two CSS stories.

**Arbitrary `data-*`.** The inventory finds `data-registration-cta`,
`data-form-action`, `data-visually-hidden`, `data-cms-embed-src`,
`data-cms-label` and `data-tone`. What every one of them *means* lives in V1
JavaScript that does not exist in v2, so there is nothing for the value to mean
here. Carrying them would produce definitions that look imported and behave
inertly, which is harder to notice than a definition that was refused. Five of
the six need no field-node feature at all — a wrapper element node can hold them
if v2 ever wants the hook — and that is an element-node allowlist question, not
this one.

**Arbitrary `aria-*`.** Not because ARIA is dangerous, but because a definition
is the wrong place for it. An accessible name describes the *content*, and the
content is the author's value: a definition that fixed `aria-label="Read more"`
would announce "Read more" for every page that used the section, whatever the
label actually said. ADR 0007 already puts accessibility metadata on the node as
explicit modelled fields rather than as free attributes, and that is where this
belongs when it is needed. The inventory found no `aria-*` on any link or image
field element, so nothing is waiting on it.

**Event handlers.** A structured definition contains no executable code and no
position that accepts any. The inventory found zero `onclick` on any field
element and zero inline handlers in the entire catalogue; adding an attribute
nobody uses whose value is a script would be inventing the vulnerability.

**`srcdoc`.** It is a whole HTML document in an attribute, for an element
(`iframe`) that is not in the tag allowlist and never will be. It appears here
only because it is the shape a payload takes when somebody is trying to smuggle
a document past an attribute check, and it is tested for that reason.

**`id` and IDREF-valued attributes** (`aria-labelledby`, `aria-describedby`,
`for`, `form`, named `target`). An id is a name in a namespace shared by the
whole page, and a definition can be placed on a page more than once — so a
definition-owned id is a duplicate id the moment somebody adds a second copy of
the section, and the anchors, labels and ARIA references then resolve to
whichever came first. Element nodes carry `id` because ADR 0007 counted 19
definitions and 41 in-page anchor edges that need it, and that is a known,
bounded exception an author places deliberately; making it a property of a field
node inside a repeatable definition is a different and worse thing.

**`srcset` and `sizes` as opaque strings.** `srcset` is a comma-separated
candidate grammar and `sizes` is a media-query list; neither is a URL, and
`safeUrl` answers a question about one URL. The renderer already has
`safeUrlList` for exactly this, and the reason it exists is that treating a list
as a single value once produced `/a.png1x,//evil.test/x2x` — a string starting
with `/`, waved through, and then split back by the browser into two candidates,
one of them off-site. A responsive image is a real requirement and it will get a
modelled node with a typed candidate list; it will not get a string. The
inventory found `srcset` and `sizes` on no image field element at all.

**Raw HTML.** Unchanged from ADR 0007: static raw markup keeps the governed
escape hatch of ADR 0005/0006 and gets no fields. A field node has no children.

**Dynamic attribute names.** There is no position in this model where a value
decides a name. That is the invariant ADR 0007 was written to establish and this
ADR does not touch it: the allowlist is a literal list in TypeScript and a
literal list in SQL, and both are read at the point of emission.

**Authored overrides of `href`, `src` and `alt`.** These are the author's
values, and the whole reason `link` and `image` are field nodes. A definition
that could set them would let a super admin's stored document override what a
contributor typed, silently, on every page using the section — and would put a
URL back into a document position, which is the thing ADR 0007's tag allowlist
was drawn to prevent.

**The non-conforming framework-utility class grammar.** The inventory finds one
definition whose class list is framework utilities: `sm:` breakpoint prefixes
and bracketed arbitrary values like `w-[32px]`, and by extension the slash
opacity suffix. This is a decision about the *value*, not the attribute — and it
is a refusal on grounds of grammar rather than of safety. `STRUCTURED_TOKEN`
admits letters, digits, `_` and `-`. Admitting `:`, `[`, `]`, `/`, `.` and `%`
would make the token grammar accept very nearly any string, which is the same as
having no grammar: the check would no longer be able to tell a class name from a
selector, a fragment, or a payload. It buys one definition. The right answer, if
that definition ever matters, is a compiled utility layer with a closed name
list, not a wider regular expression.

## Versioning

`STRUCTURED_SCHEMA_VERSION` goes from 1 to 2, and
`app.current_structured_schema_version()` with it. The persisted contract
changed, so the version changed — this model has one rule about versions and it
is that a document naming a version the reader does not implement is refused
rather than read optimistically, at the storage gate and again in the renderer,
so neither depends on the other having remembered.

It would have been possible to make `staticAttributes` an optional key at
version 1 and let old readers ignore it. That is the failure mode this schema
has met three times: a v1 reader would emit an anchor without the class that
styles it and an image without the box that reserves its space — markup that
parses, renders, and is wrong, on a page nobody reviewed.

### v1 documents render byte for byte

Asserted, not asserted-ish. `packages/seeds/src/index.test.ts` holds the exact
public and preview bytes of all five seeded definitions as recorded from commit
`718e8d0` — the last commit before schema v2 — and renders each seed's document
with its `staticAttributes` removed and the upgrade applied. Five definitions,
both rendering paths, ten byte-exact strings. `packages/renderer/src/structured.test.ts`
does the same at the node level for the five link and image shapes whose output
schema v1 could produce.

The reason it holds is structural rather than lucky: the author's own attributes
are emitted first in each start tag and the definition's follow, so a node with
no static attributes contributes nothing to the second half. `<a href="…">`
and `<img src="…" alt="…">` are unchanged, character for character, including
the `rel="noopener"` an off-site link has always had.

### The upgrade

`upgradeStructuredDocument` carries a v1 document to v2. The whole upgrade is
the version number.

**A v1 node upgraded to v2 has no static attributes — explicitly, not an empty
object.** An empty `staticAttributes` would be a v2 document claiming a
definition author had considered the question and answered "nothing", and the
inventory's evidence is that V1 wrote classes on 215 of those anchors. Inferring
an answer would be inferring it for the whole catalogue at once, with nobody
watching.

The function refuses a v1 document whose field nodes already carry
`staticAttributes` — a key v1 did not define. Re-stamping such a document would
give it the provenance of one that had been through a v2 gate, which it has not.
It is idempotent, total, and never throws: the iterative preflight runs first, so
a hostile document is refused rather than parsed.

Migration 0025 performs the same transformation over stored rows in SQL. It
cannot go through `pnpm db:revalidate`: migration 0019 deliberately excludes
structured definitions from `app.section_definitions_needing_revalidation()`,
because that tool recompiles a row from its `source_html` and a structured
definition has none — listing one there would hand the repair tool a row whose
repair is to overwrite it with an empty legacy definition.

`render_hash` is not recomputed by the migration. It is a sha256 over the
document, the compiled CSS and the CSS policy version as JavaScript serializes
them, which no SQL expression can reproduce — `jsonb` does not preserve key
order. Nothing in the schema recomputes or verifies it either; it is stored,
echoed into manifests, and compared against by the golden tests in the packages
that produce it. A row left alone therefore keeps a hash describing its v1
document until it is re-authored or re-seeded, which is a stale identity rather
than a failing gate.

## Invariants this adds to ADR 0007's list

- Static attributes are definition-owned. No stored page value reaches one, and
  no definition reaches a URL, an alt text or a label.
- Class values are token arrays. Nothing splits a stored string into markup.
- Attribute names and values are re-checked at the point of emission, so
  "it was validated upstream" is never load-bearing.
- `target="_blank"` implies `rel="noopener"` in the emitted bytes, guaranteed by
  the renderer rather than requested by the definition.
- Duplicate and merged `rel` tokens normalise deterministically: one order, one
  copy of each keyword.
- `width` and `height` are present together or not at all.
- Preview and public emit identical elements with identical attributes; preview
  adds a wrapper around them and nothing inside.
- A document this build cannot read in full renders nothing at all, without
  throwing, at every layer.

## Consequences

- The importer's `CONSUMED_BY_FIELD` and `markupField` in
  `packages/importer/src/convert.ts` can now map `class`, `rel`, `target`,
  `width`, `height`, `decoding`, `loading` and `fetchpriority` onto a field node
  instead of raising `field-attributes-lost`. Doing so should clear the code
  from 68 definitions and unlock 3; the inventory is regenerable and will say.
- The admin inspector is unaffected. Static attributes are not editable, do not
  appear in `slots`, and are not part of what an author is offered — which is
  the point of calling them static.
- Anything that writes a structured document must name version 2. The seeds and
  the importer both stamp `STRUCTURED_SCHEMA_VERSION`, so both follow the
  constant.
