// Whether an imported definition renders the page V1 rendered.
//
// Everything else in this package answers a question about *shape*: does the
// document parse, does the schema accept it, does the stylesheet survive the CSS
// policy, does the renderer emit markup rather than null. Those are all
// necessary and none of them is the claim anybody actually cares about, which is
// that a visitor cannot tell the two pages apart. A definition can pass every
// check in `catalogue.test.ts` and still have lost a line break, an emphasis, a
// class token or an image's reserved box — and the reports would say `automatic`
// the whole way down. This module is the missing evidence.
//
// WHAT "WHAT V1 WOULD RENDER" MEANS HERE, EXACTLY
//
// V1 renders a section by stamping the definition's template markup into a mount
// and then applying (a) the instance's saved content over the editable regions
// and (b) the instance's settings over the root element. With no saved content
// and no settings — a section as the library hands it to you — both passes are
// no-ops: every settings branch clears rather than sets, and a region with no
// stored value keeps the markup the template shipped. So V1's rendering of a
// *definition* is the template markup itself, and obtaining it requires reading
// a file rather than running V1's renderer.
//
// That is a claim with edges, and the edges are the point:
//
//   • It holds only for default settings. A section carrying
//     `settings.interaction.preset` has V1's own JavaScript stamp `.fx-*`
//     classes onto every `.cms-cta` descendant at render time, and those classes
//     are defined in a page-level stylesheet this repository does not carry.
//     `presetStylesheetHooks` finds the markup that can be affected, and a
//     definition that has any is not verifiable this way.
//   • It holds only while V1's two page-level stylesheets are inert. Both are
//     injected on every V1 page: INTERACTION_PRESET_CSS, whose rules are all
//     rooted at `.fx-*`, `.cms-form-action`, `.cms-arrow` or `details.fx-acc`,
//     and the mobile-density sheet, which is rooted at `[data-mobile-density]`.
//     Inert is a measurement rather than a reading of the source, and the
//     Playwright spec measures it in Chromium by rendering with the sheet and
//     without it and comparing computed styles.
//
// Where either edge is crossed, the honest answer is "not verifiable", not a
// comparison against a partial render. The inventory counts 62 definitions
// depending on that stylesheet, and reporting them green would be worse than
// reporting nothing at all.
//
// WHAT IS NORMALIZED, AND WHAT IS REFUSED
//
// Normalized: whitespace-only text between tags, the order attributes were
// written in, and the quoting around their values. All three are erased by
// parsing, which is why the comparison is over parsed trees rather than over
// strings — there is no regular expression here that could be widened by
// accident into normalizing something that matters.
//
// Refused, permanently: attributes, class tokens, text, links, URLs, image
// dimensions, accessibility content, and DOM structure. Every one of those is
// reported as a difference, and `compareRenderings` has no option that turns any
// of them off. Where a caller genuinely expects a difference — V1's editor
// instrumentation, which V2 re-derives from the field node instead of carrying —
// it says so by asserting the exact residue through `partitionDifferences`,
// which cannot hide anything else in the same bucket.

import { existsSync } from 'node:fs'
import path from 'node:path'
import { attribute, isWhitespace, parseHtml, type HtmlElement, type HtmlNode, type HtmlText } from './html.ts'
import { classesInMarkup } from './presets.ts'
import type { V1Slot } from './source.ts'
import { V1_INPUTS } from './source.ts'

// ----------------------------------------------------------- the V1_ROOT gate

/** What a candidate V1 root turned out to be. */
export type V1RootProbe = 'catalogue' | 'directory-without-catalogue' | 'nothing'

/**
 * Absence, mistake, or catalogue — the same three answers `catalogue.test.ts`
 * routes on, and deliberately the same reasons in the same words.
 *
 * It lives in a module rather than in a test file because two runners need it
 * now: this package's vitest suites and the Playwright spec, and a Playwright
 * spec cannot import a vitest file to reuse a decision. A second copy of the
 * decision written from memory in the spec is exactly how one runner comes to
 * skip while the other fails on the same machine, so there is one function and
 * it is tested here for all three routes.
 */
