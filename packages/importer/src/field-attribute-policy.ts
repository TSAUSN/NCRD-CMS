import { isStructuredAttributeValue } from '@cms/schema'

/**
 * The version of this inventory's judgements.
 *
 * Separate from `IMPORTER_VERSION` because the two answer different questions
 * and move for different reasons: the importer's version changes when a
 * definition could change *status*, this one changes when an attribute could
 * change *verdict*. Both are carried in the report, so a reader comparing two
 * inventories can tell which of the two moved.
 */
export const INVENTORY_VERSION = 1

/** The two field types that render their own element and so have no node to hold attributes. */
export const FIELD_KINDS = ['link', 'image'] as const
export type FieldKind = (typeof FIELD_KINDS)[number]

/** The element each field kind must be written on, which the converter also insists upon. */
export const FIELD_ELEMENT: Record<FieldKind, string> = { link: 'a', image: 'img' }

/**
 * Where an attribute's value comes from.
 *
 * The distinction that matters for schema v2: a `static` value is something an
 * author typed once and a v2 model could store as an authored attribute, while
 * a `repeat-indexed` one is a value that only makes sense as the Nth copy of
 * something and would need the repeat node to exist first. `generated` is V1's
 * own authoring machinery — `data-block-id` and `data-editable` are how V1
 * marks a region, and a field node re-derives both from the slot, so they are
 * not losses at all.
 */
export const ATTRIBUTE_BINDINGS = ['static', 'interpolated', 'generated', 'repeat-indexed'] as const
export type AttributeBinding = (typeof ATTRIBUTE_BINDINGS)[number]

/**
 * Whose attribute it is.
 *
 * `field-intrinsic` means the field node already carries it — the URL, the label,
 * the alt text. `field-element` means it changes how the rendered `<a>` or
 * `<img>` itself behaves and an ancestor cannot stand in for it: an intrinsic
 * width on a wrapper does not stop the image reflowing the page.
 * `wrapper-capable` means an element node wrapping the field could carry it,
 * though `wrapperSafe` below is what says whether doing so would change the page.
 */
export const ATTRIBUTE_OWNERSHIPS = ['field-intrinsic', 'field-element', 'wrapper-capable', 'unknown'] as const
export type AttributeOwnership = (typeof ATTRIBUTE_OWNERSHIPS)[number]

/** What is broken when the attribute is dropped. */
export const ATTRIBUTE_EFFECTS = ['layout', 'accessibility', 'navigation', 'loading', 'security'] as const
export type AttributeEffect = (typeof ATTRIBUTE_EFFECTS)[number]

/** How the attribute takes part in an id/IDREF or in-page anchor relationship. */
export const ANCHOR_ROLES = ['none', 'anchor-source', 'anchor-target', 'idref'] as const
export type AnchorRole = (typeof ANCHOR_ROLES)[number]

/**
 * What this inventory recommends doing with the attribute.
 *
 * `support` is a claim that a v2 field node could carry it under a closed value
 * grammar. `wrapper` is a claim that it does not need a field-node feature at
 * all, because an element node around the field can hold it without changing
 * what the page does. `quarantine` is a claim that supporting it would re-open
 * a hole schema v1 closed on purpose — an inline style is a second CSS sink
 * outside the one CSS policy, and an event handler is executable content.
 */
export const ATTRIBUTE_VERDICTS = ['support', 'wrapper', 'quarantine'] as const
export type AttributeVerdict = (typeof ATTRIBUTE_VERDICTS)[number]

// ------------------------------------------------------------ what we know

type AttributeFact = { ownership: AttributeOwnership; effects: AttributeEffect[]; hazard?: true }

/**
 * The attributes this inventory has an opinion about, and what that opinion is.
 *
 * Written out rather than derived, because ownership is not a property anything
 * in the markup can be asked for: whether a wrapper could carry `loading` is a
 * fact about how browsers fetch images, and the only place to record it is a
 * table somebody can review line by line. The list is deliberately longer than
 * the catalogue needs — `srcset`, `crossorigin`, `referrerpolicy` and the rest
 * appear on no V1 field element at all, and their absence is itself a finding
 * the summary reports, which it can only do if they were looked for.
 */
