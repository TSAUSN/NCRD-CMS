// What a V1 `<a data-editable>` or `<img data-editable>` keeps when it becomes a
// field node, and what it still cannot.
//
// Structured schema v2 gave the two markup field nodes a `staticAttributes`
// object (ADR 0008): a closed, definition-owned set with a closed grammar for
// every value. This module is the one place that decides whether a V1 element's
// attributes fit that grammar *exactly*, and it is deliberately the only place —
// the converter asks and does not re-derive, so there is one answer to "can this
// be carried" rather than one per call site.
//
// The rule that shapes every decision below: **all of it, or none of it**. A
// class list carrying one framework-utility token (`sm:px-6`, `bg-white/95`,
// `tracking-[0.14em]`) does not become a class list with that token removed. The
// token is a selector something in V1 matched, so dropping it changes what the
// page looks like, and a converted section that renders differently from the one
// it was converted from is the exact failure ADR 0007 exists to refuse. When any
// attribute on the element cannot be carried, the whole element is refused and
// the definition is quarantined with the attribute named.
//
// Names only ever leave here as names. A class token is a V1 CSS identifier and
// an `alt` is V1 copy, and neither belongs in a report this repository commits —
// so a value that fails the grammar is reported as `class(value)`, never as the
// value that failed.

import {
  STRUCTURED_IMAGE_DECODINGS,
  STRUCTURED_IMAGE_FETCH_PRIORITIES,
  STRUCTURED_IMAGE_LOADINGS,
  STRUCTURED_LINK_TARGETS,
  isStructuredStaticAttributeValue,
  structuredImageDimensionsAgree,
  type StructuredImageStaticAttributes,
  type StructuredLinkStaticAttributes,
} from '@cms/schema'
import type { HtmlAttribute } from './html.ts'

/**
 * Either the attributes a field node will carry, or the names it cannot.
 *
 * `staticAttributes` is `undefined` rather than `{}` when the element carried
 * nothing beyond what the field node already absorbs. The two are different
 * documents — ADR 0008 is explicit that a node which never asked for a static
 * attribute has no `staticAttributes` key at all — and writing an empty object
 * would put a key in every converted link and image saying nothing.
 */
export type StaticAttributeMapping<Attributes> =
  | { ok: true; staticAttributes: Attributes | undefined }
  | { ok: false; lost: string[] }

/**
 * How a name that could not be carried is written down.
 *
 * Three forms, and they are three different problems. A bare name is an
 * attribute with no home in the model at all — an inline `style`, a `data-*`
 * hook V1's own scripts read. `name(value)` is a name the model has and a value
 * its grammar refuses, which is the framework-utility class case and the one a
 * reader is most likely to mistake for the first. `width(unpaired)` is the third:
 * both dimensions are expressible, and one alone is not, because the pair is
 * what reserves the box.
 *
 * No spaces in any of them, because the reason detail joins these with a space
 * and a detail nobody can split is a detail nobody can count.
 */
function unusable(name: string): string {
  return `${name}(value)`
}

function unpaired(name: string): string {
  return `${name}(unpaired)`
}

/**
 * A space-separated attribute as the token array the model stores.
 *
 * Split on ASCII whitespace, which is how HTML defines a token list, and then
 * required to round-trip: the renderer emits `tokens.join(' ')`, so a source
 * whose spacing differs from that is a source this importer would be silently
 * rewriting. Nothing in the catalogue does — every conforming class list in the
 * 326 field elements is already single-spaced — so the strict reading costs
 * nothing here, and an importer that starts normalising somebody else's markup
 * on a guess is one whose output can no longer be held against the original.
 *
 * Returns the tokens rather than a verdict. Whether they are *usable* tokens is
 * the schema's question, asked by the caller through the one predicate that
 * answers it for the database, the renderer and this package alike.
 */
function tokenList(value: string): string[] | null {
  const tokens = value.split(/[ \t\n\f\r]+/).filter(token => token !== '')
  return tokens.join(' ') === value ? tokens : null
}

/**
 * An intrinsic dimension, as the number the model stores.
 *
 * Canonical decimal only. `0080` and `80` are the same integer and different
 * bytes, and a document that stored 80 for a source that wrote `0080` would
 * render an attribute nobody wrote — the same rewriting `tokenList` refuses, in
 * the one place a number makes it look harmless.
 */
function dimension(value: string): number | null {
  if (!/^[0-9]+$/.test(value)) return null
  const number = Number(value)
  return String(number) === value ? number : null
}

/** The element's attributes by name, so a mapping reads in one fixed order. */
function byName(attributes: readonly HtmlAttribute[]): HtmlAttribute[] {
  return [...attributes].sort((a, b) => a.name.localeCompare(b.name, 'en'))
}

/**
 * A refusal, with the names it refused over in one stable order.
 *
 * Sorted after the fact rather than relying on the walk order, because the
 * dimension-pairing check below can only run once every attribute has been
 * read and so contributes its name out of order.
 */
function refuse(lost: string[]): { ok: false; lost: string[] } {
  return { ok: false, lost: [...lost].sort((a, b) => a.localeCompare(b, 'en')) }
}

/**
 * What a V1 anchor's attributes become on a link field node.
 *
 * The three the model has — `class`, `rel`, `target` — and nothing else. `href`
 * is absent by design and is the caller's business: the URL is the author's
 * value and goes through the field, so an anchor's `href` is consumed before
 * this function ever sees it.
 *
 * The enum is narrowed with `find` over the schema's own exported keyword array
 * rather than with a boolean test and a cast. It is the same array
 * `isStructuredStaticAttributeValue` is implemented over — one grammar, and the
 * schema's — and it hands back the keyword already typed, so nothing here has
 * to assert a second time what the check just established.
 */
