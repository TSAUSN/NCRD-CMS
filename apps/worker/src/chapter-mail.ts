import type { Pool } from 'pg'
import { withWorkerSession } from './handlers.ts'
type Environment = Record<string, string | undefined>
export function localChapterRecordingOrigin(env: Environment = process.env): string | null {
  if (
    env['AUTH_PROVIDER'] !== 'local' ||
    env['CMS_LOCAL_TEST_MODE'] !== 'true' ||
    env['MAILER_PROVIDER'] !== 'recording'
  )
    return null
  try {
    const origin = new URL(env['ADMIN_ORIGIN'] ?? ''),
      db = new URL(env['DATABASE_URL_WORKER'] ?? '')
    return origin.protocol === 'http:' &&
      ['localhost', '127.0.0.1'].includes(origin.hostname) &&
      !origin.username &&
      !origin.password &&
      origin.pathname === '/' &&
      !origin.search &&
      !origin.hash &&
      ['postgres:', 'postgresql:'].includes(db.protocol) &&
      ['localhost', '127.0.0.1'].includes(db.hostname) &&
      db.port === '54329'
      ? origin.origin
      : null
  } catch {
    return null
  }
}
export async function recordLocalChapterMail(
  pool: Pool,
  workerId: string,
  env: Environment = process.env,
): Promise<number> {
  const origin = localChapterRecordingOrigin(env)
  if (!origin) return 0
  return withWorkerSession(pool, workerId, async client =>
    Number(
      (await client.query<{ count: number }>('SELECT app.record_due_local_chapter_mail($1) AS count', [origin]))
        .rows[0]!.count,
    ),
  )
}
