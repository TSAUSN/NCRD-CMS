import 'server-only'
import { randomBytes, randomUUID } from 'node:crypto'
import { asUser, type Queryable } from '@cms/platform'
import { DomainError } from '@cms/domain'
type Environment = Record<string, string | undefined>
/** This recording adapter is available only in the explicitly local demo. */
export function localChapterMailOrigin(env: Environment = process.env): string | null {
  if (
    env['AUTH_PROVIDER'] !== 'local' ||
    env['CMS_LOCAL_TEST_MODE'] !== 'true' ||
    env['MAILER_PROVIDER'] !== 'recording'
  )
    return null
  try {
    const admin = new URL(env['ADMIN_ORIGIN'] ?? '')
    const database = new URL(env['DATABASE_URL_AUTHENTICATED'] ?? '')
    if (
      admin.protocol !== 'http:' ||
      !['localhost', '127.0.0.1'].includes(admin.hostname) ||
      admin.username ||
      admin.password ||
      admin.pathname !== '/' ||
      admin.search ||
      admin.hash ||
      !['localhost', '127.0.0.1'].includes(database.hostname) ||
      !['postgres:', 'postgresql:'].includes(database.protocol)
    )
      return null
    return admin.origin
  } catch {
    return null
  }
}
export async function queueLocalChapterSignIn(client: Queryable, email: string, chapterId?: string): Promise<void> {
  const origin = localChapterMailOrigin()
  if (!origin) throw new DomainError('invalid_state', 'Local sign-in links are unavailable on this installation.')
  await client.query('SELECT app.queue_local_chapter_sign_in($1,$2,$3,$4)', [
    email,
    randomBytes(32).toString('base64url'),
    origin,
    chapterId ?? null,
  ])
}
export function inviteChapterEditor(userId: string, chapterId: string, revision: string, email: string, name: string) {
  if (!localChapterMailOrigin())
    throw new DomainError('invalid_state', 'Chapter invitations are available in the local demo only.')
  return asUser({ userId, requestId: randomUUID() }, async client => {
    const person = (
      await client.query<{ id: string }>('SELECT app.invite_chapter_editor($1,$2,$3,$4) AS id', [
        chapterId,
        revision,
        email,
        name,
      ])
    ).rows[0]!.id
    await queueLocalChapterSignIn(client, email, chapterId)
    return person
  })
}
export type ChapterEditor = { id: string; name: string; email: string; enabled: boolean }
export function chapterEditors(userId: string, chapterId: string) {
  return asUser(
    { userId },
    async client => (await client.query<ChapterEditor>('SELECT * FROM app.chapter_editor_feed($1)', [chapterId])).rows,
  )
}
export type LocalChapterMail = {
  id: string
  kind: string
  recipient: string
  subject: string
  body: string
  link: string | null
  createdAt: string
  expired: boolean | null
}
export function localChapterMessages(userId: string, siteId: string): Promise<LocalChapterMail[]> {
  return asUser(
    { userId },
    async client =>
      (await client.query<{ items: LocalChapterMail[] }>('SELECT app.local_chapter_mail_feed($1) AS items', [siteId]))
        .rows[0]?.items ?? [],
  )
}
