import { expect, it, vi } from 'vitest'
import { createFirebaseHostingClient } from './firebase-hosting.ts'
import { createFirebaseDomainProvisioner, firebaseDomainState } from './firebase-domains.ts'
import type { DomainSite } from './ports.ts'

const id = 'c123456789012-aabbccddeeff0011'
const site: DomainSite = {
  siteId: '11111111-1111-4111-8111-111111111111',
  stagingHostname: `${id}.web.app`,
  providerRef: null,
}
const host = 'test.example.org'
const verification = { name: `_cms-verify.${host}`, value: '22222222-2222-4222-8222-222222222222' }
const config = {
  projectId: 'cms-test-project',
  sitePrefix: 'c123456789012',
  serviceId: 'cms-site',
  region: 'us-central1',
  accessToken: async () => 'workload-token',
}
const routing = { rewrites: [{ glob: '**', run: { serviceId: 'cms-site', region: 'us-central1' } }] }

it('creates the site/rewrite and recovers a committed release without repeating it after a lost response', async () => {
  let exists = false,
    released = false
  const fetcher = vi.fn<typeof fetch>(async (url, init) => {
    const path = String(url)
    if (path.endsWith(`/sites/${id}`))
      return exists
        ? Response.json({ name: `projects/cms-test-project/sites/${id}` })
        : new Response('', { status: 404 })
    if (path.includes('/sites?siteId=')) {
      exists = true
      return Response.json({})
    }
    if (path.includes('/releases?pageSize=1'))
      return Response.json({ releases: released ? [{ version: { config: { ...routing, cleanUrls: false } } }] : [] })
    if (path.endsWith('/versions') && init?.method === 'POST')
      return Response.json({ name: `sites/${id}/versions/version1` })
    if (path.includes('updateMask=status')) return Response.json({})
    if (path.includes('/releases?versionName=')) {
      released = true
      throw new Error('lost acknowledgement')
    }
    throw new Error(`unexpected test path ${path}`)
  })
  const hosting = createFirebaseHostingClient({ ...config, fetcher })
  await expect(hosting.ensureSite(site.stagingHostname)).rejects.toThrow('unavailable')
  await hosting.ensureSite(site.stagingHostname)
  expect(
    fetcher.mock.calls.filter(([url, init]) => String(url).endsWith('/versions') && init?.method === 'POST'),
  ).toHaveLength(1)
  expect(
    fetcher.mock.calls.every(
      ([, init]) =>
        init?.redirect === 'error' &&
        (init.headers as Record<string, string>).Authorization === 'Bearer workload-token',
    ),
  ).toBe(true)
  expect(
    fetcher.mock.calls.every(
      ([, init]) => (init?.headers as Record<string, string>)['X-Goog-User-Project'] === config.projectId,
    ),
  ).toBe(true)
  const calls = fetcher.mock.calls.length
  await expect(hosting.ensureSite('another-project.web.app')).rejects.toThrow('does not belong')
  expect(fetcher).toHaveBeenCalledTimes(calls)
})

it('requires this reservation’s TXT token even when Google says the domain is already active', async () => {
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValue(
      Response.json({ hostState: 'HOST_ACTIVE', ownershipState: 'OWNERSHIP_ACTIVE', cert: { state: 'CERT_ACTIVE' } }),
    )
  const txt = vi.fn().mockResolvedValue([['old-token']])
  const provider = createFirebaseDomainProvisioner({ ...config, fetcher, txt })
  expect((await provider.check(host, verification, site)).state).toBe('verifying')
  expect(fetcher).not.toHaveBeenCalled()
  txt.mockResolvedValue([[verification.value.slice(0, 18), verification.value.slice(18)]])
  expect((await provider.check(host, verification, site)).state).toBe('live')
  await expect(
    provider.check(host, verification, { ...site, providerRef: 'firebase:some-other-site' }),
  ).rejects.toThrow('different site')
})

