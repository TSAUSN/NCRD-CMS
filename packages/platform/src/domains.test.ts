import { describe, expect, it, vi } from 'vitest'
import {
  cloudflareDomainState,
  configuredDomainProvisioner,
  createCloudflareDomainProvisioner,
  domainHostname,
} from './domains.ts'
const item = {
  id: 'a'.repeat(32),
  hostname: 'example.org',
  status: 'active',
  ssl: { status: 'active', validation_records: [{ txt_name: '_acme-challenge.example.org', txt_value: 'cert-token' }] },
  ownership_verification: { type: 'txt', name: '_cf-custom-hostname.example.org', value: 'ownership-token' },
}
const envelope = (result: unknown) => Response.json({ success: true, result })
const verification = { name: '_cms-verify.example.org', value: '11111111-1111-4111-8111-111111111111' }
const create = (
  fetcher: typeof fetch,
  dns = {
    cname: vi.fn().mockResolvedValue(['customers.example.net.']),
    ipv4: vi.fn().mockResolvedValue([]),
    txt: vi.fn().mockResolvedValue([[verification.value]]),
  },
) =>
  createCloudflareDomainProvisioner({
    apiToken: 'scoped-token',
    zoneId: 'b'.repeat(32),
    cnameTarget: 'customers.example.net',
    fetcher,
    dns,
  })
describe('Cloudflare SaaS contract', () => {
  it('requires active ownership, active certificate AND matching DNS', () => {
    expect(cloudflareDomainState(item, true).state).toBe('live')
    expect(cloudflareDomainState(item, false).state).toBe('pending_dns')
    expect(cloudflareDomainState({ ...item, status: 'pending' }, true).state).toBe('verifying')
    expect(cloudflareDomainState({ ...item, ssl: { status: 'pending_deployment' } }, true).state).toBe('issuing_cert')
    expect(cloudflareDomainState({ ...item, ssl: { status: 'validation_timed_out' } }, true).state).toBe('error')
  })
  it('recovers an uncertain create by exact hostname lookup, never changes DNS', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(envelope([]))
      .mockRejectedValueOnce(new Error('network request with secret'))
      .mockResolvedValueOnce(envelope([item]))
    await expect(create(fetcher).attach('example.org', 'site')).resolves.toEqual({ providerRef: item.id })
    expect(fetcher.mock.calls[1]![0]).toMatch(/\/custom_hostnames$/)
    expect(JSON.parse(fetcher.mock.calls[1]![1]!.body as string)).toMatchObject({
      hostname: 'example.org',
      ssl: { method: 'txt', type: 'dv' },
    })
    expect(fetcher.mock.calls.every(call => String(call[0]).includes('/custom_hostnames'))).toBe(true)
  })
  it('returns ownership and certificate records separately and checks target', async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => envelope([item]))
    const provider = create(fetcher)
    expect(await provider.requiredRecords('example.org')).toEqual([
      { type: 'CNAME', name: 'example.org', value: 'customers.example.net' },
      { type: 'TXT', name: '_cf-custom-hostname.example.org', value: 'ownership-token' },
      { type: 'TXT', name: '_acme-challenge.example.org', value: 'cert-token' },
    ])
    await expect(provider.check('example.org', verification)).resolves.toEqual({ state: 'live' })
    await expect(
      create(fetcher, {
        cname: vi.fn().mockRejectedValue(new Error('DNS')),
        ipv4: vi.fn().mockResolvedValue(['1.2.3.4']),
        txt: vi.fn().mockResolvedValue([[verification.value]]),
      }).check('example.org', verification),
    ).resolves.toMatchObject({ state: 'pending_dns' })
  })
  it('does not accept a dangling SaaS CNAME without the fresh CMS ownership proof', async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => envelope([item]))
    const provider = create(fetcher, {
      cname: vi.fn().mockResolvedValue(['customers.example.net']),
      ipv4: vi.fn(),
      txt: vi.fn().mockResolvedValue([['old-token']]),
    })
    await expect(provider.check('example.org', verification)).resolves.toMatchObject({
      state: 'verifying',
      errorCode: 'ownership_txt_missing',
    })
    await expect(provider.check('example.org')).resolves.toMatchObject({ state: 'verifying' })
  })
  it('detaches by provider reference and treats absence as idempotent', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(envelope([item]))
      .mockResolvedValueOnce(envelope({ id: item.id }))
      .mockResolvedValueOnce(envelope([]))
    const provider = create(fetcher)
    await provider.detach('example.org')
    await provider.detach('example.org')
    expect(fetcher.mock.calls.filter(call => call[1]?.method === 'DELETE')).toHaveLength(1)
  })
  it('refuses private, malformed and fake production hosts/configuration', async () => {
    for (const host of [
      'https://example.org',
      'example.org:80',
      '127.0.0.1',
      'x.local',
      'x.test',
      'localhost',
      '*.example.org',
    ])
      expect(() => domainHostname(host)).toThrow()
    expect(domainHostname('WWW.Example.org.')).toBe('www.example.org')
    await expect(
      configuredDomainProvisioner({ NODE_ENV: 'production', DOMAIN_PROVIDER: 'fake' }).attach('example.org', 'site'),
    ).rejects.toThrow('not configured')
  })
})
