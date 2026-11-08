/**
 * The tags an element node may carry.
 *
 * Closed, and closed around one property: nothing here fetches, executes,
 * submits, or changes how the document is parsed. `a` and `img` are deliberately
 * absent even though sections plainly need links and images — those come from
 * the `link` and `image` field nodes, whose URLs go through `safeUrl`. Leaving
 * them out of this list means there is no authored position anywhere in a
 * structured definition where a URL can be written down, so "did this URL pass
 * the policy?" has one answer for the whole model instead of one per element.
 */
export const STRUCTURED_TAGS = [
  'section',
  'div',
  'article',
  'aside',
  'header',
  'footer',
  'figure',
  'figcaption',
  'blockquote',
  'details',
  'summary',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'p',
  'span',
  'strong',
  'em',
  'small',
  'ul',
  'ol',
  'li',
  'dl',
  'dt',
  'dd',
  'br',
  'hr',
] as const
export type StructuredTag = (typeof STRUCTURED_TAGS)[number]

/**
 * Tags that have no end tag in HTML.
 *
 * Serializing `<br></br>` produces two line breaks in a browser rather than one,
 * so this is not cosmetic: emitting an end tag for a void element changes the
 * page. Children on one are refused rather than dropped, because a document that
 * asks for something impossible was not written by the editor this model is for.
 */
export const STRUCTURED_VOID_TAGS = ['br', 'hr'] as const

export function isStructuredTag(value: unknown): value is StructuredTag {
  return typeof value === 'string' && (STRUCTURED_TAGS as readonly string[]).includes(value)
}

export function isStructuredVoidTag(value: string): boolean {
  return (STRUCTURED_VOID_TAGS as readonly string[]).includes(value)
}

/**
 * The attribute names an element node may carry.
 *
 * Static: fixed by whoever authored the definition, never bound to a field. That
 * is what makes the list short enough to read. No `style` — declarations are the
 * definition's authored CSS, compiled once by the one CSS policy, rather than a
 * second string sink that would need its own. No event handler, no URL-bearing
 * attribute, nothing that decides how the surrounding markup is parsed.
 *
 * `id` earns its place: ADR 0007 counts 19 V1 definitions carrying element ids
 * and 41 in-page anchor edges that depend on them, so an id is a thing the model
 * has to be able to say rather than something to be reconstructed later.
 *
 * `aria-current` earns its place by the one test ADR 0009 admits an element
 * attribute on: a stylesheet in the V1 catalogue matches it. It is the only name
 * in the whole `unsupported-attribute` census that is carried by an element this
 * model keeps *and* selected on by a rule — `INTERACTION_PRESET_CSS` has one
 * `[aria-current="page"]` — so it is the only one whose absence would change
 * what a converted definition looks like. Every other refused name is either on
 * an element the tag allowlist already refuses, or inert: nothing styles it and
 * nothing in v2 reads it. Presence in V1's markup is not the standard, because
 * V1's markup carries V1's plumbing.
 */
export const STRUCTURED_ATTRIBUTES = [
  'class',
  'id',
  'role',
  'lang',
  'dir',
  'aria-label',
  'aria-labelledby',
  'aria-describedby',
  'aria-hidden',
  'aria-current',
] as const
export type StructuredAttribute = (typeof STRUCTURED_ATTRIBUTES)[number]

export function isStructuredAttribute(value: unknown): value is StructuredAttribute {
  return typeof value === 'string' && (STRUCTURED_ATTRIBUTES as readonly string[]).includes(value)
}

/**
 * A class name or an element id: a letter, then letters, digits, `_` or `-`.
 *
 * The same shape as `SLOT_ID`, written once here so a class name and a field
 * name cannot drift apart into two grammars nobody can keep in their head. Both
 * are identifiers that end up inside a CSS selector or an anchor fragment, and
 * both were "any string" once.
 */
export const STRUCTURED_TOKEN = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/

