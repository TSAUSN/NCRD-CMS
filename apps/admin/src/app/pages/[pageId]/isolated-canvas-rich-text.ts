import { mountCanvasRichText, canvasRichTextNodesIn, patchCanvasRichTextIn } from './canvas-rich-text-session.ts'
import { richTextPresentation } from './rich-text-model.ts'
import { applyRichTextCommand, richTextToolbarState } from './rich-text-commands.ts'
import type { IsolatedCanvasPeer } from './isolated-canvas-controls.tsx'
const SLOT = /^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/
const record = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)
type Field = {
  section: number
  slot: string
  occurrence: number
  value: string
  label: string
  constraints?: unknown
  disabled: boolean
  x: number | null
  y: number | null
}
export function parseCanvasRichField(value: unknown): Field | null {
  if (
    !record(value) ||
    Object.keys(value).some(
      key => !['section', 'slot', 'occurrence', 'value', 'label', 'constraints', 'disabled', 'x', 'y'].includes(key),
    )
  )
    return null
  try {
    if (JSON.stringify(value).length > 1_048_576) return null
  } catch {
    return null
  }
  const { section, slot, occurrence, label, disabled, x, y } = value
  if (
    !Number.isSafeInteger(section) ||
    Number(section) < 0 ||
    Number(section) >= 200 ||
    typeof slot !== 'string' ||
    !SLOT.test(slot) ||
    !Number.isSafeInteger(occurrence) ||
    Number(occurrence) < 0 ||
    Number(occurrence) > 1000 ||
    typeof value['value'] !== 'string' ||
    typeof label !== 'string' ||
    label.length > 2000 ||
    typeof disabled !== 'boolean' ||
    (x !== null && (typeof x !== 'number' || !Number.isFinite(x))) ||
    (y !== null && (typeof y !== 'number' || !Number.isFinite(y)))
  )
    return null
  return {
    section: Number(section),
    slot,
    occurrence: Number(occurrence),
    value: value['value'],
    label,
    disabled,
    x: x as number | null,
    y: y as number | null,
    constraints: value['constraints'],
  }
}
/** The same model and renderer used in the normal canvas, mounted locally.
 * The parent owns values, page history, validation and saving. */
export function installCanvasRichText(peer: IsolatedCanvasPeer): void {
  let active: { field: Field; session: ReturnType<typeof mountCanvasRichText> } | null = null
  const publishState = () =>
    peer.post('cms:rich-state', {
      field: active ? { section: active.field.section, slot: active.field.slot } : null,
      active: active ? richTextToolbarState(active.session.editor) : null,
    })
  const close = () => {
    if (active) {
      const previous = active
      active = null
      previous.session.destroy(previous.session.value())
    }
    publishState()
  }
  const change = (field: Field, value: string) =>
    peer.post('cms:rich-value', { section: field.section, slot: field.slot, value })
  window.addEventListener('message', event => {
    if (
      event.source !== window.parent ||
      event.origin !== peer.origin ||
      event.data?.channel !== peer.channel ||
      event.data?.documentId !== peer.documentId
    )
      return
    const data = event.data
    if (data.type === 'cms:rich-field') {
      if (data.field === null) {
        close()
        return
      }
      const field = parseCanvasRichField(data.field)
      if (!field) return
      if (
        active &&
        active.field.section === field.section &&
        active.field.slot === field.slot &&
        active.field.occurrence === field.occurrence
      ) {
        active.field = field
        active.session.update(field.value, field.disabled)
        publishState()
        return
      }
      close()
      const node = canvasRichTextNodesIn(
        document,
        field.section,
        field.slot,
        richTextPresentation(field.constraints).inline,
      )[field.occurrence]
      if (!node) {
        peer.post('cms:rich-unavailable', { section: field.section, slot: field.slot })
        return
      }
      const session = mountCanvasRichText({ ...field, node, onChange: value => change(field, value) })
      active = { field, session }
      session.editor.on('transaction', publishState)
      publishState()
    } else if (data.type === 'cms:rich-command' && active) {
      applyRichTextCommand(active.session.editor, data.command, richTextPresentation(active.field.constraints).inline)
    } else if (data.type === 'cms:rich-patch') {
      const field = parseCanvasRichField(data.field)
      if (!field) return
      if (active && active.field.section === field.section && active.field.slot === field.slot)
        active.session.update(field.value, field.disabled)
      if (!patchCanvasRichTextIn(document, field.section, field.slot, field.value, field.constraints))
        peer.post('cms:unpatched', { section: field.section, slot: field.slot })
    } else if (
      data.type === 'cms:flush-fields' &&
      typeof data.request === 'string' &&
      /^[a-z0-9-]{1,80}$/i.test(data.request)
    ) {
      // Input and the acknowledgement share the same ordered postMessage stream.
      // Dispatch before ack also commits a final IME/plaintext DOM value.
      for (const node of document.querySelectorAll('[data-cms-slot][data-cms-kind="text"][contenteditable]'))
        node.dispatchEvent(new Event('input', { bubbles: true }))
      if (active) change(active.field, active.session.value())
      peer.post('cms:fields-flushed', { request: data.request })
    }
  })
  window.addEventListener('pagehide', close, { once: true })
}
