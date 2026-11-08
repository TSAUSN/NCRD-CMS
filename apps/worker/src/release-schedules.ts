/** A release lease is an ephemeral capability for one stored intention. Never
 * send it to an arbitrary URL, follow a redirect, or include it in an error. */
export async function executeReleaseSchedule(
  id: string,
  lease: string,
  options: {
    origin?: string
    fetch?: typeof globalThis.fetch
    timeoutMs?: number
  } = {},
): Promise<void> {
  const origin = options.origin ?? process.env['ADMIN_ORIGIN'] ?? ''
  let url: URL
  try {
    url = new URL(origin)
  } catch {
    throw new Error('Configure ADMIN_ORIGIN to execute scheduled changes.')
  }
  if (
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash ||
    !(
      url.protocol === 'https:' ||
      (url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))
    )
  ) {
    throw new Error('ADMIN_ORIGIN must be an HTTPS origin or a local development origin.')
  }
  url.pathname = '/api/internal/scheduled-release'
  const response = await (options.fetch ?? globalThis.fetch)(url, {
    method: 'POST',
    redirect: 'error',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, lease }),
    signal: AbortSignal.timeout(options.timeoutMs ?? 50_000),
  })
  const reader = response.body?.getReader()
  if (!reader) throw new Error('The scheduled release result could not be confirmed.')
  let text = ''
  let bytes = 0
  try {
    const decoder = new TextDecoder()
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      bytes += value.byteLength
      if (bytes > 4096) {
        await reader.cancel()
        throw new Error('The scheduled release response was invalid.')
      }
      text += decoder.decode(value, { stream: true })
    }
  } finally {
    reader.releaseLock()
  }
  let result: unknown
  try {
    result = JSON.parse(text)
  } catch {
    throw new Error('The scheduled release result could not be confirmed.')
  }
  if (response.ok && result && typeof result === 'object' && 'ok' in result && result.ok === true) return
  // Do not echo arbitrary response bodies, which could contain capabilities.
  const permanent =
    response.status === 409 &&
    !!result &&
    typeof result === 'object' &&
    'permanent' in result &&
    result.permanent === true
  throw Object.assign(
    new Error(
      permanent
        ? 'These scheduled changes need a new review. Open Publish to check permissions, content and readiness.'
        : 'The scheduled release could not be confirmed.',
    ),
    permanent ? { kind: 'invalid_state' } : {},
  )
}
