import { describe, expect, it, vi } from 'vitest'
import { executeReleaseSchedule } from './release-schedules.ts'
describe('release schedule transport', () => {
  it('sends a lease only to the configured own-origin endpoint without redirecting', async () => {
    const fetch = vi.fn(async () => Response.json({ ok: true }))
    await executeReleaseSchedule('job', 'secret-lease', { origin: 'http://127.0.0.1:3200', fetch })
    const [url, request] = fetch.mock.calls[0] as unknown as [URL, RequestInit]
    expect(String(url)).toBe('http://127.0.0.1:3200/api/internal/scheduled-release')
    expect(request.redirect).toBe('error')
    expect(request.method).toBe('POST')
    expect(JSON.parse(request.body as string)).toEqual({ id: 'job', lease: 'secret-lease' })
    expect(request.signal).toBeInstanceOf(AbortSignal)
  })
  it('refuses credential-bearing, nonlocal HTTP and non-origin destinations before sending', async () => {
    const fetch = vi.fn()
    for (const origin of [
      '',
      'http://example.test',
      'https://user:password@example.test',
      'https://cms.example.test/other',
      'https://cms.example.test?token=x',
      'ftp://localhost',
    ]) {
      await expect(executeReleaseSchedule('job', 'lease', { origin, fetch })).rejects.toThrow()
    }
    expect(fetch).not.toHaveBeenCalled()
  })
  it('classifies an explicit domain refusal as permanent and keeps arbitrary bodies out of errors', async () => {
    await expect(
      executeReleaseSchedule('job', 'lease', {
        origin: 'https://cms.example.test',
        fetch: vi.fn(async () =>
          Response.json({ ok: false, permanent: true, message: 'secret-lease' }, { status: 409 }),
        ),
      }),
    ).rejects.toMatchObject({ kind: 'invalid_state' })
    for (const response of [
      new Response('secret-lease', { status: 502 }),
      Response.json({ ok: false, permanent: false, message: 'secret-lease' }, { status: 503 }),
      new Response('x'.repeat(5000)),
    ]) {
      const error = await executeReleaseSchedule('job', 'lease', {
        origin: 'https://cms.example.test',
        fetch: vi.fn(async () => response),
      }).catch(error => error)
      expect(error.message).not.toContain('secret-lease')
      expect(error.kind).toBeUndefined()
    }
  })
})
