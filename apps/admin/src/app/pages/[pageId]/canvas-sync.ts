// What the canvas has to be told, worked out from the two documents (SPEC §6.4).
//
// The editor used to decide this at the call site of each edit: typing in the
// inspector posted a patch to the canvas, and every other transition — revert,
// undo, redo, a section deleted, a value the canvas itself reported — posted
// nothing. Keeping the canvas in step was therefore a property of *which
// handler ran*, and any transition somebody forgot to instrument left the page
// showing words the document no longer contained, with the inspector and the
// canvas each convinced they were right.
//
// So the question is asked of the documents instead: given what the canvas is
// showing and what the editor now holds, what does the canvas need? A `text`
// field can be written straight into the page. Rich text can be patched only
// by the parent using the shared renderer sanitizer and structured editor.
// Links/images and structural changes still need the canonical server render.
import { deepEqual, type EditorDocument, type EditorSection } from '@cms/domain'

export type CanvasPatch = { section: number; slot: string; value: string; kind?: 'richtext' }

export type CanvasPlan = {
  /** Values the canvas can be given directly, without a round trip. */
  patches: CanvasPatch[]
  /** True when only a fresh render of the saved draft can make the canvas right. */
  render: boolean
}

/** A slot's declared kind, or undefined when the definition declares no such slot. */
export type SlotKind = (section: EditorSection, slot: string) => string | undefined

export function planCanvasUpdate(shown: EditorDocument, next: EditorDocument, kindOf: SlotKind): CanvasPlan {
  const patches: CanvasPatch[] = []
  // A section added or removed renumbers every `data-cms-section` after it, so
  // there is no position left to patch even where the values did not change.
  let render = shown.sections.length !== next.sections.length || !deepEqual(shown.identity, next.identity)

  next.sections.forEach((section, index) => {
    const before = shown.sections[index]
    if (!before || !sameRendering(before, section)) {
      render = true
      return
    }

    for (const slot of new Set([...Object.keys(before.values), ...Object.keys(section.values)])) {
      // Editorial sample markers do not change field markup or caret position.
      if (slot === '__cms_sample_fields') {
        const oldMarkers = Array.isArray(before.values[slot]) ? (before.values[slot] as unknown[]) : [],
          newMarkers = Array.isArray(section.values[slot]) ? (section.values[slot] as unknown[]) : []
        if (
          [...oldMarkers, ...newMarkers].some(
            name =>
              typeof name === 'string' &&
              oldMarkers.includes(name) !== newMarkers.includes(name) &&
              kindOf(section, name) === 'repeat',
          )
        )
          render = true
        continue
      }
      const value = section.values[slot]
      if (deepEqual(before.values[slot], value)) continue
      if (kindOf(section, slot) === 'text' && isPlainText(value)) {
        patches.push({ section: index, slot, value: value ?? '' })
      } else if (kindOf(section, slot) === 'richtext' && isPlainText(value)) {
        // The parent runs the SAME renderer sanitizer before touching DOM.
        // Active TipTap views receive the shared model without an iframe reload.
        patches.push({ section: index, slot, value: value ?? '', kind: 'richtext' })
      } else {
        render = true
      }
    }
  })

  return { patches, render }
}

/**
 * Record a value as already visible on the canvas.
 *
 * Used for the one value the canvas knows before the editor does: the character
 * somebody typed straight into the page. Without this the editor would answer
 * that keystroke by posting the same text back into the node the caret is in,
 * which rewrites the text node and drops the caret to its start.
 */
export function withCanvasValue(document: EditorDocument, index: number, slot: string, value: unknown): EditorDocument {
  const section = document.sections[index]
  if (!section) return document
  const sections = [...document.sections]
  sections[index] = { ...section, values: { ...section.values, [slot]: value } }
  return { ...document, sections }
}

/**
 * Does this section still render the way the canvas rendered it, apart from its
 * values?
 *
 * `label` is deliberately not here: it names the section in the structure tree
 * and appears nowhere on the page, so renaming one is not a reason to reload
 * what somebody is looking at.
 */
function sameRendering(a: EditorSection, b: EditorSection): boolean {
  return (
    a.section_def_id === b.section_def_id &&
    a.section_def_version === b.section_def_version &&
    Boolean(a.hidden) === Boolean(b.hidden) &&
    deepEqual(a.hidden_at ?? [], b.hidden_at ?? []) &&
    deepEqual(a.appearance ?? {}, b.appearance ?? {}) &&
    (a.custom_css ?? '') === (b.custom_css ?? '') &&
    (a.raw_html ?? '') === (b.raw_html ?? '')
  )
}

/**
 * A text field is patchable only while its value really is text. A stored value
 * of another shape is a definition and a page that disagree about the field, and
 * the renderer is the one that decides what that looks like.
 */
function isPlainText(value: unknown): value is string | null | undefined {
  return value === undefined || value === null || typeof value === 'string'
}
