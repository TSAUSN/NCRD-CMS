import { asPublic } from '@cms/platform'
import { normalizeHost } from '@cms/domain'
export const dynamic = 'force-dynamic'
/** Internal Caddy on-demand TLS ask endpoint. The edge blocks /internal/*.
 * No private content is returned, and the app grants no certificate itself. */
export async function GET(request: Request): Promise<Response> {
  const raw = new URL(request.url).searchParams.get('domain')
  const host = normalizeHost(raw)
  if (!raw || !host || raw !== host) return new Response(null, { status: 403 })
  try {
    const result = await asPublic(client =>
      client.query<{ allowed: boolean }>('SELECT public_api.certificate_allowed($1) AS allowed', [host]),
    )
    return new Response(null, { status: result.rows[0]?.allowed ? 204 : 403, headers: { 'cache-control': 'no-store' } })
  } catch {
    return new Response(null, { status: 503, headers: { 'cache-control': 'no-store' } })
  }
}
