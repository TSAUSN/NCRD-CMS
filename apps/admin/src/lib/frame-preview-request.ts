/** The client never labels an older preview as the result of a failed request. */
export type FramePreviewResult =
  | { kind: 'ready'; html: string }
  | { kind: 'aborted' }
  | { kind: 'error'; message: string }
export async function requestFramePreview(
  url: string,
  body: unknown,
  signal: AbortSignal,
  fetcher: typeof fetch = fetch,
): Promise<FramePreviewResult> {
  try {
    const response = await fetcher(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    })
    if (signal.aborted) return { kind: 'aborted' }
    if (!response.ok)
      return { kind: 'error', message: 'The preview could not be rendered. Check the selected fields and try again.' }
    const html = await response.text()
    // Cancellation can happen while the response body is being read, too.
    return signal.aborted ? { kind: 'aborted' } : { kind: 'ready', html }
  } catch {
    return signal.aborted
      ? { kind: 'aborted' }
      : { kind: 'error', message: 'The preview could not be loaded. Check your connection and try again.' }
  }
}

/** Site-wide previews use the fixed frame setup and anchor to the chosen area. */
export function framePreviewAddress(ticketHref: string, part: 'header' | 'footer'): string {
  return ticketHref + '?visit=1&frame=1#cms-preview-' + part
}

/** Stop queued and active previews before navigation replaces this document. */
export function queueFramePreview(
  run: (signal: AbortSignal) => Promise<void>,
  timeout?: { afterMs: number; onTimeout: () => void },
): () => void {
  const controller = new AbortController()
  const timer = window.setTimeout(() => {
    void run(controller.signal).finally(() => window.clearTimeout(deadline))
  }, 180)
  const deadline = timeout
    ? window.setTimeout(() => {
        cancel()
        timeout.onTimeout()
      }, timeout.afterMs)
    : undefined
  const cancel = () => {
    window.clearTimeout(timer)
    window.clearTimeout(deadline)
    controller.abort()
  }
  const beforeUnload = (event: BeforeUnloadEvent) => {
    if (!event.defaultPrevented) cancel()
  }
  window.addEventListener('beforeunload', beforeUnload)
  window.addEventListener('pagehide', cancel)
  return () => {
    cancel()
    window.removeEventListener('beforeunload', beforeUnload)
    window.removeEventListener('pagehide', cancel)
  }
}
