# ADR 0005 — a sink model for template slots, and PostCSS for the CSS policy

**Status:** accepted
**Date:** 2026-08-21
**Supersedes:** nothing. Extends the sanitation half of SPEC §6.5 and §8.

## Context

A section template is authored HTML with `{{slot}}` tokens in it. Sanitizer
policy 1 compiled it into a node list and left it at that: a slot was a slot,
and the renderer escaped every value with `escapeText`.

`escapeText` escapes `&`, `<` and `>`. That is correct for element text and
wrong for everything else. A value in `title="{{value}}"` could close the
attribute, because quotes were not escaped. A value in `href="{{value}}"` became
a live `javascript:` URL, because a URL is not text. A value in
`style="{{value}}"` became a stylesheet with an off-site `url()` in it. And a
value in `<div {{value}}>` or `<{{value}}>` was not in an attribute or an
element at all — it was choosing what the markup *is*, where escaping has
nothing to act on.

Separately, the CSS policy was a hand-written tokenizer. It fell over on a `}`
inside a string, silently flattened `@media` blocks so their rules applied at
every width, never looked at at-rule preludes, and emitted a best-effort partial
parse for unterminated input.

## Decision

**Every slot carries the sink it lands in.** An HTML tokenizer walks the
template at compile time — the states follow the HTML spec's own, because the
thing being predicted is a browser — and records one of eleven contexts per
slot. Four are renderable and each has its own escaper:

| Context | Escaper |
|---|---|
| `element-text` | `escapeText`, or the rich-text sanitizer, or markup for link/image slots |
| `quoted-attribute` | `escapeAttribute` |
| `url-attribute` | the URL policy, then `escapeAttribute` |
| `style-attribute` | the CSS policy, then `escapeAttribute` |

The other seven — `event-attribute`, `srcdoc-attribute`, `unquoted-attribute`,
`attribute-name`, `tag-name`, `comment`, `raw-text` — plus `unknown` for
anything the scanner cannot classify, are refused. Not escaped differently:
refused, at compile time, in the database, and again in the renderer. There is
no escaping that makes a value safe as a tag name, and an unquoted attribute
value ends at the first space no matter what is done to the characters before
it.

Slot kinds that emit markup (`richtext`, `link`, `button`, `image`) are confined
to `element-text` in every case.

**The CSS policy uses PostCSS.** Already resolvable in this workspace as a
transitive dependency of Next.js, so declaring it in `@cms/renderer` adds a name
to a manifest and nothing to the install. It is the parser underneath most of
the CSS toolchain, and — the property that decided it — it *throws* on unclosed
strings, blocks and brackets rather than returning a partial parse. Failing
closed on malformed input is a policy decision this codebase wants to make, and
a parser that guesses would take it away.

**Generated CSS never contains `<`.** Scoped CSS ships inside a `<style>`
element, which is HTML raw text: nothing in it is markup and exactly one
sequence ends it. Rather than hunting for the forms of `</style` that survive
comment removal and escaping, the invariant is checked on the way out and is
blunt enough to verify at a glance. A `<` inside a string is escaped to `\3c`,
which renders identically; a `<` anywhere else means the declaration, selector
or at-rule prelude is refused.

## Amendment, 2026-08-22 — binding, end tags, value tokenizing, and CSS provenance

A direct review found four things wrong with the first cut, and each changed
something structural rather than a string.

**A declared context was trusted.** Recording the sink on each slot is only
useful if the record cannot lie, and it could: a row claiming
`context: 'element-text'` on a slot sitting in `<div {{value}}>` rendered with
the text escaper and emitted the attacker's `onclick`. Contexts are now
**re-derived on every render** from the node list, which *is* the template —
concatenate it, run the tokenizer, compare. The pairing is positional, not by
slot id, because keying by id let two uses of one slot collapse into a single
entry and the safe one decide for both. The reconstructed offsets are checked
too, so an html node smuggling a `{{token}}` cannot shift every pairing after it.

**Raw text ended on a prefix.** `</scriptx>` starts with `</script`, so the
scanner left the script element early, classified the rest as element content,
and a slot there compiled as ordinary text that Chromium then executed. HTML's
*appropriate end tag* rule requires a delimiter — whitespace, `/`, or `>` —
after the name, and that rule is now written out and tested in both directions.
Exiting raw text also has to mark the token as an end tag, or `</script>` reads
as another `<script>` and drops straight back in.

