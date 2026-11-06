import { Extension, Node } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import Link from '@tiptap/extension-link'
import {
  richTextBlockAttributes,
  richTextInlineAttributes,
  sanitizeRichText,
  type RichTextBlockAttributes,
  type RichTextBlockPresentation,
  type RichTextInlineAttributes,
} from '@cms/renderer/richtext'

const presented = (presentation: RichTextBlockPresentation | undefined) => ({ HTMLAttributes: { ...presentation } })

/** What a rich-text field's definition says about it: an inline field
 * (`constraints.inline`) holds only words and marks, and the definition may
 * fix the look of its blocks and marks. Read from the slot's constraints. */
export type RichTextPresentation = { inline: boolean; blocks: RichTextBlockAttributes; marks: RichTextInlineAttributes }

export function richTextPresentation(constraints: unknown): RichTextPresentation {
  const declared =
    typeof constraints === 'object' && constraints !== null ? (constraints as Record<string, unknown>) : {}
  const inline = declared['inline'] === true
  return {
    inline,
    blocks: inline ? {} : richTextBlockAttributes(declared['blockAttributes']),
    marks: richTextInlineAttributes(declared['inlineAttributes']),
  }
}

const PLAIN: RichTextPresentation = { inline: false, blocks: {}, marks: {} }

// An inline field is one line of words that lives inside a paragraph or
// heading of its definition: its document is that line, and Enter breaks it
// as V1's region editor did, rather than starting a new block.
let inlineOnly: [ReturnType<typeof Node.create>, ReturnType<typeof Extension.create>] | null = null
const inlineExtensions = () =>
  (inlineOnly ??= [
    Node.create({ name: 'doc', topNode: true, content: 'inline*' }),
    Extension.create({
      name: 'cmsBreakOnEnter',
      addKeyboardShortcuts() {
        return { Enter: () => this.editor.commands.setHardBreak() }
      },
    }),
  ])

/** One schema for inspector and direct canvas editing. The renderer remains
 * the authority at input/output; this authoring engine never widens its policy.
 * On the canvas, a field's definition-owned block and mark presentation is
 * drawn while typing, so the page keeps its look; the classes never reach the
 * stored value, which the renderer's sanitizer canonicalizes. */
export function richTextExtensions(history: 'field' | 'page', presentation: RichTextPresentation = PLAIN) {
  const { blocks, marks } = presentation
  const common = {
    link: false as const,
    trailingNode: false as const,
    undoRedo: history === 'page' ? (false as const) : {},
    strike: false as const,
    underline: false as const,
    code: false as const,
    codeBlock: false as const,
    horizontalRule: false as const,
    bold: presented(marks.strong ?? marks.b),
    italic: presented(marks.em ?? marks.i),
  }
  const link = Link.configure({
    openOnClick: false,
    autolink: false,
    linkOnPaste: false,
    HTMLAttributes: { rel: 'noopener nofollow' },
  })
  if (presentation.inline) {
    return [
      StarterKit.configure({
        ...common,
        document: false,
        paragraph: false,
        heading: false,
        blockquote: false,
        bulletList: false,
        orderedList: false,
        listItem: false,
        listKeymap: false,
      }),
      ...inlineExtensions(),
      link,
    ]
  }
  return [
    StarterKit.configure({
      ...common,
      heading: { levels: [2, 3, 4] },
      paragraph: presented(blocks.p),
      bulletList: presented(blocks.ul),
      orderedList: presented(blocks.ol),
      listItem: presented(blocks.li),
      // A terminal quote/list is already valid content. StarterKit otherwise
      // appends an empty paragraph on selection/focus and autosaves that as an
      // author edit, before anyone has typed anything.
    }),
    link,
  ]
}

/** A value as the visual editor opens it: canonical, inline-only for an
 * inline field, and never an empty document a block editor cannot hold. */
export function visualValue(value: string, inline = false): string {
  const safe = sanitizeRichText(value, { inline })
  return !inline && safe.trim() === '' ? '<p></p>' : safe
}

/** What the visual editor (or a paste into it) hands back, canonicalized. */
export function editorValue(html: string, inline = false): string {
  return sanitizeRichText(html, { inline })
}
