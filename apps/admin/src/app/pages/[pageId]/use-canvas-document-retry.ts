import { useEffect } from 'react'
import { PREVIEW_MESSAGE } from '@cms/renderer'

const READY_PROBE_MS = 2_000
const DOCUMENT_RETRY_MS = 7_000

/** Probe the current runtime, then use the editor's normal reload once if needed. */
export function useCanvasDocumentRetry(
  source: string | null,
  ready: boolean,
  alreadyRetried: boolean,
  post: (message: Record<string, unknown>) => void,
  reload: () => void,
): void {
  useEffect(() => {
    if (!source || ready) return
    const probe = window.setTimeout(() => post({ type: PREVIEW_MESSAGE.requestReady }), READY_PROBE_MS)
    const retry = alreadyRetried ? undefined : window.setTimeout(reload, DOCUMENT_RETRY_MS)
    return () => {
      window.clearTimeout(probe)
      window.clearTimeout(retry)
    }
  }, [source, ready, alreadyRetried, post, reload])
}
