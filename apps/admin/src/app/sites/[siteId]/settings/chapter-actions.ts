'use server'
import { asUser } from '@cms/platform'
import { randomUUID } from 'node:crypto'
import { revalidatePath } from 'next/cache'
import { currentSession } from '../../../../lib/session.ts'
import { DomainError } from '@cms/domain'
const describeError = (error: unknown) =>
  error instanceof DomainError ? error.message : 'The change could not be saved. Check your entries and try again.'
export async function saveChapterSettings(input: {
  siteId: string
  revision: string
  mode: 'division' | 'chapter-editors'
}) {
  const session = await currentSession()
  if (!session) return { ok: false as const, message: 'Sign in before saving.' }
  try {
    const saved = await asUser(
      { userId: session.principal.userId, requestId: randomUUID() },
      async client =>
        (
          await client.query<{ revision: string }>('SELECT app.save_chapter_defaults($1,$2,$3) AS revision', [
            input.siteId,
            input.revision,
            input.mode,
          ])
        ).rows[0]!.revision,
    )
    revalidatePath('/sites/' + input.siteId + '/settings')
    return {
      ok: true as const,
      message: 'Chapter defaults saved. Existing chapters keep their own setup.',
      revision: String(saved),
    }
  } catch (error) {
    return { ok: false as const, message: describeError(error) }
  }
}
export async function saveChapterTeam(input: {
  siteId: string
  divisionId?: string
  divisionName?: string
  email?: string
  name?: string
  enabled?: boolean
}) {
  const session = await currentSession()
  if (!session) return { ok: false as const, message: 'Sign in before saving.' }
  try {
    await asUser({ userId: session.principal.userId, requestId: randomUUID() }, async client => {
      if (input.divisionName !== undefined) {
        await client.query('SELECT app.create_chapter_division($1,$2)', [input.siteId, input.divisionName])
        return
      }
      const owned = (
        await client.query('SELECT id FROM chapter_divisions WHERE site_id=$1 AND id=$2', [
          input.siteId,
          input.divisionId,
        ])
      ).rows[0]
      if (!owned) throw new Error('Choose a division on this site.')
      await client.query('SELECT app.set_chapter_division_staff($1,$2,$3,$4)', [
        input.divisionId,
        input.email,
        input.name,
        input.enabled ?? true,
      ])
    })
    revalidatePath('/sites/' + input.siteId + '/settings')
    return { ok: true as const, message: 'Division team saved. No email was sent.' }
  } catch (error) {
    return { ok: false as const, message: describeError(error) }
  }
}

export async function saveChapterChecks(input: {
  siteId: string
  revision: string
  checks: boolean
  reminders: boolean
}) {
  const session = await currentSession()
  if (!session) return { ok: false as const, message: 'Sign in before saving.' }
  try {
    const saved = await asUser(
      { userId: session.principal.userId, requestId: randomUUID() },
      async client =>
        (
          await client.query<{ revision: string }>('SELECT app.save_chapter_check_settings($1,$2,$3,$4) AS revision', [
            input.siteId,
            input.revision,
            input.checks,
            input.reminders,
          ])
        ).rows[0]!.revision,
    )
    revalidatePath('/sites/' + input.siteId + '/settings')
    return { ok: true as const, message: 'Chapter checks saved.', revision: String(saved) }
  } catch (error) {
    return { ok: false as const, message: describeError(error) }
  }
}
export async function recordChapterMessages(input: { siteId: string; cycle?: string }) {
  const { localChapterMailOrigin } = await import('../../../../lib/local-chapter-mail.ts')
  const origin = localChapterMailOrigin()
  const session = await currentSession()
  if (!session || !origin)
    return { ok: false as const, message: 'Recorded messages are available only in the local demo.' }
  if (input.cycle !== undefined && !/^20\d{2}-(01|07)-01$/.test(input.cycle))
    return { ok: false as const, message: 'Choose a year and January or July.' }
  try {
    const count = await asUser({ userId: session.principal.userId, requestId: randomUUID() }, async client =>
      Number(
        (
          await client.query<{ count: number }>(
            input.cycle === undefined
              ? 'SELECT app.record_chapter_review_mail($1) AS count'
              : 'SELECT app.record_chapter_check($1,$2,$3) AS count',
            input.cycle === undefined ? [input.siteId] : [input.siteId, input.cycle, origin],
          )
        ).rows[0]!.count,
      ),
    )
    revalidatePath('/sites/' + input.siteId + '/outbox')
    return {
      ok: true as const,
      message: count
        ? `${count} ${count === 1 ? 'message' : 'messages'} recorded in the local outbox. No email was sent.`
        : 'No new messages to record. This check may already be recorded or switched off.',
    }
  } catch (error) {
    return { ok: false as const, message: describeError(error) }
  }
}