const ATTRIBUTE_FACTS: Record<string, AttributeFact> = {
  // The URL, the label and the alt text: already the field node's own payload.
  href: { ownership: 'field-intrinsic', effects: ['navigation', 'security'] },
  src: { ownership: 'field-intrinsic', effects: ['loading', 'security'] },
  alt: { ownership: 'field-intrinsic', effects: ['accessibility'] },
  'data-block-id': { ownership: 'field-intrinsic', effects: [] },
  'data-editable': { ownership: 'field-intrinsic', effects: [] },

  // Styling. `class` is nominally wrapper-capable and almost never wrapper-safe:
  // V1 styles anchors and images by class, so moving one to a wrapper changes
  // which box the rule applies to. `wrapperSafe` is computed from the stylesheet
  // rather than assumed here.
  class: { ownership: 'wrapper-capable', effects: ['layout'] },
  id: { ownership: 'wrapper-capable', effects: ['navigation', 'accessibility'] },
  style: { ownership: 'field-element', effects: ['layout', 'security'], hazard: true },

  // Intrinsic geometry. A wrapper cannot supply it: the reflow happens when the
  // image loads, and the browser needs the ratio on the image.
  width: { ownership: 'field-element', effects: ['layout'] },
  height: { ownership: 'field-element', effects: ['layout'] },

  // Fetch scheduling. All four are read off the `<img>` by the loader.
  loading: { ownership: 'field-element', effects: ['loading'] },
  decoding: { ownership: 'field-element', effects: ['loading'] },
  fetchpriority: { ownership: 'field-element', effects: ['loading'] },
  srcset: { ownership: 'field-element', effects: ['layout', 'loading', 'security'] },
  sizes: { ownership: 'field-element', effects: ['layout', 'loading'] },

  // Navigation and the request the browser makes.
  target: { ownership: 'field-element', effects: ['navigation', 'security'] },
  rel: { ownership: 'field-element', effects: ['navigation', 'security'] },
  referrerpolicy: { ownership: 'field-element', effects: ['security'] },
  crossorigin: { ownership: 'field-element', effects: ['loading', 'security'] },
  download: { ownership: 'field-element', effects: ['navigation'] },
  type: { ownership: 'field-element', effects: ['navigation'] },

  // Accessible semantics, which name the element they are written on.
  title: { ownership: 'field-element', effects: ['accessibility'] },
  role: { ownership: 'field-element', effects: ['accessibility'] },
  lang: { ownership: 'wrapper-capable', effects: ['accessibility'] },
  dir: { ownership: 'wrapper-capable', effects: ['accessibility'] },
  hidden: { ownership: 'wrapper-capable', effects: ['accessibility', 'layout'] },
  tabindex: { ownership: 'field-element', effects: ['accessibility', 'navigation'] },
}

/**
 * The attributes this inventory goes looking for, whether or not V1 wrote them.
 *
 * An inventory that only lists what it found cannot say what it did not find,
 * and "no V1 link or image field carries an `id`, a `srcset`, a `role`, an
 * `aria-*` or an event handler" is one of the more load-bearing findings here:
 * it means several features a schema-v2 ADR might reasonably propose would
 * unblock nothing at all. Every name the brief asked about is listed, so the
 * absence is reported rather than inferred from a gap in a table.
 */
export const PROBED_ATTRIBUTES: Record<FieldKind, readonly string[]> = {
  link: [
    'aria-describedby',
    'aria-hidden',
    'aria-label',
    'aria-labelledby',
    'class',
    'href',
    'id',
    'onclick',
    'referrerpolicy',
    'rel',
    'role',
    'style',
    'target',
    'title',
  ],
  // Only the ones an `<img>` can meaningfully carry: listing `target` as absent
  // from an image would be reporting a fact about HTML rather than about V1.
  image: [
    'alt',
    'aria-describedby',
    'aria-hidden',
    'aria-label',
    'aria-labelledby',
    'class',
    'crossorigin',
    'decoding',
    'fetchpriority',
    'height',
    'id',
    'loading',
    'onclick',
    'referrerpolicy',
    'role',
    'sizes',
    'src',
    'srcset',
    'style',
    'title',
    'width',
  ],
}