export type V1Source =
  | { kind: 'run'; why: string; v1Root: string }
  | { kind: 'skip'; why: string }
  | { kind: 'fail'; why: string }

/**
 * The one filesystem question the gate asks, kept apart from the decision it
 * feeds so the decision stays testable on a machine with no V1 checkout — which
 * is every machine but one.
 */
export function probeV1Root(root: string): V1RootProbe {
  // The same generated file the reader opens first, named from `V1_INPUTS` so
  // the gate cannot drift from what `readV1Catalogue` actually needs.
  if (existsSync(path.join(root, V1_INPUTS.sources))) return 'catalogue'
  return existsSync(root) ? 'directory-without-catalogue' : 'nothing'
}

/**
 * No V1_ROOT is a skip, because V1 is licensed source that is not part of this
 * repository and a suite that failed without it would fail everywhere but one
 * laptop. A V1_ROOT that names the wrong place is not absence — somebody set it
 * meaning to run these — so it fails, because a skip is indistinguishable from a
 * pass in a summary line and is how a CI job stays green having tested nothing.
 */
export function decideV1Source(raw: string | undefined, probe: (root: string) => V1RootProbe): V1Source {
  // Trimmed because the value normally arrives from a .env line somebody pasted
  // a path into, and the whitespace around it was never part of the path.
  const given = (raw ?? '').trim()
  if (given === '') {
    return {
      kind: 'skip',
      why: 'V1_ROOT names no path, so the licensed V1 checkout these tests read is not on this machine',
    }
  }
  const found = probe(given)
  if (found === 'catalogue') {
    return { kind: 'run', why: `V1_ROOT names a V1 checkout at ${given}`, v1Root: given }
  }
  return {
    kind: 'fail',
    why:
      found === 'nothing'
        ? `V1_ROOT is set to ${given}, and there is nothing at that path`
        : `V1_ROOT is set to ${given}, which exists but holds no ${V1_INPUTS.sources}`,
  }
}

// ------------------------------------------------------- V1's own instrumentation

/**
 * The attributes V1 leaves in its own markup that V2 re-derives rather than
 * carries.
 *
 * They are not decoration a renderer may drop at will. `data-block-id` and
 * `data-editable` are how V1's editor finds a region and how its reader keys
 * stored content to it; V2 carries the same fact in the document — the field
 * node's `field` *is* the block id — and re-derives the marker in preview only,
 * as `data-cms-slot`. `data-cms-section` is V1's identity for one hand-written
 * block inside a static page, which its `render-sections.js` resolves with
 * `querySelector`; V2 has no static page and no swap, and emits an attribute of
 * that exact name itself to carry the section *index* the preview runtime reads
 * — so importing V1's value would answer V2's own query with a page identity.
 * `convert.ts` consumes it for those reasons and ADR 0009 records the evidence.
 *
 * So each difference is real, expected, and one that has to be *stated* rather
 * than normalized: `partitionDifferences` separates exactly these names, and
 * only when they are missing from the V2 side, so one of them carrying a
 * *different* value or appearing out of nowhere still lands in the substantive
 * pile.
 */
export const V1_EDITOR_INSTRUMENTATION: readonly string[] = ['data-block-id', 'data-cms-section', 'data-editable']

// -------------------------------------------------- the definition's own content

export type RegionExtraction = {
  /** Field values, keyed by block id, in the shape the structured renderer takes. */
  values: Record<string, unknown>
  /**
   * Regions whose default content this cannot faithfully turn into a value.
   *
   * A problem here is a reason not to compare rather than a comparison that
   * fails: a text run containing `&amp;` has a text *value* of `&`, and feeding
   * the source spelling to a renderer that escapes it produces `&amp;amp;` and a
   * mismatch that is this extractor's fault rather than the importer's. Refusing
   * is the same posture `html.ts` takes about character references: a
   * half-implemented entity table is a way to be quietly wrong about content
   * this package has no business reproducing.
   */
  problems: string[]
  /**
   * Block ids of `text` regions whose markup holds elements.
   *
   * V1 ships a template whose text region may contain a `<br>` or an `<em>`; a
   * `text` field node holds a string and renders it escaped, so those elements
   * have nowhere to go and no author value can put them back. Named separately
   * because it is the most consequential thing this file finds and a reader
   * should not have to infer it from a list of structural differences.
   */
  markupInsideTextRegions: string[]
}

