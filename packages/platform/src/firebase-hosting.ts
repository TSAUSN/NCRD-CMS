import { createMetadataAccessTokenProvider, type GoogleAccessToken } from './google-access.ts'

export type FirebaseCustomDomain = {
  name?: string
  hostState?: string
  ownershipState?: string
  reconciling?: boolean
  cert?: { state?: string; verification?: { dns?: FirebaseDnsUpdates } }
  requiredDnsUpdates?: FirebaseDnsUpdates
}
export type FirebaseDnsUpdates = { desired?: FirebaseDnsSet[]; discovered?: FirebaseDnsSet[] }
export type FirebaseDnsSet = {
  records?: { domainName?: string; type?: string; rdata?: string; requiredAction?: string }[]
}
export type FirebaseHostingOptions = {
  projectId: string
  sitePrefix: string
  serviceId: string
  region: string
  accessToken?: GoogleAccessToken
  fetcher?: typeof fetch
}

export function createFirebaseHostingClient(options: FirebaseHostingOptions) {
  if (
    !/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(options.projectId) ||
    !/^[a-z][a-z0-9-]{1,11}[a-z0-9]$/.test(options.sitePrefix) ||
    !/^[a-z][a-z0-9-]{0,61}[a-z0-9]$/.test(options.serviceId) ||
    !/^[a-z]+-[a-z]+\d$/.test(options.region)
  )
    throw new Error('Configure the Firebase Hosting project, site prefix and Cloud Run service')
  const fetcher = options.fetcher ?? fetch
  const token = options.accessToken ?? createMetadataAccessTokenProvider()
  const base = 'https://firebasehosting.googleapis.com/v1beta1/'
  async function request(path: string, method = 'GET', body?: unknown, allowed: number[] = []): Promise<unknown> {
    let response: Response
    const authorization = await token()
    try {
      response = await fetcher(base + path, {
        method,
        headers: {
          Authorization: `Bearer ${authorization}`,
          'Content-Type': 'application/json',
          'X-Goog-User-Project': options.projectId,
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        redirect: 'error',
        signal: AbortSignal.timeout(10_000),
      })
    } catch {
      throw new Error('Firebase Hosting is unavailable')
    }
    if (allowed.includes(response.status)) {
      await response.body?.cancel()
      return null
    }
    if (!response.ok) {
      await response.body?.cancel()
      throw new Error(`Firebase Hosting returned HTTP ${response.status}`)
    }
    return response.status === 204 ? null : response.json()
  }
  function siteId(hostname: string): string {
    const id = hostname.endsWith('.web.app') ? hostname.slice(0, -8) : ''
    if (id.length > 30 || !id.startsWith(`${options.sitePrefix}-`) || !/^[a-z][a-z0-9-]+$/.test(id)) {
      throw new Error('The staging address does not belong to this Firebase installation')
    }
    return id
  }
  const config = { rewrites: [{ glob: '**', run: { serviceId: options.serviceId, region: options.region } }] }
  return {
    siteId,
    async ensureSite(hostname: string): Promise<void> {
      const id = siteId(hostname)
      const path = `projects/${options.projectId}/sites/${id}`
      if (!(await request(path, 'GET', undefined, [404]))) {
        await request(`projects/${options.projectId}/sites?siteId=${id}`, 'POST', { type: 'USER_SITE' }, [409])
      }
      // Recover a successful release whose acknowledgement was lost. A retry
      // must not create a new Hosting version on every background pass.
      const current = (await request(`sites/${id}/releases?pageSize=1`)) as {
        releases?: {
          version?: {
            config?: { rewrites?: { glob?: string; run?: { serviceId?: string; region?: string; tag?: string } }[] }
          }
        }[]
      }
      const rewrites = current.releases?.[0]?.version?.config?.rewrites
      const route = rewrites?.[0]
      if (
        rewrites?.length === 1 &&
        route?.glob === '**' &&
        route.run?.serviceId === options.serviceId &&
        route.run.region === options.region &&
        !route.run.tag
      )
        return
      const version = (await request(`sites/${id}/versions`, 'POST', { config })) as { name?: string }
      if (!version.name || !new RegExp(`^sites/${id}/versions/[a-zA-Z0-9_-]+$`).test(version.name))
        throw new Error('Firebase returned an invalid Hosting version')
      await request(`${version.name}?updateMask=status`, 'PATCH', { status: 'FINALIZED' })
      await request(`sites/${id}/releases?versionName=${encodeURIComponent(version.name)}`, 'POST', {})
    },
    async customDomain(hostname: string, stagingHostname: string): Promise<FirebaseCustomDomain | null> {
      const id = siteId(stagingHostname)
      return (await request(
        `projects/${options.projectId}/sites/${id}/customDomains/${encodeURIComponent(hostname)}`,
        'GET',
        undefined,
        [404],
      )) as FirebaseCustomDomain | null
    },
    async attachDomain(hostname: string, stagingHostname: string): Promise<void> {
      const id = siteId(stagingHostname)
      if (await this.customDomain(hostname, stagingHostname)) return
      await request(
        `projects/${options.projectId}/sites/${id}/customDomains?customDomainId=${encodeURIComponent(hostname)}`,
        'POST',
        { certPreference: 'GROUPED' },
        [409],
      )
    },
    async detachDomain(hostname: string, stagingHostname: string): Promise<void> {
      const id = siteId(stagingHostname)
      await request(
        `projects/${options.projectId}/sites/${id}/customDomains/${encodeURIComponent(hostname)}`,
        'DELETE',
        undefined,
        [404],
      )
    },
  }
}

export function configuredFirebaseHosting(env: Record<string, string | undefined> = process.env) {
  return createFirebaseHostingClient({
    projectId: env['GOOGLE_CLOUD_PROJECT'] ?? '',
    sitePrefix: env['FIREBASE_HOSTING_SITE_PREFIX'] ?? '',
    serviceId: env['FIREBASE_PUBLIC_SERVICE'] ?? '',
    region: env['GOOGLE_CLOUD_REGION'] ?? '',
  })
}
