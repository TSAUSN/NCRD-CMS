import { isDirty, type EditorState } from '@cms/domain'
import type { ActionResult } from '../../../lib/action-result.ts'
import type { SitePreviewContext } from '../../../lib/preview-context.ts'
import type { PageEditorProps } from './editor-types.ts'
import type { useDraftSave } from './use-draft-save.ts'
import { readCanvasTicket, type useIsolatedCanvas } from './use-isolated-canvas.ts'

type Current<T> = { current: T }
type Inputs = {
  props: Pick<PageEditorProps, 'pageId' | 'visitorPreviewOrigin' | 'isolatedCanvasOrigin'>
  draft: {
    currentEditor: Current<EditorState>
    latestSave: ReturnType<typeof useDraftSave>['latestSave']
    savedVersionId: Current<string | null>
    setResult: (result: ActionResult) => void
  }
  canvas: { isolatedCurrent: Current<ReturnType<typeof useIsolatedCanvas>>; canvasRefreshBlocked: Current<boolean> }
  view: { sitePreview: SitePreviewContext; previewHidden: boolean }
}

/** Open a visitor view of the saved draft using the current canvas policy. */
export function visitorPreview({ props, draft, canvas, view }: Inputs) {
  const { currentEditor, latestSave, savedVersionId, setResult } = draft
  const { isolatedCurrent, canvasRefreshBlocked } = canvas
  const { sitePreview, previewHidden } = view
  async function openVisitorPreview() {
    const tab = window.open('about:blank', '_blank')
    if (!tab) {
      setResult({ ok: false, kind: 'error', message: 'Allow a preview window in your browser, then try again.' })
      return
    }
    tab.opener = null
    tab.document.title = 'Opening preview…'
    tab.document.body.textContent = 'Preparing your saved page…'
    if (isolatedCurrent.current.enabled && !canvasRefreshBlocked.current && !(await isolatedCurrent.current.flush())) {
      tab.close()
      return
    }
    if (isDirty(currentEditor.current) && !(await latestSave.current('checkpoint'))) {
      tab.close()
      return
    }
    const version = savedVersionId.current
    if (!version) {
      tab.close()
      return
    }
    const visitorOrigin = props.visitorPreviewOrigin ?? props.isolatedCanvasOrigin
    if (visitorOrigin) {
      try {
        const channel = crypto.randomUUID(),
          response = await fetch(`/api/pages/${props.pageId}/canvas`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              action: 'open',
              versionId: version,
              sitePreview,
              showHidden: previewHidden,
              channel,
            }),
          })
        const ticket = response.ok ? readCanvasTicket(await response.json(), visitorOrigin, channel) : null
        if (!ticket) throw Error('unavailable')
        isolatedCurrent.current.trackVisitor(tab, ticket)
        tab.location.replace(ticket.href + '?visit=1')
      } catch {
        tab.close()
        setResult({
          ok: false,
          kind: 'error',
          message: 'The saved page preview could not be opened. Your draft is still here. Try Preview again.',
        })
      }
    } else
      tab.location.replace(
        `/preview/${version}?visit=1&lists=draft&site=${sitePreview}&hidden=${previewHidden ? '1' : '0'}`,
      )
  }
  return openVisitorPreview
}