export function linkStaticAttributes(
  attributes: readonly HtmlAttribute[],
): StaticAttributeMapping<StructuredLinkStaticAttributes> {
  const lost: string[] = []
  let classes: string[] | undefined
  let rel: string[] | undefined
  let target: (typeof STRUCTURED_LINK_TARGETS)[number] | undefined

  for (const attr of byName(attributes)) {
    switch (attr.name) {
      case 'class': {
        const tokens = tokenList(attr.value)
        if (tokens === null || !isStructuredStaticAttributeValue('link', 'class', tokens)) {
          lost.push(unusable('class'))
          break
        }
        classes = tokens
        break
      }
      case 'rel': {
        const tokens = tokenList(attr.value)
        if (tokens === null || !isStructuredStaticAttributeValue('link', 'rel', tokens)) {
          lost.push(unusable('rel'))
          break
        }
        rel = tokens
        break
      }
      case 'target': {
        const keyword = STRUCTURED_LINK_TARGETS.find(candidate => candidate === attr.value)
        if (keyword === undefined) {
          lost.push(unusable('target'))
          break
        }
        target = keyword
        break
      }
      default:
        lost.push(attr.name)
    }
  }

  if (lost.length > 0) return refuse(lost)

  // Assembled here, in `STRUCTURED_LINK_STATIC_ATTRIBUTES` order, rather than in
  // the loop above. The loop reads the element in whatever order V1 wrote it,
  // and key order in a JSON object is insertion order — so building the document
  // as it is read would make an author's typing part of the stored bytes and of
  // the render hash derived from them.
  const out: StructuredLinkStaticAttributes = {}
  if (classes !== undefined) out.class = classes
  if (rel !== undefined) out.rel = rel
  if (target !== undefined) out.target = target
  return { ok: true, staticAttributes: Object.keys(out).length === 0 ? undefined : out }
}

/**
 * What a V1 image's attributes become on an image field node.
 *
 * Six names, and the pairing rule at the end that no per-attribute check can
 * express: `width` and `height` arrive together or neither does, because one
 * alone gives the browser no aspect ratio and so reserves the wrong box while
 * looking like it reserved the right one. The schema and the database both
 * refuse the lone one, so an importer that emitted it would be producing
 * documents storage rejects — and quietly dropping the survivor instead would
 * be dropping a layout guarantee, which is the thing this package refuses to do
 * silently.
 */
export function imageStaticAttributes(
  attributes: readonly HtmlAttribute[],
): StaticAttributeMapping<StructuredImageStaticAttributes> {
  const lost: string[] = []
  let classes: string[] | undefined
  let width: number | undefined
  let height: number | undefined
  let decoding: (typeof STRUCTURED_IMAGE_DECODINGS)[number] | undefined
  let loading: (typeof STRUCTURED_IMAGE_LOADINGS)[number] | undefined
  let fetchpriority: (typeof STRUCTURED_IMAGE_FETCH_PRIORITIES)[number] | undefined

  for (const attr of byName(attributes)) {
    switch (attr.name) {
      case 'class': {
        const tokens = tokenList(attr.value)
        if (tokens === null || !isStructuredStaticAttributeValue('image', 'class', tokens)) {
          lost.push(unusable('class'))
          break
        }
        classes = tokens
        break
      }
      case 'width':
      case 'height': {
        const size = dimension(attr.value)
        if (size === null || !isStructuredStaticAttributeValue('image', attr.name, size)) {
          lost.push(unusable(attr.name))
          break
        }
        if (attr.name === 'width') width = size
        else height = size
        break
      }
      case 'decoding': {
        const keyword = STRUCTURED_IMAGE_DECODINGS.find(candidate => candidate === attr.value)
        if (keyword === undefined) {
          lost.push(unusable('decoding'))
          break
        }
        decoding = keyword
        break
      }
      case 'loading': {
        const keyword = STRUCTURED_IMAGE_LOADINGS.find(candidate => candidate === attr.value)
        if (keyword === undefined) {
          lost.push(unusable('loading'))
          break
        }
        loading = keyword
        break
      }
      case 'fetchpriority': {
        const keyword = STRUCTURED_IMAGE_FETCH_PRIORITIES.find(candidate => candidate === attr.value)
        if (keyword === undefined) {
          lost.push(unusable('fetchpriority'))
          break
        }
        fetchpriority = keyword
        break
      }
      default:
        lost.push(attr.name)
    }
  }

  // Asked of what survived, not of what was written: an element carrying both
  // dimensions where one value fails the grammar has already lost that one, and
  // the other is now the lone survivor this rule exists to refuse.
  if (!structuredImageDimensionsAgree({ width, height })) {
    lost.push(unpaired(width === undefined ? 'height' : 'width'))
  }

  if (lost.length > 0) return refuse(lost)

  // In `STRUCTURED_IMAGE_STATIC_ATTRIBUTES` order, for the reason the link
  // mapping states: the stored document's key order is its bytes.
  const out: StructuredImageStaticAttributes = {}
  if (classes !== undefined) out.class = classes
  if (width !== undefined) out.width = width
  if (height !== undefined) out.height = height
  if (decoding !== undefined) out.decoding = decoding
  if (loading !== undefined) out.loading = loading
  if (fetchpriority !== undefined) out.fetchpriority = fetchpriority
  return { ok: true, staticAttributes: Object.keys(out).length === 0 ? undefined : out }
}
