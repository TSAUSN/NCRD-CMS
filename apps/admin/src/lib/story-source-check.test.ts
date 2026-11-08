import { it, expect, vi } from 'vitest'
import { readSawsoStoriesSource } from './story-source-check.ts'
import { SAWSO_STORIES_FEED } from './story-source-endpoint.ts'
import { createStorySourceCheckHandler } from './story-source-check-handler.ts'
const site = '00000000-0000-4000-8000-000000000001',
  collection = '00000000-0000-4000-8000-000000000002',
  id = '00000000-0000-4000-8000-000000000003'
const check = {
  id,
  status: 'ok' as const,
  started_at: '2026-10-31T11:00:00Z',
  finished_at: '2026-10-31T11:00:01Z',
  result: { added: 1 },
}
const request = (body: unknown = { collectionId: collection, requestId: id }, origin = 'http://localhost') =>
  new Request('http://localhost/api/sites/' + site + '/stories/check', {
    method: 'POST',
    headers: { origin, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
it('only reads the fixed endpoint once with no redirects, credentials or caching', async () => {
  const fetcher = vi.fn(async () => new Response('local synthetic response'))
  expect(await readSawsoStoriesSource(fetcher as typeof fetch)).toBe('local synthetic response')
  expect(fetcher).toHaveBeenCalledTimes(1)
  expect(fetcher).toHaveBeenCalledWith(
    SAWSO_STORIES_FEED,
    expect.objectContaining({
      redirect: 'error',
      cache: 'no-store',
      credentials: 'omit',
      signal: expect.any(AbortSignal),
    }),
  )
})
it('refuses failed, oversized or invalid UTF-8 responses without another request', async () => {
  for (const response of [
    new Response('unavailable', { status: 503 }),
    new Response('too large', { headers: { 'content-length': '20000001' } }),
    new Response(new Uint8Array([255])),
  ]) {
    const fetcher = vi.fn(async () => response)
    await expect(readSawsoStoriesSource(fetcher as typeof fetch)).rejects.toThrow()
    expect(fetcher).toHaveBeenCalledTimes(1)
  }
})
it('requires same-origin session and a bounded closed request before invoking a check', async () => {
  const run = vi.fn(async () => check),
    handler = createStorySourceCheckHandler({ currentUser: async () => 'actor', check: run })
  for (const req of [
    request({}, 'https://foreign.test'),
    request({ collectionId: collection, requestId: id, url: 'https://foreign.test' }),
    request({ collectionId: collection, requestId: 'bad' }),
    request({ large: 'x'.repeat(1000) }),
  ])
    expect((await handler(req, site)).status).toBeGreaterThanOrEqual(400)
  expect(run).not.toHaveBeenCalled()
  expect(
    (await createStorySourceCheckHandler({ currentUser: async () => null, check: run })(request(), site)).status,
  ).toBe(404)
  expect(run).not.toHaveBeenCalled()
})
it('returns only the safe saved status and passes the resolved actor and request identity', async () => {
  const run = vi.fn(async () => ({ ...check, created_by: 'private-user-id' })),
    response = await createStorySourceCheckHandler({ currentUser: async () => 'actor', check: run })(request(), site)
  expect(response.status).toBe(200)
  expect(response.headers.get('cache-control')).toBe('private, no-store')
  expect(await response.json()).toEqual({ check })
  expect(run).toHaveBeenCalledWith('actor', site, collection, id)
})