**Declaration values were still matched by pattern.** PostCSS gives structure
and hands the value over as a string; a regex looking for `url(` does not see
`u\72l(`, and a browser does, because CSS resolves escapes inside identifiers
before deciding what a function is. Values are now tokenized with
`@csstools/css-tokenizer` — the CSS Syntax Level 3 tokenizer, which resolves
those escapes as the specification says to, so `u\72l(…)`, `U\52 L(…)` and
`url(…)` all arrive as a url token carrying the URL. The bare-location regex
that follows is a diagnostic for dead CSS, not the boundary.

**Authored and compiled CSS were one column.** The seed stored `compiled.css`
as `source_css`; the manifest published that column, which worked only because
it was already compiled; and revalidation read it as authored source and scoped
it a second time. They are separate columns now — `source_css`, `compiled_css`,
`css_policy_version` — with only the compiled one published, and revalidation
compiling from the authored one under the same named scope selector.

## Amendment, 2026-08-22 (second) — ids, scripts, and compiled artifacts

Three more, and see ADR 0006 for what the pattern is now taken to mean.

**A slot id was syntax.** Reconstruction interpolated the stored id into a
`{{…}}` marker, so an id of `a}}</p><div title="` closed its own marker and
changed the derived context of every slot after it. Ids are now a grammar —
`^[a-zA-Z][a-zA-Z0-9_-]{0,63}$`, enforced in the zod schema, the compiler, the
renderer's rebinding and the database gate — and reconstruction uses generated
positional markers (`__cms_slot_N__`) that owe nothing to stored data. Count,
offset, marker identity and token length are all compared, and an html node
containing such a marker is refused, because a real compiler cannot emit one.

**Script elements no longer end.** HTML's script-data escaped and
double-escaped states mean `<script><!--<script></script>-->` does not close
where it appears to. Rather than implement those states — the third hand-rolled
corner of a tokenizer to be wrong — the scanner treats a script element as
one-way, and the compiler refuses any template that has both a script and a
slot. Static raw code still ships through approval; it is just static. This is
what SPEC §6.5's active-content rejection should always have meant: approval is
a decision about markup an author pasted, never a decision that a typed field
may become code.

**Compiled CSS was believed.** `validateCompiledCss` now re-checks a stored
artifact with PostCSS and the value tokenizer — every selector branch rooted at
that definition's own scope with a real boundary, every conditional at-rule
recursed into, every declaration re-run through the URL and active-value policy
— without re-scoping, since re-scoping an already-scoped selector changes the
page. The renderer runs it before emitting a stylesheet and drops the whole
section if it fails. `css_policy_version` is carried into `SectionDefView` so
the renderer can make that decision from what it was handed.

## Amendment, 2026-08-22 (third) — selectors are tokens, slugs are a grammar

A selector's meaning is not in its characters. `.cms-section--d\65 vil` is the
class `cms-section--devil`, so a definition with slug `d` could style one with
slug `devil` — and the "character after the scope" test passed it, because a
backslash cannot continue an identifier *before* escape resolution and very much
can after. Comments, every-character escaping and escaped punctuation were the
same hole wearing different clothes. Authored CSS could produce it too: `&\65 vil`
was scoped by `selector.replace('&', scope)`, putting the scope directly against
characters the author chose.

Selectors are now parsed with `postcss-selector-parser`, which resolves those
spellings the way the CSS Syntax specification does and yields a class node whose
`value` is the identifier. Validation compares identifiers. Scope *insertion* is
structural — the nesting node is replaced with a real class node in the parsed
tree — and the serialized result is re-parsed and re-validated before it can
ship, so a serialization that happens to concatenate into something new is caught
by the same check that catches a stored artifact. Every branch of a selector list
is checked independently, at every at-rule nesting level, and per-block custom
CSS (scoped to `#s<n>`) goes through the identical path.

