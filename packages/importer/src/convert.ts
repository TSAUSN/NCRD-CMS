// One V1 definition, mapped to the current structured schema — or refused, with
// reasons.
//
// The rule this file is built around: a definition is converted only when every
// part of it has somewhere to go. Not "most of it", not "the parts that matter".
// V1's markup is styled entirely by class, its images carry intrinsic
// dimensions, and its repeated units are numbered by hand; a mapping that drops
// any of those produces a section that renders without complaint and does not
// look like the page it came from, which is the failure ADR 0007 exists to
// prevent and the one an importer is most likely to commit.
//
// So there is no partial conversion and no fallback. Every refusal below is a
// place where this converter cannot faithfully map what V1 said, and each one
// names itself. Some need model extensions; others need a verified mapping or
// collection data that a definition catalogue cannot supply.

import {
  STRUCTURED_LIMITS,
  STRUCTURED_SCHEMA_VERSION,
  StructuredDocument,
  isStructuredAttribute,
  isStructuredAttributeValue,
  isStructuredTag,
  structuredDepth,
  type StructuredFieldDef,
  type StructuredFieldType,
  type StructuredNode,
  type StructuredTag,
} from '@cms/schema'
import {
  compileStructuredSection,
  scopeCss,
  sectionScopeSelector,
  structuredSectionProblems,
  validateCompiledCss,
} from '@cms/renderer'
import { attribute, depthOf, elements, isWhitespace, parseHtml, type HtmlElement, type HtmlNode } from './html.ts'
import { borrowedClasses, classesInMarkup, classesInStylesheet } from './presets.ts'
import { orderReasons, reason, statusFor, type ImportStatus, type Reason } from './reasons.ts'
import { imageStaticAttributes, linkStaticAttributes } from './static-attributes.ts'
import type { V1Slot } from './source.ts'
import { catalogueStyles } from './catalogue-styles.ts'

/** V1's own field vocabulary, as used by the catalogue rather than as validated by it. */
const V1_EDITABLE_TYPES = ['text', 'richtext', 'link', 'image', 'icon'] as const

/** The four V1 types the structured schema has a node for. */
const MAPPABLE_FIELD_TYPES = ['text', 'richtext', 'link', 'image'] as const satisfies readonly StructuredFieldType[]
type MappableFieldType = (typeof MAPPABLE_FIELD_TYPES)[number]
const MAPPABLE_TYPES = new Set<string>(MAPPABLE_FIELD_TYPES)

function isMappableFieldType(value: string): value is MappableFieldType {
  return MAPPABLE_TYPES.has(value)
}

/**
 * Attributes a field node absorbs into its own value, per V1 field type.
 *
 * These are the author's, not the definition's: the URL a link field holds, the
 * source and alt text an image field holds, and V1's own region markers, which a
 * field node re-derives from the slot. A definition may not restate any of them
 * as a static attribute, which is why they are removed before the static
 * mapping is asked anything.
 *
 * Everything else is a question for `static-attributes.ts` on a link or an
 * image, and a loss anywhere else: a `text` or `richtext` field keeps its
 * element, so its attributes go through the element-node allowlist instead.
 */
export const CONSUMED_BY_FIELD: Record<string, Set<string>> = {
  text: new Set(['data-block-id', 'data-editable']),
  richtext: new Set(['data-block-id', 'data-editable']),
  link: new Set(['data-block-id', 'data-editable', 'href']),
  image: new Set(['data-block-id', 'data-editable', 'src', 'alt']),
}

/**
 * Attributes that are V1's authoring plumbing rather than the definition's
 * markup, removed from every element before the element-node allowlist is
 * asked anything.
 *
 * Only `data-cms-section` so far, and ADR 0009 refused it as an *attribute* on
 * exactly this evidence, gathered over all 118 definitions. It appears in 20 of
 * them, exactly once each, always on the definition's root element, and every
 * value is unique — a per-definition identity rather than a label anything
 * shares. No definition stylesheet selects on it and neither does
 * `INTERACTION_PRESET_CSS`, so carrying it and dropping it produce the same
 * rendered page; what reads it is V1's `render-sections.js`, resolving
 * `querySelector('[data-cms-section="…"]')` to find a hand-written block inside
 * a static page, and v2 has no static page and no swap because a page is
 * composed of section instances and rendered from the document.
 *
 * Importing the value would be worse than inert. V2's own renderer emits
 * `data-cms-section` on the section wrapper to carry the section *index*, which
 * is what the preview runtime reads to say which section was clicked; a V1
 * value smuggled in on an inner element would answer that query with a page
 * identity and break the editor's contract with itself.
 *
 * Stripped everywhere rather than only at the root, because the rule is "this
 * attribute is authoring metadata", not "this position is special" — a reader
 * who finds it on a nested element should get the same answer, and a rule that
 * held only at the root would quietly become a rule about position the first
 * time V1 wrote one a level down.
 *
 * This is emphatically not a widening of the attribute policy: every other
 * `data-*` name in the census is still refused, one by one, by
 * `isStructuredAttribute`. What earns this one an exemption is that v2
 * re-derives it, exactly as `CONSUMED_BY_FIELD` re-derives `data-block-id`.
 */