/** `ltr`, `rtl`, `auto`, and nothing else — `dir` is a three-valued control. */
const DIRECTIONS = new Set(['ltr', 'rtl', 'auto'])
/** A language tag: `en`, `en-US`, `zh-Hant-TW`. */
const LANGUAGE_TAG = /^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/
/** An ARIA role name: lowercase words joined by dashes, e.g. `doc-subtitle`. */
const ROLE_NAME = /^[a-z]+(?:-[a-z]+)*$/
/** The two values `aria-hidden` has; anything else is not a boolean to ARIA. */
const ARIA_BOOLEANS = new Set(['true', 'false'])
/**
 * The seven states `aria-current` has, exported because two layers spell them.
 *
 * The attribute's whole specified set rather than the one keyword V1 wrote,
 * following the choice ADR 0008 already made for `decoding`, `loading` and
 * `fetchpriority`: the V1 inventory found only `async`, only `high` and only
 * `page`, and each of those attributes took its full set anyway. The set is
 * closed by the specification, so narrowing it to what one catalogue happened to
 * use would be inventing a second, undocumented restriction that the next
 * definition author would hit and nobody could explain.
 *
 * `true` and `false` are in it and are not booleans in the `aria-hidden` sense:
 * `aria-current="true"` means "this one, unspecified which kind of current", and
 * `false` is the default said out loud. Both are inert.
 */
export const STRUCTURED_ARIA_CURRENT_STATES = ['page', 'step', 'location', 'date', 'time', 'true', 'false'] as const
const ARIA_CURRENT = new Set<string>(STRUCTURED_ARIA_CURRENT_STATES)
/** Free-text attribute values are capped rather than unbounded. */
export const MAX_ATTRIBUTE_LENGTH = 512
/**
 * Entries in one token-list attribute — a field node's `class` or `rel`.
 *
 * Far above the V1 catalogue, whose widest conforming class list is five tokens.
 * It is a bound on work rather than a design budget: the list is an array in a
 * stored document, so its length is whatever was last written into the row.
 */
export const MAX_ATTRIBUTE_TOKENS = 32
/**
 * Control characters, which a browser strips rather than displays.
 *
 * The same range `safeUrl` removes, and here for the same reason: a value whose
 * stored bytes and rendered meaning differ is one nobody can review by reading
 * it, and reading is the only check a static attribute ever gets.
 */
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/

/**
 * Is this a value the named attribute can actually hold?
 *
 * Escaping alone would make every one of these *safe* — the renderer escapes on
 * the way out regardless — so this is not the safety boundary. It is the
 * agreement boundary: a `class` of `a"onclick=x` escapes to something inert and
 * also to something that is not a class name, and a definition that stores it is
 * a definition whose author and whose renderer believe different things about
 * what will appear on the page. The database enforces the identical rules, so a
 * document either round-trips or is refused, and never half of each.
 */
export function isStructuredAttributeValue(name: string, value: unknown): boolean {
  if (typeof value !== 'string') return false
  if (value.length > MAX_ATTRIBUTE_LENGTH) return false
  // `<` is checked bluntly and separately from escaping, exactly as the CSS
  // policy checks it: one character, one grep, verifiable at a glance.
  if (value.includes('<') || CONTROL_CHARACTERS.test(value)) return false

  switch (name) {
    case 'class':
      return value.split(' ').every(token => STRUCTURED_TOKEN.test(token))
    case 'id':
      return STRUCTURED_TOKEN.test(value)
    case 'aria-labelledby':
    case 'aria-describedby':
      return value.split(' ').every(token => STRUCTURED_TOKEN.test(token))
    case 'aria-hidden':
      return ARIA_BOOLEANS.has(value)
    case 'aria-current':
      return ARIA_CURRENT.has(value)
    case 'dir':
      return DIRECTIONS.has(value)
    case 'lang':
      return LANGUAGE_TAG.test(value)
    case 'role':
      return ROLE_NAME.test(value)
    case 'aria-label':
      return value.length > 0
    default:
      // An attribute nobody listed. Reached only if the allowlist and this
      // function disagree, which is a bug rather than an input, and the right
      // behaviour for a bug here is to refuse.
      return false
  }
}