it('shows required additions, CAA and exact conflicting removals, keeping unrelated DNS records alone', async () => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
    Response.json({
      requiredDnsUpdates: {
        desired: [
          {
            records: [
              { type: 'TXT', domainName: `${host}.`, rdata: '"hosting-site=test-site"', requiredAction: 'ADD' },
              { type: 'CAA', domainName: `${host}.`, rdata: '0 issue "pki.goog"', requiredAction: 'ADD' },
            ],
          },
        ],
        discovered: [
          {
            records: [
              { type: 'A', domainName: `${host}.`, rdata: '192.0.2.1', requiredAction: 'REMOVE' },
              { type: 'TXT', domainName: `${host}.`, rdata: 'existing-mail-verification', requiredAction: 'NONE' },
            ],
          },
        ],
      },
    }),
  )
  const provider = createFirebaseDomainProvisioner({ ...config, fetcher })
  expect(await provider.requiredRecords(host, site)).toEqual([
    { type: 'TXT', name: host, value: 'hosting-site=test-site', action: 'ADD' },
    { type: 'CAA', name: host, value: '0 issue "pki.goog"', action: 'ADD' },
    { type: 'A', name: host, value: '192.0.2.1', action: 'REMOVE' },
  ])
  fetcher.mockResolvedValueOnce(new Response('', { status: 404 }))
  await provider.detach(host, site)
  expect(fetcher.mock.calls.at(-1)![1]!.method).toBe('DELETE')
})

it('does not declare live until routing, ownership and certificate all agree', () => {
  expect(firebaseDomainState({}).state).toBe('pending_dns')
  expect(firebaseDomainState({ hostState: 'HOST_ACTIVE' }).state).toBe('verifying')
  expect(
    firebaseDomainState({
      hostState: 'HOST_ACTIVE',
      ownershipState: 'OWNERSHIP_ACTIVE',
      cert: { state: 'CERT_PROPAGATING' },
    }).state,
  ).toBe('issuing_cert')
  expect(firebaseDomainState({ hostState: 'HOST_CONFLICT' }).state).toBe('error')
  expect(
    firebaseDomainState({
      hostState: 'HOST_ACTIVE',
      ownershipState: 'OWNERSHIP_ACTIVE',
      cert: { state: 'CERT_EXPIRING_SOON' },
    }).state,
  ).toBe('live')
})

it('includes certificate DNS challenges and their exact conflicts without duplicating routing advice', async () => {
  const cname = { type: 'CNAME', domainName: `${host}.`, rdata: site.stagingHostname }
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
    Response.json({
      requiredDnsUpdates: { desired: [{ records: [cname] }] },
      cert: {
        state: 'CERT_VALIDATING',
        verification: {
          dns: {
            desired: [
              {
                records: [
                  cname,
                  {
                    type: 'TXT',
                    domainName: `_acme-challenge.${host}.`,
                    rdata: '"new-challenge"',
                    requiredAction: 'ADD',
                  },
                ],
              },
            ],
            discovered: [
              {
                records: [
                  {
                    type: 'TXT',
                    domainName: `_acme-challenge.${host}.`,
                    rdata: '"obsolete-challenge"',
                    requiredAction: 'REMOVE',
                  },
                  { type: 'TXT', domainName: `${host}.`, rdata: 'existing-verification', requiredAction: 'NONE' },
                ],
              },
            ],
          },
        },
      },
    }),
  )
  expect(await createFirebaseDomainProvisioner({ ...config, fetcher }).requiredRecords(host, site)).toEqual([
    { type: 'CNAME', name: host, value: site.stagingHostname, action: 'ADD' },
    { type: 'TXT', name: `_acme-challenge.${host}`, value: 'new-challenge', action: 'ADD' },
    { type: 'TXT', name: `_acme-challenge.${host}`, value: 'obsolete-challenge', action: 'REMOVE' },
  ])
})
