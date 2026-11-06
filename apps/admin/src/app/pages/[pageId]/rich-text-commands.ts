import type { Editor } from '@tiptap/core'
import { safeUrl } from '@cms/renderer/escape'
export type RichTextCommand =
  | { type: 'block'; value: 'paragraph' | 'heading-2' | 'heading-3' | 'heading-4' }
  | { type: 'bold' | 'italic' | 'bullet' | 'ordered' | 'quote' | 'unlink' }
  | { type: 'link'; href: string }
export type RichTextToolbarState = {
  paragraph: boolean
  h2: boolean
  h3: boolean
  h4: boolean
  bold: boolean
  italic: boolean
  bullet: boolean
  ordered: boolean
  quote: boolean
  link: boolean
  selectionEmpty: boolean
  href: string
}
export function richTextToolbarState(editor: Editor): RichTextToolbarState {
  return {
    paragraph: editor.isActive('paragraph'),
    h2: editor.isActive('heading', { level: 2 }),
    h3: editor.isActive('heading', { level: 3 }),
    h4: editor.isActive('heading', { level: 4 }),
    bold: editor.isActive('bold'),
    italic: editor.isActive('italic'),
    bullet: editor.isActive('bulletList'),
    ordered: editor.isActive('orderedList'),
    quote: editor.isActive('blockquote'),
    link: editor.isActive('link'),
    selectionEmpty: editor.state.selection.empty,
    href: String(editor.getAttributes('link')['href'] ?? '').slice(0, 2048),
  }
}
export function isRichTextCommand(value: unknown): value is RichTextCommand {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const command = value as Record<string, unknown>,
    keys = Object.keys(command)
  if (command['type'] === 'block')
    return keys.length === 2 && ['paragraph', 'heading-2', 'heading-3', 'heading-4'].includes(String(command['value']))
  if (command['type'] === 'link')
    return (
      keys.length === 2 &&
      typeof command['href'] === 'string' &&
      command['href'].length <= 2048 &&
      (safeUrl(command['href']) !== '#' || command['href'] === '#')
    )
  return (
    keys.length === 1 && ['bold', 'italic', 'bullet', 'ordered', 'quote', 'unlink'].includes(String(command['type']))
  )
}
/** A closed vocabulary, shared by local and isolated editing. No command name,
 * selector, HTML or URL supplied by a message is executed as code. */
export function applyRichTextCommand(editor: Editor, command: unknown, inline = false): boolean {
  if (
    !isRichTextCommand(command) ||
    editor.isDestroyed ||
    !editor.isEditable ||
    (inline && ['block', 'bullet', 'ordered', 'quote'].includes(command.type))
  )
    return false
  const chain = editor.chain().focus()
  switch (command.type) {
    case 'block':
      return command.value === 'paragraph'
        ? chain.setParagraph().run()
        : chain.setHeading({ level: Number(command.value.slice(-1)) as 2 | 3 | 4 }).run()
    case 'bold':
      return chain.toggleBold().run()
    case 'italic':
      return chain.toggleItalic().run()
    case 'bullet':
      return chain.toggleBulletList().run()
    case 'ordered':
      return chain.toggleOrderedList().run()
    case 'quote':
      return chain.toggleBlockquote().run()
    case 'unlink':
      return chain.extendMarkRange('link').unsetLink().run()
    case 'link':
      return chain
        .extendMarkRange('link')
        .setLink({ href: safeUrl(command.href) })
        .run()
  }
}
export function isRichTextToolbarState(value: unknown): value is RichTextToolbarState {
  if (!value || typeof value !== 'object') return false
  const state = value as Record<string, unknown>
  return (
    ['paragraph', 'h2', 'h3', 'h4', 'bold', 'italic', 'bullet', 'ordered', 'quote', 'link', 'selectionEmpty'].every(
      key => typeof state[key] === 'boolean',
    ) &&
    typeof state['href'] === 'string' &&
    state['href'].length <= 2048
  )
}
