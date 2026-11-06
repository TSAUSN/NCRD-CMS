import { describe, expect, it, vi } from 'vitest'
import { createOriginDomainProvisioner } from './origin-domains.ts'
const proof = { name: '_cms-verify.example.org', value: 'proof' }
describe('direct origin domain lifecycle', () => {
  it('requires exact origin DNS and ownership before checking a certificate', async () => {
    const certificate = vi.fn(async () => true)
    const provider = createOriginDomainProvisioner('203.0.113.10', {
      ipv4: async () => ['192.168.1.1'],
      txt: async () => [['proof']],
      certificate,
    })
    expect((await provider.check('example.org', proof)).state).toBe('pending_dns')
    expect(certificate).not.toHaveBeenCalled()
  })
  it('progresses from verified DNS to a certificate and then live routing', async () => {
    const certificate = vi.fn().mockResolvedValueOnce(false).mockResolvedValue(true)
    const provider = createOriginDomainProvisioner('203.0.113.10', {
      ipv4: async () => ['203.0.113.10'],
      txt: async () => [['pr', 'oof']],
      certificate,
    })
    expect(await provider.requiredRecords('example.org')).toEqual([
      { type: 'A', name: 'example.org', value: '203.0.113.10' },
    ])
    expect((await provider.check('example.org', proof)).state).toBe('issuing_cert')
    expect((await provider.check('example.org', proof)).state).toBe('live')
    expect(certificate).toHaveBeenLastCalledWith('example.org', '203.0.113.10')
  })
  it('refuses private origins and malformed hosts', async () => {
    for (const address of ['127.0.0.1', '10.0.0.1', '169.254.169.254', '172.16.0.1', '192.168.0.1', '100.64.0.1'])
      expect(() => createOriginDomainProvisioner(address)).toThrow()
    const provider = createOriginDomainProvisioner('203.0.113.10')
    await expect(provider.attach('https://example.org', 'site')).rejects.toThrow()
  })
})
