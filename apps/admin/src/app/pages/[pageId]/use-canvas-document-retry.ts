import { useEffect, useState } from 'react'
import { PREVIEW_MESSAGE } from '@cms/renderer'

const READY_PROBE_MS = 2_000
const DOCUMENT_RETRY_MS = 7_000

/**
 * A successful document request does not guarantee a ready iframe. Ask the
 * current runtime to respond without waiting for images or fonts. If that
 * fails, remount this same saved version once and leave the editor state alone.
 * The editor still requires its normal, verified ready message.
 */
export function useCanvasDocumentRetry(
  source: string | null,
  ready: boolean,
  post: (message: Record<string, unknown>) => void,
): boolean {
  const [retriedSource, setRetriedSource] = useState<string | null>(null)
  const retried = Boolean(source && source === retriedSource)
  useEffect(() => {
    if (!source || ready) return
    const probe = window.setTimeout(() => post({ type: PREVIEW_MESSAGE.requestReady }), READY_PROBE_MS)
    const retry = retried ? undefined : window.setTimeout(() => setRetriedSource(source), DOCUMENT_RETRY_MS)
    return () => {
      window.clearTimeout(probe)
      window.clearTimeout(retry)
    }
  }, [source, ready, post, retried])
  return retried
}
