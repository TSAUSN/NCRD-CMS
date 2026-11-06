import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DomainError } from '@cms/domain'
const execute = vi.hoisted(() => vi.fn())
vi.mock('./scheduled-release.ts', () => ({ executeLeasedRelease: execute }))
import { POST } from '../app/api/internal/scheduled-release/route.ts'
const id = '00000000-0000-4000-8000-000000000001',
  lease = '00000000-0000-4000-8000-000000000002'
const request = (body: unknown) =>
  new Request('http://localhost/api/internal/scheduled-release', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
beforeEach(() => execute.mockReset())
describe('lease execution HTTP boundary', () => {
  it('accepts only two valid capability references and does not use browser identity', async () => {
    execute.mockResolvedValue(undefined)
    const response = await POST(request({ id, lease }))
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(execute).toHaveBeenCalledExactlyOnceWith(id, lease)
  })
  it('refuses extra actors, malformed references, arrays, missing bodies and oversized UTF-8 bodies', async () => {
    for (const body of [{ id, lease, actor: id }, { id: 'x', lease }, [id, lease], { id }, null])
      expect((await POST(request(body))).status).toBe(400)
    expect((await POST(new Request('http://localhost', { method: 'POST' }))).status).toBe(415)
    expect((await POST(request({ id: 'é'.repeat(140), lease }))).status).toBe(413)
    expect(execute).not.toHaveBeenCalled()
  })
  it('classifies domain refusals and hides infrastructure errors and lease details', async () => {
    execute.mockRejectedValueOnce(new DomainError('stale_revision', 'Review the newer work.'))
    const blocked = await POST(request({ id, lease }))
    expect(blocked.status).toBe(409)
    expect(await blocked.json()).toEqual({ ok: false, permanent: true, message: 'Review the newer work.' })
    execute.mockRejectedValueOnce(new Error('Unexpected internal secret ' + lease))
    const failed = await POST(request({ id, lease }))
    expect(failed.status).toBe(503)
    expect(await failed.text()).not.toContain(lease)
  })
})
