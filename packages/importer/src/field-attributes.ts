// What a *schema v1* link or image field node would lose, attribute by
// attribute.
//
// `field-attributes-lost` was the single largest obstacle in the catalogue — 77
// of 118 definitions — and it was also the least informative reason code this
// package produced, because "it carries attributes a field node cannot hold" was
// true of an anchor with one class and of an image with six loading hints, and
// those are not the same problem. Widening the model on the strength of that
// number alone would have been widening it blind.
//
// So this module reads the same catalogue the converter reads and answers a
// narrower question: for every attribute that sits on a `<a data-editable>` or
// `<img data-editable>`, what is it, what shape is its value, what does it
// affect, could a wrapper element carry it instead, and how many definitions
// would stop being blocked if the model could say it.
//
// Schema v2 answered it — ADR 0008 took the allowlist ranking below and made
// most of it real, and the converter now carries those attributes rather than
// refusing over them. This module is deliberately **not** updated to match. It
// is the evidence the decision was argued from, and an inventory rewritten to
// describe the model it produced is no longer evidence of anything. So "loss"
// here still means "a v1 field node could not hold it", and the gap between that
// and what the run now codes is reported as `lostButNotCoded` rather than
// papered over.
//
// Two rules govern what may be written down. The first is the one `report.ts`
// already states: no V1 markup, no V1 CSS, no V1 copy. A class name is a V1 CSS
// identifier and an `alt` is V1 copy, so neither appears here — a value is
// reduced to a *shape* (`class-token-list(3)`, `integer`, `enum:lazy`) before it
// reaches a report, and the enum values are HTML keywords from the table below
// rather than anything read from the catalogue. The second is byte-stability:
// every list is sorted, no `Map` iteration order reaches an output, nothing
// reads a clock, and the run ID comes from the source manifest exactly as the
// classification run's does.

import { isStructuredAttributeValue } from '@cms/schema'
import { attribute, elements, parseHtml, type HtmlElement } from './html.ts'
import { classesInStylesheet } from './presets.ts'
import { CONSUMED_BY_FIELD, repeatUnits } from './convert.ts'
import { readV1Catalogue, type SourceManifest, type V1Definition } from './source.ts'
import { runImport, type RunOptions } from './run.ts'

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
const FIELD_ELEMENT: Record<FieldKind, string> = { link: 'a', image: 'img' }

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

// ------------------------------------------------------------- the readings

/** One attribute on one field element of one definition, fully classified. */
export type AttributeSighting = {
  definitionId: string
  fieldKind: FieldKind
  name: string
  shape: string
  binding: AttributeBinding
  ownership: AttributeOwnership
  effects: AttributeEffect[]
  anchorRole: AnchorRole
  /** The field node already carries this one, so it is not a loss. */
  consumedByField: boolean
  /** A selector in this definition's CSS, or in the shared preset sheet, depends on it. */
  inSelector: boolean
  expressible: boolean
}

/** One row of the inventory: an attribute, on a field kind, with one value shape. */
export type FieldAttributeRow = {
  fieldKind: FieldKind
  name: string
  shape: string
  occurrences: number
  definitions: number
  definitionIds: string[]
  bindings: AttributeBinding[]
  ownership: AttributeOwnership
  effects: AttributeEffect[]
  anchorRole: AnchorRole
  consumedByField: boolean
  /** How many of the occurrences a stylesheet selector depends on. */
  inSelector: number
  /** True when no selector depends on it, so a wrapper could carry it unchanged. */
  wrapperSafe: boolean
  expressible: boolean
  verdict: AttributeVerdict
}

/**
 * Which of the two attribute reason codes applies to a definition, and why.
 *
 * The two are counted separately everywhere below because they are about
 * disjoint populations of elements — see `CODE_BOUNDARY` — and the 14
 * definitions carrying both are 14 definitions with two different problems
 * rather than one problem counted twice.
 */
