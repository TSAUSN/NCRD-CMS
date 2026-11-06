import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPageRecoveryHeadHandler } from './page-recovery-handler.ts'
const scope = { userId: 'user-a', siteId: 'site-a', pageId: 'page-a' }
const head = { versionId: 'version-a', revision: 5, document: { sections: [], meta: {} } }
const currentUser = vi.fn(),
  readHead = vi.fn()
const handle = createPageRecoveryHeadHandler({ currentUser, readHead })
function request(query = '?user=user-a&site=site-a') {
  return handle(new Request(`https://cms.test/api/pages/page-a/recovery${query}`), 'page-a')
}
beforeEach(() => {
  vi.clearAllMocks()
  currentUser.mockResolvedValue(scope.userId)
  readHead.mockResolvedValue(head)
})
describe('private browser recovery head', () => {
  it('returns only the current authorized scope/head and prevents caching', async () => {
    const response = await request()
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ scope, head })
    expect(readHead).toHaveBeenCalledWith(scope)
    expect(response.headers.get('cache-control')).toBe('no-store, private')
    expect(response.headers.get('vary')).toBe('Cookie')
  })
  it.each([null, 'user-b'])('refuses absent or changed account before accessing the page (%s)', async userId => {
    currentUser.mockResolvedValue(userId)
    const response = await request()
    expect(response.status).toBe(403)
    expect(readHead).not.toHaveBeenCalled()
    expect(await response.text()).not.toContain('version-a')
  })
  it('fails closed for a wrong site, archived/invisible page or invalid saved head', async () => {
    expect((await request('?user=user-a')).status).toBe(404)
    expect(readHead).not.toHaveBeenCalled()
    readHead.mockResolvedValueOnce(null)
    expect((await request('?user=user-a&site=other')).status).toBe(404)
    expect(readHead).toHaveBeenLastCalledWith({ ...scope, siteId: 'other' })
    readHead.mockResolvedValueOnce({ ...head, document: { sections: 'invalid' } })
    expect((await request()).status).toBe(404)
  })
})