/** Every editable region in the markup, keyed by its block id. */
function regionsByBlockId(nodes: readonly HtmlNode[], into: Map<string, HtmlElement>): void {
  for (const node of nodes) {
    if (node.kind !== 'element') continue
    const blockId = attribute(node, 'data-block-id')
    if (blockId !== undefined && !into.has(blockId)) into.set(blockId, node)
    regionsByBlockId(node.children, into)
  }
}

/** The text a region holds, as V1's own `element.textContent` would report it. */
function textOf(nodes: readonly HtmlNode[]): string {
  let out = ''
  for (const node of nodes) out += node.kind === 'text' ? node.text : textOf(node.children)
  return out
}

/** Elements a region holds, at any depth, by tag name. */
function tagsIn(nodes: readonly HtmlNode[]): string[] {
  const out: string[] = []
  for (const node of nodes) {
    if (node.kind !== 'element') continue
    out.push(node.tag)
    out.push(...tagsIn(node.children))
  }
  return out
}

/** Void elements, so re-serializing a region's markup does not invent end tags. */
const VOID_TAGS = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'param',
  'source',
  'track',
  'wbr',
])

/** A region's inner markup, as V1's own `element.innerHTML` would report it. */
function innerHtmlOf(nodes: readonly HtmlNode[]): string {
  let out = ''
  for (const node of nodes) {
    if (node.kind === 'text') {
      out += node.text
      continue
    }
    out += `<${node.tag}${node.attributes.map(a => ` ${a.name}="${a.value}"`).join('')}>`
    if (!VOID_TAGS.has(node.tag)) out += `${innerHtmlOf(node.children)}</${node.tag}>`
  }
  return out
}

/**
 * The field values a definition's own template carries.
 *
 * These are the values that make the comparison mean something. Rendering the
 * imported document with invented content would compare V2's chrome against V1's
 * chrome and say nothing about the regions, which is where a conversion loses
 * things; rendering it with V1's own default content asks the only question
 * worth asking — put this definition on a page exactly as the library hands it
 * over, and does it look like the one V1 puts there?
 *
 * The four mappings mirror V1's `applyBlockToElement` rather than being invented
 * here: a text block is `textContent`, a richtext block is `innerHTML`, a link
 * block is an `href` and its text, and an image block is a `src` and an `alt`.
 */
export function v1DefaultValues(html: string, slots: readonly V1Slot[]): RegionExtraction {
  const parsed = parseHtml(html)
  if (!parsed.ok) {
    return { values: {}, problems: [`the markup could not be read: ${parsed.refusal}`], markupInsideTextRegions: [] }
  }

  const regions = new Map<string, HtmlElement>()
  regionsByBlockId(parsed.nodes, regions)

  const values: Record<string, unknown> = {}
  const problems: string[] = []
  const markupInsideTextRegions: string[] = []

  for (const slot of slots) {
    const region = regions.get(slot.blockId)
    if (region === undefined) {
      problems.push(`${slot.blockId} is declared as a slot and has no region in the markup`)
      continue
    }
    const text = textOf(region.children)
    // Deliberately any `&`, not a guess at which ones are references. An
    // ampersand that starts nothing still round-trips through an escaper into a
    // spelling the source did not use, and either way the two sides stop being
    // comparable for a reason that is about this extractor.
    if (text.includes('&') || innerHtmlOf(region.children).includes('&')) {
      problems.push(`${slot.blockId} holds a character reference this extractor does not decode`)
      continue
    }

    switch (slot.editable) {
      case 'text': {
        const tags = tagsIn(region.children)
        if (tags.length > 0) markupInsideTextRegions.push(`${slot.blockId}: ${[...new Set(tags)].sort().join(' ')}`)
        values[slot.blockId] = text
        break
      }
      case 'richtext':
        values[slot.blockId] = innerHtmlOf(region.children)
        break
      case 'link':
        values[slot.blockId] = { url: attribute(region, 'href') ?? '', label: text }
        break
      case 'image': {
        const alt = attribute(region, 'alt') ?? ''
        // `decorative` has to be stated rather than inferred from an empty alt,
        // because that is the contract the structured renderer holds authors to
        // — an image with neither an alt nor a declaration renders nothing. An
        // empty alt in V1's markup *is* the declaration, made in V1's spelling.
        values[slot.blockId] =
          alt === ''
            ? { src: attribute(region, 'src') ?? '', alt: '', decorative: true }
            : { src: attribute(region, 'src') ?? '', alt }
        break
      }
      default:
        problems.push(`${slot.blockId} is a ${slot.editable} region, which has no structured field type`)
    }
  }

  return { values, problems, markupInsideTextRegions }
}