export const CONSUMED_BY_SECTION: ReadonlySet<string> = new Set(['data-cms-section'])

/** Elements that submit, collect, or are controls. */
const FORM_ELEMENTS = new Set([
  'form',
  'input',
  'select',
  'textarea',
  'label',
  'option',
  'optgroup',
  'fieldset',
  'legend',
  'output',
  'datalist',
])
/** Elements that load a third party's document into this one. */
const EMBED_ELEMENTS = new Set(['iframe', 'object', 'embed'])

export type ConversionInput = {
  id: string
  html: string
  css: string
  slots: readonly V1Slot[]
  presetClasses: readonly string[]
  /** When supplied, the hashed source-owned scriptless preset stylesheet. */
  presetCss?: string
  /** Reasons decided outside the markup: divergence, unresolved anchors. */
  external?: readonly Reason[]
}

export type Conversion = {
  id: string
  status: ImportStatus
  reasons: Reason[]
  /** Present only when the status is `automatic`. */
  document: StructuredDocument | null
  /** Compiled, scoped CSS. Never the authored form. */
  compiledCss: string | null
  /** The identity `compileStructuredSection` produces, or null when refused. */
  renderHash: string | null
  /** Shape facts a report can print without reproducing anything. */
  measurements: {
    nodes: number
    fields: number
    depth: number
    /** Preset classes this definition uses and does not define. */
    borrowedClasses: string[]
  }
}

/**
 * Map one definition, or say why not.
 *
 * Never throws on bad input: an importer that crashes on definition 44 of 118
 * has no counts at all, and the counts are the deliverable.
 */
