'use client'

import { useEffect, useRef, useState, type RefObject } from 'react'
import type { Editor } from '@tiptap/core'
import { mountCanvasRichText, canvasRichTextNodesIn, patchCanvasRichTextIn } from './canvas-rich-text-session.ts'
import { richTextPresentation } from './rich-text-model.ts'
import { RichTextToolbar } from './rich-text-toolbar.tsx'

export type CanvasRichTextRequest = {
  section: number
  slot: string
  origin: string
  occurrence: number
  x: number | null
  y: number | null
}

/** Only nodes actually emitted as rich-text fields by our same-origin renderer.
 * A legacy inline boundary cannot safely host the block editor; an inline
 * field (words and marks only) is made to live inside a paragraph or heading,
 * though never inside a link or button. */
function canvasRichTextNodes(
  frame: HTMLIFrameElement | null,
  section: number,
  slot: string,
  inline = false,
): HTMLElement[] {
  if (!frame || !Number.isSafeInteger(section) || section < 0 || !/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/.test(slot)) return []
  try {
    const doc = frame.contentDocument
    if (!doc || frame.contentWindow?.location.origin !== window.location.origin) return []
    return canvasRichTextNodesIn(doc, section, slot, inline)
  } catch {
    return []
  }
}

export function canvasRichTextNode(
  frame: HTMLIFrameElement | null,
  section: number,
  slot: string,
  occurrence = 0,
  constraints?: unknown,
): HTMLElement | null {
  return Number.isSafeInteger(occurrence) && occurrence >= 0
    ? (canvasRichTextNodes(frame, section, slot, richTextPresentation(constraints).inline)[occurrence] ?? null)
    : null
}

/** Passive rich-text patches draw the field exactly as the public renderer
 * does, with its definition's presentation (`constraints`). A mounted TipTap
 * editor receives updates through its model effect instead of DOM writes. */
export function patchCanvasRichText(
  frame: HTMLIFrameElement | null,
  section: number,
  slot: string,
  value: string,
  constraints?: unknown,
): boolean {
  try {
    if (!frame || frame.contentWindow?.location.origin !== window.location.origin) return false
    const doc = frame.contentDocument
    return doc ? patchCanvasRichTextIn(doc, section, slot, value, constraints) : false
  } catch {
    return false
  }
}

export function CanvasRichText({
  frameRef,
  request,
  value,
  label,
  constraints,
  disabled,
  onChange,
  onClose,
}: {
  frameRef: RefObject<HTMLIFrameElement | null>
  request: CanvasRichTextRequest
  value: string
  label: string
  /** The field's definition constraints: inline or block, and the
   * presentation of its blocks and marks. */
  constraints?: unknown
  disabled: boolean
  onChange: (value: string) => void
  onClose: () => void
}) {
  const [editor, setEditor] = useState<Editor | null>(null)
  const [unavailable, setUnavailable] = useState(false)
  const latest = useRef({ value, onChange, disabled, constraints })
  latest.current = { value, onChange, disabled, constraints }
  const inline = richTextPresentation(constraints).inline
  const mounted = useRef<ReturnType<typeof mountCanvasRichText> | null>(null)

  useEffect(() => {
    const node = canvasRichTextNode(
      frameRef.current,
      request.section,
      request.slot,
      request.occurrence,
      latest.current.constraints,
    )
    if (!node) {
      setUnavailable(true)
      return
    }
    const session = mountCanvasRichText({
      node,
      value: latest.current.value,
      label,
      constraints: latest.current.constraints,
      disabled: latest.current.disabled,
      x: request.x,
      y: request.y,
      onChange: next => latest.current.onChange(next),
    })
    mounted.current = session
    setEditor(session.editor)
    return () => {
      mounted.current = null
      session.destroy(latest.current.value)
    }
  }, [frameRef, request, label])

  useEffect(() => {
    mounted.current?.update(value, disabled)
  }, [editor, value, disabled])

  return (
    <div className="canvas-rich-editor" role="group" aria-label="On-page rich text">
      <div className="canvas-rich-editor-heading">
        <strong>{label}</strong>
        <button type="button" className="secondary small" onClick={onClose}>
          Done editing text
        </button>
      </div>
      {unavailable ? (
        <p role="status">This source boundary needs the inspector editor. Its page layout has been preserved.</p>
      ) : (
        <RichTextToolbar
          editor={editor}
          id="canvas-rich-text"
          disabled={disabled}
          label="Canvas rich text formatting"
          inline={inline}
        />
      )}
    </div>
  )
}