// ------------------------------------------------------------ the comparison

type ParityDifferenceKind =
  | 'unreadable'
  | 'child-count'
  | 'node-kind'
  | 'tag'
  | 'text'
  | 'attribute-only-in-v1'
  | 'attribute-only-in-v2'
  | 'attribute-value'
  | 'class-tokens'
  | 'class-order'

export type ParityDifference = {
  /** Where in the tree, as a path of tags and 1-based positions. */
  path: string
  kind: ParityDifferenceKind
  /** The attribute or class the difference is about, when it is about one. */
  name?: string
  /** What differs, in structural terms. Never a page's copy — see below. */
  detail: string
}

/**
 * Attributes whose value is a closed vocabulary or a number, and may therefore
 * be quoted into a difference.
 *
 * The rest — `href`, `src`, `alt`, `title`, `id` — hold a URL or a sentence
 * somebody wrote, and this repository's standing rule is that V1's copy does not
 * leave the machine it is being measured on. So those differences carry lengths
 * and the offset where the two first diverge, which is what a person debugging
 * actually needs, and the value stays where it was.
 */
const CLOSED_VOCABULARY = new Set([
  'aria-hidden',
  'decoding',
  'dir',
  'draggable',
  'fetchpriority',
  'height',
  'hidden',
  'loading',
  'rel',
  'role',
  'target',
  'translate',
  'width',
])

/** How two values differ, said without reproducing either of them. */
function valueDifference(name: string, v1: string, v2: string): string {
  if (CLOSED_VOCABULARY.has(name)) return `V1 has ${JSON.stringify(v1)}, V2 has ${JSON.stringify(v2)}`
  let at = 0
  while (at < v1.length && at < v2.length && v1[at] === v2[at]) at += 1
  return `V1 has ${v1.length} characters, V2 has ${v2.length}, first differing at ${at}`
}

/**
 * The children that take part in a comparison: everything except the whitespace
 * between tags.
 *
 * This is the whole of the normalization, and it is deliberately the only place
 * a node can be dropped. `isWhitespace` is the importer's own predicate, the
 * same one the converter uses to decide what it may leave out of a document, so
 * the comparison and the conversion cannot disagree about what "whitespace
 * between tags" means.
 */
function comparable(nodes: readonly HtmlNode[]): HtmlNode[] {
  return nodes.filter(node => !(node.kind === 'text' && isWhitespace(node.text)))
}

export type ComparisonTree = { ok: true; nodes: HtmlNode[] } | { ok: false; refusal: string }

/**
 * One side of the comparison, read by the importer's own strict parser.
 *
 * Strict on purpose. A browser parser recovers from anything, which means two
 * different documents can produce the same tree and a comparison over them would
 * report equality it did not establish. This reader refuses what it does not
 * fully understand, so an unreadable rendering is a finding rather than a silent
 * pass.
 */
export function comparisonTree(html: string): ComparisonTree {
  const parsed = parseHtml(html)
  return parsed.ok ? { ok: true, nodes: comparable(parsed.nodes) } : { ok: false, refusal: parsed.refusal }
}

/**
 * Everything by which two renderings of the same definition differ.
 *
 * There is no option to ignore a category, and there will not be one. A caller
 * that expects a particular difference states it — see `partitionDifferences` —
 * and any *other* difference of the same kind is still in the list, which is the
 * property an ignore-list cannot have.
 */