export function convertDefinition(input: ConversionInput): Conversion {
  const reasons: Reason[] = [...(input.external ?? [])]
  const scope = sectionScopeSelector(input.id)

  // Asked of the slot list before the markup is opened at all. These are facts
  // about what a definition declares, so a definition whose markup this reader
  // cannot get through still contributes to the count waiting on a faithful
  // icon mapping or collection binding — which is the count somebody plans against.
  if (input.slots.some(slot => slot.editable === 'icon')) reasons.push(reason('icon-field'))
  const repeated = repeatUnits(input.slots)
  if (repeated.length > 0) reasons.push(reason('repeat-family', repeated.join(' ')))

  const parsed = parseHtml(input.html)
  if (!parsed.ok) {
    return refuse(input.id, [...reasons, reason('html-parse-failed', parsed.refusal)], [])
  }

  // Before the recursive walk below touches it. A tree deeper than the model
  // permits has no document to become, and finding that out by overflowing the
  // stack would cost the run its counts.
  const depth = depthOf(parsed.nodes)
  if (depth > STRUCTURED_LIMITS.depth) {
    return refuse(input.id, [...reasons, reason('too-deep', String(depth))], [])
  }

  const ownClasses = classesInStylesheet(input.css)
  let sourceCss = input.css
  if (input.presetCss !== undefined) {
    try {
      sourceCss = catalogueStyles(input.html, input.css, input.presetCss)
    } catch {
      reasons.push(reason('interaction-preset-css', 'source stylesheet could not be preserved within a section'))
    }
  }
  // Read off the whole parsed tree rather than accumulated during the walk. The
  // walk stops descending the moment a subtree cannot be expressed, so a class
  // or a region below that point would never be counted — and a definition
  // whose only borrowed class sits inside an icon it also cannot import would
  // look like it depends on nothing.
  const everyElement = elements(parsed.nodes)
  const named = (name: string): string[] =>
    everyElement.map(element => attribute(element, name)).filter((value): value is string => value !== undefined)
  const walk = new Walk(input.slots)
  const nodes = walk.nodes(parsed.nodes)
  reasons.push(...walk.reasons)

  const borrowed = borrowedClasses({
    used: classesInMarkup(named('class')),
    presetClasses: input.presetClasses,
    ownCss: ownClasses,
  })
  if (borrowed.length > 0 && input.presetCss === undefined)
    reasons.push(reason('interaction-preset-css', borrowed.join(' ')))
  if (input.presetCss !== undefined) {
    const carriedClasses = new Set(classesInStylesheet(input.presetCss))
    if (borrowed.some(name => !carriedClasses.has(name))) {
      reasons.push(reason('interaction-preset-css', 'supplied stylesheet does not define every borrowed class'))
    }
  }

  // Asked of the whole parsed tree, not of the walk. The walk stops descending
  // at a refusal, so a region inside one would have looked like a declared slot
  // with no markup behind it — a defect in the catalogue this importer would
  // have invented twelve times over.
  reasons.push(...slotIntegrity(input.slots, named('data-block-id')))
  reasons.push(...cssReasons(sourceCss, scope))

  const fields = declaredFields(input.slots)
  const document = {
    schemaVersion: STRUCTURED_SCHEMA_VERSION,
    fields: fields.defs,
    nodes: nodes ?? [],
  }
  reasons.push(...fields.reasons)

  // Compiled through the compiler the seeds use, so a definition this importer
  // calls converted is one the authoring path would accept unchanged. A second
  // spelling of "is this document valid" is how an importer comes to produce
  // documents storage refuses.
  const compiled = compileStructuredSection({ slug: input.id, document, sourceCss })
  // Only asked of a definition whose markup converted whole. A refused walk
  // leaves an empty node list behind, and validating that would report a
  // mapping bug for every definition the model simply cannot express — which is
  // most of them, and none of them a bug.
  if (nodes !== null) {
    const stored = structuredSectionProblems({
      definition_kind: 'structured',
      structured_doc: document,
      structured_schema_version: STRUCTURED_SCHEMA_VERSION,
    })
    if (stored.length > 0) reasons.push(reason('document-invalid', String(stored.length)))
  }

  const ordered = orderReasons(reasons)
  const status = statusFor(ordered)
  const measurements = {
    nodes: countNodes(nodes ?? []),
    fields: fields.defs.length,
    depth: structuredDepth(nodes ?? []),
    borrowedClasses: borrowed,
  }
  if (status !== 'automatic') {
    return { id: input.id, status, reasons: ordered, document: null, compiledCss: null, renderHash: null, measurements }
  }

  return {
    id: input.id,
    status,
    reasons: ordered,
    document: StructuredDocument.parse(document),
    compiledCss: compiled.css,
    renderHash: compiled.renderHash,
    measurements,
  }
}

function refuse(id: string, reasons: Reason[], borrowed: string[]): Conversion {
  const ordered = orderReasons(reasons)
  return {
    id,
    status: statusFor(ordered),
    reasons: ordered,
    document: null,
    compiledCss: null,
    renderHash: null,
    measurements: { nodes: 0, fields: 0, depth: 0, borrowedClasses: borrowed },
  }
}

// ------------------------------------------------------------------ the walk

/**
 * The tree walk, as a class only because it accumulates four things at once and
 * threading four accumulators through a recursive function is how one of them
 * ends up forgotten on one branch.
 */
class Walk {
  readonly reasons: Reason[] = []
  private readonly byBlockId: Map<string, V1Slot>

  // The field is assigned in the body rather than declared as a parameter
  // property: the repository runs its TypeScript through
  // `--experimental-strip-types`, which erases annotations and refuses anything
  // that would need emitting.
  constructor(slots: readonly V1Slot[]) {
    this.byBlockId = new Map(slots.map(slot => [slot.blockId, slot]))
  }

  /** Returns null once anything in the subtree could not be expressed. */
  nodes(input: readonly HtmlNode[]): StructuredNode[] | null {
    const out: StructuredNode[] = []
    let usable = true
    for (const node of input) {
      const converted = this.node(node)
      if (converted === null) {
        usable = false
        continue
      }
      // Whitespace between elements is layout in the source and nothing in the
      // tree; skipping it is the one lossless omission this walk makes.
      if (converted !== undefined) out.push(converted)
    }
    return usable ? out : null
  }

