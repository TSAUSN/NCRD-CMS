import { setValue } from '@cms/domain'
import { slotForId } from '@cms/schema'
import { sectionVersionKey } from '../../../lib/section-version.ts'
import { withCanvasValue } from './canvas-sync.ts'
import { CanvasRichText, patchCanvasRichText } from './canvas-rich-text.tsx'
import { IsolatedRichTextToolbar } from './isolated-rich-text-toolbar.tsx'
import type { EditorCanvasProps } from './editor-canvas.tsx'

export function EditorCanvasRichText({
  fields,
  frame,
  overlays,
}: Pick<EditorCanvasProps, 'fields' | 'frame' | 'overlays'>) {
  const {
    state,
    currentEditor,
    setState,
    activeRichText: request,
    slotsByDef,
    richTextConstraints,
    canvasHistoryBlocked,
    remoteRichState,
    remoteRichUnavailable,
    setRichTextRequest,
  } = fields
  if (!request) return null
  const section = state.document.sections[request.section]
  if (!section) return null

  const entry = slotsByDef.get(sectionVersionKey(section.section_def_id, section.section_def_version))
  const value = String(section.values[request.slot] ?? '')
  const label = slotForId(entry?.slots ?? [], section.values, request.slot)?.label ?? 'Rich text'
  const constraints = richTextConstraints(section, request.slot)
  const close = () => setRichTextRequest(null)
  const { isolated, toCanvas, canvasRef, shown } = frame
  if (isolated.enabled) {
    return (
      <IsolatedRichTextToolbar
        request={request}
        value={value}
        label={label}
        constraints={constraints}
        disabled={canvasHistoryBlocked.current}
        active={remoteRichState}
        unavailable={remoteRichUnavailable}
        post={toCanvas}
        onClose={close}
      />
    )
  }

  const { upgrade, replacement, overrideOpen, submitOpen, recovery } = overlays
  return (
    <CanvasRichText
      frameRef={canvasRef}
      request={request}
      value={value}
      label={label}
      constraints={constraints}
      disabled={
        upgrade !== null ||
        replacement !== null ||
        overrideOpen ||
        submitOpen ||
        recovery.review !== null ||
        recovery.busy
      }
      onChange={value => {
        const { section, slot, origin } = request
        if (currentEditor.current.sectionOrigins[section] !== origin) return
        patchCanvasRichText(
          canvasRef.current,
          section,
          slot,
          value,
          richTextConstraints(currentEditor.current.document.sections[section], slot),
        )
        shown.current = withCanvasValue(shown.current, section, slot, value)
        setState(current => setValue(current, section, slot, value))
      }}
      onClose={close}
    />
  )
}
