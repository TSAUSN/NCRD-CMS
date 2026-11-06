import { beforeEach, expect, it, vi } from 'vitest'
const stub = vi.hoisted(() => ({ query: vi.fn(), asUser: vi.fn(), active: false }))
vi.mock('./database.ts', () => ({ asUser: stub.asUser }))
import { resolvePrincipal } from './session.ts'
beforeEach(() => {
  stub.query.mockReset()
  stub.asUser.mockReset()
  stub.active = false
  stub.asUser.mockImplementation(async (_context: unknown, run: (client: unknown) => Promise<unknown>) => {
    expect(stub.active).toBe(false)
    stub.active = true
    try {
      return await run({ query: stub.query })
    } finally {
      stub.active = false
    }
  })
})
const identity = {
  user_id: 'person',
  email: 'chapter@example.test',
  display_name: '[Name]',
  is_super_admin: false,
  memberships: {},
}
it('loads page assignments only after releasing the identity lookup connection', async () => {
  stub.query
    .mockResolvedValueOnce({ rows: [identity] })
    .mockResolvedValueOnce({ rows: [{ pages: { page: { siteId: 'site', role: 'contributor' } } }] })
  const session = await resolvePrincipal({ subject: 'local|chapter', email: identity.email })
  expect(session?.principal.memberships.size).toBe(0)
  expect(session?.principal.pageScopes?.get('page')).toEqual({ siteId: 'site', role: 'contributor' })
  expect(stub.asUser.mock.calls.map(call => call[0])).toEqual([{ userId: null }, { userId: 'person' }])
})
it('retains the existing session shape when there are no page assignments', async () => {
  stub.query.mockResolvedValueOnce({ rows: [identity] }).mockResolvedValueOnce({ rows: [{ pages: {}, divisions: {} }] })
  expect(
    (await resolvePrincipal({ subject: 'local|chapter', email: identity.email }))?.principal.pageScopes,
  ).toBeUndefined()
})
it('never reads assignments for an unresolved account or a super admin', async () => {
  stub.query.mockResolvedValueOnce({ rows: [] })
  expect(await resolvePrincipal({ subject: 'unknown', email: identity.email })).toBeNull()
  expect(stub.query).toHaveBeenCalledTimes(1)
  stub.query.mockReset().mockResolvedValueOnce({ rows: [{ ...identity, is_super_admin: true }] })
  expect((await resolvePrincipal({ subject: 'local|root', email: identity.email }))?.principal.isSuperAdmin).toBe(true)
  expect(stub.query).toHaveBeenCalledTimes(1)
})

it('keeps division access before its first page without inventing a site membership', async () => {
  stub.query.mockResolvedValueOnce({ rows: [identity] }).mockResolvedValueOnce({
    rows: [{ pages: {}, divisions: { team: { siteId: 'site', name: 'Example division (sample)' } } }],
  })
  const session = await resolvePrincipal({ subject: 'local|staff', email: identity.email })
  expect(session?.principal.memberships.size).toBe(0)
  expect(session?.principal.pageScopes).toBeUndefined()
  expect(session?.principal.divisionScopes?.get('team')).toEqual({ siteId: 'site', name: 'Example division (sample)' })
})
