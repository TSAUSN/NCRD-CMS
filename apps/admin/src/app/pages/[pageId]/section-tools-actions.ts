'use server'
import { randomUUID } from 'node:crypto'
import { revalidatePath } from 'next/cache'
import { asUser } from '@cms/platform'
import { DomainError, mapErrors } from '@cms/domain'
import { currentSession } from '../../../lib/session.ts'
import {
  reviewSectionLink,
  renameSectionLinkDrafts,
  sectionCopyChoices,
  copySectionDraft,
  type SectionToolSource,
} from '../../../lib/section-tools-commands.ts'
async function run<T>(
  input: SectionToolSource,
  command: (client: Parameters<Parameters<typeof asUser>[1]>[0]) => Promise<T>,
) {
  const session = await currentSession()
  if (!session) return { ok: false as const, kind: 'error' as const, message: 'Sign in before managing a section.' }
  try {
    const result = await mapErrors(() => asUser({ userId: session.principal.userId, requestId: randomUUID() }, command))
    return { ok: true as const, ...result }
  } catch (error) {
    let sourceChanged = error instanceof DomainError && error.kind === 'stale_revision'
    if (sourceChanged)
      try {
        const head = await asUser(
          { userId: session.principal.userId },
          async client =>
            (
              await client.query<{ revision: string; draft_version_id: string }>(
                'SELECT revision::text,draft_version_id FROM pages WHERE id=$1',
                [input.pageId],
              )
            ).rows[0],
        )
        sourceChanged = !head || head.revision !== input.revision || head.draft_version_id !== input.versionId
      } catch {
        /* Keep a conservative source-conflict result. */
      }
    return {
      ok: false as const,
      kind: sourceChanged ? ('conflict' as const) : ('error' as const),
      message:
        error instanceof DomainError
          ? error.message
          : 'The result could not be confirmed. Check the affected page drafts before trying again.',
    }
  }
}
export async function loadSectionLink(input: SectionToolSource) {
  return run(input, client => reviewSectionLink(client, input))
}
export async function saveSectionLink(input: SectionToolSource & { name: string; fingerprint: string }) {
  const result = await run(input, client => renameSectionLinkDrafts(client, input))
  if (result.ok) revalidatePath('/sites', 'layout')
  return result
}
export async function loadSectionCopyChoices(input: SectionToolSource) {
  return run(input, client => sectionCopyChoices(client, input))
}
export async function saveSectionCopy(
  input: SectionToolSource & { targetPageId: string; targetRevision: string; at: number },
) {
  const result = await run(input, client => copySectionDraft(client, input))
  if (result.ok) revalidatePath('/sites', 'layout')
  return result
}
