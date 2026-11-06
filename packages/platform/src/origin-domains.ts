import { Resolver } from 'node:dns/promises'
import { isIP } from 'node:net'
import { connect } from 'node:tls'
import { normalizeHost } from '@cms/domain'
import type { DomainProvisioner } from './ports.ts'

type Lookups = {
  ipv4(host: string): Promise<string[]>
  txt(host: string): Promise<string[][]>
  certificate(host: string, address: string): Promise<boolean>
}
function hostname(value: string): string {
  const normalized = normalizeHost(value)
  if (
    !normalized ||
    normalized !== value ||
    isIP(normalized) ||
    !normalized.includes('.') ||
    /\.(localhost|local|test|invalid)$/.test(normalized)
  )
    throw new Error('A normalized public hostname is required.')
  return normalized
}
function publicIPv4(value: string): boolean {
  if (isIP(value) !== 4) return false
  const [a, b] = value.split('.').map(Number)
  return (
    a !== 0 &&
    a !== 10 &&
    a !== 127 &&
    a! >= 1 &&
    a! < 224 &&
    !(a === 169 && b === 254) &&
    !(a === 172 && b! >= 16 && b! <= 31) &&
    !(a === 192 && b === 168) &&
    !(a === 100 && b! >= 64 && b! <= 127)
  )
}
async function certificate(host: string, address: string): Promise<boolean> {
  return new Promise(resolve => {
    // Dial only the configured origin IP; user-controlled DNS cannot redirect
    // a certificate probe into private services or another customer's server.
    const socket = connect({ host: address, port: 443, servername: host, rejectUnauthorized: true })
    let finished = false
    const finish = (result: boolean) => {
      if (finished) return
      finished = true
      socket.destroy()
      resolve(result)
    }
    socket.setTimeout(10000, () => finish(false))
    socket.once('error', () => finish(false))
    socket.once('secureConnect', () => finish(socket.authorized))
  })
}
export function createOriginDomainProvisioner(address: string, lookups?: Lookups): DomainProvisioner {
  if (!publicIPv4(address)) throw new Error('DOMAIN_ORIGIN_IPV4 must be the public IPv4 address of the CMS origin.')
  const resolver = new Resolver({ timeout: 3000, tries: 2 })
  const dns = lookups ?? {
    ipv4: (host: string) => resolver.resolve4(host),
    txt: (host: string) => resolver.resolveTxt(host),
    certificate,
  }
  return {
    async requiredRecords(raw) {
      return [{ type: 'A', name: hostname(raw), value: address }]
    },
    async attach(raw) {
      return { providerRef: `origin:${hostname(raw)}` }
    },
    async detach(raw) {
      hostname(raw)
    }, // Routing and future certificate permission are revoked transactionally by the CMS.
    async check(raw, verification) {
      const host = hostname(raw)
      if (!verification || verification.name !== `_cms-verify.${host}` || !verification.value)
        return {
          state: 'pending_dns',
          errorCode: 'ownership_required',
          errorDetail: 'Add the CMS ownership TXT record.',
        }
      let records: string[], proofs: string[][]
      try {
        ;[records, proofs] = await Promise.all([dns.ipv4(host), dns.txt(verification.name)])
      } catch {
        return {
          state: 'pending_dns',
          errorCode: 'dns_pending',
          errorDetail: 'The required DNS records are not available yet.',
        }
      }
      if (
        !records.length ||
        records.some(record => record !== address) ||
        !proofs.some(parts => parts.join('') === verification.value)
      )
        return {
          state: 'pending_dns',
          errorCode: 'dns_target_mismatch',
          errorDetail:
            'Point the hostname directly to the CMS origin and add the exact ownership TXT record. Disable proxying while verifying.',
        }
      if (!(await dns.certificate(host, address)))
        return {
          state: 'issuing_cert',
          errorCode: 'certificate_pending',
          errorDetail:
            'DNS ownership is verified. The origin is obtaining a certificate; use Verify now again shortly.',
        }
      return { state: 'live' }
    },
  }
}
