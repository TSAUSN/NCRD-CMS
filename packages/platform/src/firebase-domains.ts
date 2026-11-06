import { Resolver } from 'node:dns/promises'
import { domainHostname } from './domains.ts'
import {
  createFirebaseHostingClient,
  type FirebaseCustomDomain,
  type FirebaseHostingOptions,
} from './firebase-hosting.ts'
import type { DnsRecord, DomainProvisioner, DomainSite, DomainState } from './ports.ts'

export function firebaseDomainState(domain: FirebaseCustomDomain): {
  state: DomainState
  errorCode?: string
  errorDetail?: string
} {
  if (
    domain.hostState === 'HOST_CONFLICT' ||
    ['OWNERSHIP_CONFLICT', 'OWNERSHIP_MISMATCH'].includes(domain.ownershipState ?? '')
  ) {
    return {
      state: 'error',
      errorCode: 'provider_dns_conflict',
      errorDetail:
        'Google found conflicting DNS records. Follow the Add and Remove actions shown below, then verify again.',
    }
  }
  if (domain.cert?.state === 'CERT_EXPIRED')
    return {
      state: 'error',
      errorCode: 'certificate_expired',
      errorDetail:
        'Google reports an expired certificate. Check DNS and certificate-authority records, then verify again.',
    }
  if (domain.hostState !== 'HOST_ACTIVE') return { state: 'pending_dns' }
  if (domain.ownershipState !== 'OWNERSHIP_ACTIVE') return { state: 'verifying' }
  if (!['CERT_ACTIVE', 'CERT_EXPIRING_SOON'].includes(domain.cert?.state ?? '')) return { state: 'issuing_cert' }
  return { state: 'live' }
}

export function createFirebaseDomainProvisioner(
  options: FirebaseHostingOptions & {
    txt?: (hostname: string) => Promise<string[][]>
  },
): DomainProvisioner {
  const hosting = createFirebaseHostingClient(options)
  const resolver = new Resolver({ timeout: 1_500, tries: 2 })
  const txt = options.txt ?? resolver.resolveTxt.bind(resolver)
  function target(hostname: string, site?: DomainSite): { host: string; staging: string; ref: string } {
    const host = domainHostname(hostname)
    if (!site) throw new Error('The domain has no authoritative CMS site context')
    const id = hosting.siteId(site.stagingHostname)
    const ref = `firebase:${id}`
    if (site.providerRef && site.providerRef !== ref)
      throw new Error('The domain provider receipt belongs to a different site')
    return { host, staging: site.stagingHostname, ref }
  }
  return {
    async attach(hostname, siteId, site) {
      if (siteId !== site?.siteId) throw new Error('Domain site context does not match')
      const item = target(hostname, site)
      await hosting.ensureSite(item.staging)
      await hosting.attachDomain(item.host, item.staging)
      return { providerRef: item.ref }
    },
    async requiredRecords(hostname, site) {
      const item = target(hostname, site)
      const domain = await hosting.customDomain(item.host, item.staging)
      const records: DnsRecord[] = []
      for (const updates of [domain?.requiredDnsUpdates, domain?.cert?.verification?.dns]) {
        for (const set of [...(updates?.desired ?? []), ...(updates?.discovered ?? [])]) {
          for (const record of set.records ?? []) {
            if (
              !['A', 'AAAA', 'CNAME', 'TXT', 'CAA'].includes(record.type ?? '') ||
              !record.domainName ||
              !record.rdata
            )
              continue
            // Discovered records only require action when Google explicitly says
            // REMOVE; unrelated existing MX/TXT records are never removal advice.
            if (updates?.discovered?.includes(set) && record.requiredAction !== 'REMOVE') continue
            const value =
              record.type === 'TXT' && /^"[^"\\]*"$/.test(record.rdata) ? record.rdata.slice(1, -1) : record.rdata
            const result: DnsRecord = {
              type: record.type as DnsRecord['type'],
              name: record.domainName.replace(/\.$/, ''),
              value,
              action: record.requiredAction === 'REMOVE' ? 'REMOVE' : 'ADD',
            }
            if (!records.some(old => JSON.stringify(old) === JSON.stringify(result))) records.push(result)
          }
        }
      }
      return records
    },
    async check(hostname, verification, site) {
      const item = target(hostname, site)
      let proved = false
      if (verification?.name === `_cms-verify.${item.host}` && /^[0-9a-f-]{36}$/i.test(verification.value)) {
        try {
          proved = (await txt(verification.name)).some(parts => parts.join('') === verification.value)
        } catch {
          /* DNS propagation can still be pending. */
        }
      }
      if (!proved)
        return {
          state: 'verifying',
          errorCode: 'ownership_txt_missing',
          errorDetail:
            'Add the exact _cms-verify TXT record shown below to prove this CMS connection owns the address.',
        }
      const domain = await hosting.customDomain(item.host, item.staging)
      return domain
        ? firebaseDomainState(domain)
        : {
            state: 'verifying',
            errorCode: 'provider_pending',
            errorDetail: 'Google is preparing this domain connection. Verify again shortly.',
          }
    },
    async detach(hostname, site) {
      const item = target(hostname, site)
      await hosting.detachDomain(item.host, item.staging)
    },
  }
}