/**
 * The two field types whose node *is* an element rather than sitting inside one.
 *
 * A `text` or `richtext` field puts characters where it stands, so whatever
 * element an author wants around it is an ordinary element node they can write.
 * A `link` or an `image` has no such element: the field node renders the `<a>`
 * or the `<img>` itself, and until schema v2 there was nowhere to say anything
 * about it. These two are the only ones that can carry static attributes,
 * because they are the only two that have an element to carry them.
 */
export const STRUCTURED_MARKUP_FIELD_TYPES = ['link', 'image'] as const
export type StructuredMarkupFieldType = (typeof STRUCTURED_MARKUP_FIELD_TYPES)[number]

// ------------------------------------------- definition-owned static attributes

/**
 * The static attributes a link field node may carry, in the order they are
 * emitted.
 *
 * "Static" in exactly the sense `STRUCTURED_ATTRIBUTES` means it: chosen by
 * whoever authored the definition, fixed in the stored document, never bound to
 * a field. `href` is absent and always will be — the URL is the author's value
 * and goes through `safeUrl`, and a definition that could also write one would
 * make "did this URL pass the policy?" a question with two answers.
 *
 * The order is the emission order, so two documents asking for the same thing
 * produce the same bytes.
 */
export const STRUCTURED_LINK_STATIC_ATTRIBUTES = ['class', 'rel', 'target'] as const

/**
 * The static attributes an image field node may carry, in the order they are
 * emitted.
 *
 * `src` and `alt` are absent for the same reason `href` is: they are the
 * author's value, and the field node is where the author's value goes.
 */
export const STRUCTURED_IMAGE_STATIC_ATTRIBUTES = [
  'class',
  'width',
  'height',
  'decoding',
  'loading',
  'fetchpriority',
] as const

/**
 * The link relationships a definition may ask for, in the order they are
 * emitted.
 *
 * Alphabetical, which is not a style choice: the renderer contributes a token of
 * its own — `structuredLinkRel` adds `noopener` — so the emitted `rel` is a
 * *set* assembled from two sources, and a set has to be put in some order before
 * it can be bytes. An order anybody can re-derive from the list is the one that
 * never has to be looked up.
 *
 * Every keyword here is inert: it describes a relationship, and no user agent
 * fetches anything because of it. That is why `prefetch`, `preload`,
 * `preconnect`, `dns-prefetch`, `prerender`, `modulepreload`, `stylesheet`,
 * `icon` and `manifest` are absent — each of them turns an anchor into a
 * request, which is the one thing a link in a section is not allowed to do
 * before somebody clicks it.
 *
 * `opener` is absent too, and it is the interesting omission. Its only effect is
 * to undo `noopener`, which is the guarantee the renderer makes for every
 * `target="_blank"` link. A closed keyword set that contained the keyword
 * for "please reintroduce the vulnerability" would need a conflict rule and a
 * test for the conflict rule; leaving it out means the conflict cannot be
 * written down.
 */
export const STRUCTURED_LINK_RELS = [
  'alternate',
  'author',
  'bookmark',
  'external',
  'help',
  'license',
  'next',
  'nofollow',
  'noopener',
  'noreferrer',
  'prev',
  'search',
  'tag',
] as const
export type StructuredLinkRel = (typeof STRUCTURED_LINK_RELS)[number]

/**
 * The browsing contexts a link may name.
 *
 * `_parent` and `_top` are refused because they name a context the section does
 * not own. In the editor every section is rendered inside the canvas iframe, so
 * a `_top` link navigates the admin shell out from under the person editing it
 * — the same markup behaving differently in preview and in public, which is the
 * one difference this renderer exists to not have. A *named* target is refused
 * for the reason `id` is refused on a field node: a name is an entry in a
 * namespace shared by the whole page, so two sections that happen to pick the
 * same one silently start steering each other's links.
 *
 * `_self` is the default stated out loud, and it is inert here in a way it is
 * not in general HTML: `<base>` is not a tag any structured document can carry,
 * so there is no document-wide default for it to override.
 */
