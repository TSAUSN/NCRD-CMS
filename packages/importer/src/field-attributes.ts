/** Compare V1 link and image attributes against the schema v1 field contract. The inventory emits shapes, never source values. */
import {
  type FieldKind,
  type AttributeBinding,
  type AttributeOwnership,
  type AttributeEffect,
  type AnchorRole,
  type AttributeVerdict,
  FIELD_ELEMENT,
  INVENTORY_VERSION,
  PROBED_ATTRIBUTES,
  valueShape,
  factFor,
  ATTRIBUTE_EFFECTS,
  anchorRoleOf,
  isExpressibleShape,
} from './field-attribute-policy.ts'
import { type SourceManifest, readV1Catalogue, type V1Definition } from './source.ts'
import { type RunOptions, runImport } from './run.ts'
import { classesInStylesheet } from './presets.ts'
import { parseHtml, elements, type HtmlElement, attribute } from './html.ts'
import { repeatUnits, CONSUMED_BY_FIELD } from './convert.ts'
import { tabulate, attributions, rankAllowlist, countInventory, rankRemaining } from './field-attribute-report.ts'
export {
  INVENTORY_VERSION,
  FIELD_KINDS,
  type FieldKind,
  ATTRIBUTE_BINDINGS,
  type AttributeBinding,
  ATTRIBUTE_OWNERSHIPS,
  type AttributeOwnership,
  ATTRIBUTE_EFFECTS,
  type AttributeEffect,
  ANCHOR_ROLES,
  type AnchorRole,
  ATTRIBUTE_VERDICTS,
  type AttributeVerdict,
  PROBED_ATTRIBUTES,
  valueShape,
  isExpressibleShape,
} from './field-attribute-policy.ts'

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
