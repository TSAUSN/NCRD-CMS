// The structured section model (ADR 0007).
//
// A definition is a versioned document of typed nodes. Every value an editor can
// change is a *field on a node*, never a position in a string — which is the one
// sentence that separates this from sections.ts. There, a value's meaning comes
// from where its `{{token}}` happened to sit in some markup, so the whole
// apparatus of context re-derivation in compile.ts exists to work out, on every
// render, what a stored string is about to become. Here a value cannot become
// anything: a `text` field is text because the node says `text`, and a tag name
// is never a value at all.
//
// The interpolation model is not replaced and not extended. It is frozen, and a
// row says which of the two kinds it is rather than letting anything infer it
// from shape. Inference is how a definition ends up read by the half of the
// system it was not written for, and the reading that guesses wrong is always
// the permissive one.
import { z } from 'zod'
import { StoryTagFilter } from './stories.ts'
import { TableauEmbed } from './provider-embed.ts'
import { SLOT_ID } from './sections.ts'

/**
 * Which model a stored section definition is written in.
 *
 * An explicit column rather than "it has a structured document, so it must be
 * structured": a row carrying both artifacts is a row two code paths disagree
 * about, and the disagreement is silent. The row says, and anything that cannot
 * read what it says renders nothing.
 */
export const SECTION_DEFINITION_KINDS = ['legacy', 'structured'] as const
export type SectionDefinitionKind = (typeof SECTION_DEFINITION_KINDS)[number]

export function isSectionDefinitionKind(value: unknown): value is SectionDefinitionKind {
  return typeof value === 'string' && (SECTION_DEFINITION_KINDS as readonly string[]).includes(value)
}

/**
 * The version of the node vocabulary below.
 *
 * Checked the way `SANITIZER_POLICY_VERSION` and `CSS_POLICY_VERSION` already
 * are, and for the same reason: the difference between one version of a document
 * schema and the next is what the nodes *mean*, so a document naming a version
 * this build does not implement is not "mostly readable". It is refused — at the
 * storage gate, and again in the renderer, so neither depends on the other
 * having remembered.
 *
 * Version 2 adds `staticAttributes` to the `link` and `image` field nodes and
 * changes nothing else (ADR 0008). It is a version rather than an optional key
 * because the *persisted* contract changed: a v2 document stored where a v1
 * reader can reach it would have that reader emit an anchor without the class
 * that styles it or an image without the box that reserves its space — markup
 * that parses, renders, and is wrong, which is the failure this whole model is
 * built to refuse.
 *
 * ADR 0009 adds a name to `STRUCTURED_ATTRIBUTES` and deliberately does *not*
 * move this number, which is the harder half of that decision and so is written
 * down here rather than only in the ADR. The test is not "did anything change",
 * it is "can a build read a document and put the wrong thing on the page". A new
 * key on a node passes that test the wrong way, because a reader that does not
 * know the key has to choose between ignoring it and refusing, and ignoring it
 * renders markup that parses and is wrong. A new *name* in a closed allowlist
 * does not: every reader checks the name against its own list, and one that has
 * never heard of it refuses the whole document — at the storage gate and again
 * in the renderer — so the section is visibly absent rather than quietly
 * misshapen. Both directions are safe: an older document is read identically by
 * a newer build, and a newer document renders nothing at all on an older one.
 *
 * The cost of moving it is what settles it. This number is checked against
 * `app.current_structured_schema_version()`, against every stored row's
 * `structured_schema_version`, and against the version inside every document.
 * TypeScript and SQL land in separate commits, so between them the two disagree
 * — and a bumped version makes that disagreement catalogue-wide: every
 * structured definition fails to save and every structured section on every page
 * renders nothing, including the ones nobody touched. Widening the allowlist
 * confines the disagreement to the documents that actually use the new name.
 * A version is for a change in what nodes *mean*; this is a change in what one
 * of them may *say*.
 */
export const STRUCTURED_SCHEMA_VERSION = 3

/**
 * The versions `upgradeStructuredDocument` can carry forward to the current one.
 *
 * One entry, and it will stay short: an upgrade is only writable while somebody
 * still remembers what the older vocabulary meant. A version not listed here is
 * refused rather than read optimistically — the same rule the renderer and the
 * database apply to a document that names a version they do not implement.
 */
export const STRUCTURED_UPGRADABLE_SCHEMA_VERSIONS = [1, 2] as const