  /** A node, `undefined` for one that is correctly dropped, `null` for a refusal. */
  private node(node: HtmlNode): StructuredNode | null | undefined {
    if (node.kind === 'text') {
      if (isWhitespace(node.text)) return undefined
      // Copy with no field to live in. Structured schema v1 has element nodes
      // and field nodes and nothing that holds a fixed sentence, so importing
      // this definition would delete the words from the page.
      this.reasons.push(reason('static-text'))
      return null
    }

    const editable = attribute(node, 'data-editable')
    if (editable !== undefined) return this.field(node, editable)

    const verdict = elementTag(node.tag)
    if (!verdict.ok) {
      // The SVG subtree is not descended: every element below it is SVG, and
      // reporting `<path>` as an unsupported element as well would say the same
      // thing twenty-two more times.
      if (node.tag === 'svg') {
        this.reasons.push(verdict.refusal)
        return null
      }
      return this.keepLooking(node, verdict.refusal)
    }

    const attributes = this.attributes(node)
    const children = this.nodes(node.children)
    if (attributes === null || children === null) return null
    return { type: 'element', tag: verdict.tag, attributes, children }
  }

  /**
   * Record a refusal and carry on down.
   *
   * A walk that returned at its first refusal reported one reason per
   * definition and left the census wrong about the rest: a section holding a
   * form, three icons and a table looked like a section holding a form. The
   * document is already unusable at this point, so descending costs nothing and
   * buys the only thing this package produces — an accurate count of what the
   * model cannot yet say.
   */
  private keepLooking(node: HtmlElement, refusal: Reason): null {
    this.reasons.push(refusal)
    this.attributes(node)
    this.nodes(node.children)
    return null
  }

  /** Static attributes for a retained element, or null when one cannot be carried. */
  private attributes(node: HtmlElement): Record<string, string> | null {
    const out: Record<string, string> = {}
    let usable = true
    // `CONSUMED_BY_SECTION` is removed before the allowlist is consulted rather
    // than allowlisted: the allowlist answers "may an element node carry this",
    // and the answer for authoring plumbing v2 re-derives is that the question
    // does not arise. Asked in this one place, so it holds for a retained
    // element, for one being descended after a refusal, and for the element a
    // text or richtext region keeps.
    //
    // Sorted by name so two runs over the same element serialize identically
    // regardless of the order the source wrote them in. The document is hashed;
    // key order in a JSON object is insertion order, and insertion order here
    // would otherwise be an author's typing.
    const carried = node.attributes.filter(attr => !CONSUMED_BY_SECTION.has(attr.name))
    for (const attr of carried.sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
      if (!isStructuredAttribute(attr.name)) {
        this.reasons.push(reason('unsupported-attribute', attr.name))
        usable = false
        continue
      }
      if (!isStructuredAttributeValue(attr.name, attr.value)) {
        // The name is allowed and the value is not — an over-long class list, an
        // `aria-hidden` that is not a boolean. Reported against the name, since
        // the value is V1's text and does not belong in a report.
        this.reasons.push(reason('unsupported-attribute', `${attr.name} value`))
        usable = false
        continue
      }
      out[attr.name] = attr.value
    }
    return usable ? out : null
  }