export function compareRenderings(v1Html: string, v2Html: string): ParityDifference[] {
  const v1 = comparisonTree(v1Html)
  const v2 = comparisonTree(v2Html)
  const differences: ParityDifference[] = []
  if (!v1.ok) differences.push({ path: '/', kind: 'unreadable', detail: `V1's rendering: ${v1.refusal}` })
  if (!v2.ok) differences.push({ path: '/', kind: 'unreadable', detail: `V2's rendering: ${v2.refusal}` })
  if (!v1.ok || !v2.ok) return differences

  compareNodeLists(v1.nodes, v2.nodes, '', differences)
  return differences
}

function compareNodeLists(
  v1: readonly HtmlNode[],
  v2: readonly HtmlNode[],
  path: string,
  into: ParityDifference[],
): void {
  if (v1.length !== v2.length) {
    into.push({
      path: path === '' ? '/' : path,
      kind: 'child-count',
      detail: `V1 has ${v1.length} child nodes (${describe(v1)}), V2 has ${v2.length} (${describe(v2)})`,
    })
  }
  // Compared pairwise as far as both go rather than abandoned at the first
  // length mismatch: a definition that dropped one element usually dropped it in
  // one place, and the differences below it are the ones somebody has to fix.
  const shared = Math.min(v1.length, v2.length)
  for (let index = 0; index < shared; index += 1) {
    compareNode(v1[index]!, v2[index]!, path, index + 1, into)
  }
}

/** A child list, as tag names, so a count difference says what went missing. */
function describe(nodes: readonly HtmlNode[]): string {
  return nodes.map(node => (node.kind === 'text' ? '#text' : `<${node.tag}>`)).join(' ') || 'nothing'
}

function compareNode(v1: HtmlNode, v2: HtmlNode, parentPath: string, position: number, into: ParityDifference[]): void {
  const here = `${parentPath}/${v1.kind === 'text' ? '#text' : v1.tag}[${position}]`
  if (v1.kind !== v2.kind) {
    into.push({
      path: here,
      kind: 'node-kind',
      detail: `V1 has ${v1.kind === 'text' ? 'text' : `<${v1.tag}>`}, V2 has ${v2.kind === 'text' ? 'text' : `<${v2.tag}>`}`,
    })
    return
  }
  // The two casts below hold because a kind mismatch returned above. They are
  // written by hand because the equality that makes them true is a statement
  // away and the compiler does not carry it across the branch.
  if (v1.kind === 'text') {
    const otherText = (v2 as HtmlText).text
    if (v1.text !== otherText) {
      into.push({ path: here, kind: 'text', detail: valueDifference('#text', v1.text, otherText) })
    }
    return
  }
  const other = v2 as HtmlElement
  if (v1.tag !== other.tag) {
    into.push({ path: here, kind: 'tag', detail: `V1 has <${v1.tag}>, V2 has <${other.tag}>` })
    return
  }

  compareAttributes(v1, other, here, into)
  compareNodeLists(comparable(v1.children), comparable(other.children), here, into)
}

function compareAttributes(v1: HtmlElement, v2: HtmlElement, path: string, into: ParityDifference[]): void {
  const left = new Map(v1.attributes.map(a => [a.name, a.value]))
  const right = new Map(v2.attributes.map(a => [a.name, a.value]))
  // Sorted so the difference list is the same on two runs over the same input.
  // Attribute order in the source is an author's typing and is exactly one of
  // the three things this comparison is allowed to be blind to.
  for (const name of [...new Set([...left.keys(), ...right.keys()])].sort()) {
    const before = left.get(name)
    const after = right.get(name)
    if (before !== undefined && after === undefined) {
      into.push({
        path,
        kind: 'attribute-only-in-v1',
        name,
        detail: `V1's <${v1.tag}> carries ${name} and V2's does not`,
      })
      continue
    }
    if (before === undefined && after !== undefined) {
      into.push({
        path,
        kind: 'attribute-only-in-v2',
        name,
        detail: `V2's <${v2.tag}> carries ${name} and V1's does not`,
      })
      continue
    }
    if (before === after) continue
    if (name === 'class') {
      compareClasses(before!, after!, path, into)
      continue
    }
    into.push({ path, kind: 'attribute-value', name, detail: valueDifference(name, before!, after!) })
  }
}

