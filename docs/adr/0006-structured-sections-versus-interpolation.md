# ADR 0006 — structured section definitions, not interpolated HTML

**Status:** accepted as a recommendation; implementation deferred to M2's
importer work, which is where it becomes cheap
**Date:** 2026-08-22
**Relates to:** SPEC §6.5, ADR 0005

## The evidence

V2's section model is "authored HTML with `{{slot}}` tokens in it". Compiling
that safely means knowing, for every token, which of HTML's parsing contexts it
lands in — and then escaping for that context. That is a language
implementation, and the record of this one is not encouraging:

| Round | What was wrong |
|---|---|
| 1 | One escaper for every position; a value in `title="…"` closed the attribute |
| 2 | Contexts recorded but trusted; a stored row could claim `element-text` in `<div ␣>` |
| 2 | Raw text ended on any `</script` prefix, so `</scriptx>` left the element early |
| 2 | `url()` matched by spelling, so `u\72l(…)` was not a url to us and was to Chromium |
| 3 | Slot ids interpolated into the reconstruction, so an id could rewrite the parse |
| 3 | Script-data escaped and double-escaped states unmodelled |
| 3 | Compiled CSS believed because a column said so |
| 4 | Selector scopes compared as text, so an escape crossed them |
| 4 | Slugs had no grammar and became selector syntax |

Repeated reviews found distinct parsing and validation defects beyond the
existing test corpus. This indicates substantial complexity in the generalized
interpolation model and motivates a narrower representation.

Arbitrary interpolation positions add risk beyond the required editing model.
No product requirement says an editor's typed field must be able to
appear in an arbitrary position in arbitrary markup. What the SPEC asks for is
sections with typed, editable fields (§6.5), and the interpolation model is an
implementation choice that happens to make the general case available — and
therefore to make the general case a thing that has to be secured.

## The recommendation

V2's ordinary path should be **structured section definitions**:

- A definition is a versioned tree of typed nodes — element, text, richtext,
  url, image, style — not a string with holes in it.
- Fields bind to node *properties*, not to positions in markup. A url field is
  a url because of where it is in the tree, and there is no other kind of place
  it could be.
- The renderer walks the tree and emits markup. Nothing interpolates, so there
  is no context to derive, no context to store, no context to re-derive, and no
  stored value that is ever parsed as syntax. The entire class of defect above
  stops existing rather than being defended against.
- Style is a declaration list on a node, run through the CSS policy, never a
  string in a `style="…"` attribute.

**Static raw HTML keeps a governed escape hatch**, and it stays *static*: no
fields, super-admin approval, and ideally rendered through a separate path with
its own isolation — a sandboxed frame or a separately-scoped shadow root —
rather than concatenated into the page beside ordinary sections. The rule
arrived at in round 3 for scripts ("a template with a script may not have
slots") is the same rule generalised: dynamic and raw do not mix, ever.

**The V1 importer becomes the forcing function.** 118 definitions have to be
read and turned into something anyway. Mapping recognised template shapes onto
structured definitions is roughly the same work as importing them as HTML
strings, and definitions that do not map cleanly get quarantined and reported —
which is information worth having about a library nobody has audited since it
was written.

## Why not now

Two reasons, both about sequencing rather than doubt.

The importer is not written yet, and it is the natural place to build the
structured model: writing it first and then discovering what 118 real
definitions actually need is how a model gets designed twice. And the current
path is, as of this commit, defended at four independent layers — compiler,
database gate, renderer rebinding, and an in-browser differential suite — which
is enough to keep M2 moving while the model is designed against real inputs.

## Consequences

- Section importer work (M2) is scoped to produce structured definitions, with
  a quarantine report for what will not map. That is a change to that task's
  shape and should be planned as one.
- The interpolation compiler stays until the importer lands, and stays defended.
  It is not to be extended: new slot kinds, new contexts, or new template
  capabilities go into the structured model instead.
- The escape hatch's isolation (sandboxed frame or shadow root) becomes a design
  question for M2 rather than an open one.
- If the structured model turns out not to cover a real V1 section shape, that
  is a finding to record here, not a reason to widen interpolation.