export const STRUCTURED_LINK_TARGETS = ['_self', '_blank'] as const
export type StructuredLinkTarget = (typeof STRUCTURED_LINK_TARGETS)[number]

/** The three values `decoding` has; anything else is not a hint to a browser. */
export const STRUCTURED_IMAGE_DECODINGS = ['sync', 'async', 'auto'] as const
/** `loading` is two-valued: there is no `auto`, whatever the default behaves like. */
export const STRUCTURED_IMAGE_LOADINGS = ['lazy', 'eager'] as const
/** The three values `fetchpriority` has. */
export const STRUCTURED_IMAGE_FETCH_PRIORITIES = ['high', 'low', 'auto'] as const

/**
 * The smallest and largest intrinsic dimension an image field node may declare.
 *
 * **Zero is refused, and it is conforming HTML.** `width` and `height` on an
 * `<img>` are parsed by the rules for parsing non-negative integers, and zero is
 * a non-negative integer, so `width="0"` is valid markup and a browser accepts
 * it. This bound is a product-contract narrowing rather than a spec
 * requirement, and it is worth the paragraph because somebody will one day read
 * the spec, find zero permitted, and assume the check is a bug.
 *
 * Two reasons it is not. The attribute is supported at all because the V1
 * inventory found `width` and `height` on 85 of 86 image field elements, doing
 * the one job those attributes do: reserving the box before the bytes arrive so
 * the page does not jump. A zero dimension reserves nothing, so a definition
 * that declares one has asked for the attribute and refused its only effect.
 * And a `0`×`0` image is a request that fetches and shows nothing, which is the
 * shape of a tracking pixel rather than of a picture — a definition author can
 * still write one with CSS, but not by accident and not invisibly to whoever
 * reads the document.
 *
 * The upper bound is 8192: more than twice the long edge of a 4K frame, so
 * every raster the catalogue could plausibly ship fits, and small enough that
 * the reserved box is a page rather than a denial of layout.
 */
export const STRUCTURED_DIMENSION_MIN = 1
export const STRUCTURED_DIMENSION_MAX = 8192

/**
 * Is this a static attribute the named field type may carry at all?
 *
 * `fieldType` is a plain string rather than the union, because it is asked about
 * a node type read out of a stored document: the whole question is whether that
 * string is one of the two, and a signature that assumed it was would push the
 * check somewhere else.
 */
export function isStructuredStaticAttribute(fieldType: string, name: string): boolean {
  if (!(STRUCTURED_MARKUP_FIELD_TYPES as readonly string[]).includes(fieldType)) return false
  return fieldType === 'link'
    ? (STRUCTURED_LINK_STATIC_ATTRIBUTES as readonly string[]).includes(name)
    : (STRUCTURED_IMAGE_STATIC_ATTRIBUTES as readonly string[]).includes(name)
}

/**
 * A list of tokens, never a string that something splits later.
 *
 * The element-node `class` is a single string, checked here by splitting on one
 * space and checked in SQL by a repeated-token pattern — two spellings of one
 * grammar that only agree because somebody went and found the cases where they
 * would not (`a  b`, `a `, the empty string). A list has no such gap: there is
 * nothing to split, the separator is the renderer's and never the author's, and
 * a token that is not a token is one array entry rather than a substring nobody
 * knew was there.
 */
function isTokenList(value: unknown, isToken: (token: string) => boolean, unique: boolean): boolean {
  if (!Array.isArray(value)) return false
  // Empty is refused rather than treated as absent, because `class=""` and no
  // `class` at all are different bytes and a document should say which it means.
  if (value.length === 0 || value.length > MAX_ATTRIBUTE_TOKENS) return false
  const seen = new Set<string>()
  for (const token of value) {
    if (typeof token !== 'string' || !isToken(token)) return false
    if (unique && seen.has(token)) return false
    seen.add(token)
  }
  return true
}

