import { beforeEach, expect, it, vi } from 'vitest'
const stubs = vi.hoisted(() => ({ origin: vi.fn(), asUser: vi.fn(), accept: vi.fn(), issue: vi.fn() }))
vi.mock('server-only', () => ({}))
vi.mock('../../../lib/session.ts', () => ({ authProvider: () => ({ name: 'local', issue: stubs.issue }) }))
vi.mock('../../../lib/local-chapter-mail.ts', () => ({ localChapterMailOrigin: stubs.origin }))
vi.mock('@cms/platform', async original => ({
  ...(await original<object>()),
  asUser: stubs.asUser,
  acceptInvite: stubs.accept,
  localSessionCookieSecure: () => false,
}))
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('not-found')
  },
}))
import { GET } from './route.ts'
beforeEach(() => {
  vi.resetAllMocks()
  stubs.origin.mockReturnValue('http://localhost:3000')
  stubs.issue.mockResolvedValue('signed-local-session')
  stubs.accept.mockResolvedValue('person')
})
it('is unavailable outside the explicitly local adapter', async () => {
  stubs.origin.mockReturnValue(null)
  await expect(GET(new Request('http://localhost:3000/auth/local-chapter'))).rejects.toThrow('not-found')
  expect(stubs.asUser).not.toHaveBeenCalled()
})
it('sets a session only after consuming an authorized one-use capability and redirects without its query', async () => {
  stubs.asUser.mockResolvedValue({ user_id: 'person', email: 'chapter@example.test', page_id: 'page' })
  const response = await GET(new Request('http://localhost:3000/auth/local-chapter?code=local-test-code'))
  expect(response.status).toBe(303)
  expect(response.headers.get('location')).toBe('http://localhost:3000/pages/page')
  expect(response.headers.get('cache-control')).toBe('no-store, private')
  expect(response.headers.get('referrer-policy')).toBe('no-referrer')
  expect(response.headers.get('set-cookie')).toContain('HttpOnly')
  expect(stubs.accept).toHaveBeenCalledWith(
    expect.objectContaining({ subject: 'local|chapter@example.test', email: 'chapter@example.test' }),
  )
  expect(stubs.issue).toHaveBeenCalledTimes(1)
})
it('never issues a session for expired, reused or refused links', async () => {
  stubs.asUser.mockResolvedValue(undefined)
  const response = await GET(new Request('http://localhost:3000/auth/local-chapter?code=expired'))
  expect(response.headers.get('location')).toContain('/sign-in?error=expired-link')
  expect(response.headers.has('set-cookie')).toBe(false)
  expect(stubs.issue).not.toHaveBeenCalled()
})