/**
 * How deep a document may nest, counted in *node levels*.
 *
 * The convention, written out because "depth 16" has three plausible readings
 * and the wrong one is off by one in the direction that accepts too much:
 *
 * - The document envelope — the object carrying `schemaVersion`, `fields` and
 *   `nodes` — is not a level. It is not a node.
 * - Every entry of the document's `nodes` array is at level 1. There is no
 *   level 0, and the length of that array is a width rather than a depth.
 *   Fifty sibling nodes are all at level 1.
 * - A child is one level below its parent, so a `div` inside a `section` is at
 *   level 2.
 * - A *field node is a node*, and occupies a level exactly like an element
 *   does. This is the reading that is easy to get wrong: the field is the
 *   payload rather than the container, so it looks like it should be free, and
 *   it is not.
 *
 * So sixteen means: at most sixteen nodes on any path from a top-level node to
 * a leaf. To an author it is "the tags you nest, plus the field itself" — a
 * `section > h1 > text-field` is three, and fifteen nested elements around one
 * field is the deepest document this model will accept. To a stored document it
 * is `structuredDepth(doc.nodes) <= 16`, which is the same sentence and the one
 * every layer actually evaluates. The database says it the same way: migration
 * 0021's walk seeds `depth = 1` from `nodes` and refuses `max_depth > 16`.
 *
 * The number is a bound on work, not a design budget. Both walkers downstream
 * are recursive — the renderer's serializer and the database's
 * `app.structured_node_defect` — and a document is a stored value, so its depth
 * is an attacker's choice rather than an author's. Sixteen is more than any of
 * the 118 V1 definitions needs (the deepest nests 9) and far less than either
 * stack minds.
 */
export const STRUCTURED_MAX_DEPTH = 16

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
const MAX_ATTRIBUTE_LENGTH = 512
/**
 * Entries in one token-list attribute — a field node's `class` or `rel`.
 *
 * Far above the V1 catalogue, whose widest conforming class list is five tokens.
 * It is a bound on work rather than a design budget: the list is an array in a
 * stored document, so its length is whatever was last written into the row.
 */
const MAX_ATTRIBUTE_TOKENS = 32
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

// ------------------------------------------------------------------- nodes

/**
 * The four field types the V1 catalogue actually uses, minus the two that need
 * something that does not exist yet.
 *
 * ADR 0007 counts five: `icon` is 105 slots across 32 definitions, and it is not
 * here because an icon name selects from a compiled sprite and there is no
 * sprite. `repeat` is not here either. Shipping either as "a field that renders
 * nothing for now" would put a type in the vocabulary that the database accepts,
 * the editor offers, and the page omits.
 */
export const STRUCTURED_FIELD_TYPES = ['text', 'richtext', 'link', 'image', 'repeat'] as const
export type StructuredFieldType = (typeof STRUCTURED_FIELD_TYPES)[number]

/** One repeat can never expand a page manifest without a fixed upper bound. */
export const STRUCTURED_REPEAT_MAX_ENTRIES = 200

const RepeatAutomaticSelection = z.strictObject({
  mode: z.literal('automatic'),
  storyTags: StoryTagFilter.optional(),
  order: z.literal('newest').optional(),
  dateField: z
    .string()
    .regex(/^[a-z][a-z0-9_]{0,63}$/)
    .optional(),
  maxAgeMonths: z.number().int().min(1).max(120).optional(),
  excludeStableKey: z
    .string()
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
    .max(80)
    .optional(),
  filter: z
    .strictObject({ field: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/), value: z.string().trim().min(1).max(120) })
    .optional(),
  limit: z.number().int().min(1).max(STRUCTURED_REPEAT_MAX_ENTRIES),
})
const RepeatManualSelection = z
  .strictObject({
    mode: z.literal('manual'),
    stableKeys: z
      .array(
        z
          .string()
          .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
          .max(80),
      )
      .max(STRUCTURED_REPEAT_MAX_ENTRIES),
  })
  .check(ctx => {
    if (new Set(ctx.value.stableKeys).size !== ctx.value.stableKeys.length) {
      ctx.issues.push({ code: 'custom', input: ctx.value.stableKeys, message: 'manual repeat keys must be unique' })
    }
  })

