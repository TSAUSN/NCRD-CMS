import { expect, it, vi } from 'vitest'
import { observePublicResponse } from './observability.ts'
it('records public request/error metrics without exception or tenant data', async () => {
  const log = vi.fn()
  const response = await observePublicResponse(async () => {
    throw new Error('postgres://secret@example.org/tenant')
  }, log)
  expect(response.status).toBe(503)
  expect(response.headers.get('cache-control')).toBe('no-store')
  expect(log.mock.calls[0]?.[0]).not.toContain('secret')
  expect(JSON.parse(log.mock.calls[0]![0])).toMatchObject({ event: 'cms.public.request', status: 503, error: true })
})
it('preserves successful and neutral missing responses', async () => {
  const log = vi.fn()
  const response = new Response(null, { status: 404 })
  expect(await observePublicResponse(async () => response, log)).toBe(response)
  expect(JSON.parse(log.mock.calls[0]![0])).toMatchObject({ status: 404, error: false })
})
