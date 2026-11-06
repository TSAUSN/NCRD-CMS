'use client'
import { useEffect } from 'react'
import type { CanvasRichTextRequest } from './canvas-rich-text.tsx'
import { RichTextToolbarView } from './rich-text-toolbar.tsx'
import { richTextPresentation } from './rich-text-model.ts'
import type { RichTextToolbarState } from './rich-text-commands.ts'
export function IsolatedRichTextToolbar({
  request,
  value,
  label,
  constraints,
  disabled,
  active,
  unavailable,
  post,
  onClose,
}: {
  request: CanvasRichTextRequest
  value: string
  label: string
  constraints?: unknown
  disabled: boolean
  active: RichTextToolbarState | null
  unavailable: boolean
  post: (message: Record<string, unknown>) => void
  onClose: () => void
}) {
  useEffect(() => {
    post({
      type: 'cms:rich-field',
      field: {
        section: request.section,
        slot: request.slot,
        occurrence: request.occurrence,
        x: request.x,
        y: request.y,
        value,
        label,
        constraints,
        disabled,
      },
    })
  }, [request, value, label, constraints, disabled, post])
  useEffect(() => () => post({ type: 'cms:rich-field', field: null }), [post])
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
        <RichTextToolbarView
          id="canvas-rich-text"
          active={active}
          available={Boolean(active)}
          disabled={disabled}
          label="Canvas rich text formatting"
          inline={richTextPresentation(constraints).inline}
          onCommand={command => post({ type: 'cms:rich-command', command })}
        />
      )}
    </div>
  )
}