Slugs were the other half. `sectionScopeSelector('a,body')` produced
`.cms-section--a,body` — a selector list. There is now one grammar
(`^[a-z0-9]+(?:-[a-z0-9]+)*$`, 64 characters) in Zod, TypeScript, and
`app.is_section_slug`, and `sectionScopeSelector` returns null rather than
turning a bad slug into syntax. No slug means no scope means no stylesheet:
falling back to the bare `.cms-section` had scoped a definition's CSS to every
section on the page.

## Amendment, 2026-08-22 (fourth) — what the scanner is allowed to decide

A read-only audit swarm found that two rules were resting on the scanner in
places the scanner cannot hold, and that one sink category was answering the
wrong question.

**Script presence is no longer the scanner's decision.** The rule that a
template may not contain both a script element and an editable slot was
implemented by counting the script elements the tokenizer walk entered. Inside
`<svg>` and `<math>` the walk is wrong: foreign content does not put `title`,
`textarea`, `style`, `xmp` or `noembed` into raw text, and Chromium executes
`<svg><title><script>…</script></title></svg>`. The walk never saw that script,
so the rule did not fire. Making the walk right means implementing HTML's
foreign-content algorithm including its integration points — `<math><mi><title>`
is HTML again, where the script really is inert — and that is the same
language-implementation work this ADR already declined for the script-data
states. The rule does not need to know *where* a script is, only that there is
one, so presence is now a state-free search over the markup the AST carries. It
is the same search `app.render_ast_defect` performs on the same values, so the
compiler and the storage gate now refuse exactly the same templates instead of
the compiler accepting what storage would later reject.

The same change closes the `</>` evasion independently of the tokenizer fix that
landed beside it: a scanner bug can no longer hide a script, because the
detector does not consult the scanner.

`SANITIZER_POLICY_VERSION` deliberately did not move. The storage gate was
already applying this exact search, so no artifact that can be stored was ever
one of the newly-refused ones — the acceptance change is at compile time only,
and a bump would have forced a fleet-wide revalidation that recomputes identical
bytes.

**`url-attribute` was one category holding four grammars.** The set the
tokenizer classifies as URL-bearing contains two space-separated lists (`ping`,
`archive`), one comma-separated candidate grammar with descriptors (`srcset`),
and five attributes that are not URLs at all (`xmlns`, `xmlns:xlink`, `from`,
`to`, `values`). `safeUrl` was applied to all of them, which asks a single-URL
question about a list and answers it from the first few characters — and it
stripped every space in its input, welding a list into one string that began
with `/` and passed the protocol-relative check. Each attribute now selects a
policy by name, using the attribute the tokenizer recorded and `bindContexts`
re-derives, and the five non-URL attributes render nothing rather than teaching
the frozen compiler a fourth grammar for a case the V1 catalogue does not
contain.


## Consequences

- `SANITIZER_POLICY_VERSION` is 4 and `CSS_POLICY_VERSION` is 6 (selectors are
  tokenized and slugs are constrained). Stored
  definitions carry theirs, so the bump is detectable rather than silent — which
  is what SPEC §6.5 says those columns are for.
- Existing rows are found by `app.section_definitions_needing_revalidation()`
  and recompiled from their stored `source_html`/`source_css` by
  `pnpm db:revalidate --apply`. A definition whose source no longer compiles
  cleanly is listed and left alone: the fix for a slot in a tag name is an
  author changing the template, not a script choosing a meaning for them.
- A page pinned to a definition below the current policy does not preview and
  does not publish. That is a visible refusal naming the definition, not a
  section that quietly disappears.
- Templates that put a slot in an unquoted attribute now fail to save. Some of
  the 118 V1 sections may do this; the importer will report them rather than
  carry the defect across, which is the outcome the escape-hatch work is
  sequenced before it for.
- Three direct dependencies: `postcss` for structure, `@csstools/css-tokenizer`
  for values, and `postcss-selector-parser` for selectors. Both are small, maintained, and doing a
  job that a hand-written matcher demonstrably got wrong.
- Rows written before the authored/compiled split keep publishing exactly what
  they published — their `source_css` is copied into `compiled_css`, because
  compiled is what it actually was — but their `css_policy_version` is NULL,
  which reads as "provenance unknown". Revalidation reports those as
  `needs-an-author` rather than recompiling: `source_css` may hold either form,
  nothing can tell by looking, and guessing means either double-scoping a
  definition or publishing unscoped CSS into a shared stylesheet.
