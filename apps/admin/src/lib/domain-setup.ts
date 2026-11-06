/** Hosted admin and worker processes may have different provider settings. Only
 * refuse the explicitly local, provider-free demo here; never require the
 * worker's secret in the admin just to show the domain workspace. */
export function localDomainsUnavailable(env: Record<string, string | undefined> = process.env): boolean {
  return (
    env['CMS_LOCAL_TEST_MODE'] === 'true' &&
    !['origin', 'cloudflare', 'firebase', 'fake'].includes(env['DOMAIN_PROVIDER'] ?? '')
  )
}

export const LOCAL_DOMAIN_GUIDANCE =
  'Custom domains are not connected in this local demo. Use the localhost preview addresses. A hosted CMS needs a public destination, DNS ownership checks and HTTPS before you can connect an address.'
