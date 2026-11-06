import { Resolver } from 'node:dns/promises'
import { isIP } from 'node:net'
import { normalizeHost } from '@cms/domain'
import { createFakeDomainProvisioner } from './local/index.ts'
import type { DnsRecord, DomainProvisioner, DomainState } from './ports.ts'
import { createOriginDomainProvisioner } from './origin-domains.ts'
import { createFirebaseDomainProvisioner } from './firebase-domains.ts'

type CustomHostname = {
  id: string
  hostname: string
  status?: string
  ownership_verification?: { type?: string; name?: string; value?: string }
  ssl?: {
    status?: string
    validation_records?: {
      txt_name?: string
      txt_value?: string
      txt_record?: string
      cname?: string
      cname_target?: string
    }[]
  }
}
export function domainHostname(raw: string): string {
  const host = normalizeHost(raw)
  if (
    !host ||
    host !== raw.trim().toLowerCase().replace(/\.$/, '') ||
    !host.includes('.') ||
    isIP(host) ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.endsWith('.test') ||
    host.endsWith('.invalid')
  ) {
    throw new Error('Enter a public hostname without a protocol, port or path.')
  }
  return host
}
export function cloudflareDomainState(
  item: CustomHostname,
  dnsMatches: boolean,
): { state: DomainState; errorCode?: string; errorDetail?: string } {
  if (
    ['blocked', 'moved', 'deleted', 'pending_deletion', 'test_failed'].includes(item.status ?? '') ||
    /timed_out|expired|deleted|inactive/.test(item.ssl?.status ?? '')
  ) {
    return {
      state: 'error',
      errorCode: 'provider_validation_failed',
      errorDetail: `Cloudflare hostname: ${item.status ?? 'unknown'}; certificate: ${item.ssl?.status ?? 'unknown'}. Check hostname ownership and certificate validation records.`,
    }
  }
  if (!dnsMatches)
    return {
      state: 'pending_dns',
      errorCode: 'dns_target_mismatch',
      errorDetail: 'DNS does not point to the configured SaaS CNAME target or assigned apex addresses.',
    }
  if (item.status !== 'active') return { state: 'verifying' }
  if (item.ssl?.status !== 'active') return { state: 'issuing_cert' }
  return { state: 'live' }
}

/** One explicit provider candidate; enabling it requires a tested SaaS zone,
 * fallback origin and owned-domain acceptance. It never changes customer DNS. */