/**
 * Class lists, as tokens rather than as a string.
 *
 * Two differences, kept apart because they are not the same finding. A token
 * present on one side and not the other changes which selectors match, which is
 * the failure ADR 0007 exists to prevent. A different *order* of the same tokens
 * changes nothing about matching, but it is still a difference between the two
 * renderings and is reported as one — the caller decides what to do about it,
 * and nothing here decides on its behalf that it does not matter.
 */
function compareClasses(v1: string, v2: string, path: string, into: ParityDifference[]): void {
  const left = classesInMarkup([v1])
  const right = classesInMarkup([v2])
  const onlyV1 = left.filter(token => !right.includes(token))
  const onlyV2 = right.filter(token => !left.includes(token))
  if (onlyV1.length > 0 || onlyV2.length > 0) {
    into.push({
      path,
      kind: 'class-tokens',
      name: 'class',
      detail: `only in V1: ${onlyV1.join(' ') || 'none'}; only in V2: ${onlyV2.join(' ') || 'none'}`,
    })
    return
  }
  into.push({
    path,
    kind: 'class-order',
    name: 'class',
    detail: `the same tokens in a different order: V1 ${left.join(' ')}, V2 ${right.join(' ')}`,
  })
}

/**
 * The differences a caller expects, separated from the ones it does not.
 *
 * `instrumentation` holds only the case described on `V1_EDITOR_INSTRUMENTATION`:
 * one of those two attribute names, present in V1's rendering and absent from
 * V2's. Everything else — including one of those names carrying a *different
 * value*, or appearing on V2's side where V1 has none — is substantive, because
 * each of those would be a different fact about the conversion than "V2 re-derives
 * this marker instead of storing it".
 */
export function partitionDifferences(differences: readonly ParityDifference[]): {
  instrumentation: ParityDifference[]
  substantive: ParityDifference[]
} {
  const instrumentation: ParityDifference[] = []
  const substantive: ParityDifference[] = []
  for (const difference of differences) {
    const isInstrumentation =
      difference.kind === 'attribute-only-in-v1' &&
      difference.name !== undefined &&
      V1_EDITOR_INSTRUMENTATION.includes(difference.name)
    ;(isInstrumentation ? instrumentation : substantive).push(difference)
  }
  return { instrumentation, substantive }
}

/** A difference list as lines somebody can read in a failure. */
export function describeDifferences(differences: readonly ParityDifference[]): string {
  return differences.map(d => `${d.path} ${d.kind}${d.name === undefined ? '' : ` ${d.name}`}: ${d.detail}`).join('\n')
}

// ------------------------------------------------- what V1's page still supplies

/**
 * The hooks in this markup that V1's page-level stylesheets and V1's own
 * JavaScript reach for.
 *
 * A definition with none of these renders under its own stylesheet alone, and a
 * comparison that gives V2 the compiled version of that same stylesheet is
 * therefore comparing like with like. A definition with any of them does not:
 * part of what a visitor sees comes from a sheet V1 injects once per page and
 * this repository has never carried, so a browser comparison would be measuring
 * a partial render and calling the difference parity.
 *
 * `presetClasses` is passed in — it is read off V1's own stylesheet by
 * `readV1Catalogue` — so this cannot drift from the sheet it is about. The two
 * additions are the ones that are not class-shaped: `.cms-arrow::after` draws a
 * CTA's trailing arrow as generated content, and `[data-mobile-density]` is the
 * hook for the second injected sheet.
 */
export function presetStylesheetHooks(html: string, presetClasses: readonly string[]): string[] {
  const parsed = parseHtml(html)
  if (!parsed.ok) return []
  const found = new Set<string>()
  const walk = (nodes: readonly HtmlNode[]): void => {
    for (const node of nodes) {
      if (node.kind !== 'element') continue
      for (const token of classesInMarkup([attribute(node, 'class') ?? ''])) {
        if (presetClasses.includes(token) || token === 'cms-arrow') found.add(`class ${token}`)
      }
      if (attribute(node, 'data-mobile-density') !== undefined) found.add('attribute data-mobile-density')
      walk(node.children)
    }
  }
  walk(parsed.nodes)
  return [...found].sort()
}
