// Rich text is stored as authored and sanitized on the way out, against a
// closed allowlist. Anything not named here is dropped, including
// its attributes — the default is "remove", never "keep and hope".
import { escapeAttribute, escapeText, safeUrl } from './escape.ts'
import { decodeHTML, decodeHTMLAttribute } from 'entities'

export const RICHTEXT_POLICY_VERSION = 2

const ALLOWED = new Map<string, readonly string[]>([
  ['p', []],
  ['br', []],
  ['strong', []],
  ['em', []],
  ['b', []],
  ['i', []],
  ['ul', []],
  ['ol', []],
  ['li', []],
  ['blockquote', []],
  ['h2', []],
  ['h3', []],
  ['h4', []],
  ['a', ['href']],
])
const VOID_ELEMENTS = new Set(['br'])

// `\s[^<>]*`, not `\s+[^<>]*`. Every character in \s is also in [^<>], so the
// two accept the identical language and pick the identical match — the `+` only
// added a second way to reach each split, which is the O(n²) blowup. A ~98 KiB
// rich-text value cost 4.4 s of blocking CPU per render before this.
const TAG = /<\/?([a-zA-Z][a-zA-Z0-9]*)((?:\s[^<>]*)?)\/?>/g
const ATTRIBUTE = /([a-zA-Z-]+)\s*=\s*("([^"]*)"|'([^']*)')/g

// An inline field lives inside a paragraph or heading of its definition, so
// its value may hold only words and their marks: never a block of its own.
const INLINE_ALLOWED = new Set(['br', 'strong', 'em', 'b', 'i', 'a'])

export type RichTextOptions = {
  /** An inline field (`constraints.inline`): blocks are unwrapped, and a
   * boundary between two of them becomes a line break. */
  inline?: boolean
}

export function sanitizeRichText(input: string, options: RichTextOptions = {}): string {
  const open: string[] = []
  let output = ''
  let cursor = 0
  // In an inline field a dropped block boundary still separates its words.
  let pendingBreak = false
  const text = (raw: string) => {
    const decoded = decodeHTML(raw)
    if (pendingBreak && decoded.trim() !== '') {
      output += '<br>'
      pendingBreak = false
    }
    if (!(options.inline && pendingBreak)) output += escapeText(decoded)
  }

  for (const match of input.matchAll(TAG)) {
    const index = match.index
    // HTML authors and visual editors both use character references. Decode
    // them while the tokenizer still knows this is text, then escape the
    // resulting characters exactly once. Decoding after reconstruction would
    // be mutation-XSS territory; decoding here cannot create structure because
    // `<` is escaped before anything else examines the output.
    text(input.slice(cursor, index))
    cursor = index + match[0].length

    const name = match[1]!.toLowerCase()
    const allowedAttributes = ALLOWED.get(name)
    // An unknown tag is removed but its text content is kept, so dropping
    // <script> does not also silently delete a paragraph around it.
    if (!allowedAttributes) continue
    if (options.inline && !INLINE_ALLOWED.has(name)) {
      if (output !== '') pendingBreak = true
      continue
    }
    if (pendingBreak && !match[0].startsWith('</')) {
      output += '<br>'
      pendingBreak = false
    }

    if (match[0].startsWith('</')) {
      // Only close what was actually opened: hostile input must not be able to
      // unbalance the document around it.
      const at = open.lastIndexOf(name)
      if (at !== -1) {
        for (let i = open.length - 1; i >= at; i -= 1) output += `</${open[i]}>`
        open.length = at
      }
      continue
    }

    let attributes = ''
    for (const attribute of match[2]!.matchAll(ATTRIBUTE)) {
      const key = attribute[1]!.toLowerCase()
      if (!allowedAttributes.includes(key)) continue
      // TipTap serializes `&` in an href as `&amp;`. Apply the browser's
      // attribute decoding rules before the URL policy, then escape once for
      // the emitted attribute. Without this, every editor/render pass grew an
      // additional visible `amp;`.
      const raw = decodeHTMLAttribute(attribute[3] ?? attribute[4] ?? '')
      attributes += ` ${key}="${escapeAttribute(key === 'href' ? safeUrl(raw) : raw)}"`
    }
    // Links out of authored content are untrusted by default.
    if (name === 'a') attributes += ' rel="noopener nofollow"'

    output += `<${name}${attributes}>`
    if (!VOID_ELEMENTS.has(name)) open.push(name)
  }

  text(input.slice(cursor))
  for (let i = open.length - 1; i >= 0; i -= 1) output += `</${open[i]}>`
  return output
}

