import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DomainError } from '@cms/domain'

const mocks = vi.hoisted(() => ({ session: vi.fn(), asUser: vi.fn(), evaluate: vi.fn() }))
vi.mock('server-only', () => ({}))
vi.mock('../lib/session.ts', () => ({ currentSession: mocks.session, authProvider: vi.fn() }))
vi.mock('@cms/platform', async original => ({
  ...(await original<object>()),
  asUser: mocks.asUser,
  evaluateVersionReadiness: mocks.evaluate,
}))
vi.mock('next/navigation', () => ({
  redirect: () => {
    throw new Error('redirect-to-sign-in')
  },
}))
import { runReadiness } from './actions/page-publish.ts'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.session.mockResolvedValue({ principal: { userId: 'verified-user' } })
  mocks.asUser.mockImplementation(async (_identity, run) => run({ query: vi.fn() }))
  mocks.evaluate.mockResolvedValue({ ok: true, findings: [] })
})
describe('readiness action authentication', () => {
  it('derives the database actor from the verified session', async () => {
    await runReadiness('requested-version')
    expect(mocks.asUser.mock.calls[0]![0]).toEqual({ userId: 'verified-user' })
    expect(mocks.evaluate.mock.calls[0]!.slice(1)).toEqual(['requested-version', 'member'])
  })
  it('does not query content when no session exists', async () => {
    mocks.session.mockResolvedValue(null)
    await expect(runReadiness('requested-version')).rejects.toThrow('redirect-to-sign-in')
    expect(mocks.asUser).not.toHaveBeenCalled()
  })
  it('keeps authorization failures distinct from incomplete authoring state', async () => {
    mocks.evaluate.mockRejectedValue(new DomainError('not_authorized', 'No access'))
    await expect(runReadiness('requested-version')).rejects.toMatchObject({ kind: 'not_authorized' })
    mocks.evaluate.mockRejectedValue(new DomainError('invalid_state', 'Choose a collection'))
    expect(await runReadiness('requested-version')).toMatchObject({
      ok: false,
      blocking: [{ message: 'Choose a collection' }],
    })
  })
})
