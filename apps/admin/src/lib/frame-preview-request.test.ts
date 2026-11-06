import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { queueFramePreview, requestFramePreview } from './frame-preview-request.ts'
const url = '/api/sites/synthetic/global-elements/preview'
describe('frame preview failure and replacement requests', () => {
  it('returns the current successful markup', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('<main>Current frame</main>'))
    expect(await requestFramePreview(url, { header: 'new' }, new AbortController().signal, fetcher)).toEqual({
      kind: 'ready',
      html: '<main>Current frame</main>',
    })
    expect(fetcher.mock.calls[0]?.[1]?.body).toBe('{"header":"new"}')
  })
  it.each([400, 403, 404, 500])('does not return older or error markup on HTTP %i', async status => {
    const result = await requestFramePreview(
      url,
      {},
      new AbortController().signal,
      vi.fn<typeof fetch>().mockResolvedValue(new Response('error body', { status })),
    )
    expect(result.kind).toBe('error')
    expect(result).not.toHaveProperty('html')
  })
  it('handles rejected network requests without an unhandled rejection', async () => {
    expect(
      (
        await requestFramePreview(
          url,
          {},
          new AbortController().signal,
          vi.fn<typeof fetch>().mockRejectedValue(new TypeError('offline')),
        )
      ).kind,
    ).toBe('error')
  })
  it('ignores an obsolete fetch even if its implementation resolves after abort', async () => {
    const controller = new AbortController()
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => {
      controller.abort()
      return new Response('old')
    })
    expect(await requestFramePreview(url, {}, controller.signal, fetcher)).toEqual({ kind: 'aborted' })
  })
  it('ignores an obsolete response body that completes after a newer edit', async () => {
    const controller = new AbortController()
    const response = new Response('old')
    vi.spyOn(response, 'text').mockImplementation(async () => {
      controller.abort()
      return 'old'
    })
    expect(
      await requestFramePreview(url, {}, controller.signal, vi.fn<typeof fetch>().mockResolvedValue(response)),
    ).toEqual({ kind: 'aborted' })
  })
  it('treats rejected cancellations as superseded, not an error', async () => {
    const controller = new AbortController()
    controller.abort()
    expect(
      await requestFramePreview(
        url,
        {},
        controller.signal,
        vi.fn<typeof fetch>().mockRejectedValue(new Error('abort')),
      ),
    ).toEqual({ kind: 'aborted' })
  })
})

describe('preview navigation lifecycle', () => {
  let lifecycle: EventTarget
  beforeEach(() => {
    vi.useFakeTimers()
    lifecycle = new EventTarget()
    vi.stubGlobal('window', Object.assign(lifecycle, { setTimeout, clearTimeout }))
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })
  it.each(['beforeunload', 'pagehide'])('does not start a queued request after %s', async event => {
    const run = vi.fn(async (_signal: AbortSignal) => {})
    const cleanup = queueFramePreview(run)
    lifecycle.dispatchEvent(new Event(event))
    await vi.runAllTimersAsync()
    expect(run).not.toHaveBeenCalled()
    cleanup()
  })
  it('aborts an active preview before the document leaves', async () => {
    const run = vi.fn(async (_signal: AbortSignal) => {})
    const cleanup = queueFramePreview(run)
    await vi.advanceTimersByTimeAsync(180)
    expect(run).toHaveBeenCalledOnce()
    const signal = run.mock.calls[0]![0]
    expect(signal.aborted).toBe(false)
    lifecycle.dispatchEvent(new Event('pagehide'))
    expect(signal.aborted).toBe(true)
    cleanup()
  })
  it('keeps a preview when the navigation guard cancels leaving', async () => {
    const run = vi.fn(async (_signal: AbortSignal) => {})
    const cleanup = queueFramePreview(run)
    const event = new Event('beforeunload', { cancelable: true })
    event.preventDefault()
    lifecycle.dispatchEvent(event)
    await vi.advanceTimersByTimeAsync(180)
    expect(run).toHaveBeenCalledOnce()
    expect(run.mock.calls[0]![0].aborted).toBe(false)
    cleanup()
    expect(run.mock.calls[0]![0].aborted).toBe(true)
  })
  it('removes obsolete listeners when an edit replaces the preview', async () => {
    const remove = vi.spyOn(lifecycle, 'removeEventListener')
    const run = vi.fn(async (_signal: AbortSignal) => {})
    queueFramePreview(run)()
    await vi.runAllTimersAsync()
    expect(run).not.toHaveBeenCalled()
    expect(remove.mock.calls.map(call => call[0])).toEqual(['beforeunload', 'pagehide'])
  })
})