export const StructuredRepeatBinding = z
  .strictObject({
    readerKey: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/),
    selection: z.discriminatedUnion('mode', [RepeatAutomaticSelection, RepeatManualSelection]),
  })
  .refine(
    value => !(value.selection.mode === 'automatic' && value.selection.storyTags && value.readerKey !== 'stories'),
    'Choose these tag groups on a Stories section.',
  )
  .refine(
    value =>
      !(
        value.readerKey === 'stories' &&
        value.selection.mode === 'automatic' &&
        ((value.selection.dateField !== undefined && value.selection.dateField !== 'published_date') ||
          (value.selection.maxAgeMonths !== undefined && value.selection.maxAgeMonths !== 13))
      ),
    'Stories use the story date and a 13-month feed limit.',
  )
export type StructuredRepeatBinding = z.infer<typeof StructuredRepeatBinding>

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

export type StructuredElementNode = {
  type: 'element'
  tag: StructuredTag
  attributes?: Record<string, string>
  children?: StructuredNode[]
}

export type StructuredTextFieldNode = { type: 'text' | 'richtext' | 'icon'; field: string }
export type StructuredLinkFieldNode = {
  type: 'link'
  field: string
  staticAttributes?: StructuredLinkStaticAttributes
}
export type StructuredImageFieldNode = {
  type: 'image'
  field: string
  staticAttributes?: StructuredImageStaticAttributes
}
export type StructuredRepeatFieldNode = {
  type: 'repeat'
  field: string
  item: StructuredNode[]
  empty: { behavior: 'hide' } | { behavior: 'message'; text: string }
}

export type StructuredFieldNode =
  | StructuredTextFieldNode
  | StructuredLinkFieldNode
  | StructuredImageFieldNode
  | StructuredRepeatFieldNode

export type StructuredNode = StructuredElementNode | StructuredFieldNode | TableauEmbed

const AttributeMap = z.record(z.string(), z.string()).check(ctx => {
  for (const [name, value] of Object.entries(ctx.value)) {
    if (!isStructuredAttribute(name)) {
      ctx.issues.push({ code: 'custom', input: name, message: `${name} is not an attribute an element node may carry` })
    } else if (!isStructuredAttributeValue(name, value)) {
      ctx.issues.push({ code: 'custom', input: value, message: `${JSON.stringify(value)} is not a usable ${name}` })
    }
  }
})

// `strictObject` everywhere below, deliberately. A key this build does not
// recognise is not a harmless extra: it is the part of the document that was
// written for a reader that is not this one, and continuing without it renders a
// section that is missing whatever that key was for. Refusing is how an unknown
// schema version gets noticed even when somebody forgot to bump it.
const StructuredElement = z
  .strictObject({
    type: z.literal('element'),
    tag: z.enum(STRUCTURED_TAGS),
    attributes: AttributeMap.optional(),
    children: z.array(z.lazy(() => StructuredNode)).optional(),
  })
  .check(ctx => {
    if (isStructuredVoidTag(ctx.value.tag) && (ctx.value.children?.length ?? 0) > 0) {
      ctx.issues.push({
        code: 'custom',
        input: ctx.value,
        message: `<${ctx.value.tag}> has no end tag, so it cannot have children`,
      })
    }
  })

const FieldName = z
  .string()
  .regex(SLOT_ID, 'a field name must be a letter followed by letters, digits, _ or -, up to 64 characters')

/**
 * A field whose value is characters, which is every field that is not its own
 * element.
 *
 * `strictObject` with no `staticAttributes`, so writing one on a `text` node is
 * refused rather than ignored. There is nothing for it to attach to — the
 * element around a text field is an element node the author already wrote — and
 * a key that is silently dropped is the half of a document somebody believes is
 * doing something.
 */
const StructuredTextField = z.strictObject({ type: z.literal('text'), field: FieldName })
const StructuredRichTextField = z.strictObject({ type: z.literal('richtext'), field: FieldName })

const StructuredLinkStaticAttributes = z
  .strictObject({
    class: z.array(z.string()).optional(),
    rel: z.array(z.string()).optional(),
    target: z.enum(STRUCTURED_LINK_TARGETS).optional(),
  })
  .check(ctx => {
    // Deferred to the shared predicate rather than expressed as Zod combinators,
    // for the reason `AttributeMap` above defers: the database enforces the
    // identical rules from SQL, and a grammar written twice in one language is
    // already two grammars. One function is what the renderer re-checks at the
    // point of emission, so "it was validated upstream" never becomes
    // load-bearing.
    for (const [name, value] of Object.entries(ctx.value)) {
      if (value === undefined) continue
      if (!isStructuredStaticAttributeValue('link', name, value)) {
        ctx.issues.push({
          code: 'custom',
          input: value,
          message: `${JSON.stringify(value)} is not a usable ${name} for a link field`,
        })
      }
    }
  })

