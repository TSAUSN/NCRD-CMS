// Group source-authored prose only when the existing rich-text policy can
// represent its complete tree. Styling, accessibility attributes, authoring
// boundaries and special link behavior stay in the definition instead of
// disappearing into a sanitizer. This is a mapping test, not a second policy.
import { decodeHTML, decodeHTMLAttribute } from 'entities'
import {
  applyRichTextBlockAttributes,
  applyRichTextInlineAttributes,
  richTextBlockAttributes,
  richTextInlineAttributes,
  sanitizeRichText,
  type RichTextBlockAttributes,
  type RichTextInlineAttributes,
} from '@cms/renderer'
import { attribute, parseHtml, type HtmlElement, type HtmlNode } from './html.ts'
import { serializeLegacy } from './legacy-values.ts'

// The current visual editor emits block content. Never newly put that editor
// inside a heading, paragraph, anchor or span: an edit would produce invalid
// nesting (and browsers would repair the surrounding source layout).
const FLOW_CONTAINERS = new Set([
  'div',
  'section',
  'article',
  'aside',
  'main',
  'header',
  'footer',
  'nav',
  'blockquote',
  'li',
  'dd',
  'td',
  'th',
  'figure',
  'figcaption',
  'details',
])
const BLOCKS = new Set(['p', 'h2', 'h3', 'h4', 'ul', 'ol', 'blockquote'])

export function acceptsRichTextBlocks(tag: string): boolean {
  return FLOW_CONTAINERS.has(tag)
}

export function isRichTextBlock(node: HtmlNode): boolean {
  return node.kind === 'element' && BLOCKS.has(node.tag)
}

/** A whitespace-only source separator, including character references. */
export function isRichTextSeparator(node: HtmlNode): boolean {
  // NBSP is meaningful source spacing, even though JavaScript trim removes it.
  return node.kind === 'text' && /^[\t\n\f\r ]*$/.test(decodeHTML(node.text))
}

export type CohesiveRichText = {
  value: string
  linkPolicyApplied: boolean
  blockAttributes?: RichTextBlockAttributes
  inlineAttributes?: RichTextInlineAttributes
  /** Words and marks only, for a field inside a paragraph or heading. */
  inline?: true
}

// Body copy only. A styled heading or eyebrow is a distinct labelled element
// that a rich-text field would let an editor demote or delete, so it stays its
// own field in the definition's markup.
const PRESENTED_BLOCKS = new Set(['p', 'ul', 'ol'])

/**
 * The classes and inline style the source put on its body-copy blocks
 * (top-level paragraphs and lists, and the items of top-level lists), taken
 * from the first of each tag. It is only a candidate: the complete comparison
 * below accepts it only when every block of that tag carries exactly the same
 * presentation and the renderer's policy emits it unchanged.
 */
function sourceBlockAttributes(nodes: HtmlNode[]): RichTextBlockAttributes {
  const found: Record<string, { class?: string; style?: string }> = {}
  const take = (node: HtmlElement) => {
    if (node.tag in found) return
    const presentation: { class?: string; style?: string } = {}
    const className = attribute(node, 'class'),
      style = attribute(node, 'style')
    if (className !== undefined) presentation.class = decodeHTMLAttribute(className)
    if (style !== undefined) presentation.style = decodeHTMLAttribute(style)
    found[node.tag] = presentation
  }
  for (const node of nodes) {
    if (node.kind !== 'element' || !PRESENTED_BLOCKS.has(node.tag)) continue
    take(node)
    if (node.tag === 'ul' || node.tag === 'ol') {
      for (const item of node.children) if (item.kind === 'element' && item.tag === 'li') take(item)
    }
  }
  return richTextBlockAttributes(found)
}

const MARKS = new Set(['em', 'i', 'strong', 'b'])

/** The classes and style the source put on its emphasis and bold marks, at
 * any depth, from the first of each tag. Like the block candidate, it is
 * accepted only when the whole rendered tree then equals the source. */
function sourceInlineAttributes(nodes: HtmlNode[]): RichTextInlineAttributes {
  const found: Record<string, { class?: string; style?: string }> = {}
  const visit = (list: HtmlNode[]) => {
    for (const node of list) {
      if (node.kind !== 'element') continue
      if (MARKS.has(node.tag) && !(node.tag in found)) {
        const presentation: { class?: string; style?: string } = {}
        const className = attribute(node, 'class'),
          style = attribute(node, 'style')
        if (className !== undefined) presentation.class = decodeHTMLAttribute(className)
        if (style !== undefined) presentation.style = decodeHTMLAttribute(style)
        found[node.tag] = presentation
      }
      visit(node.children)
    }
  }
  visit(nodes)
  return richTextInlineAttributes(found)
}