/**
 * An intrinsic dimension: an integer inside the bound above.
 *
 * A JSON number rather than a string of digits, so `"0080"`, `" 12"`, `"12px"`
 * and `"1e3"` are not values this model can even hold. `Number.isSafeInteger`
 * rather than `Number.isInteger` because a JSON document can name an integer
 * larger than a double can distinguish, and two documents that store different
 * numbers and parse to the same one are two documents the database and the
 * renderer would describe differently.
 */
function isDimension(value: unknown): boolean {
  return (
    typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    value >= STRUCTURED_DIMENSION_MIN &&
    value <= STRUCTURED_DIMENSION_MAX
  )
}

/**
 * Is this a value the named static attribute can actually hold?
 *
 * The sibling of `isStructuredAttributeValue`, and the same boundary: the
 * renderer escapes on the way out regardless, so this is not what makes a value
 * safe. It is what makes the definition's author, the database and the renderer
 * agree about what will appear on the page.
 *
 * `class` refuses a repeated token and `rel` permits one, which is not an
 * oversight. A class list is emitted verbatim and in the order it was written,
 * so that the markup can be read against the V1 markup it was converted from —
 * a document that says one class twice is one somebody edited badly, and the
 * model can say so. A `rel` is not emitted verbatim: the renderer adds
 * `noopener` to it, so the emitted value is a set assembled from two sources and
 * *something* has to collapse duplicates. Doing that in one place — the
 * normaliser the renderer calls — is how the two sources cannot disagree.
 */
export function isStructuredStaticAttributeValue(fieldType: string, name: string, value: unknown): boolean {
  if (!isStructuredStaticAttribute(fieldType, name)) return false
  switch (name) {
    case 'class':
      return isTokenList(value, token => STRUCTURED_TOKEN.test(token), true)
    case 'rel':
      return isTokenList(value, token => (STRUCTURED_LINK_RELS as readonly string[]).includes(token), false)
    case 'target':
      return typeof value === 'string' && (STRUCTURED_LINK_TARGETS as readonly string[]).includes(value)
    case 'width':
    case 'height':
      return isDimension(value)
    case 'decoding':
      return typeof value === 'string' && (STRUCTURED_IMAGE_DECODINGS as readonly string[]).includes(value)
    case 'loading':
      return typeof value === 'string' && (STRUCTURED_IMAGE_LOADINGS as readonly string[]).includes(value)
    case 'fetchpriority':
      return typeof value === 'string' && (STRUCTURED_IMAGE_FETCH_PRIORITIES as readonly string[]).includes(value)
    default:
      // Reached only if the allowlist above and this function disagree, which is
      // a bug rather than an input, and the right behaviour for a bug is refuse.
      return false
  }
}

/**
 * `width` and `height` arrive together, or neither does.
 *
 * One alone is the case that looks harmless and is not. The pair is what gives
 * a browser an intrinsic aspect ratio to reserve space with; a lone `width`
 * leaves the other axis unknown, so the box is still wrong and the page still
 * jumps — the attribute has been paid for and none of its effect collected. It
 * also changes the rendered shape of the picture the moment a stylesheet sets
 * the other axis, which is a layout bug nobody traces back to a missing
 * attribute. The V1 inventory agrees the pair is how they occur: 85 image field
 * elements carry `width` and the same 85 carry `height`.
 */
export function structuredImageDimensionsAgree(
  attributes: { width?: unknown; height?: unknown } | null | undefined,
): boolean {
  if (attributes === null || attributes === undefined) return true
  return (attributes.width === undefined) === (attributes.height === undefined)
}

export type StructuredLinkStaticAttributes = {
  class?: string[]
  rel?: string[]
  target?: StructuredLinkTarget
}

export type StructuredImageStaticAttributes = {
  class?: string[]
  width?: number
  height?: number
  decoding?: (typeof STRUCTURED_IMAGE_DECODINGS)[number]
  loading?: (typeof STRUCTURED_IMAGE_LOADINGS)[number]
  fetchpriority?: (typeof STRUCTURED_IMAGE_FETCH_PRIORITIES)[number]
}