const StructuredImageStaticAttributes = z
  .strictObject({
    class: z.array(z.string()).optional(),
    width: z.number().optional(),
    height: z.number().optional(),
    decoding: z.enum(STRUCTURED_IMAGE_DECODINGS).optional(),
    loading: z.enum(STRUCTURED_IMAGE_LOADINGS).optional(),
    fetchpriority: z.enum(STRUCTURED_IMAGE_FETCH_PRIORITIES).optional(),
  })
  .check(ctx => {
    for (const [name, value] of Object.entries(ctx.value)) {
      if (value === undefined) continue
      if (!isStructuredStaticAttributeValue('image', name, value)) {
        ctx.issues.push({
          code: 'custom',
          input: value,
          message: `${JSON.stringify(value)} is not a usable ${name} for an image field`,
        })
      }
    }
    if (!structuredImageDimensionsAgree(ctx.value)) {
      ctx.issues.push({
        code: 'custom',
        input: ctx.value,
        message:
          'an image field declares width and height together or neither, ' +
          'because one alone reserves the wrong box and still lets the page jump',
      })
    }
  })

const StructuredLinkField = z.strictObject({
  type: z.literal('link'),
  field: FieldName,
  staticAttributes: StructuredLinkStaticAttributes.optional(),
})

const StructuredImageField = z.strictObject({
  type: z.literal('image'),
  field: FieldName,
  staticAttributes: StructuredImageStaticAttributes.optional(),
})

const StructuredRepeatEmpty = z.discriminatedUnion('behavior', [
  z.strictObject({ behavior: z.literal('hide') }),
  z.strictObject({ behavior: z.literal('message'), text: z.string().min(1).max(200) }),
])

const StructuredRepeatField = z.strictObject({
  type: z.literal('repeat'),
  field: FieldName,
  item: z
    .array(z.lazy(() => StructuredNode))
    .min(1)
    .max(512),
  empty: StructuredRepeatEmpty,
})

export const StructuredNode: z.ZodType<StructuredNode> = z.lazy(() =>
  z.discriminatedUnion('type', [
    StructuredElement,
    StructuredTextField,
    StructuredRichTextField,
    StructuredLinkField,
    StructuredImageField,
    StructuredRepeatField,
    TableauEmbed,
    z.strictObject({ type: z.literal('icon'), field: z.string().regex(SLOT_ID) }),
  ]),
)

/**
 * What an editor is offered for one field, declared once at the top of the
 * document.
 *
 * The node already carries its own type, so this is not what the renderer reads.
 * It is what keeps the editor and the renderer describing the same thing: a
 * field declared `text` and used by a `richtext` node means the editor shows a
 * plain box for a value the renderer will sanitize as markup, or the reverse —
 * an author typing HTML into a field that escapes it, and nobody able to say
 * which of the two is wrong. The mismatch is refused instead.
 */
export const StructuredFieldDef = z.strictObject({
  name: z
    .string()
    .regex(SLOT_ID, 'a field name must be a letter followed by letters, digits, _ or -, up to 64 characters'),
  type: z.enum(STRUCTURED_FIELD_TYPES),
  label: z.string().min(1),
})
export type StructuredFieldDef = z.infer<typeof StructuredFieldDef>

export const StructuredDocument = z
  .strictObject({
    // The document repeats the version its row's column carries. Both are checked,
    // and against each other: the column is what the database vouched for and the
    // document is what the compiler wrote, and a row where those two disagree is
    // one where somebody rewrote half of it.
    schemaVersion: z.number().int(),
    fields: z.array(StructuredFieldDef),
    nodes: z.array(StructuredNode),
  })
  .check(ctx => {
    const seen = new Set<string>()
    for (const field of ctx.value.fields) {
      if (seen.has(field.name)) {
        ctx.issues.push({
          code: 'custom',
          input: field.name,
          message: `field ${field.name} is declared twice, so nothing can say what type it is`,
        })
      }
      seen.add(field.name)
    }
  })
export type StructuredDocument = z.infer<typeof StructuredDocument>

