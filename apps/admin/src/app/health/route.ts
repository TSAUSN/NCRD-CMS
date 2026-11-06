// Liveness and readiness for the `admin` role (SPEC §3.1, §6.15).
import { asUser } from '@cms/platform'

export const dynamic = 'force-dynamic'

export async function GET(): Promise<Response> {
  try {
    await asUser({ userId: null }, client => client.query('SELECT 1'))
    return Response.json(
      { status: 'ok', role: 'admin', version: process.env['APP_VERSION'] ?? 'dev' },
      { headers: { 'cache-control': 'no-store' } },
    )
  } catch (error) {
    return Response.json(
      { status: 'unavailable', error: (error as Error).message },
      { status: 503, headers: { 'cache-control': 'no-store' } },
    )
  }
}
