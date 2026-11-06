import { decodeHTML } from 'entities'

export const decodeSourceText = (value: string): string => decodeHTML(value)

// A strict HTML reader, for reading someone else's markup exactly once.
//
// This is not a browser parser and must not become one. A browser's algorithm is
// specified to recover from anything — an unclosed `<p>`, a `</div>` with no
// opening, a `<td>` outside a table — because a browser's job is to show
// *something*. An importer's job is the opposite: the tree it produces becomes a
// stored definition that nobody will ever diff against the original again, so a
// tree assembled by recovery rules is a definition nobody authored and nobody
// reviewed.
//
// So every construct this file does not fully understand is a refusal, and the
// refusal names what it saw. That includes constructs a browser handles
// perfectly well — implied end tags, unquoted attribute values, raw-text
// elements — because "a browser would cope" is not the standard. The standard is
// that the tree and the source say the same thing.
//
// Text is kept only so the caller can ask whether there is any outside an
// editable region. Character references are deliberately *not* resolved: nothing
// downstream renders this text, the whitespace question is unaffected by
// resolving them, and a half-implemented entity table is a way to be wrong about
// content this package has no business reproducing anyway.

export type SourceRange = { start: number; end: number }
export type HtmlAttribute = { name: string; value: string; valueRange?: SourceRange }

export type HtmlElement = {
  kind: 'element'
  source?: SourceRange & { openEnd: number; closeStart: number }
  tag: string
  attributes: HtmlAttribute[]
  children: HtmlNode[]
  /** 1-based, within the html string as given. For provenance, not for logic. */
  line: number
}

export type HtmlText = { kind: 'text'; text: string; line: number; source?: SourceRange }

export type HtmlNode = HtmlElement | HtmlText

export type HtmlParse = { ok: true; nodes: HtmlNode[] } | { ok: false; refusal: string }

/**
 * Elements with no end tag in HTML.
 *
 * The full void set, not the subset this catalogue happens to use, because the
 * consequence of getting it wrong is silent: treat `<source>` as a container and
 * everything after it nests inside it, producing a tree that parses and is
 * shaped nothing like the page.
 */