/**
 * Every field node in the document, in document order.
 *
 * Used to check the nodes against the declarations, which cannot be done inside
 * the node schema itself: a node has no way to see the document it is part of.
 */
export function structuredFieldNodes(nodes: readonly StructuredNode[]): StructuredFieldNode[] {
  // Iterative for the same reason structuredDepth is: this is asked about
  // documents that may be hostile, and a walker that overflows on a deep one
  // answers by crashing. The stack is reversed on push so the result stays in
  // document order, which the editor's field list depends on.
  const out: StructuredFieldNode[] = []
  const stack: StructuredNode[] = [...nodes].reverse()
  while (stack.length > 0) {
    const node = stack.pop()!
    if (node.type === 'provider-embed') continue
    if (node.type !== 'element') {
      out.push(node)
      continue
    }
    const children = node.children ?? []
    for (let i = children.length - 1; i >= 0; i -= 1) stack.push(children[i]!)
  }
  return out
}

/** Field nodes belonging to a repeat's collection item rather than its page instance. */
export function structuredRepeatItemFieldNodes(node: StructuredRepeatFieldNode): StructuredFieldNode[] {
  const out: StructuredFieldNode[] = []
  const stack: StructuredNode[] = [...node.item].reverse()
  while (stack.length > 0) {
    const current = stack.pop()!
    if (current.type === 'element') {
      const children = current.children ?? []
      for (let index = children.length - 1; index >= 0; index -= 1) stack.push(children[index]!)
      continue
    }
    if (current.type === 'provider-embed') continue
    out.push(current)
    if (current.type === 'repeat') {
      for (let index = current.item.length - 1; index >= 0; index -= 1) stack.push(current.item[index]!)
    }
  }
  return out
}

/**
 * How deeply this node list nests, in the node levels `STRUCTURED_MAX_DEPTH`
 * counts: every entry of `nodes` is at level 1, a child is one level below its
 * parent, and a field node occupies a level exactly like an element does. An
 * empty list is 0, which is the only answer that is not a level.
 *
 * Iterative, with an explicit stack. The recursive version read better and
 * overflowed the call stack somewhere between 100 and 1000 levels — and the
 * whole reason this function exists is to answer a question about documents
 * that might be hostile, so "it crashes on a deep one" means the check is not a
 * check. Run `structuredShapeProblems` first: this still assumes the shape is a
 * node tree, and only that preflight can promise it.
 */
export function structuredDepth(nodes: readonly StructuredNode[]): number {
  let deepest = 0
  const stack: { node: StructuredNode; depth: number }[] = nodes.map(node => ({ node, depth: 1 }))
  while (stack.length > 0) {
    const { node, depth } = stack.pop()!
    if (depth > deepest) deepest = depth
    if (node.type === 'element') {
      for (const child of node.children ?? []) stack.push({ node: child, depth: depth + 1 })
    } else if (node.type === 'repeat') {
      for (const child of node.item) stack.push({ node: child, depth: depth + 1 })
    }
  }
  return deepest
}

/**
 * Bounds every structured document is held to, in one place because two layers
 * enforce them and a limit that differs between them is a document one layer
 * stores and the other refuses to render.
 *
 * The numbers are deliberately far above anything the V1 catalogue contains —
 * its deepest definition nests 9 levels and its largest has 41 nodes — because
 * these are not a design budget. They are the point past which a document stops
 * being a section and starts being a way to spend the renderer's stack.
 */
export const STRUCTURED_LIMITS = {
  /** Node levels on the deepest path, in the sense `STRUCTURED_MAX_DEPTH` defines. */
  depth: STRUCTURED_MAX_DEPTH,
  /** Nodes in the whole document, at every level together. */
  nodes: 2_000,
  /** Entries in the document's `fields` array. */
  fields: 256,
  /** Entries in one element's `children` array. Siblings, not descendants. */
  childrenPerElement: 512,
  /** Keys in one node's `attributes` or `staticAttributes` object. */
  attributes: 64,
  /** One attribute's name and value added together, in characters. */
  attributeLength: MAX_ATTRIBUTE_LENGTH,
  /** Entries in one token-list attribute: a field node's `class` or `rel`. */
  attributeTokens: MAX_ATTRIBUTE_TOKENS,
  /** One field declaration's label, in characters. */
  labelLength: 256,
} as const

