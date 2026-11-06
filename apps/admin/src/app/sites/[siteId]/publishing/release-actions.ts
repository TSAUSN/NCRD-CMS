'use server'

import { revalidatePath } from 'next/cache'
import { asUser } from '@cms/platform'
import { DomainError } from '@cms/domain'
import { currentSession } from '../../../../lib/session.ts'
import {
  executeSiteRelease,
  listReleaseCandidates,
  checkedReleaseSelection,
  planSiteRelease,
  scheduleSiteRelease,
  type ReleaseItem,
  type ReleaseRow,
} from '../../../../lib/releases.ts'

export type ReleaseResult = {
  ok: boolean
  message: string
  presentations?: Record<string, import('../../../../lib/release-copy.ts').ReleasePresentation>
  release?: Omit<ReleaseRow, 'created_at' | 'finished_at'> & { created_at: string; finished_at: string | null }
}
export async function prepareRelease(siteId: string, id: string, items: ReleaseItem[]): Promise<ReleaseResult> {
  const session = await currentSession()
  if (!session) return { ok: false, message: 'Sign in before preparing a release.' }
  if (!Array.isArray(items) || !items.length || items.length > 200)
    return { ok: false, message: 'Select up to 200 release items.' }
  try {
    const release = await planSiteRelease(session.principal.userId, id, siteId, items)
    const { releasePresentations } = await import('../../../../lib/release-presentation.ts'),
      presentations = await releasePresentations(session.principal.userId, siteId, release.snapshot)
    revalidatePath(`/sites/${siteId}/publishing`)
    return {
      ok: true,
      message: 'Release preview prepared. The live site is unchanged.',
      presentations,
      release: {
        ...release,
        created_at: release.created_at.toISOString(),
        finished_at: release.finished_at?.toISOString() ?? null,
      },
    }
  } catch (error) {
    return {
      ok: false,
      message:
        error instanceof DomainError
          ? error.message
          : 'The release preview could not be prepared. No publication was committed.',
    }
  }
}
export async function publishRelease(id: string, override: string, samplesConfirmed = false): Promise<ReleaseResult> {
  const session = await currentSession()
  if (!session) return { ok: false, message: 'Sign in before publishing a release.' }
  try {
    await executeSiteRelease(session.principal.userId, id, override, samplesConfirmed === true)
    revalidatePath('/', 'layout')
    return { ok: true, message: 'Release applied. The selected changes took effect together.' }
  } catch (error) {
    return {
      ok: false,
      message:
        error instanceof DomainError
          ? error.message
          : 'The release could not be confirmed. Refresh its status before retrying.',
    }
  }
}
export async function cancelRelease(id: string): Promise<ReleaseResult> {
  const session = await currentSession()
  if (!session) return { ok: false, message: 'Sign in before cancelling a release.' }
  try {
    await asUser({ userId: session.principal.userId }, client =>
      client.query('SELECT app.finish_site_release($1,true,$2)', [id, '{}']),
    )
    revalidatePath('/', 'layout')
    return { ok: true, message: 'Release cancelled. The live site was not changed.' }
  } catch (error) {
    return { ok: false, message: error instanceof DomainError ? error.message : 'Cancellation could not be confirmed.' }
  }
}

export async function scheduleRelease(
  id: string,
  runAt: string,
  override: string,
  samplesConfirmed: boolean,
  requestId: string,
): Promise<ReleaseResult> {
  const session = await currentSession()
  const { schedulingConfigured } = await import('../../../../lib/scheduling.ts')
  if (!session || !schedulingConfigured())
    return { ok: false, message: 'Scheduling has not been activated for this installation.' }
  if (!Number.isFinite(Date.parse(runAt))) return { ok: false, message: 'Choose a valid date and time.' }
  try {
    await scheduleSiteRelease(session.principal.userId, id, runAt, override, samplesConfirmed === true, requestId)
    revalidatePath('/', 'layout')
    return { ok: true, message: 'Scheduling request saved. Check Scheduled publishing below for its current status.' }
  } catch (error) {
    return {
      ok: false,
      message:
        error instanceof DomainError
          ? error.message
          : 'The schedule could not be confirmed. Check scheduled changes before retrying.',
    }
  }
}

/** Full before/after values travel only when a comparison is opened. Verify the
 * monotonic draft pins on both sides of the read, so a concurrent save cannot
 * appear under the earlier row's identity. */
export async function readReleaseComparison(
  siteId: string,
  requested: ReleaseItem,
): Promise<
  | { ok: true; comparison: import('../../../../lib/release-copy.ts').ReleasePresentation }
  | { ok: false; message: string; stale: boolean }
> {
  const session = await currentSession()
  if (!session) return { ok: false, message: 'Sign in again to view these changes.', stale: true }
  try {
    const userId = session.principal.userId
    const before = (await listReleaseCandidates(userId, siteId)).filter(item => item.key === requested?.key)
    const [actual] = checkedReleaseSelection(before, [requested])
    const { releasePresentations } = await import('../../../../lib/release-presentation.ts')
    const data = await releasePresentations(userId, siteId, [actual!], true)
    const after = (await listReleaseCandidates(userId, siteId)).filter(item => item.key === requested.key)
    checkedReleaseSelection(after, [requested])
    const comparison = data[requested.key]
    if (!comparison) throw new DomainError('not_found', 'These saved changes are no longer available.')
    return { ok: true, comparison }
  } catch (error) {
    return {
      ok: false,
      message: error instanceof DomainError ? error.message : 'The comparison could not be loaded. Try again.',
      stale: error instanceof DomainError,
    }
  }
}