/** Words, line breaks and emphasis/bold marks only: what V1 edits as one
 * `data-editable="text"` region inside a paragraph or heading. At least one
 * break or mark, or a plain text field already holds it. */
export function isInlineRun(nodes: HtmlNode[]): boolean {
  const inline = (list: HtmlNode[]): boolean =>
    list.every(
      node =>
        node.kind === 'text' ||
        (node.kind === 'element' &&
          (node.tag === 'br'
            ? node.attributes.length === 0 && node.children.length === 0
            : MARKS.has(node.tag) && inline(node.children))),
    )
  return nodes.some(node => node.kind === 'element') && inline(nodes)
}

/**
 * Uniform block presentation (every paragraph with the same classes and style,
 * say) is carried by the field's definition rather than dropped, so styled
 * source paragraphs can still be one field. The only permitted semantic
 * difference is adding the renderer's default
 * link relationship to an anchor that had no relationship. Existing target,
 * rel, download, class, style, title, language and CMS label/field attributes
 * cannot be dropped. Entity spelling and attribute ordering are not changes
 * to the authored content. Every other difference returns to static mapping.
 */
export function cohesiveRichText(
  nodes: HtmlNode[],
  options: { candidate?: boolean; inline?: boolean } = {},
): CohesiveRichText | null {
  const value = sanitizeRichText(serializeLegacy(nodes), { inline: options.inline === true })
  const blockAttributes = options.inline ? {} : sourceBlockAttributes(nodes)
  const inlineAttributes = sourceInlineAttributes(nodes)
  // One styled paragraph of plain text gains nothing from becoming rich text:
  // its existing text field already keeps it exactly. Presentation is for
  // joining several styled blocks, or one whose inline formatting would
  // otherwise split it into fragments. A run is still built from such
  // candidates one at a time, so they are only judged as a whole.
  const blocks = nodes.filter((node): node is HtmlElement => node.kind === 'element')
  if (
    !options.candidate &&
    Object.keys(blockAttributes).length &&
    blocks.length === 1 &&
    blocks[0]!.children.every(child => child.kind === 'text')
  )
    return null
  const parsed = parseHtml(
    applyRichTextInlineAttributes(applyRichTextBlockAttributes(value, blockAttributes), inlineAttributes),
  )
  if (!parsed.ok) return null
  let linkPolicyApplied = false
  const attributesMatch = (source: HtmlElement, rendered: HtmlElement) => {
    // An anchor without a destination is not a link the visual editor can
    // preserve. Keep its authored element in the definition instead.
    if (source.tag === 'a' && attribute(source, 'href') === undefined) return false
    const original = new Map(source.attributes.map(attr => [attr.name, decodeHTMLAttribute(attr.value)]))
    const output = new Map(rendered.attributes.map(attr => [attr.name, decodeHTMLAttribute(attr.value)]))
    if (source.tag === 'a' && attribute(source, 'rel') === undefined && output.get('rel') === 'noopener nofollow') {
      output.delete('rel')
      linkPolicyApplied = true
    }
    return original.size === output.size && [...original].every(([name, content]) => output.get(name) === content)
  }
  const textRuns = (nodes: HtmlNode[]): HtmlNode[] => {
    const result: HtmlNode[] = []
    for (const node of nodes) {
      if (node.kind === 'element') {
        result.push(node)
        continue
      }
      // The strict reader drops comments but leaves their adjacent text nodes
      // separate. Compare the rendered text, not parser token boundaries.
      // Decode BEFORE joining: a comment can interrupt a character reference,
      // and removing that boundary must not invent a different character.
      const text = decodeHTML(node.text)
      const previous = result.at(-1)
      if (previous?.kind === 'text') previous.text += text
      else result.push({ ...node, text })
    }
    return result
  }
  const matches = (source: HtmlNode[], rendered: HtmlNode[]): boolean => {
    const original = textRuns(source)
    const output = textRuns(rendered)
    return (
      original.length === output.length &&
      original.every((node, index) => {
        const other = output[index]!
        if (node.kind === 'text') return other.kind === 'text' && node.text === other.text
        return (
          other.kind === 'element' &&
          node.tag === other.tag &&
          attributesMatch(node, other) &&
          matches(node.children, other.children)
        )
      })
    )
  }
  if (!matches(nodes, parsed.nodes)) return null
  return {
    value,
    linkPolicyApplied,
    ...(Object.keys(blockAttributes).length ? { blockAttributes } : {}),
    ...(Object.keys(inlineAttributes).length ? { inlineAttributes } : {}),
    ...(options.inline ? { inline: true as const } : {}),
  }
}