export type DefinitionAttribution = {
  id: string
  status: string
  /** Every reason code the classification run gave it, in that run's order. */
  reasonCodes: string[]
  fieldAttributesLost: boolean
  unsupportedAttribute: boolean
  /** Attribute names lost on link field elements, sorted; never their values. */
  lostOnLink: string[]
  lostOnImage: string[]
  /**
   * Losses in the v1 sense are present, and the classification run did not code
   * them.
   *
   * Two different causes since schema v2 landed, and the count is the sum of
   * both. The first is a definition refused at an earlier gate — a nested
   * editable region, a slot that disagrees with its region — which never has its
   * field element's attributes examined at all. The second is now the common
   * one: this module measures what a *v1* field node would lose, because that is
   * the evidence ADR 0008 was argued from and rewriting it would delete the
   * argument, and a v2 field node carries most of those attributes. Counting
   * either as `field-attributes-lost` would overstate the code; ignoring them
   * would understate what the model had to grow to absorb. Both numbers are
   * reported.
   */
  lostButNotCoded: boolean
  /** True when a governed allowlist could express every one of its losses. */
  clearableByAllowlist: boolean
  /** Codes that would remain if every loss were expressible, sorted. */
  remainingCodes: string[]
}

/**
 * One step of the evidence-ranked allowlist: what a bundle of attributes buys.
 *
 * A step adds a *set*, not a name, and that is the whole correction over the
 * obvious version of this analysis. Attributes arrive together — every `<img>`
 * that carries `width` also carries `height`, `decoding` and usually
 * `fetchpriority` — so ranking one name at a time reports that `height` clears
 * nothing and `width` clears eight, when the truth is that the four of them
 * together clear eight and no proper subset clears any. A reader following the
 * one-name-at-a-time table would implement `width` and `loading` and unblock
 * nothing at all.
 */
export type AllowlistStep = {
  rank: number
  fieldKind: FieldKind | 'both'
  /** The names this step adds, sorted. Never one name unless one is enough. */
  added: string[]
  /** The whole allowlist after this step, sorted. */
  allowlist: string[]
  /** Definitions this step clears of every loss, over the step before it. */
  newlyCleared: number
  /** Definitions cleared of every loss by this step and every step above it. */
  cumulativeCleared: number
  /** Of those, the ones with no other reason code at all — the real unlock. */
  cumulativeUnlocked: number
  /** The least acceptable verdict among the names added, so a step that would
   * require accepting an inline style says so rather than looking free. */
  verdict: AttributeVerdict
}

export type FieldAttributeInventory = {
  importerVersion: number
  inventoryVersion: number
  /** The classification run's own ID, because both read the same manifest. */
  runId: string
  manifest: SourceManifest
  counts: {
    definitions: number
    definitionsWithLinkField: number
    definitionsWithImageField: number
    linkFieldElements: number
    imageFieldElements: number
    /** Definitions with at least one attribute a field node could not hold. */
    definitionsWithLoss: number
    /** Definitions the classification run actually gave `field-attributes-lost`. */
    fieldAttributesLostCode: number
    unsupportedAttributeCode: number
    bothCodes: number
    eitherCode: number
    /** Losses present that the run never reached, because an earlier gate refused first. */
    lostButNotCoded: number
  }
  attributes: FieldAttributeRow[]
  definitions: DefinitionAttribution[]
  allowlist: {
    link: AllowlistStep[]
    image: AllowlistStep[]
    combined: AllowlistStep[]
    /** Definitions no allowlist clears, because a loss has no closed grammar. */
    unclearable: string[]
  }
  /**
   * Names from `PROBED_ATTRIBUTES` that no field element of that kind carries.
   *
   * Reported because a zero is a design answer: an `id` on a link node would
   * unblock nothing, so it does not belong in the first allowlist however
   * reasonable it sounds in the abstract.
   */
  absent: { link: string[]; image: string[] }
  /**
   * For definitions a full allowlist would clear: the single code left, counted.
   *
   * The planning number. A definition blocked by exactly one remaining thing is
   * one piece of work away from importing; a definition blocked by four is not,
   * and adding attributes to the model does nothing for it this quarter.
   */
  remainingBlockers: { code: string; definitions: number }[]
}

/**
 * The boundary between the two attribute reason codes, in one sentence each.
 *
 * Kept here as data rather than as prose in the summary, so that the JSON report
 * carries the distinction too and nothing downstream has to re-derive it from
 * the counts.
 */
