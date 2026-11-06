import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'
import { PREVIEW_MESSAGE, PREVIEW_RUNTIME } from './preview-runtime.ts'

function preview(attributes: Record<string, string> = {}) {
  let listening = false
  const received: { type: string; documentId?: string; channel?: string; requestId?: string }[] = []
  const destinations: string[] = []
  const labels: Record<string, string> = {}
  const handlers = new Map<string, (event: unknown) => void>()
  const parent = {
    postMessage(message: (typeof received)[number], origin: string) {
      if (listening) {
        received.push(message)
        destinations.push(origin)
      }
    },
  }
  const window = {
    parent,
    location: { origin: 'https://cms.test' },
    addEventListener(type: string, handler: (event: unknown) => void) {
      handlers.set(type, handler)
    },
  }
  const document = {
    documentElement: {
      getAttribute: (name: string) => attributes[name] ?? null,
      setAttribute: (name: string, value: string) => {
        attributes[name] = value
      },
    },
    querySelector: () => ({
      setAttribute: (name: string, value: string) => {
        labels[name] = value
      },
    }),
    querySelectorAll: () => [],
    addEventListener: () => {},
  }
  runInNewContext(PREVIEW_RUNTIME, { window, document })
  return {
    received,
    parent,
    destinations,
    labels,
    send(data: Record<string, unknown>, origin: string) {
      handlers.get('message')?.({ source: parent, origin, data })
    },
    listen() {
      listening = true
    },
    request(source: unknown = parent, origin = window.location.origin, channel?: string, requestId?: string) {
      handlers.get('message')?.({ source, origin, data: { type: 'cms:request-ready', channel, requestId } })
    },
  }
}

describe('preview readiness handshake', () => {
  it('recovers when the preview loads before the editor starts listening', () => {
    const frame = preview()
    expect(frame.received).toEqual([])
    frame.listen()
    frame.request()
    expect(frame.received).toEqual([{ type: PREVIEW_MESSAGE.ready, documentId: expect.any(String) }])
  })

  it('identifies repeated acknowledgements as the same loaded document', () => {
    const frame = preview()
    frame.listen()
    frame.request()
    frame.request()
    expect(frame.received).toHaveLength(2)
    expect(frame.received[0]?.documentId).toBeTruthy()
    expect(frame.received[1]?.documentId).toBe(frame.received[0]?.documentId)
  })

  it('isolated readiness requires the exact configured parent and channel', () => {
    const channel = 'isolated-canvas-channel-123456'
    const frame = preview({ 'data-cms-parent-origin': 'https://admin.test', 'data-cms-channel': channel })
    frame.listen()
    frame.request(frame.parent, 'https://admin.test')
    frame.request(frame.parent, 'https://admin.test', 'wrong-channel')
    frame.request({}, 'https://admin.test', channel)
    frame.request(frame.parent, 'https://cms.test', channel)
    expect(frame.received).toEqual([])
    frame.request(frame.parent, 'https://admin.test', channel)
    expect(frame.received).toEqual([{ type: PREVIEW_MESSAGE.ready, documentId: expect.any(String), channel }])
    expect(frame.destinations).toEqual(['https://admin.test'])
  })

  it('echoes a bounded readiness challenge while preserving its document identity', () => {
    const channel = 'isolated-canvas-channel-123456',
      origin = 'https://admin.test'
    const frame = preview({ 'data-cms-parent-origin': origin, 'data-cms-channel': channel })
    frame.listen()
    frame.request(frame.parent, origin, channel, 'reload-1234')
    expect(frame.received).toEqual([
      { type: PREVIEW_MESSAGE.ready, documentId: expect.any(String), channel, requestId: 'reload-1234' },
    ])
    frame.request(frame.parent, origin, channel, 'x'.repeat(81))
    expect(frame.received[1]).toEqual({
      type: PREVIEW_MESSAGE.ready,
      documentId: frame.received[0]!.documentId,
      channel,
    })
  })

  it('an isolated command cannot affect a replacement document', () => {
    const channel = 'isolated-canvas-channel-123456',
      origin = 'https://admin.test'
    const frame = preview({ 'data-cms-parent-origin': origin, 'data-cms-channel': channel })
    frame.listen()
    frame.request(frame.parent, origin, channel)
    const command = {
      type: PREVIEW_MESSAGE.setLabels,
      labels: ['Current section'],
      channel,
      documentId: frame.received[0]!.documentId,
    }
    frame.send({ ...command, documentId: 'old-document' }, origin)
    frame.send({ ...command, documentId: undefined }, origin)
    expect(frame.labels).toEqual({})
    frame.send(command, origin)
    expect(frame.labels).toEqual({ 'data-cms-label': 'Current section', title: 'Current section' })
  })

  it('answers only the same-origin parent', () => {
    const frame = preview()
    frame.listen()
    frame.request({}, 'https://cms.test')
    frame.request(frame.parent, 'https://foreign.test')
    expect(frame.received).toEqual([])
  })
})