const VOID_ELEMENTS = new Set([
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

/**
 * Elements whose content is executable or is a stylesheet.
 *
 * Refused at the reader, before anything looks at the body. A definition
 * carrying one is not importable under any mapping, and the right place to stop
 * is the place where the bytes would otherwise be read.
 */
const ACTIVE_TEXT_ELEMENTS = new Set(['script', 'style'])

/**
 * Elements whose content is literal text rather than markup.
 *
 * The body is skipped rather than parsed — `<textarea>` may legally contain a
 * `<` — and the element is kept with no children, so the *converter* gets to
 * refuse it for what it is. Refusing it here instead reported `<textarea>` as a
 * parse failure, which is true of nothing: the markup is well formed, and the
 * reason the definition cannot be imported is that it is a form control.
 */
const LITERAL_TEXT_ELEMENTS = new Set(['textarea', 'title'])

/**
 * Elements whose subtree is not HTML.
 *
 * Inside one of these, `<path />` really does close itself — foreign content is
 * XML, where the self-closing slash is the syntax rather than a habit carried
 * over from XHTML. Refusing it here as "written as self-closing but not a void
 * element" was wrong about 44 of the 118 definitions, and wrong in the most
 * expensive way available: it reported a parse failure for markup that is
 * perfectly well formed, hiding the real reason those definitions cannot be
 * imported, which is that they contain inline SVG at all.
 */
const FOREIGN_CONTENT_ELEMENTS = new Set(['svg', 'math'])

/** A tag name: a letter, then letters, digits or dashes. */
const TAG_NAME = /^[a-zA-Z][a-zA-Z0-9-]*$/

/**
 * Parse a fragment, or say what stopped it.
 *
 * The result is a forest rather than a single root, because a V1 template is a
 * fragment and several of them are two sibling `<section>` elements.
 */
export function parseHtml(html: string, options: { locations?: boolean; styles?: boolean } = {}): HtmlParse {
  const root: HtmlNode[] = []
  const stack: HtmlElement[] = []
  const children = (): HtmlNode[] => (stack.length === 0 ? root : stack[stack.length - 1]!.children)

  let index = 0
  // How deep inside an <svg> or <math> subtree the reader currently is, because
  // the self-closing slash means something there and nothing outside.
  let foreignDepth = 0
  // Tracked incrementally rather than recomputed by counting newlines in a
  // slice, which turned an O(n) parse into an O(n²) one on the largest
  // definition in the catalogue.
  let line = 1
  const advance = (to: number): void => {
    for (let i = index; i < to; i += 1) if (html[i] === '\n') line += 1
    index = to
  }

  while (index < html.length) {
    const next = html.indexOf('<', index)
    if (next === -1) {
      pushText(children(), html.slice(index), line, options.locations ? { start: index, end: html.length } : undefined)
      break
    }
    if (next > index) {
      const startLine = line
      const text = html.slice(index, next)
      advance(next)
      pushText(children(), text, startLine, options.locations ? { start: next - text.length, end: next } : undefined)
    }

    if (html.startsWith('<!--', index)) {
      const end = html.indexOf('-->', index + 4)
      // An unterminated comment swallows the rest of the document in a browser
      // and would swallow the rest of the definition here. There is no honest
      // reading of where the author meant it to stop.
      if (end === -1) return { ok: false, refusal: 'an HTML comment is never closed' }
      // Dropped, not kept. A comment renders nothing, so losing it loses nothing
      // from the page — the only construct in this file that is true of.
      advance(end + 3)
      continue
    }
    if (html.startsWith('<!', index)) {
      return { ok: false, refusal: 'a doctype or markup declaration is not importable' }
    }
    if (html.startsWith('<?', index)) {
      return { ok: false, refusal: 'a processing instruction is not importable' }
    }

    if (html.startsWith('</', index)) {
      const close = html.indexOf('>', index)
      if (close === -1) return { ok: false, refusal: 'an end tag is never closed' }
      const name = html
        .slice(index + 2, close)
        .trim()
        .toLowerCase()
      const open = stack[stack.length - 1]
      // Strict pairing. A browser would pop until it found a match, or ignore
      // the tag entirely; both rebuild the tree around a mistake, and the
      // rebuilt tree is what would get stored.
      if (open === undefined) return { ok: false, refusal: `</${name}> closes an element that was never opened` }
      if (open.tag !== name) return { ok: false, refusal: `</${name}> closes an element opened as <${open.tag}>` }
      if (open.source) {
        open.source.closeStart = index
        open.source.end = close + 1
      }
      stack.pop()
      if (foreignDepth > 0) foreignDepth -= 1
      advance(close + 1)
      continue
    }

    const elementStart = index
    const tag = readStartTag(html, index, options.locations)
    if (!tag.ok) return { ok: false, refusal: tag.refusal }
    const startLine = line
    advance(tag.end)

    if (ACTIVE_TEXT_ELEMENTS.has(tag.name) && !(options.styles && tag.name === 'style')) {
      return { ok: false, refusal: `<${tag.name}> holds content that is not markup` }
    }

    const element: HtmlElement = {
      kind: 'element',
      tag: tag.name,
      attributes: tag.attributes,
      children: [],
      line: startLine,
      ...(options.locations
        ? { source: { start: elementStart, openEnd: tag.end, closeStart: tag.end, end: tag.end } }
        : {}),
    }
    children().push(element)

    if (options.styles && tag.name === 'style') {
      const closeMatch = /<\/style\s*>/gi
      closeMatch.lastIndex = index
      const match = closeMatch.exec(html)
      if (!match) return { ok: false, refusal: '<style> is never closed' }
      pushText(
        element.children,
        html.slice(index, match.index),
        line,
        options.locations ? { start: index, end: match.index } : undefined,
      )
      if (element.source) {
        element.source.closeStart = match.index
        element.source.end = closeMatch.lastIndex
      }
      advance(closeMatch.lastIndex)
      continue
    }
    if (LITERAL_TEXT_ELEMENTS.has(tag.name)) {
      const end = html.toLowerCase().indexOf(`</${tag.name}`, index)
      if (end === -1) return { ok: false, refusal: `<${tag.name}> is never closed` }
      const close = html.indexOf('>', end)
      if (close === -1) return { ok: false, refusal: `</${tag.name}> is never closed` }
      advance(close + 1)
      continue
    }

    // A void element is never pushed, with or without the XHTML slash, so a
    // stray `</br>` later falls out of the pairing check above as an end tag
    // for something that was never opened — which is what it is.
    if (VOID_ELEMENTS.has(tag.name)) continue
    const isForeign = foreignDepth > 0 || FOREIGN_CONTENT_ELEMENTS.has(tag.name)
    if (tag.selfClosing) {
      // Inside SVG or MathML the slash is the syntax and the element is closed.
      // Outside it, `<div/>` opens a div in every browser, so honouring the
      // slash would build a tree the page does not have.
      if (isForeign) continue
      return { ok: false, refusal: `<${tag.name}/> is written as self-closing but ${tag.name} is not a void element` }
    }
    if (isForeign) foreignDepth += 1
    stack.push(element)
  }

  if (stack.length > 0) {
    return { ok: false, refusal: `<${stack[stack.length - 1]!.tag}> is never closed` }
  }
  return { ok: true, nodes: root }
}

function pushText(into: HtmlNode[], text: string, line: number, source?: SourceRange): void {
  if (text === '') return
  into.push({ kind: 'text', text, line, ...(source ? { source } : {}) })
}

type StartTag =
  | { ok: true; name: string; attributes: HtmlAttribute[]; selfClosing: boolean; end: number }
  | { ok: false; refusal: string }

function readStartTag(html: string, start: number, locations = false): StartTag {
  let i = start + 1
  const nameStart = i
  while (i < html.length && /[a-zA-Z0-9-]/.test(html[i]!)) i += 1
  const name = html.slice(nameStart, i).toLowerCase()
  if (!TAG_NAME.test(name)) return { ok: false, refusal: 'a "<" appears where no tag follows it' }

  const attributes: HtmlAttribute[] = []
  const seen = new Set<string>()

  for (;;) {
    while (i < html.length && /\s/.test(html[i]!)) i += 1
    if (i >= html.length) return { ok: false, refusal: `<${name}> is never closed` }

    if (html[i] === '>') return { ok: true, name, attributes, selfClosing: false, end: i + 1 }
    if (html[i] === '/' && html[i + 1] === '>') {
      return { ok: true, name, attributes, selfClosing: true, end: i + 2 }
    }

    const attrStart = i
    while (i < html.length && !/[\s/>=]/.test(html[i]!)) i += 1
    const attrName = html.slice(attrStart, i).toLowerCase()
    if (attrName === '') return { ok: false, refusal: `<${name}> has an attribute with no name` }
    // A repeated attribute has two values and one meaning, and which one a
    // browser keeps is a rule nobody importing markup should have to know.
    if (seen.has(attrName)) return { ok: false, refusal: `<${name}> carries ${attrName} twice` }
    seen.add(attrName)

    while (i < html.length && /\s/.test(html[i]!)) i += 1
    if (html[i] !== '=') {
      // A bare attribute — `hidden`, `disabled`. Legal HTML, and none of the
      // structured attributes are boolean, so it can only be something this
      // importer would have to drop.
      attributes.push({ name: attrName, value: '' })
      continue
    }
    i += 1
    while (i < html.length && /\s/.test(html[i]!)) i += 1

    const quote = html[i]
    if (quote !== '"' && quote !== "'") {
      // Unquoted values end at whitespace, which makes "where does this value
      // end" a question about characters the author did not choose. The
      // renderer's own compiler learned this the hard way; this one simply
      // refuses.
      return { ok: false, refusal: `<${name}> has an unquoted value for ${attrName}` }
    }
    const close = html.indexOf(quote, i + 1)
    if (close === -1) return { ok: false, refusal: `<${name}> has an unterminated value for ${attrName}` }
    attributes.push({
      name: attrName,
      value: html.slice(i + 1, close),
      ...(locations ? { valueRange: { start: i + 1, end: close } } : {}),
    })
    i = close + 1
  }
}

/** Is this text node nothing but whitespace — that is, layout rather than copy? */
export function isWhitespace(text: string): boolean {
  return text.trim() === ''
}

/** One attribute's value, or undefined. Attribute names are already lowercased. */
export function attribute(element: HtmlElement, name: string): string | undefined {
  return element.attributes.find(a => a.name === name)?.value
}

/** Every element in the tree, in document order, without recursing. */
export function elements(nodes: readonly HtmlNode[]): HtmlElement[] {
  const out: HtmlElement[] = []
  const stack: HtmlNode[] = [...nodes].reverse()
  while (stack.length > 0) {
    const node = stack.pop()!
    if (node.kind !== 'element') continue
    out.push(node)
    for (let i = node.children.length - 1; i >= 0; i -= 1) stack.push(node.children[i]!)
  }
  return out
}

/**
 * How deeply this forest nests, counting an outermost element as 1.
 *
 * Iterative, and asked before anything recurses over the same tree. The
 * converter's walk is recursive because a tree walk reads better that way, and
 * the corpus it was written for nests nine levels — but "the input is fine" is
 * not a property of a reader, and a definition that nested a thousand levels
 * would take the importer down instead of being quarantined by it.
 */
export function depthOf(nodes: readonly HtmlNode[]): number {
  let deepest = 0
  const stack: { node: HtmlNode; depth: number }[] = nodes.map(node => ({ node, depth: 1 }))
  while (stack.length > 0) {
    const { node, depth } = stack.pop()!
    if (depth > deepest) deepest = depth
    if (node.kind !== 'element') continue
    for (const child of node.children) stack.push({ node: child, depth: depth + 1 })
  }
  return deepest
}