export function createCloudflareDomainProvisioner(options: {
  apiToken: string
  zoneId: string
  cnameTarget: string
  apexIPv4?: string[]
  fetcher?: typeof fetch
  dns?: {
    cname(host: string): Promise<string[]>
    ipv4(host: string): Promise<string[]>
    txt?(host: string): Promise<string[][]>
  }
}): DomainProvisioner {
  if (!/^[a-zA-Z0-9_-]+$/.test(options.apiToken) || !/^[a-f0-9]{32}$/i.test(options.zoneId))
    throw new Error('Configure Cloudflare SaaS API token and zone ID')
  const cnameTarget = domainHostname(options.cnameTarget)
  const apex = options.apexIPv4 ?? []
  if (apex.some(ip => isIP(ip) !== 4)) throw new Error('DOMAIN_APEX_IPV4 must contain allocated IPv4 addresses')
  const fetcher = options.fetcher ?? fetch
  const resolver = new Resolver({ timeout: 1500, tries: 2 })
  const dns = options.dns ?? {
    cname: resolver.resolveCname.bind(resolver),
    ipv4: resolver.resolve4.bind(resolver),
    txt: resolver.resolveTxt.bind(resolver),
  }
  const base = `https://api.cloudflare.com/client/v4/zones/${options.zoneId}/custom_hostnames`
  async function request(path: string, method = 'GET', body?: unknown): Promise<unknown> {
    let response: Response
    try {
      response = await fetcher(`${base}${path}`, {
        method,
        headers: { Authorization: `Bearer ${options.apiToken}`, 'Content-Type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        redirect: 'error',
        signal: AbortSignal.timeout(10_000),
      })
    } catch {
      throw new Error('Cloudflare hostname provider is unavailable')
    }
    if (method === 'DELETE' && response.status === 404) return null
    const data = (await response.json().catch(() => null)) as { success?: boolean; result?: unknown } | null
    if (!response.ok || data?.success !== true)
      throw new Error(`Cloudflare hostname provider returned HTTP ${response.status}`)
    return data.result
  }
  async function find(host: string): Promise<CustomHostname | null> {
    host = domainHostname(host)
    const result = await request(`?hostname=${encodeURIComponent(host)}&per_page=50`)
    if (!Array.isArray(result)) throw new Error('Cloudflare returned an unreadable hostname list')
    const matches = result.filter(
      (v): v is CustomHostname =>
        !!v && v.hostname === host && typeof v.id === 'string' && /^[a-f0-9-]{32,36}$/i.test(v.id),
    )
    if (matches.length > 1) throw new Error('Cloudflare returned ambiguous hostname records')
    return matches[0] ?? null
  }
  async function dnsMatches(host: string): Promise<boolean> {
    try {
      let current = host
      for (let i = 0; i < 8; i++) {
        const names = await dns.cname(current)
        if (names.some(name => normalizeHost(name) === cnameTarget)) return true
        if (names.length !== 1) break
        current = normalizeHost(names[0]) ?? ''
        if (!current) break
      }
    } catch {
      /* Apex flattening is checked only against explicitly allocated IPs. */
    }
    if (!apex.length) return false
    try {
      const actual = await dns.ipv4(host)
      return actual.length > 0 && actual.every(ip => apex.includes(ip))
    } catch {
      return false
    }
  }
  return {
    async attach(hostname) {
      const host = domainHostname(hostname)
      const existing = await find(host)
      if (existing) return { providerRef: existing.id }
      try {
        const item = (await request('', 'POST', {
          hostname: host,
          ssl: { method: 'txt', type: 'dv', settings: { min_tls_version: '1.2' } },
        })) as CustomHostname
        if (!item || item.hostname !== host || typeof item.id !== 'string')
          throw new Error('Cloudflare returned an unreadable hostname receipt')
        return { providerRef: item.id }
      } catch (error) {
        // A timed-out POST may have succeeded. Exact-host lookup makes retries
        // idempotent without silently creating two hostname resources.
        const retried = await find(host)
        if (retried) return { providerRef: retried.id }
        throw error
      }
    },
    async requiredRecords(hostname) {
      const host = domainHostname(hostname)
      const item = await find(host)
      const records: DnsRecord[] = apex.length
        ? apex.map(value => ({ type: 'A', name: host, value }))
        : [{ type: 'CNAME', name: host, value: cnameTarget }]
      const ownership = item?.ownership_verification
      if (ownership?.type === 'txt' && ownership.name && ownership.value)
        records.push({ type: 'TXT', name: ownership.name, value: ownership.value })
      for (const record of item?.ssl?.validation_records ?? []) {
        if (record.txt_name && (record.txt_value || record.txt_record))
          records.push({ type: 'TXT', name: record.txt_name, value: record.txt_value ?? record.txt_record! })
        if (record.cname && record.cname_target)
          records.push({ type: 'CNAME', name: record.cname, value: record.cname_target })
      }
      return records
    },
    async check(hostname, verification) {
      const item = await find(hostname)
      if (!item)
        return {
          state: 'error',
          errorCode: 'provider_hostname_missing',
          errorDetail: 'The hostname is absent from the configured Cloudflare SaaS zone. Check again to reconnect it.',
        }
      // A dangling CNAME from a previously removed customer must not prove
      // ownership for a new tenant. Require this reservation’s fresh TXT token.
      let proved = false
      if (
        verification &&
        verification.name === `_cms-verify.${hostname}` &&
        /^[0-9a-f-]{36}$/i.test(verification.value)
      ) {
        try {
          proved = (await (dns.txt ?? resolver.resolveTxt.bind(resolver))(verification.name)).some(
            parts => parts.join('') === verification.value,
          )
        } catch {
          /* propagation still pending */
        }
      }
      if (!proved)
        return {
          state: 'verifying',
          errorCode: 'ownership_txt_missing',
          errorDetail:
            'The CMS ownership TXT record is missing or does not match this connection. Add the exact _cms-verify record shown below.',
        }
      return cloudflareDomainState(item, await dnsMatches(hostname))
    },
    async detach(hostname) {
      const item = await find(hostname)
      if (item) await request(`/${item.id}`, 'DELETE')
    },
  }
}

export function configuredDomainProvisioner(env: Record<string, string | undefined> = process.env): DomainProvisioner {
  if (env['DOMAIN_PROVIDER'] === 'firebase')
    return createFirebaseDomainProvisioner({
      projectId: env['GOOGLE_CLOUD_PROJECT'] ?? '',
      sitePrefix: env['FIREBASE_HOSTING_SITE_PREFIX'] ?? '',
      serviceId: env['FIREBASE_PUBLIC_SERVICE'] ?? '',
      region: env['GOOGLE_CLOUD_REGION'] ?? '',
    })
  if (env['DOMAIN_PROVIDER'] === 'origin') return createOriginDomainProvisioner(env['DOMAIN_ORIGIN_IPV4'] ?? '')
  if (env['DOMAIN_PROVIDER'] === 'cloudflare')
    return createCloudflareDomainProvisioner({
      apiToken: env['CLOUDFLARE_DOMAIN_API_TOKEN'] ?? '',
      zoneId: env['CLOUDFLARE_DOMAIN_ZONE_ID'] ?? '',
      cnameTarget: env['DOMAIN_CNAME_TARGET'] ?? '',
      apexIPv4: (env['DOMAIN_APEX_IPV4'] ?? '')
        .split(',')
        .map(s => s.trim())
        .filter(Boolean),
    })
  if (env['DOMAIN_PROVIDER'] === 'fake' && (env['NODE_ENV'] !== 'production' || env['CMS_LOCAL_TEST_MODE'] === 'true'))
    return createFakeDomainProvisioner()
  const fail = async (): Promise<never> => {
    throw new Error('Domain connection provider is not configured on the worker')
  }
  return { attach: fail, check: fail, requiredRecords: fail, detach: fail }
}