/**
 * Canonical HTML passed into the visual rich-text editor.
 *
 * These named directions make the editor/storage boundary explicit. Both are
 * sanitized because the browser widget is an authoring convenience, never a
 * trusted parser. Policy v2's entity handling makes canonical allowed output a
 * fixed point, so opening, saving and rendering cannot progressively rewrite
 * ordinary punctuation.
 */
export function richTextForVisualEditor(authored: string): string {
  return sanitizeRichText(authored)
}

export function richTextFromVisualEditor(editorHtml: string): string {
  return sanitizeRichText(editorHtml)
}

// ------------------------------------------------- definition-owned blocks --

/** Block tags whose presentation a definition may fix for one rich-text field. */
export const RICHTEXT_BLOCK_TAGS = ['p', 'h2', 'h3', 'h4', 'ul', 'ol', 'li', 'blockquote'] as const
export type RichTextBlockTag = (typeof RICHTEXT_BLOCK_TAGS)[number]
export type RichTextBlockPresentation = { class?: string; style?: string }
export type RichTextBlockAttributes = Partial<Record<RichTextBlockTag, RichTextBlockPresentation>>

// Typography and box spacing only: nothing here can load a resource, position
// a block over the page or hide it. The value grammar has no `url(`, escape,
// at-rule, comment or block, so a declaration cannot reach another sink.
const BLOCK_STYLE_PROPERTIES = new Set([
  'color',
  'background-color',
  'font-family',
  'font-size',
  'font-style',
  'font-weight',
  'font-variant',
  'letter-spacing',
  'line-height',
  'text-align',
  'text-decoration',
  'text-indent',
  'text-transform',
  'word-spacing',
  'white-space',
  'max-width',
  'list-style-type',
  'list-style-position',
  ...['margin', 'padding'].flatMap(box => [
    box,
    ...[
      'top',
      'right',
      'bottom',
      'left',
      'block',
      'inline',
      'block-start',
      'block-end',
      'inline-start',
      'inline-end',
    ].map(side => `${box}-${side}`),
  ]),
])
const BLOCK_STYLE_VALUE = /^[\w\s#%.,()+\-*/'"!]+$/
const BLOCK_STYLE_REFUSED = /url\(|image|expression|attr\(|\\|\/\*|!(?!\s*important\s*$)/i
// Class tokens are emitted attribute-escaped, so the only refusals are the
// characters no class needs and a control character.
const CLASS_TOKEN = /^[^\s<>"'`\u0000-\u001f\u007f]+$/

function blockStyle(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > 1000) return undefined
  const declarations = value
    .split(';')
    .map(part => part.trim())
    .filter(Boolean)
  if (declarations.length === 0) return undefined
  const valid = declarations.every(declaration => {
    const colon = declaration.indexOf(':')
    if (colon < 1) return false
    const property = declaration.slice(0, colon).trim().toLowerCase()
    const content = declaration.slice(colon + 1).trim()
    const quotes = (content.match(/["']/g) ?? []).length
    return (
      BLOCK_STYLE_PROPERTIES.has(property) &&
      content !== '' &&
      quotes % 2 === 0 &&
      BLOCK_STYLE_VALUE.test(content) &&
      !BLOCK_STYLE_REFUSED.test(content)
    )
  })
  // The authored text ships verbatim when every declaration passes, so an
  // imported paragraph keeps exactly the style its source had.
  return valid ? value : undefined
}

function blockClass(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > 500) return undefined
  const tokens = value.split(/\s+/).filter(Boolean)
  return tokens.length > 0 && tokens.every(token => CLASS_TOKEN.test(token)) ? value : undefined
}

/**
 * Read a rich-text field's block presentation from its definition: the classes
 * and inline style a source put on every paragraph (for example), so those
 * paragraphs can be one editable field without losing their look. The stored
 * value stays canonical rich text; this is applied on the way out. A value that
 * fails the policy is dropped whole, never partly emitted.
 */
export function richTextBlockAttributes(value: unknown): RichTextBlockAttributes {
  return presentations(value, RICHTEXT_BLOCK_TAGS)
}

function presentations<Tag extends string>(
  value: unknown,
  tags: readonly Tag[],
): Partial<Record<Tag, RichTextBlockPresentation>> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {}
  const found: Partial<Record<Tag, RichTextBlockPresentation>> = {}
  for (const tag of tags) {
    const declared = (value as Record<string, unknown>)[tag]
    if (typeof declared !== 'object' || declared === null) continue
    const presentation: RichTextBlockPresentation = {}
    const className = blockClass((declared as Record<string, unknown>)['class'])
    const style = blockStyle((declared as Record<string, unknown>)['style'])
    if (className !== undefined) presentation.class = className
    if (style !== undefined) presentation.style = style
    if (presentation.class !== undefined || presentation.style !== undefined) found[tag] = presentation
  }
  return found
}

const SANITIZED_TAG = /<(\/?)([a-z0-9]+)((?:\s[^<>]*)?)>/g

/**
 * Put a field's block presentation on sanitized rich text: on top-level
 * blocks, and on the items of top-level lists. The input must be
 * `sanitizeRichText` output, whose tags are the allowlisted ones with no
 * attributes but a link's, so a tag here is always a real element.
 */
export function applyRichTextBlockAttributes(sanitized: string, blocks: RichTextBlockAttributes): string {
  if (Object.keys(blocks).length === 0) return sanitized
  const open: string[] = []
  let output = ''
  let cursor = 0
  for (const match of sanitized.matchAll(SANITIZED_TAG)) {
    output += sanitized.slice(cursor, match.index)
    cursor = match.index + match[0].length
    const [whole, closing, name, attributes] = match
    if (closing) {
      open.pop()
      output += whole
      continue
    }
    const listItem = name === 'li' && open.length === 1 && (open[0] === 'ul' || open[0] === 'ol')
    const presentation = open.length === 0 || listItem ? blocks[name as RichTextBlockTag] : undefined
    output += presentation
      ? `<${name}${attributes}${presentation.class !== undefined ? ` class="${escapeAttribute(presentation.class)}"` : ''}` +
        `${presentation.style !== undefined ? ` style="${escapeAttribute(presentation.style)}"` : ''}>`
      : whole
    if (!VOID_ELEMENTS.has(name!)) open.push(name!)
  }
  return output + sanitized.slice(cursor)
}

// ------------------------------------------------ definition-owned marks --

/** Inline marks whose presentation a definition may fix for one rich-text
 * field: an imported source's `<em class="red">`, say. Links keep the link
 * policy's own attributes. */
export const RICHTEXT_INLINE_TAGS = ['strong', 'em', 'b', 'i'] as const
export type RichTextInlineTag = (typeof RICHTEXT_INLINE_TAGS)[number]
export type RichTextInlineAttributes = Partial<Record<RichTextInlineTag, RichTextBlockPresentation>>

/** Read a field's mark presentation from its definition, under the same
 * class and style policy as its blocks. A failing value is dropped whole. */
export function richTextInlineAttributes(value: unknown): RichTextInlineAttributes {
  return presentations(value, RICHTEXT_INLINE_TAGS)
}

/** Put a field's mark presentation on every emphasis and bold mark of
 * sanitized rich text, at any depth. The input must be `sanitizeRichText`
 * output (attribute-free marks). */
export function applyRichTextInlineAttributes(sanitized: string, marks: RichTextInlineAttributes): string {
  if (Object.keys(marks).length === 0) return sanitized
  return sanitized.replace(/<(strong|em|b|i)>/g, (whole, name: RichTextInlineTag) => {
    const presentation = marks[name]
    return presentation
      ? `<${name}${presentation.class !== undefined ? ` class="${escapeAttribute(presentation.class)}"` : ''}` +
          `${presentation.style !== undefined ? ` style="${escapeAttribute(presentation.style)}"` : ''}>`
      : whole
  })
}

/** A rich-text field as the page renders it: sanitized (inline-only for an
 * inline field), then given its definition's block and mark presentation.
 * The renderer, the canvas and the editors all draw a field through this. */
export function presentRichText(value: string, constraints?: Record<string, unknown> | null): string {
  const inline = constraints?.['inline'] === true
  return applyRichTextInlineAttributes(
    applyRichTextBlockAttributes(
      sanitizeRichText(value, { inline }),
      inline ? {} : richTextBlockAttributes(constraints?.['blockAttributes']),
    ),
    richTextInlineAttributes(constraints?.['inlineAttributes']),
  )
}
