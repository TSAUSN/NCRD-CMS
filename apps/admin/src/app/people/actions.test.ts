import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const stubs = vi.hoisted(() => ({ session: vi.fn(), asUser: vi.fn(), query: vi.fn(), provider: vi.fn() }))
vi.mock('../../lib/session.ts', () => ({ currentSession: stubs.session, authProvider: stubs.provider }))
vi.mock('@cms/platform', () => ({ asUser: stubs.asUser }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
import { addPerson, invitePerson, resendInvitation, updatePerson } from './actions.ts'

beforeEach(() => {
  vi.resetAllMocks()
  stubs.provider.mockReturnValue({ name: 'local' })
  vi.stubEnv('INVITATION_EMAIL_ENABLED', 'false')
  stubs.session.mockResolvedValue({ principal: { isSuperAdmin: true, userId: 'owner' } })
  stubs.asUser.mockImplementation(async (_actor, action) => action({ query: stubs.query }))
})
afterEach(() => vi.unstubAllEnvs())

it('refuses new and repeated email invitations before changing account access or queueing undeliverable work', async () => {
  expect(await invitePerson({ name: 'Invited person', email: 'person@example.test', memberships: [] })).toMatchObject({
    ok: false,
    message: expect.stringContaining('off for this pilot'),
  })
  expect(await resendInvitation('person', '0')).toMatchObject({ ok: false })
  expect(stubs.asUser).not.toHaveBeenCalled()
})

it('keeps existing account permissions manageable while invitation delivery is off', async () => {
  expect(
    await updatePerson({ id: 'person', revision: '0', name: 'Existing person', status: 'active', memberships: [] }),
  ).toMatchObject({ ok: true })
  expect(stubs.query).toHaveBeenCalledWith('SELECT app.update_person($1,$2,$3,$4,$5)', [
    'person',
    '0',
    'Existing person',
    'active',
    '[]',
  ])
})

it('adds scoped product access without queueing an invitation when delivery is off', async () => {
  expect(
    await addPerson({
      name: 'New editor',
      email: 'editor@example.test',
      memberships: [{ siteId: 'site', role: 'editor' }],
    }),
  ).toMatchObject({ ok: true, message: expect.stringContaining('No invitation email was sent') })
  expect(stubs.query).toHaveBeenCalledExactlyOnceWith('SELECT app.add_person($1,$2,$3)', [
    'editor@example.test',
    'New editor',
    '[{"siteId":"site","role":"editor"}]',
  ])
})

it('requires Super admin and a fresh hosted sign-in before adding someone', async () => {
  stubs.session.mockResolvedValueOnce({ principal: { isSuperAdmin: false, userId: 'editor' } })
  expect(await addPerson({ name: 'Person', email: 'person@example.test', memberships: [] })).toMatchObject({
    ok: false,
  })
  stubs.provider.mockReturnValue({ name: 'supabase' })
  expect(await addPerson({ name: 'Person', email: 'person@example.test', memberships: [] })).toMatchObject({
    ok: false,
    reauthenticate: true,
  })
  expect(stubs.asUser).not.toHaveBeenCalled()
})