  /** An editable region, as the field node its declared type names. */
  private field(node: HtmlElement, editable: string): StructuredNode | null {
    const blockId = attribute(node, 'data-block-id')
    if (blockId === undefined) {
      this.reasons.push(reason('slot-integrity', 'an editable region has no block id'))
      return null
    }
    const slot = this.byBlockId.get(blockId)
    if (slot === undefined) {
      this.reasons.push(reason('slot-integrity', 'an editable region is not declared as a slot'))
      return null
    }
    if (slot.editable !== editable) {
      this.reasons.push(reason('slot-integrity', 'an editable region and its slot disagree about type'))
      return null
    }
    if (!(V1_EDITABLE_TYPES as readonly string[]).includes(editable)) {
      this.reasons.push(reason('slot-integrity', 'an editable region has a type V1 does not define'))
      return null
    }

    if (editable === 'icon') {
      this.reasons.push(reason('icon-field'))
      return null
    }
    if (!isMappableFieldType(editable)) {
      this.reasons.push(reason('slot-integrity', 'an editable region has a type this importer cannot map'))
      return null
    }

    for (const descendant of node.children) {
      if (this.containsEditable(descendant)) {
        this.reasons.push(reason('nested-editable'))
        return null
      }
    }

    const field = editable
    if (field === 'link' || field === 'image') return this.markupField(node, field)

    // `text` and `richtext` keep their element: the class that styles the
    // heading is on the heading, and the field node goes inside it. This is the
    // one V1 shape the structured schema already fits.
    //
    // Judged by the same function the non-editable path uses, so a `<button>`
    // carrying an editable label is refused as a button rather than as an
    // element nobody has heard of.
    const verdict = elementTag(node.tag)
    if (!verdict.ok) {
      this.reasons.push(verdict.refusal)
      return null
    }
    // The field node replaces the region's children, so anything that was
    // inside them has to be something the field can say again. A `richtext`
    // field can: it renders sanitized HTML, and the markup in the region is the
    // sample value the author's value replaces. A `text` field cannot — it
    // renders an escaped string — so a `<br>`, an `<em>`, or the `<span>` a
    // headline colours one word with has no author value that would put it
    // back, and this walk used to delete all three without saying so. It called
    // hni-hero-v1 automatic on that basis, and a browser parity run caught it
    // rendering 13 elements where V1 renders 15.
    //
    // The whole subtree, not the direct children: a `<span>` wrapping an `<em>`
    // loses both, and reporting only the outer one would understate what an
    // author would have to give up. Tag names only — they are structural HTML
    // rather than V1's copy, and the copy is precisely what must not reach a
    // report in this repository.
    const markup = field === 'text' ? elements(node.children).map(child => child.tag) : []
    const lost = [...new Set(markup)].sort((a, b) => a.localeCompare(b, 'en'))
    if (lost.length > 0) this.reasons.push(reason('text-region-markup', lost.join(' ')))

    // Asked even when the markup above already settled it, so a region that
    // carries both an unsupported attribute and an `<em>` is counted under both
    // — the census is the deliverable, and a refusal that hides the next
    // refusal is how it comes to understate the work.
    const attributes = this.attributes(this.withoutConsumed(node, field))
    if (lost.length > 0 || attributes === null) return null
    return { type: 'element', tag: verdict.tag, attributes, children: [{ type: field, field: blockId }] }
  }

  /**
   * A `link` or `image` field, which renders its own element.
   *
   * There is no element node to hang attributes on: the field node *is* the
   * anchor or the image. Until schema v2 that ended the conversation — the node
   * carried a URL, a label or an alt text and nothing else, so the class that
   * makes an anchor look like a button and the dimensions that stop the page
   * jumping had nowhere to go, and 77 definitions were refused over it.
   *
   * Schema v2 gave those two nodes a governed `staticAttributes` object, so the
   * question is now narrower and is asked in `static-attributes.ts`: do these
   * attributes fit that grammar *exactly*? All of them, or none — a class list
   * with one framework-utility token in it is still refused whole, because
   * carrying the tokens that fit and dropping the one that does not is how an
   * importer produces a section that renders and does not look like the page it
   * came from. What is still outside the grammar — an inline `style`, a `data-*`
   * hook — keeps this reason, which is why the reason stayed rather than being
   * deleted along with the limitation that created it.
   */
  private markupField(node: HtmlElement, field: 'link' | 'image'): StructuredNode | null {
    const expected = field === 'link' ? 'a' : 'img'
    if (node.tag !== expected) {
      this.reasons.push(reason('unexpected-field-element', `${field} on <${node.tag}>`))
      return null
    }
    if (field === 'link' && node.children.some(child => child.kind === 'element')) {
      this.reasons.push(reason('link-wraps-content'))
      return null
    }

    // Everything the field node itself absorbs is removed first, so the mapping
    // is only ever asked about attributes that would otherwise be lost. `href`
    // is the link's own value and `src` and `alt` are the image's; a definition
    // is not allowed to write them as static attributes, and reporting them as
    // unmappable would report that the model cannot say the thing it exists to
    // say.
    // `CONSUMED_BY_SECTION` as well as the field's own set, so the rule holds
    // wherever the attribute is written. `Walk.attributes()` strips it for every
    // element node, and a link or an image field never reaches that function —
    // it has no element node to hang attributes on — so without this line the
    // rule would have been a rule about element nodes wearing the words "every
    // element", which is the shape of comment this repository has been caught by
    // before.
    const carried = node.attributes.filter(
      attr => !CONSUMED_BY_FIELD[field]!.has(attr.name) && !CONSUMED_BY_SECTION.has(attr.name),
    )
    const blockId = attribute(node, 'data-block-id')!

    if (field === 'link') {
      const mapped = linkStaticAttributes(carried)
      if (!mapped.ok) {
        this.reasons.push(reason('field-attributes-lost', `${expected}: ${mapped.lost.join(' ')}`))
        return null
      }
      if (mapped.staticAttributes === undefined) return { type: 'link', field: blockId }
      return { type: 'link', field: blockId, staticAttributes: mapped.staticAttributes }
    }

    const mapped = imageStaticAttributes(carried)
    if (!mapped.ok) {
      this.reasons.push(reason('field-attributes-lost', `${expected}: ${mapped.lost.join(' ')}`))
      return null
    }
    if (mapped.staticAttributes === undefined) return { type: 'image', field: blockId }
    return { type: 'image', field: blockId, staticAttributes: mapped.staticAttributes }
  }

