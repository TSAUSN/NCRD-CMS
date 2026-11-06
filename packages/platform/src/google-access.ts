export type GoogleAccessToken = () => Promise<string>

/** Cloud Run's attached identity supplies short-lived tokens. No service-account
 * keys or database-bypass credentials are installed in the web applications. */
export function createMetadataAccessTokenProvider(fetcher: typeof fetch = fetch, now = Date.now): GoogleAccessToken {
  let cached: { token: string; until: number } | null = null
  let pending: Promise<string> | null = null
  return async () => {
    if (cached && now() < cached.until) return cached.token
    if (pending) return pending
    pending = (async () => {
      let response: Response
      try {
        response = await fetcher(
          'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token',
          {
            headers: { 'Metadata-Flavor': 'Google' },
            redirect: 'error',
            signal: AbortSignal.timeout(5_000),
          },
        )
      } catch {
        throw new Error('Google workload identity is unavailable')
      }
      if (!response.ok) throw new Error(`Google workload identity returned HTTP ${response.status}`)
      const result = (await response.json()) as { access_token?: unknown; expires_in?: unknown; token_type?: unknown }
      if (
        typeof result.access_token !== 'string' ||
        !result.access_token ||
        /\s/.test(result.access_token) ||
        typeof result.expires_in !== 'number' ||
        !Number.isFinite(result.expires_in) ||
        result.expires_in <= 60 ||
        result.token_type !== 'Bearer'
      )
        throw new Error('Google workload identity returned an invalid token')
      cached = { token: result.access_token, until: now() + (result.expires_in - 60) * 1_000 }
      return cached.token
    })()
    try {
      return await pending
    } finally {
      pending = null
    }
  }
}