/**
 * The stable names for what `structuredShapeDefects` can find.
 *
 * A code as well as a sentence, because the sentences are written for an author
 * and a test that asserts one is asserting the wording. Every bound below was
 * reached by a document that returned "a problem" from a suite that could not
 * say *which* problem — so a fixture carrying an unrelated defect passed the
 * boundary test it was supposed to fail, and the boundary was never checked at
 * all. The code is what a test asserts; the message is what a person reads.
 */
export const STRUCTURED_SHAPE_CODES = [
  'not-a-document',
  'no-node-list',
  'too-many-fields',
  'field-label-too-long',
  'too-many-nodes',
  'too-deep',
  'too-many-children',
  'too-many-attributes',
  'attribute-too-long',
  'too-many-attribute-tokens',
  'node-container-conflict',
  'node-is-its-own-ancestor',
  'node-used-twice',
] as const
export type StructuredShapeCode = (typeof STRUCTURED_SHAPE_CODES)[number]

/** One thing wrong with a document: a name for a test, a sentence for a person. */
export type StructuredProblem<Code extends string = string> = {
  readonly code: Code
  readonly message: string
}

/** The sentences, for callers that only ever showed the sentences. */
export function structuredProblemMessages(problems: readonly StructuredProblem[]): string[] {
  return problems.map(problem => problem.message)
}

/**
 * How many characters a static attribute value would occupy on the page.
 *
 * The *rendered* length rather than the stored one, so the bound means the same
 * thing for a token list as it does for a string: a `class` of four tokens costs
 * the four tokens and the three spaces between them, which is exactly what
 * `class="…"` will contain. Measuring the JSON instead would count the quotes
 * and commas, and the number in the message would be about a serialization
 * nobody sees.
 */
function staticAttributeLength(value: unknown): number {
  if (typeof value === 'string') return value.length
  if (typeof value === 'number') return String(value).length
  if (!Array.isArray(value)) return 0
  let total = 0
  for (const token of value) total += (typeof token === 'string' ? token.length : 0) + 1
  return total === 0 ? 0 : total - 1
}

/**
 * Everything structurally wrong with an *unvalidated* document, found without
 * recursing once.
 *
 * This runs before Zod, and that order is the whole point. `StructuredDocument`
 * is a recursive schema: parsing a 1,000-deep node list overflows the call
 * stack inside Zod, so a limit expressed as a check performed *after* parsing
 * is a limit that never gets to run. The declared maximum depth of 16 did not
 * protect anything, because reaching the code that enforced it required
 * surviving the parse that the depth was supposed to make safe.
 *
 * It is also the only layer that can see a cycle. A document read from JSON or
 * from the database cannot contain one, but this module is exported and an
 * in-memory caller can hand it an object graph that points at itself — which is
 * an infinite descent for every recursive consumer downstream. A repeated
 * reference that is *not* a cycle is refused too, and named separately; see the
 * walk below for why the two are worth telling apart.
 *
 * Deliberately shape-tolerant: it walks whatever it is given and reports what is
 * too big or self-referential. Saying what is *wrong* with a node is Zod's job,
 * and this exists so that job can be done at all.
 */
