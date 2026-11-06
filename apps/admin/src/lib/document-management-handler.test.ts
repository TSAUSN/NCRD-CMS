import { describe, expect, it, vi } from 'vitest'
import { createDocumentManagementHandlers } from './document-management-handler.ts'
const site = '00000000-0000-4000-a000-000000000001',
  id = '00000000-0000-4000-a000-000000000002'
const input = { id, revision: 0, category: 'Reports', archived: false }
function harness() {
  const deps = {
    currentSession: vi.fn(async () => ({ userId: 'editor' })),
    list: vi.fn(async () => ({ documents: [], total: 0, categories: [] })),
    organize: vi.fn(async () => 1),
  }
  return { deps, ...createDocumentManagementHandlers(deps) }
}
const request = (body: unknown = input, origin = 'http://admin.test') =>
  new Request('http://admin.test/api/documents', {
    method: 'PATCH',
    headers: { origin, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
describe('document management HTTP boundary', () => {
  it('passes bounded filters and returns non-cacheable results', async () => {
    const h = harness(),
      response = await h.GET(
        new Request('http://admin.test/api?search=Annual&category=Reports&archived=true&page=2'),
        site,
      )
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(h.deps.list).toHaveBeenCalledWith('editor', site, {
      search: 'Annual',
      category: 'Reports',
      archived: true,
      page: 2,
    })
  })
  it('rejects invalid filters and wrong origin before accessing document metadata', async () => {
    const h = harness()
    for (const q of ['page=0', 'page=1x', 'archived=yes', 'category=' + 'x'.repeat(81)])
      expect((await h.GET(new Request(`http://admin.test/api?${q}`), site)).status).toBe(400)
    expect((await h.PATCH(request(input, 'https://outside.test'), site)).status).toBe(403)
    expect(h.deps.organize).not.toHaveBeenCalled()
    expect(h.deps.list).not.toHaveBeenCalled()
  })
  it('accepts zero revision and rejects malformed or oversized streamed metadata', async () => {
    const h = harness()
    expect((await h.PATCH(request(), site)).status).toBe(200)
    expect(h.deps.organize).toHaveBeenCalledWith('editor', site, input)
    for (const body of [
      null,
      [],
      { ...input, revision: null },
      { ...input, category: 'bad\nvalue' },
      { ...input, archived: 'false' },
    ])
      expect((await h.PATCH(request(body), site)).status).toBe(400)
    expect((await h.PATCH(request({ ...input, extra: 'x'.repeat(2048) }), site)).status).toBe(413)
  })
  it('reports a conflict or denied document without hiding it behind success', async () => {
    const h = harness()
    h.deps.organize.mockRejectedValueOnce({ kind: 'stale_revision' })
    expect((await h.PATCH(request(), site)).status).toBe(409)
    h.deps.organize.mockRejectedValueOnce({ kind: 'not_authorized' })
    expect((await h.PATCH(request(), site)).status).toBe(404)
  })
})
