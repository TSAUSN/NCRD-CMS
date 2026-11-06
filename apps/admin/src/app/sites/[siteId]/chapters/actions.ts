'use server'
import { inviteChapterEditor, chapterEditors } from '../../../../lib/local-chapter-mail.ts'
import { chapterUsesLinkedPage } from '@cms/schema'
import { randomUUID } from 'node:crypto'
import { revalidatePath } from 'next/cache'
import { DomainError } from '@cms/domain'
import { currentSession } from '../../../../lib/session.ts'
import { saveChapter } from '../../../../lib/chapters.ts'
export async function saveChapterAction(input: {
  siteId: string
  id: string | null
  revision: string
  slug: string
  config: unknown
  divisionId?: string | null
}) {
  const session = await currentSession()
  if (!session) return { ok: false as const, message: 'Sign in before changing a chapter.' }
  try {
    const row = await saveChapter(
      session.principal.userId,
      randomUUID(),
      input.siteId,
      input.id,
      input.revision,
      input.slug,
      input.config,
      input.divisionId,
    )
    revalidatePath('/sites/' + input.siteId)
    return {
      ok: true as const,
      row,
      message: chapterUsesLinkedPage(row.config.destination)
        ? 'Chapter link saved as a draft. Review it in Publish when it is ready.'
        : 'Chapter saved as a draft. Review and publish the page when it is ready.',
    }
  } catch (error) {
    return {
      ok: false as const,
      message:
        error instanceof DomainError
          ? error.message
          : 'The chapter could not be saved. Check the fields, then try again. Your entries are still here.',
    }
  }
}

export async function inviteChapterEditorAction(input: {
  chapterId: string
  revision: string
  email: string
  name: string
}) {
  const session = await currentSession()
  if (!session) return { ok: false as const, message: 'Sign in before inviting someone.' }
  try {
    const person = await inviteChapterEditor(
      session.principal.userId,
      input.chapterId,
      input.revision,
      input.email.trim().toLowerCase(),
      input.name.trim(),
    )
    return {
      ok: true as const,
      person,
      message: 'Chapter editor invited. The sign-in link is in the local outbox; no email was sent.',
    }
  } catch (error) {
    return {
      ok: false as const,
      message:
        error instanceof DomainError
          ? error.message
          : 'The invitation could not be confirmed. Your entries are still here.',
    }
  }
}
export async function loadChapterEditorsAction(chapterId: string) {
  const session = await currentSession()
  if (!session) return { ok: false as const, message: 'Sign in to see the chapter editors.' }
  try {
    return { ok: true as const, people: await chapterEditors(session.principal.userId, chapterId) }
  } catch {
    return { ok: false as const, message: 'This chapter’s editors could not be loaded. Try again.' }
  }
}