export const CODE_BOUNDARY: { code: string; population: string; sentence: string }[] = [
  {
    code: 'field-attributes-lost',
    population: 'a `<a data-editable="link">` or `<img data-editable="image">` element',
    sentence:
      'The element becomes a field node, whose attributes are the governed ' +
      'static set schema v2 gave it and nothing else, so an attribute outside ' +
      'that set — or a value its closed grammar refuses — has nowhere to go. ' +
      'Widening the element-node attribute allowlist does not help: there is ' +
      'no element node here.',
  },
  {
    code: 'unsupported-attribute',
    population: 'an element node — every element that is not a link or image field',
    sentence:
      'The element keeps its tag and becomes an element node, which does have ' +
      'attributes, and this one is not on the allowlist or its value is not ' +
      'one the allowlist’s grammar accepts. Widening that allowlist is exactly ' +
      'what would help.',
  },
]

// -------------------------------------------------------------- the reading

export function inventoryFieldAttributes(options: RunOptions): FieldAttributeInventory {
  const catalogue = readV1Catalogue(options, classesInStylesheet)
  // The classification run is the only authority on which reason codes a
  // definition actually has. Recomputing them here would be a second opinion
  // that could disagree with the report this inventory exists to explain.
  const run = runImport(options)
  const codesById = new Map(run.records.map(record => [record.provenance.id, record.reasons.map(r => r.code)]))
  const statusById = new Map(run.records.map(record => [record.provenance.id, String(record.status)]))

  const sightings: AttributeSighting[] = []
  const lossesById = new Map<string, AttributeSighting[]>()
  let linkFieldElements = 0
  let imageFieldElements = 0
  const withLink = new Set<string>()
  const withImage = new Set<string>()

  for (const definition of catalogue.definitions) {
    const parsed = parseHtml(definition.html)
    // A definition whose markup this reader cannot get through contributes no
    // sightings and is not counted as loss-free: the classification run already
    // reports it as `html-parse-failed`, and inventing an attribute list for it
    // would be inventing markup.
    if (!parsed.ok) continue
    const selectors = selectorFacts(definition.css, catalogue.presetClasses)
    const families = new Set(repeatUnits(definition.slots))

    const perDefinition: Instance[] = []
    for (const element of elements(parsed.nodes)) {
      const kind = fieldKindOf(element)
      if (kind === null) continue
      // The converter refuses a `link` written on anything but `<a>` before it
      // ever looks at attributes, so an inventory that counted those would be
      // describing an element the model would never reach.
      if (element.tag !== FIELD_ELEMENT[kind]) continue
      if (kind === 'link') {
        linkFieldElements += 1
        withLink.add(definition.id)
      } else {
        imageFieldElements += 1
        withImage.add(definition.id)
      }

      const place = repeatPlace(element, families)
      for (const attr of element.attributes) {
        perDefinition.push({
          sighting: classify(definition, kind, attr.name, attr.value, selectors),
          place,
          value: attr.value,
        })
      }
    }

    for (const sighting of bindRepeats(perDefinition)) {
      sightings.push(sighting)
      if (sighting.consumedByField) continue
      const list = lossesById.get(definition.id) ?? []
      list.push(sighting)
      lossesById.set(definition.id, list)
    }
  }

  const attributes = tabulate(sightings)
  const definitions = attributions(catalogue.definitions, codesById, statusById, lossesById)
  const allowlist = rankAllowlist(lossesById, definitions)
  const counts = countInventory(catalogue.definitions, definitions, lossesById, {
    linkFieldElements,
    imageFieldElements,
    withLink: withLink.size,
    withImage: withImage.size,
  })

  return {
    importerVersion: run.importerVersion,
    inventoryVersion: INVENTORY_VERSION,
    runId: catalogue.runId,
    manifest: catalogue.manifest,
    counts,
    attributes,
    definitions,
    allowlist,
    absent: {
      link: absentFrom(attributes, 'link'),
      image: absentFrom(attributes, 'image'),
    },
    remainingBlockers: rankRemaining(definitions),
  }
}

