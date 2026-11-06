// Liveness and readiness for the `site` role (SPEC §3.1, §6.15).
import { asPublic } from '@cms/platform'

export const dynamic = 'force-dynamic'

export async function GET(): Promise<Response> {
  try {
    // Readiness means the public role can actually execute its lookup, not
    // merely that the process is listening.
    await asPublic(client => client.query("SELECT 1 FROM public_api.resolve_host('health.invalid')"))
    return Response.json(
      { status: 'ok', role: 'site', version: process.env['APP_VERSION'] ?? 'dev' },
      { headers: { 'cache-control': 'no-store' } },
    )
  } catch (error) {
    return Response.json(
      { status: 'unavailable', error: (error as Error).message },
      { status: 503, headers: { 'cache-control': 'no-store' } },
    )
  }
}