/** IDREF attributes: their value names another element's id rather than describing this one. */
const IDREF_ATTRIBUTES = new Set([
  'aria-labelledby',
  'aria-describedby',
  'aria-controls',
  'aria-owns',
  'aria-details',
  'aria-errormessage',
  'aria-flowto',
  'for',
  'headers',
  'list',
])

/** Attributes whose value is a URL, and so gets a URL shape rather than a text one. */
const URL_ATTRIBUTES = new Set(['href', 'src', 'poster', 'cite', 'action', 'formaction', 'data-cms-embed-src'])

/** Attributes whose value is prose, and so never reaches a report at all. */
const FREE_TEXT_ATTRIBUTES = new Set(['alt', 'title', 'aria-label', 'aria-placeholder', 'placeholder'])

/**
 * The closed value sets HTML itself defines.
 *
 * These are the only attribute *values* this module ever names, and they are
 * named because they are keywords from the HTML specification rather than
 * anything read out of V1 — `lazy` is `lazy` in every document on the web. A
 * value not in the set for its attribute is reported as `enum-other`, so an
 * unexpected one is visible without being quoted.
 */
const KEYWORD_VALUES: Record<string, Set<string>> = {
  loading: new Set(['lazy', 'eager']),
  decoding: new Set(['sync', 'async', 'auto']),
  fetchpriority: new Set(['high', 'low', 'auto']),
  crossorigin: new Set(['anonymous', 'use-credentials']),
  referrerpolicy: new Set([
    'no-referrer',
    'no-referrer-when-downgrade',
    'origin',
    'origin-when-cross-origin',
    'same-origin',
    'strict-origin',
    'strict-origin-when-cross-origin',
    'unsafe-url',
  ]),
  target: new Set(['_blank', '_self', '_parent', '_top']),
  dir: new Set(['ltr', 'rtl', 'auto']),
  'aria-hidden': new Set(['true', 'false']),
}

/** Space-separated keyword lists, where every token comes from a closed set. */
const KEYWORD_LISTS: Record<string, Set<string>> = {
  rel: new Set([
    'alternate',
    'author',
    'bookmark',
    'external',
    'help',
    'license',
    'me',
    'next',
    'nofollow',
    'noopener',
    'noreferrer',
    'prev',
    'search',
    'tag',
  ]),
}

// --------------------------------------------------------------- the shapes

/**
 * One attribute value, reduced to its shape.
 *
 * Never the value. The shape has to be specific enough that a reader can tell
 * `width="1600"` from `width="50%"` and `class="a b c"` from a class list with a
 * Tailwind token in it, and vague enough that no V1 identifier, URL or sentence
 * survives it.
 */
export function valueShape(name: string, value: string): string {
  if (value === '') return 'empty'
  if (name === 'class') {
    const tokens = value.split(/\s+/).filter(token => token !== '')
    // The grammar the schema already enforces on element nodes, asked here so
    // that "allow class on a link node" can be costed honestly: a definition
    // whose classes are Tailwind utilities is not unblocked by an allowlist
    // entry whose value rule it fails.
    const conforming = isStructuredAttributeValue('class', value)
    return `class-token-list(${tokens.length}${conforming ? '' : ',non-conforming'})`
  }
  if (name === 'data-block-id') return 'slot-id'
  if (name === 'data-editable') return 'field-type'
  if (name === 'style') {
    const declarations = value.split(';').filter(part => part.trim() !== '')
    return `declaration-list(${declarations.length})`
  }
  const keywords = KEYWORD_VALUES[name]
  if (keywords !== undefined) return keywords.has(value) ? `enum:${value}` : 'enum-other'
  const list = KEYWORD_LISTS[name]
  if (list !== undefined) {
    const tokens = value.split(/\s+/).filter(token => token !== '')
    const known = tokens.every(token => list.has(token))
    return `keyword-list(${tokens.length}${known ? '' : ',unknown'})`
  }
  if (IDREF_ATTRIBUTES.has(name)) {
    return `idref-list(${value.split(/\s+/).filter(token => token !== '').length})`
  }
  if (URL_ATTRIBUTES.has(name)) return urlShape(value)
  if (/^\d+$/.test(value)) return 'integer'
  if (/^\d+(?:\.\d+)?(?:px|%|em|rem|vw|vh)$/.test(value)) return 'length-with-unit'
  if (FREE_TEXT_ATTRIBUTES.has(name)) return 'free-text'
  if (name.startsWith('data-')) return 'opaque-token'
  return 'opaque-string'
}