/** Probed names this field kind never carries, sorted. */
function absentFrom(rows: readonly FieldAttributeRow[], kind: FieldKind): string[] {
  const seen = new Set(rows.filter(row => row.fieldKind === kind).map(row => row.name))
  return PROBED_ATTRIBUTES[kind]
    .filter(name => !seen.has(name))
    .slice()
    .sort((a, b) => a.localeCompare(b, 'en'))
}

/** The field kind an element declares, or null when it declares none this module reads. */
function fieldKindOf(element: HtmlElement): FieldKind | null {
  const editable = attribute(element, 'data-editable')
  if (editable === 'link' || editable === 'image') return editable
  return null
}

type SelectorFacts = {
  classes: Set<string>
  ids: Set<string>
  attributeSelectors: Set<string>
}

/**
 * Which names a stylesheet's selectors depend on.
 *
 * Both this definition's own CSS and the shared preset sheet count: a class that
 * only INTERACTION_PRESET_CSS targets is still a class something styles, and
 * moving it to a wrapper still changes the page. The preset sheet's class names
 * arrive already parsed from `readV1Catalogue`, so this only has to parse one
 * stylesheet per definition.
 */
function selectorFacts(css: string, presetClasses: readonly string[]): SelectorFacts {
  const classes = new Set<string>([...classesInStylesheet(css), ...presetClasses])
  const ids = new Set<string>()
  const attributeSelectors = new Set<string>()
  for (const match of css.matchAll(/#(-?[A-Za-z_][A-Za-z0-9_-]*)/g)) ids.add(match[1]!)
  for (const match of css.matchAll(/\[\s*([A-Za-z_:][-A-Za-z0-9_:.]*)/g))
    attributeSelectors.add(match[1]!.toLowerCase())
  return { classes, ids, attributeSelectors }
}

function classify(
  definition: V1Definition,
  kind: FieldKind,
  name: string,
  value: string,
  selectors: SelectorFacts,
): AttributeSighting {
  const shape = valueShape(name, value)
  const fact = factFor(name)
  const consumedByField = CONSUMED_BY_FIELD[kind]?.has(name) === true
  const effects = [...fact.effects]

  let inSelector = selectors.attributeSelectors.has(name)
  if (name === 'class') {
    inSelector = value
      .split(/\s+/)
      .filter(token => token !== '')
      .some(token => selectors.classes.has(token))
  } else if (name === 'id') {
    inSelector = inSelector || selectors.ids.has(value)
  }
  // A `data-*` hook nobody styles affects nothing this inventory can see; one a
  // selector depends on is layout, and saying so from the stylesheet rather than
  // from a table is the only honest way to know.
  if (inSelector && !effects.includes('layout')) effects.push('layout')

  return {
    definitionId: definition.id,
    fieldKind: kind,
    name,
    shape,
    binding: bindingOf(name, value),
    ownership: fact.ownership,
    effects: effects.sort((a, b) => ATTRIBUTE_EFFECTS.indexOf(a) - ATTRIBUTE_EFFECTS.indexOf(b)),
    anchorRole: anchorRoleOf(name, shape),
    consumedByField,
    inSelector,
    // An attribute the field node already carries is expressible by
    // demonstration: `href` is the link field's URL and `alt` is the image
    // field's alt text, and reporting them as inexpressible would be reporting
    // that schema v1 cannot say the one thing it was built to say. Only the
    // losses go through the shape grammar, and only the losses reach the
    // allowlist arithmetic.
    expressible: consumedByField || isExpressibleShape(name, shape),
  }
}

/** What is known about an attribute name, including the prefix families. */
function factFor(name: string): AttributeFact {
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

/** Where the value came from, before the repeat question is asked of its siblings. */
function bindingOf(name: string, value: string): AttributeBinding {
  if (name === 'data-block-id' || name === 'data-editable') return 'generated'
  if (/\{\{|\}\}|\$\{|<%/.test(value)) return 'interpolated'
  return 'static'
}

/** One attribute on one field element, with the repeat instance it belongs to. */
type Instance = { sighting: AttributeSighting; place: RepeatPlace | null; value: string }

/** The repeat family an element belongs to, and which copy it is. */
type RepeatPlace = { family: string; index: string }

/**
 * Which copy of a hand-flattened repeat this element is, if it is one.
 *
 * Read off the element's own `data-block-id` against the families `repeatUnits`
 * detected in the slot list, so `card-1-link` is the first card only when there
 * is also a second card. A lone `hero-1-link` is a name with a number in it.
 */
function repeatPlace(element: HtmlElement, families: ReadonlySet<string>): RepeatPlace | null {
  const blockId = attribute(element, 'data-block-id')
  if (blockId === undefined) return null
  const match = /^(.*?)-(\d+)(-.*)?$/.exec(blockId)
  if (match === null || !families.has(match[1]!)) return null
  return { family: match[1]!, index: match[2]! }
}

/**
 * Promote the attributes that actually depend on which copy they are on.
 *
 * Asked by *comparing the copies*, not by looking for a digit. An earlier
 * version asked whether the value contained the element's own repeat index, and
 * duly reported `class="ring-1"` on all four cards of a grid as
 * repeat-indexed — it is a Tailwind ring width, identical on every copy, and
 * nothing about it varies with the index. The question that distinguishes them
 * is whether the value *changes* from copy to copy while tracking the index,
 * which needs the siblings and cannot be answered one element at a time.
 *
 * Both conditions are required. Values that differ but do not track the index —
 * four different alt texts for four different photographs — are variation
 * without repetition, and a repeat node would not generate them.
 */
function bindRepeats(instances: readonly Instance[]): AttributeSighting[] {
  const groups = new Map<string, Instance[]>()
  for (const instance of instances) {
    if (instance.place === null) continue
    const key = `${instance.place.family}\t${instance.sighting.name}`
    const list = groups.get(key) ?? []
    list.push(instance)
    groups.set(key, list)
  }

  const indexed = new Set<Instance>()
  for (const group of groups.values()) {
    const indices = new Set(group.map(instance => instance.place!.index))
    if (indices.size < 2) continue
    if (new Set(group.map(instance => instance.value)).size < 2) continue
    const tracks = group.every(instance =>
      new RegExp(`(?:^|[^0-9])${instance.place!.index}(?:[^0-9]|$)`).test(instance.value),
    )
    if (!tracks) continue
    for (const instance of group) indexed.add(instance)
  }

  return instances.map(instance =>
    indexed.has(instance) && instance.sighting.binding === 'static'
      ? { ...instance.sighting, binding: 'repeat-indexed' as const }
      : instance.sighting,
  )
}

function anchorRoleOf(name: string, shape: string): AnchorRole {
  if (name === 'id') return 'anchor-target'
  if (IDREF_ATTRIBUTES.has(name)) return 'idref'
  if (shape === 'url-fragment' || shape === 'url-fragment-empty') return 'anchor-source'
  return 'none'
}

// ------------------------------------------------------------ the tabulation

/** Every sighting, grouped into one row per field kind, attribute name and value shape. */
function tabulate(sightings: readonly AttributeSighting[]): FieldAttributeRow[] {
  const groups = new Map<string, AttributeSighting[]>()
  for (const sighting of sightings) {
    const key = `${sighting.fieldKind} ${sighting.name} ${sighting.shape}`
    const list = groups.get(key) ?? []
    list.push(sighting)
    groups.set(key, list)
  }

  const rows = [...groups.values()].map((group): FieldAttributeRow => {
    const first = group[0]!
    const ids = [...new Set(group.map(s => s.definitionId))].sort((a, b) => a.localeCompare(b, 'en'))
    const bindings = [...new Set(group.map(s => s.binding))].sort(
      (a, b) => ATTRIBUTE_BINDINGS.indexOf(a) - ATTRIBUTE_BINDINGS.indexOf(b),
    )
    const effects = [...new Set(group.flatMap(s => s.effects))].sort(
      (a, b) => ATTRIBUTE_EFFECTS.indexOf(a) - ATTRIBUTE_EFFECTS.indexOf(b),
    )
    const inSelector = group.filter(s => s.inSelector).length
    return {
      fieldKind: first.fieldKind,
      name: first.name,
      shape: first.shape,
      occurrences: group.length,
      definitions: ids.length,
      definitionIds: ids,
      bindings,
      ownership: first.ownership,
      effects,
      anchorRole: first.anchorRole,
      consumedByField: first.consumedByField,
      inSelector,
      // `class` is excluded for the reason `verdictFor` gives: this importer
      // reads two stylesheets and the sites render with more, so a class no
      // selector here depends on is not a class nothing styles.
      wrapperSafe: first.name !== 'class' && first.ownership === 'wrapper-capable' && inSelector === 0,
      expressible: first.expressible,
      verdict: verdictFor(first),
    }
  })

  // Sorted so the report leads with what matters and never with a Map's
  // insertion order: field kind, then how many definitions carry it, then the
  // name and the shape to break every remaining tie.
  return rows.sort(
    (a, b) =>
      a.fieldKind.localeCompare(b.fieldKind, 'en') ||
      b.definitions - a.definitions ||
      b.occurrences - a.occurrences ||
      a.name.localeCompare(b.name, 'en') ||
      a.shape.localeCompare(b.shape, 'en'),
  )
}

/**
 * What to do with this attribute, from the evidence rather than from taste.
 *
 * An attribute the field node already carries needs nothing. One a wrapper could
 * hold without a stylesheet noticing is a wrapper's job, not a new field-node
 * feature. One with a closed value grammar and no policy hazard is a candidate
 * for the allowlist. Everything else stays quarantined, and the two hazards —
 * inline style and event handlers — stay quarantined even though their grammar
 * could be closed, because the reason schema v1 excluded them was never grammar.
 */
function verdictFor(sighting: AttributeSighting): AttributeVerdict {
  if (sighting.consumedByField) return 'support'
  const fact = factFor(sighting.name)
  if (fact.hazard === true) return 'quarantine'
  // A class is never given the `wrapper` verdict, however few selectors this
  // importer can see depending on it. It reads three stylesheets — the
  // definition's own, the shared preset sheet, and nothing else — and the sites
  // that render these definitions load global sheets it does not. So "no
  // selector depends on this class" is a statement about what was looked at,
  // and moving a class to a wrapper on the strength of it is the silent-layout-
  // loss failure ADR 0007 exists to refuse. The `in a selector` column still
  // reports what was measured.
  if (sighting.name === 'class') return sighting.expressible ? 'support' : 'quarantine'
  if (sighting.ownership === 'wrapper-capable' && !sighting.inSelector) return 'wrapper'
  return sighting.expressible ? 'support' : 'quarantine'
}

// ------------------------------------------------------- the per-definition view

function attributions(
  definitions: readonly V1Definition[],
  codesById: ReadonlyMap<string, string[]>,
  statusById: ReadonlyMap<string, string>,
  lossesById: ReadonlyMap<string, AttributeSighting[]>,
): DefinitionAttribution[] {
  return definitions.map((definition): DefinitionAttribution => {
    const codes = codesById.get(definition.id) ?? []
    const losses = lossesById.get(definition.id) ?? []
    const lostOn = (kind: FieldKind): string[] =>
      [...new Set(losses.filter(loss => loss.fieldKind === kind).map(loss => loss.name))].sort((a, b) =>
        a.localeCompare(b, 'en'),
      )
    const fieldAttributesLost = codes.includes('field-attributes-lost')
    const clearable = losses.length > 0 && losses.every(loss => loss.expressible)
    return {
      id: definition.id,
      status: statusById.get(definition.id) ?? 'unknown',
      reasonCodes: codes,
      fieldAttributesLost,
      unsupportedAttribute: codes.includes('unsupported-attribute'),
      lostOnLink: lostOn('link'),
      lostOnImage: lostOn('image'),
      lostButNotCoded: losses.length > 0 && !fieldAttributesLost,
      clearableByAllowlist: clearable,
      remainingCodes: codes
        .filter(code => code !== 'field-attributes-lost')
        .filter((code, at, all) => all.indexOf(code) === at)
        .sort((a, b) => a.localeCompare(b, 'en')),
    }
  })
}

function countInventory(
  definitions: readonly V1Definition[],
  attributions: readonly DefinitionAttribution[],
  lossesById: ReadonlyMap<string, AttributeSighting[]>,
  shape: { linkFieldElements: number; imageFieldElements: number; withLink: number; withImage: number },
): FieldAttributeInventory['counts'] {
  const both = attributions.filter(row => row.fieldAttributesLost && row.unsupportedAttribute).length
  return {
    definitions: definitions.length,
    definitionsWithLinkField: shape.withLink,
    definitionsWithImageField: shape.withImage,
    linkFieldElements: shape.linkFieldElements,
    imageFieldElements: shape.imageFieldElements,
    definitionsWithLoss: lossesById.size,
    fieldAttributesLostCode: attributions.filter(row => row.fieldAttributesLost).length,
    unsupportedAttributeCode: attributions.filter(row => row.unsupportedAttribute).length,
    bothCodes: both,
    eitherCode: attributions.filter(row => row.fieldAttributesLost || row.unsupportedAttribute).length,
    lostButNotCoded: attributions.filter(row => row.lostButNotCoded).length,
  }
}

// ------------------------------------------------------------- the allowlist

/**
 * The smallest allowlist that clears the most definitions.
 *
 * Greedy over *bundles* rather than over names, for the reason `AllowlistStep`
 * gives. The candidate bundles are the distinct sets of attributes that
 * individual definitions would lose — nothing invented, only sets the catalogue
 * actually asks for.
 *
 * The step chosen is the one with the best *marginal density*: definitions
 * cleared per attribute added. Choosing the bundle that simply clears the most
 * produced a single step for each field kind — `class + rel + target` clearing
 * 61 — which is the correct maximum and a useless recommendation, because it
 * hides that `class` alone reaches 60 and the other two attributes buy one
 * definition between them. Density recovers the shape somebody would actually
 * implement in order, and the endpoint is unchanged: the walk continues until no
 * bundle clears anything further.
 *
 * Definitions with a loss no grammar can express are excluded from the
 * candidates: an allowlist cannot clear them at any size, and letting their sets
 * seed a bundle would put `style` in an allowlist that buys nothing.
 */
function rankAllowlist(
  lossesById: ReadonlyMap<string, AttributeSighting[]>,
  attributions: readonly DefinitionAttribution[],
): FieldAttributeInventory['allowlist'] {
  const remaining = new Map(attributions.map(row => [row.id, row.remainingCodes]))
  // A step's verdict is taken over the occurrences the allowlist would actually
  // accept, which means the expressible ones. Taking it over every occurrence
  // instead reported the whole `class` bundle as `quarantine` on the strength of
  // one definition writing Tailwind utilities — a definition the allowlist never
  // clears anyway, because it is in `unclearable`. A price is only a price for
  // something you are buying.
  const verdicts = new Map<string, AttributeVerdict>()
  const record = (loss: AttributeSighting): void => {
    const verdict = verdictFor(loss)
    const seen = verdicts.get(loss.name)
    if (seen === undefined || rankVerdict(verdict) > rankVerdict(seen)) verdicts.set(loss.name, verdict)
  }
  for (const losses of lossesById.values()) for (const loss of losses) if (loss.expressible) record(loss)
  // Names with no expressible occurrence at all still need a verdict, for the
  // case where a future catalogue puts one inside a bundle.
  for (const losses of lossesById.values()) {
    for (const loss of losses) if (!verdicts.has(loss.name)) record(loss)
  }

  const stepsFor = (kind: FieldKind | 'both'): AllowlistStep[] => {
    const relevant = [...lossesById]
      .map(([id, losses]) => ({
        id,
        losses: kind === 'both' ? losses : losses.filter(loss => loss.fieldKind === kind),
      }))
      .filter(entry => entry.losses.length > 0)
      .sort((a, b) => a.id.localeCompare(b.id, 'en'))

    const required = new Map<string, string[]>()
    for (const entry of relevant) {
      // Only definitions every one of whose losses has a grammar. The others are
      // in `unclearable`, counted and named, rather than silently absent.
      if (!entry.losses.every(loss => loss.expressible)) continue
      required.set(
        entry.id,
        [...new Set(entry.losses.map(loss => loss.name))].sort((a, b) => a.localeCompare(b, 'en')),
      )
    }
    const bundles = [...new Set([...required.values()].map(names => names.join(' ')))]
      .sort((a, b) => a.localeCompare(b, 'en'))
      .map(key => (key === '' ? [] : key.split(' ')))

    const cleared = (allowed: ReadonlySet<string>): string[] =>
      [...required].filter(([, names]) => names.every(name => allowed.has(name))).map(([id]) => id)

    const allowed = new Set<string>()
    const steps: AllowlistStep[] = []
    let previous = 0
    for (;;) {
      let best: { added: string[]; count: number; gain: number } | null = null
      for (const bundle of bundles) {
        const added = bundle.filter(name => !allowed.has(name)).sort((a, b) => a.localeCompare(b, 'en'))
        if (added.length === 0) continue
        const count = cleared(new Set([...allowed, ...bundle])).length
        const candidate = { added, count, gain: count - previous }
        if (candidate.gain <= 0) continue
        if (best === null || better(candidate, best)) best = candidate
      }
      if (best === null) break
      for (const name of best.added) allowed.add(name)
      const nowCleared = cleared(allowed)
      steps.push({
        rank: steps.length + 1,
        fieldKind: kind,
        added: best.added,
        allowlist: [...allowed].sort((a, b) => a.localeCompare(b, 'en')),
        newlyCleared: nowCleared.length - previous,
        cumulativeCleared: nowCleared.length,
        cumulativeUnlocked: nowCleared.filter(id => (remaining.get(id) ?? []).length === 0).length,
        verdict: best.added
          .map(name => verdicts.get(name) ?? 'quarantine')
          .reduce((worst, next) => (rankVerdict(next) > rankVerdict(worst) ? next : worst), 'support'),
      })
      previous = nowCleared.length
    }
    return steps
  }

  const unclearable = [...lossesById]
    .filter(([, losses]) => losses.some(loss => !loss.expressible))
    .map(([id]) => id)
    .sort((a, b) => a.localeCompare(b, 'en'))

  return { link: stepsFor('link'), image: stepsFor('image'), combined: stepsFor('both'), unclearable }
}

/**
 * Is this candidate step a better buy than the best so far?
 *
 * Density first — definitions cleared per attribute added — compared as
 * `a.gain * b.names > b.gain * a.names` rather than as a division, so no
 * platform's floating point gets a say in which step a report lists first. Then
 * the cheaper bundle, then the one clearing more, then the alphabetically first,
 * which between them leave no tie for the catalogue's read order to break.
 */
function better(
  candidate: { added: string[]; count: number; gain: number },
  best: { added: string[]; count: number; gain: number },
): boolean {
  const left = candidate.gain * best.added.length
  const right = best.gain * candidate.added.length
  if (left !== right) return left > right
  if (candidate.added.length !== best.added.length) return candidate.added.length < best.added.length
  if (candidate.count !== best.count) return candidate.count > best.count
  return candidate.added.join(' ').localeCompare(best.added.join(' '), 'en') < 0
}

/** How unacceptable a verdict is, so the worst of a set can be taken. */
function rankVerdict(verdict: AttributeVerdict): number {
  return ATTRIBUTE_VERDICTS.indexOf(verdict)
}

/**
 * Definitions blocked by exactly one remaining thing, by what that thing is.
 *
 * Asked only of definitions a full attribute allowlist would clear, because for
 * every other definition the attribute question is not the last question and the
 * count would be a different, less useful one.
 */
function rankRemaining(attributions: readonly DefinitionAttribution[]): { code: string; definitions: number }[] {
  const tally = new Map<string, number>()
  for (const row of attributions) {
    if (!row.clearableByAllowlist) continue
    if (row.remainingCodes.length !== 1) continue
    const code = row.remainingCodes[0]!
    tally.set(code, (tally.get(code) ?? 0) + 1)
  }
  return [...tally]
    .map(([code, definitions]) => ({ code, definitions }))
    .sort((a, b) => b.definitions - a.definitions || a.code.localeCompare(b.code, 'en'))
}
