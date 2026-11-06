import { it, expect, vi, afterEach } from 'vitest'
import { canvasDocumentReady, readCanvasTicket } from './use-isolated-canvas.ts'
afterEach(() => vi.unstubAllGlobals())
it('reloads a client entry from a workspace or another site, retaining exact document policy', () => {
  const reload = vi.fn(),
    dataset: { cmsCanvasOrigin?: string } = {}
  vi.stubGlobal('document', { documentElement: { dataset } })
  vi.stubGlobal('window', { location: { reload, origin: 'http://admin.test', pathname: '/pages/current' } })
  vi.stubGlobal('performance', { getEntriesByType: () => [{ name: 'http://admin.test/pages/current' }] })
  const origin = 'http://own.staging.localhost:3201'
  expect(canvasDocumentReady(origin)).toBe(false)
  expect(reload).toHaveBeenCalledOnce()
  dataset.cmsCanvasOrigin = 'http://other.staging.localhost:3201'
  expect(canvasDocumentReady(origin)).toBe(false)
  expect(reload).toHaveBeenCalledTimes(2)
  dataset.cmsCanvasOrigin = origin
  expect(canvasDocumentReady(origin)).toBe(true)
  expect(reload).toHaveBeenCalledTimes(2)
})
it('does not trust a React-updated marker after a server-action redirect from another document', () => {
  const reload = vi.fn(),
    origin = 'http://own.staging.localhost:3201'
  vi.stubGlobal('document', { documentElement: { dataset: { cmsCanvasOrigin: origin } } })
  vi.stubGlobal('window', { location: { reload, origin: 'http://admin.test', pathname: '/pages/new' } })
  vi.stubGlobal('performance', { getEntriesByType: () => [{ name: 'http://admin.test/sites/own' }] })
  expect(canvasDocumentReady(origin)).toBe(false)
  expect(reload).toHaveBeenCalledOnce()
  vi.stubGlobal('performance', { getEntriesByType: () => [{ name: 'http://admin.test/pages/new?field=title' }] })
  expect(canvasDocumentReady(origin)).toBe(true)
  vi.stubGlobal('performance', { getEntriesByType: () => [] })
  expect(canvasDocumentReady(origin)).toBe(false)
  expect(reload).toHaveBeenCalledTimes(2)
})
it('accepts only the exact issued own-site capability address', () => {
  const origin = 'http://own.staging.localhost:3201',
    token = 'a'.repeat(64),
    channel = 'test-channel-12345678',
    row = { href: `${origin}/__cms/canvas/${token}`, token, expiresAt: '2026-10-26T12:10:00Z' }
  expect(readCanvasTicket(row, origin, channel)).toEqual({ ...row, origin, channel, documentId: null, requestId: null })
  for (const patch of [
    { href: 'https://foreign.test/__cms/canvas/' + token },
    { href: row.href + '?redirect=1' },
    { href: origin + '/../__cms/canvas/' + token },
    { token: 'b'.repeat(64) },
    { token: '../path' },
    { expiresAt: 'never' },
  ])
    expect(readCanvasTicket({ ...row, ...patch }, origin, channel)).toBeNull()
  expect(readCanvasTicket(null, origin, channel)).toBeNull()
})