export function structuredShapeDefects(document: unknown): StructuredProblem<StructuredShapeCode>[] {
  const defect = (code: StructuredShapeCode, message: string) => ({ code, message })
  if (document === null || typeof document !== 'object' || Array.isArray(document)) {
    return [defect('not-a-document', 'is not a structured document')]
  }
  const problems: StructuredProblem<StructuredShapeCode>[] = []
  const doc = document as { nodes?: unknown; fields?: unknown }

  if (Array.isArray(doc.fields) && doc.fields.length > STRUCTURED_LIMITS.fields) {
    problems.push(
      defect(
        'too-many-fields',
        `declares ${doc.fields.length} fields, more than the ${STRUCTURED_LIMITS.fields} a section may have`,
      ),
    )
  }
  for (const field of Array.isArray(doc.fields) ? doc.fields : []) {
    const label: unknown = (field as { label?: unknown })?.label
    if (typeof label === 'string' && label.length > STRUCTURED_LIMITS.labelLength) {
      problems.push(
        defect('field-label-too-long', `has a field label longer than ${STRUCTURED_LIMITS.labelLength} characters`),
      )
      break
    }
  }

  if (!Array.isArray(doc.nodes)) return [...problems, defect('no-node-list', 'has no node list')]

  // Answered before anything is walked, because the widest hostile document is
  // one flat array and walking it to count it is the whole attack. Every entry
  // of `nodes` is a node at level 1, so a list longer than the budget is over
  // the budget whatever the entries turn out to be, and this costs one read of
  // a length rather than a traversal of five million objects.
  if (doc.nodes.length > STRUCTURED_LIMITS.nodes) {
    return [...problems, defect('too-many-nodes', `has more than ${STRUCTURED_LIMITS.nodes} nodes`)]
  }

  // A depth-first walk with an explicit stack, carrying a `leave` frame under
  // each node's children so `onPath` is exactly the ancestors of the node being
  // entered. That is what separates the two ways one object can turn up twice:
  //
  //   - on the current path, which is a *cycle* — following the children again
  //     leads back here, and every recursive consumer downstream descends
  //     forever;
  //   - already finished, which is a repeated reference — the same child object
  //     used in two places, a directed acyclic graph rather than a loop, which
  //     terminates but is not a tree.
  //
  // Both are refused, because a document that arrived as JSON or out of a
  // database column can be neither, so either one means an in-memory caller
  // built something this model cannot store. They are refused with different
  // sentences because they are different mistakes, and telling somebody their
  // document contains a cycle when it contains a shared node sends them looking
  // for a loop that is not there.
  const seen = new Set<object>()
  const onPath = new Set<object>()
  type Frame =
    | { readonly leave: object }
    | { readonly leave?: undefined; readonly node: unknown; readonly depth: number }
  const stack: Frame[] = []
  for (let i = doc.nodes.length - 1; i >= 0; i -= 1) stack.push({ node: doc.nodes[i], depth: 1 })
  let count = 0

  while (stack.length > 0) {
    const frame = stack.pop()!
    if (frame.leave !== undefined) {
      onPath.delete(frame.leave)
      continue
    }
    const { node, depth } = frame
    if (node === null || typeof node !== 'object') continue

    if (onPath.has(node)) {
      return [
        ...problems,
        defect('node-is-its-own-ancestor', 'contains a node that is its own ancestor, so reading it never finishes'),
      ]
    }
    if (seen.has(node)) {
      return [
        ...problems,
        defect('node-used-twice', 'uses one node object in two places, which no stored document can do'),
      ]
    }
    seen.add(node)
    onPath.add(node)
    stack.push({ leave: node })

    count += 1
    if (count > STRUCTURED_LIMITS.nodes) {
      return [...problems, defect('too-many-nodes', `has more than ${STRUCTURED_LIMITS.nodes} nodes`)]
    }
    if (depth > STRUCTURED_LIMITS.depth) {
      return [...problems, defect('too-deep', `nests deeper than ${STRUCTURED_LIMITS.depth} levels`)]
    }

    const attributes = (node as { attributes?: unknown }).attributes
    if (attributes !== null && typeof attributes === 'object') {
      const entries = Object.entries(attributes as Record<string, unknown>)
      if (entries.length > STRUCTURED_LIMITS.attributes) {
        return [
          ...problems,
          defect('too-many-attributes', `has an element carrying more than ${STRUCTURED_LIMITS.attributes} attributes`),
        ]
      }
      for (const [name, value] of entries) {
        if (name.length + (typeof value === 'string' ? value.length : 0) > STRUCTURED_LIMITS.attributeLength) {
          return [
            ...problems,
            defect(
              'attribute-too-long',
              `has an attribute longer than ${STRUCTURED_LIMITS.attributeLength} characters`,
            ),
          ]
        }
      }
    }

    // The same three questions of a field node's `staticAttributes`, and asked
    // separately because the shape is different: its values are token lists and
    // numbers rather than strings, so the length above would have measured a
    // thousand-token class list as nothing at all. A separate key name rather
    // than a second shape under `attributes` is what makes that difference
    // visible to every reader — this one, the Zod schemas, and the SQL — instead
    // of being a thing each of them has to remember.
    const staticAttributes = (node as { staticAttributes?: unknown }).staticAttributes
    if (staticAttributes !== null && typeof staticAttributes === 'object') {
      const entries = Object.entries(staticAttributes as Record<string, unknown>)
      if (entries.length > STRUCTURED_LIMITS.attributes) {
        return [
          ...problems,
          defect('too-many-attributes', `has an element carrying more than ${STRUCTURED_LIMITS.attributes} attributes`),
        ]
      }
      for (const [name, value] of entries) {
        if (Array.isArray(value) && value.length > STRUCTURED_LIMITS.attributeTokens) {
          return [
            ...problems,
            defect(
              'too-many-attribute-tokens',
              `has an attribute of more than ${STRUCTURED_LIMITS.attributeTokens} tokens`,
            ),
          ]
        }
        if (name.length + staticAttributeLength(value) > STRUCTURED_LIMITS.attributeLength) {
          return [
            ...problems,
            defect(
              'attribute-too-long',
              `has an attribute longer than ${STRUCTURED_LIMITS.attributeLength} characters`,
            ),
          ]
        }
      }
    }

    const rawNode = node as { type?: unknown; children?: unknown; item?: unknown }
    const isRepeat = rawNode.type === 'repeat'
    if ((isRepeat && Object.hasOwn(rawNode, 'children')) || (!isRepeat && Object.hasOwn(rawNode, 'item'))) {
      return [
        ...problems,
        defect('node-container-conflict', 'has a node carrying the child container of a different node type'),
      ]
    }
    // Select by discriminator, never by whichever key happens to be first.
    // Otherwise a hostile repeat can carry a shallow `children` decoy and put
    // its real, deep item tree in `item`, overflowing recursive Zod before the
    // preflight reaches it.
    const children = isRepeat ? rawNode.item : rawNode.children
    if (!Array.isArray(children)) continue
    if (children.length > STRUCTURED_LIMITS.childrenPerElement) {
      return [
        ...problems,
        defect('too-many-children', `has an element with more than ${STRUCTURED_LIMITS.childrenPerElement} children`),
      ]
    }
    for (let i = children.length - 1; i >= 0; i -= 1) {
      stack.push({ node: children[i], depth: depth + 1 })
    }
  }

  return problems
}