  /** The element minus the attributes its field type absorbs. */
  private withoutConsumed(node: HtmlElement, field: string): HtmlElement {
    const consumed = CONSUMED_BY_FIELD[field] ?? new Set<string>()
    return { ...node, attributes: node.attributes.filter(attr => !consumed.has(attr.name)) }
  }

  private containsEditable(node: HtmlNode): boolean {
    if (node.kind !== 'element') return false
    if (attribute(node, 'data-editable') !== undefined) return true
    return node.children.some(child => this.containsEditable(child))
  }
}

/** Either a tag an element node may carry, or why this one may not be. */
type TagVerdict = { ok: true; tag: StructuredTag } | { ok: false; refusal: Reason }

/**
 * Whether this tag can be an element node, and why not when it cannot.
 *
 * One function for both the editable and the non-editable path, because the
 * answer is a fact about the tag and the two paths were free to disagree about
 * it — and did, reporting three `<button data-editable>` regions as unsupported
 * *elements*, which is true and the least useful true thing available.
 *
 * The result carries the narrowed tag rather than a bare `null`, so the caller
 * that builds the node gets the allowlisted type from the check itself instead
 * of asserting it a second time.
 */
function elementTag(tag: string): TagVerdict {
  if (tag === 'svg') return { ok: false, refusal: reason('inline-svg') }
  if (FORM_ELEMENTS.has(tag)) return { ok: false, refusal: reason('form-element', tag) }
  if (tag === 'button') return { ok: false, refusal: reason('button-element') }
  if (EMBED_ELEMENTS.has(tag)) return { ok: false, refusal: reason('embed-element', tag) }
  // `a` and `img` reach here when they carry no `data-editable`: a static link
  // or a fixed image. Both are deliberately absent from the tag allowlist so
  // that every URL in a structured definition goes through the URL policy on a
  // field, which means a *static* one has nowhere to go.
  if (!isStructuredTag(tag)) return { ok: false, refusal: reason('unsupported-element', tag) }
  return { ok: true, tag }
}

// ------------------------------------------------------------------ the rest

function countNodes(nodes: readonly StructuredNode[]): number {
  let count = 0
  const stack: StructuredNode[] = [...nodes]
  while (stack.length > 0) {
    const node = stack.pop()!
    count += 1
    if (node.type === 'element') for (const child of node.children ?? []) stack.push(child)
  }
  return count
}

/**
 * The repeated units hidden in a slot list.
 *
 * V1 has no repeat primitive, so a list of four donation amounts is
 * `amount-1-value` through `amount-4-link` and the cardinality is a fact about
 * the markup. Importing that as written would carry the fixed count across into
 * a model that was designed to stop doing exactly this. V2 has a repeat node,
 * but its item schema, template and collection binding must be established;
 * numbered slot names alone cannot prove those things.
 */
export function repeatUnits(slots: readonly V1Slot[]): string[] {
  const families = new Map<string, Set<string>>()
  for (const slot of slots) {
    const match = /^(.*?)-(\d+)(-.*)?$/.exec(slot.blockId)
    if (match === null) continue
    // The unit name and the part are kept apart by a character that cannot occur
    // in a slot id, so `amount-1-value` and `amount-value-1` cannot collide into
    // one family and be counted as a repeat neither of them is.
    const key = `${match[1]}|${match[3] ?? ''}`
    const indices = families.get(key) ?? new Set<string>()
    indices.add(match[2]!)
    families.set(key, indices)
  }
  const units = new Set<string>()
  for (const [key, indices] of families) {
    // Two instances, not one. A lone `card-1-title` is a name with a number in
    // it rather than a family, and calling it a repeat would quarantine
    // definitions over their slot naming.
    if (indices.size >= 2) units.add(key.slice(0, key.indexOf('|')))
  }
  return [...units].sort((a, b) => a.localeCompare(b, 'en'))
}

