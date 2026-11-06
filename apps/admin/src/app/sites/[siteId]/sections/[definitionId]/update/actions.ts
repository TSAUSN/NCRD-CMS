'use server'
import { randomUUID } from 'node:crypto'
import { revalidatePath } from 'next/cache'
import { asUser } from '@cms/platform'
import { DomainError } from '@cms/domain'
import { currentSession } from '../../../../../../lib/session.ts'
import {
  applySectionPageUpdates,
  previewSectionPageUpdate,
  type SectionPagePin,
} from '../../../../../../lib/section-page-updates.ts'
export async function previewPageUpdate(siteId: string, definitionId: string, version: number, pin: SectionPagePin) {
  const session = await currentSession()
  if (!session) return { ok: false as const, stale: false, message: 'Sign in to review page updates.' }
  try {
    return {
      ok: true as const,
      ...(await asUser({ userId: session.principal.userId }, client =>
        previewSectionPageUpdate(client, siteId, definitionId, version, pin),
      )),
    }
  } catch (error) {
    return {
      ok: false as const,
      stale: error instanceof DomainError && error.kind === 'stale_revision',
      message: error instanceof DomainError ? error.message : 'The preview could not be loaded. Try again.',
    }
  }
}
export async function updateSectionPages(
  siteId: string,
  definitionId: string,
  version: number,
  pins: SectionPagePin[],
) {
  const session = await currentSession()
  if (!session) return { ok: false, message: 'Sign in to update pages.' }
  try {
    const count = await asUser({ userId: session.principal.userId, requestId: randomUUID() }, client =>
      applySectionPageUpdates(client, siteId, definitionId, version, pins),
    )
    for (const pin of pins) revalidatePath(`/pages/${pin.pageId}`)
    revalidatePath(`/sites/${siteId}/sections`)
    return {
      ok: true,
      message: `Updated ${count} ${count === 1 ? 'page draft' : 'page drafts'}. Review and publish when ready.`,
    }
  } catch (error) {
    return {
      ok: false,
      message:
        error instanceof DomainError
          ? error.message
          : 'The update could not be confirmed. Refresh the page list before trying again.',
    }
  }
}