/**
 * The same answer as `structuredShapeDefects`, as the sentences alone.
 *
 * Kept because every caller that predates the codes wants exactly this, and a
 * second walk with a second set of rules is how the two spellings of "is this
 * document valid" come to disagree.
 */
export function structuredShapeProblems(document: unknown): string[] {
  return structuredProblemMessages(structuredShapeDefects(document))
}

/**
 * A document written against an older schema version, at the current one — or
 * null when there is no such document.
 *
 * The whole upgrade is the version number. Schema v2 differs from v1 only by
 * what a `link` or `image` field node *may* carry, and a v1 node carries none of
 * it, so an upgraded v1 node has no `staticAttributes` key at all — not an empty
 * object, which would be a v2 node claiming a definition author had considered
 * the question and answered "nothing". That distinction is the point of the
 * function existing rather than being a `jsonb_set` in a migration and a
 * sentence in a changelog: an upgrade that *inferred* attributes would be
 * reading V1's intent out of a document that never expressed it, and would do it
 * for 118 definitions at once with nobody watching.
 *
 * It is total and it never throws. The preflight runs first, so a hostile
 * document is refused rather than parsed, and everything else is decided by the
 * same schema the renderer and the database use. Idempotent: a document already
 * at the current version comes back unchanged, so running the upgrade twice is
 * running it once.
 */
export function upgradeStructuredDocument(document: unknown): StructuredDocument | null {
  if (document === null || typeof document !== 'object' || Array.isArray(document)) return null
  if (structuredShapeDefects(document).length > 0) return null

  const version = (document as { schemaVersion?: unknown }).schemaVersion
  const upgradable = (STRUCTURED_UPGRADABLE_SCHEMA_VERSIONS as readonly unknown[]).includes(version)
  if (version !== STRUCTURED_SCHEMA_VERSION && !upgradable) return null

  const parsed = StructuredDocument.safeParse({ ...document, schemaVersion: STRUCTURED_SCHEMA_VERSION })
  if (!parsed.success) return null

  // The check that makes "a v1 node has no attributes" true rather than merely
  // intended. Re-stamping the version and re-parsing would happily accept a
  // hand-built v1 document whose field nodes already carried `staticAttributes`
  // — a key v1 refused — and call the result an upgrade. It is not: it is a v2
  // document that has never been through a v2 gate, arriving with the
  // provenance of one that was.
  if (version === 1) {
    for (const node of structuredFieldNodes(parsed.data.nodes)) {
      if ('staticAttributes' in node && node.staticAttributes !== undefined) return null
    }
  }
  return parsed.data
}
