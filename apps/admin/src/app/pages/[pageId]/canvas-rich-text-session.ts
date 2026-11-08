import { Editor } from '@tiptap/core'
import { presentRichText } from '@cms/renderer/richtext'
import { editorValue, richTextExtensions, richTextPresentation, visualValue } from './rich-text-model.ts'

/** One model/mount lifecycle for same-origin and isolated direct editing. The
 * caller resolves a renderer-marked node; this never accepts arbitrary HTML. */
export function mountCanvasRichText(input: {
  node: HTMLElement
  value: string
  label: string
  constraints?: unknown
  disabled: boolean
  x: number | null
  y: number | null
  onChange: (value: string) => void
}) {
  const { node } = input
  const presentation = richTextPresentation(input.constraints)
  const attributes = [...node.attributes].map(attribute => [attribute.name, attribute.value] as const)
  let value = input.value
  let disabled = input.disabled
  const editor = new Editor({
    element: { mount: node },
    injectCSS: false,
    extensions: richTextExtensions('page', presentation),
    editable: !disabled,
    content: visualValue(value, presentation.inline),
    editorProps: {
      transformPastedHTML: html => editorValue(html, presentation.inline),
      attributes: {
        'aria-label': input.label,
        'aria-multiline': 'true',
        'data-cms-inline-editing': '',
        ...(presentation.inline ? { 'data-cms-inline-field': '' } : {}),
      },
    },
    onUpdate: ({ editor: active }) => {
      value = editorValue(active.getHTML(), presentation.inline)
      if (!disabled) input.onChange(value)
    },
  })
  if (input.x !== null && input.y !== null) {
    const position = editor.view.posAtCoords({ left: input.x, top: input.y })
    if (position) editor.commands.setTextSelection(position.pos)
  }
  // This imperative mount is already connected. Focus synchronously so a
  // delayed selection restore cannot overwrite the first real input.
  editor.view.focus()
  return {
    editor,
    update(next: string, readOnly: boolean) {
      value = next
      disabled = readOnly
      if (editor.isDestroyed) return
      editor.setEditable(!disabled, false)
      editor.view.dom.setAttribute('aria-readonly', String(disabled))
      const visual = visualValue(value, presentation.inline)
      if (editorValue(editor.getHTML(), presentation.inline) === editorValue(visual, presentation.inline)) return
      const { from, to } = editor.state.selection
      editor.commands.setContent(visual, { emitUpdate: false })
      const maximum = editor.state.doc.content.size
      editor.commands.setTextSelection({ from: Math.min(from, maximum), to: Math.min(to, maximum) })
    },
    value: () => editorValue(editor.getHTML(), presentation.inline),
    destroy(next = value) {
      editor.destroy()
      for (const attribute of [...node.attributes]) node.removeAttribute(attribute.name)
      for (const [name, original] of attributes) node.setAttribute(name, original)
      node.innerHTML = presentRichText(next, input.constraints as Record<string, unknown> | undefined)
    },
  }
}

/** Resolve only renderer-marked, structurally safe rich-text boundaries. */
export function canvasRichTextNodesIn(doc: Document, section: number, slot: string, inline = false): HTMLElement[] {
  if (!Number.isSafeInteger(section) || section < 0 || !/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/.test(slot)) return []
  const nodes = [
    ...doc.querySelectorAll<HTMLElement>(
      `[data-cms-section="${section}"] [data-cms-slot="${slot}"][data-cms-kind="richtext"]`,
    ),
  ]
  return nodes.some(node => node.closest(inline ? 'a,button' : 'p,h1,h2,h3,h4,h5,h6,a,button')) ? [] : nodes
}
export function patchCanvasRichTextIn(
  doc: Document,
  section: number,
  slot: string,
  value: string,
  constraints?: unknown,
): boolean {
  const nodes = canvasRichTextNodesIn(doc, section, slot, richTextPresentation(constraints).inline)
  if (!nodes.length) return false
  const safe = presentRichText(value, constraints as Record<string, unknown> | undefined)
  for (const node of nodes) if (!node.hasAttribute('data-cms-inline-editing')) node.innerHTML = safe
  return true
}