/**
 * A URL, as one of the six shapes that decide what happens to it.
 *
 * `url-fragment-empty` is called out separately because it is a finding rather
 * than a shape: `href="#"` is a link that goes nowhere, and ADR 0007 counts 22
 * definitions carrying one.
 */
function urlShape(value: string): string {
  if (value === '#') return 'url-fragment-empty'
  if (value.startsWith('#')) return 'url-fragment'
  if (value.startsWith('//')) return 'url-protocol-relative'
  if (value.startsWith('/')) return 'url-relative-root'
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(value)
  if (scheme !== null) return `url-scheme:${scheme[1]!.toLowerCase()}`
  return 'url-relative-path'
}

/**
 * Could a governed allowlist accept this value as written?
 *
 * The question an unlock estimate depends on. Allowing `class` on a link node
 * buys nothing for a definition whose class list the value grammar rejects, and
 * an estimate that ignored that would promise definitions it could not deliver.
 * Only the shapes with a closed grammar are expressible; everything else — an
 * inline declaration list, a `data-*` hook, an unknown attribute — is not, and
 * deliberately: those are the ones a v2 model should refuse rather than widen
 * for.
 */
export function isExpressibleShape(name: string, shape: string): boolean {
  if (name === 'class') return shape.startsWith('class-token-list(') && !shape.includes('non-conforming')
  if (name === 'width' || name === 'height') return shape === 'integer'
  if (KEYWORD_VALUES[name] !== undefined) return shape.startsWith('enum:')
  if (KEYWORD_LISTS[name] !== undefined) return shape.startsWith('keyword-list(') && !shape.includes('unknown')
  if (name === 'id') return shape === 'opaque-string' || shape === 'opaque-token'
  return false
}

/** What is known about an attribute name, including the prefix families. */
export function factFor(name: string): AttributeFact {
  const known = ATTRIBUTE_FACTS[name]
  if (known !== undefined) return known
  // An inline event handler is executable content on an element node, which is
  // the one thing the tag and attribute allowlists exist to make impossible.
  // ADR 0007 counts zero in the catalogue; the classification is here so that a
  // future one cannot arrive unlabelled.
  if (/^on[a-z]+$/.test(name)) return { ownership: 'field-element', effects: ['security'], hazard: true }
  if (IDREF_ATTRIBUTES.has(name)) return { ownership: 'field-element', effects: ['accessibility'] }
  if (name.startsWith('aria-')) return { ownership: 'field-element', effects: ['accessibility'] }
  // A behaviour hook for V1's own scripts. Effects are left empty and filled in
  // from the stylesheet, because what a `data-*` attribute does is a fact about
  // code this importer does not read.
  if (name.startsWith('data-')) return { ownership: 'wrapper-capable', effects: [] }
  return { ownership: 'unknown', effects: [] }
}

export function anchorRoleOf(name: string, shape: string): AnchorRole {
  if (name === 'id') return 'anchor-target'
  if (IDREF_ATTRIBUTES.has(name)) return 'idref'
  if (shape === 'url-fragment' || shape === 'url-fragment-empty') return 'anchor-source'
  return 'none'
}
