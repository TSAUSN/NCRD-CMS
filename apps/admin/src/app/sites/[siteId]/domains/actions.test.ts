import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const stubs = vi.hoisted(() => ({ session: vi.fn(), asUser: vi.fn(), query: vi.fn() }))
vi.mock('../../../../lib/session.ts', () => ({
  currentSession: stubs.session,
  authProvider: () => ({ name: 'local' }),
}))
vi.mock('@cms/platform', () => ({ asUser: stubs.asUser, domainHostname: (value: string) => value }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
import { changeDomain } from './actions.ts'

describe('local domain setup', () => {
  afterEach(() => vi.unstubAllEnvs())
  beforeEach(() => {
    vi.resetAllMocks()
    vi.stubEnv('CMS_LOCAL_TEST_MODE', 'true')
    vi.stubEnv('DOMAIN_PROVIDER', '')
    stubs.session.mockResolvedValue({ principal: { isSuperAdmin: true, userId: 'root' } })
    stubs.asUser.mockImplementation(async (_actor, action) => action({ query: stubs.query }))
  })
  it('refuses add and verify before reserving a hostname or queuing failed work', async () => {
    for (const input of [
      { action: 'add' as const, siteId: 'site', hostname: 'demo.example.org', withWww: false },
      { action: 'check' as const, siteId: 'site', id: 'domain', revision: '0' },
    ]) {
      expect(await changeDomain(input)).toMatchObject({ ok: false, message: expect.stringContaining('local demo') })
    }
    expect(stubs.asUser).not.toHaveBeenCalled()
  })
  it('allows routing revocation even if the provider has become unavailable', async () => {
    expect(
      await changeDomain({
        action: 'remove',
        siteId: 'site',
        id: 'domain',
        revision: '1',
        confirmation: 'demo.example.org',
      }),
    ).toMatchObject({ ok: true })
    expect(stubs.query).toHaveBeenCalledWith('SELECT app.remove_domain($1,$2,$3)', ['domain', '1', 'demo.example.org'])
  })
  it('permits an explicitly simulated local test provider', async () => {
    vi.stubEnv('DOMAIN_PROVIDER', 'fake')
    expect(
      await changeDomain({ action: 'add', siteId: 'site', hostname: 'demo.example.org', withWww: false }),
    ).toMatchObject({ ok: true })
    expect(stubs.query).toHaveBeenCalledWith('SELECT app.add_domain($1,$2,$3)', ['site', 'demo.example.org', false])
  })
  it('does not mistake a hosted admin without worker secrets for the local demo', async () => {
    vi.stubEnv('CMS_LOCAL_TEST_MODE', '')
    expect(await changeDomain({ action: 'check', siteId: 'site', id: 'domain', revision: '0' })).toMatchObject({
      ok: true,
    })
    expect(stubs.query).toHaveBeenCalledWith('SELECT app.check_domain($1)', ['domain'])
  })
  it('still denies ordinary users before any domain mutation', async () => {
    vi.stubEnv('DOMAIN_PROVIDER', 'fake')
    stubs.session.mockResolvedValue({ principal: { isSuperAdmin: false, userId: 'editor' } })
    expect(await changeDomain({ action: 'check', siteId: 'site', id: 'domain', revision: '0' })).toMatchObject({
      ok: false,
      message: expect.stringContaining('Super Admin'),
    })
    expect(stubs.asUser).not.toHaveBeenCalled()
  })
})