/** Every declared slot has a region, and every region has a declared slot. */
function slotIntegrity(slots: readonly V1Slot[], seen: readonly string[]): Reason[] {
  const declared = new Set(slots.map(slot => slot.blockId))
  const present = new Set(seen)
  const missing = [...declared].filter(id => !present.has(id))
  // Only the count, never the ids: a slot id is V1's naming and this list is
  // written to a file in this repository.
  return missing.length > 0
    ? [reason('slot-integrity', `${missing.length} declared slots have no editable region`)]
    : []
}

/** The field declarations an editor reads, from V1's own slot list. */
function declaredFields(slots: readonly V1Slot[]): { defs: StructuredFieldDef[]; reasons: Reason[] } {
  const defs: StructuredFieldDef[] = []
  const reasons: Reason[] = []
  for (const slot of slots) {
    if (!isMappableFieldType(slot.editable)) continue
    if (slot.label.trim() === '') {
      reasons.push(reason('slot-integrity', 'a slot has no label'))
      continue
    }
    defs.push({ name: slot.blockId, type: slot.editable, label: slot.label })
  }
  return { defs, reasons }
}

/**
 * Violation text the CSS policy produces, reduced to a token.
 *
 * Two reasons. The policy's parse failures quote the source that failed to
 * parse, and its scope failures quote the selector — both are V1's stylesheet,
 * and this string ends up in a file in this repository. And a report that groups
 * by reason needs the varying part to stop varying.
 */
const CSS_VIOLATION_TOKENS: readonly [string, string][] = [
  ['this CSS could not be parsed', 'unparseable'],
  ['a rule with no declarations was dropped', 'empty-rule'],
  ['at-rules that load external resources', 'loading-at-rule'],
  ['is not supported in section CSS', 'unsupported-at-rule'],
  ['nested rules are not supported', 'nested-rule'],
  ['active CSS values are not allowed', 'active-value'],
  ['url() may only reference this site', 'off-site-url'],
  ['a declaration may not name an off-site location', 'off-site-location'],
  ['a declaration value could not be parsed', 'unparseable-declaration'],
  ['a selector could not be confined to this section', 'unconfinable-selector'],
  ['a selector cannot contain markup', 'markup-in-selector'],
  ['a declaration cannot contain markup', 'markup-in-declaration'],
  ['an at-rule condition cannot contain markup', 'markup-in-at-rule'],
  ['could not be made safe to embed', 'unembeddable'],
]

function cssViolationToken(violation: string): string {
  for (const [needle, token] of CSS_VIOLATION_TOKENS) if (violation.includes(needle)) return token
  return 'other'
}

/**
 * A rule the policy drops without blocking is still a rule that does not ship.
 *
 * `empty-rule` is the one exception, and the only one: a rule with no
 * declarations contributes nothing to the page, so losing it loses nothing.
 * Everything else — a dropped `@keyframes`, a rule the scoper could not confine
 * — changes what the section looks like, and a section that silently loses its
 * layout is the failure this importer is supposed to refuse rather than count.
 */
function cssReasons(css: string, scope: string | null): Reason[] {
  if (scope === null) return [reason('css-rejected', 'the definition id is not a usable section scope')]
  const scoped = scopeCss(css, scope)
  if (scoped.blocking.length > 0) {
    const tokens = [...new Set(scoped.blocking.map(cssViolationToken))].sort()
    return [reason('css-rejected', tokens.join(' '))]
  }
  const dropped = [...new Set(scoped.violations.map(cssViolationToken))].filter(token => token !== 'empty-rule').sort()
  if (dropped.length > 0) return [reason('css-policy-dropped', dropped.join(' '))]

  // The compiled artifact, checked by the validator a stored row goes through.
  // scopeCss producing it is not the same statement as validateCompiledCss
  // accepting it, and the second one is what the renderer actually runs.
  const invalid = validateCompiledCss(scoped.css, scope)
  if (invalid.length > 0) return [reason('css-rejected', `compiled: ${invalid.length}`)]
  return []
}
