// Shared result shapes and session guard for server actions. Server actions are
// a transport, not an authorization layer: each one resolves the session, then
// calls a database command that re-authorizes independently, so bypassing the
// actions entirely still cannot cross a tenant or flip a pointer.
import { redirect } from 'next/navigation'
import { DomainError, type ReadinessReport } from '@cms/domain'
import { currentSession } from './session.ts'
import { type PublishTogether } from './publish-together.ts'

export type ActionResult =
  /**
   * `versionId` is the immutable version this write created, or null for a
   * write that created none. Every draft save inserts one and moves the page's
   * draft pointer to it, so the id the editor was rendered with names an older
   * version the moment anything is saved. The canvas renders a version by id,
   * and re-rendering it from the id the page was loaded with showed the draft
   * as it was when the editor opened — the newer the work, the more of it went
   * missing. Returning it makes the canvas able to follow the draft.
   */
  | { ok: true; revision: number; versionId: string | null; message: string }
  | { ok: false; kind: 'conflict'; currentRevision: number | undefined; message: string }
  | {
      ok: false
      kind: 'blocked'
      report: ReadinessReport
      message: string
      together?: PublishTogether
      needsSampleConfirmation?: true
    }
  | { ok: false; kind: 'error'; message: string }

export type GlobalElementsActionResult =
  | {
      ok: true
      headerRevision: number
      footerRevision: number
      headerVersionId: string
      footerVersionId: string
      message: string
    }
  | Exclude<ActionResult, { ok: true }>

export async function requireSession() {
  const session = await currentSession()
  if (!session) redirect('/sign-in')
  return session
}

export function toActionResult(error: unknown): Exclude<ActionResult, { ok: true }> {
  if (error instanceof DomainError) {
    switch (error.kind) {
      case 'stale_revision':
        return {
          ok: false,
          kind: 'conflict',
          currentRevision: error.currentRevision,
          message:
            'Someone else saved this page while you were editing. Your work is still here — ' +
            'reload to see their version before saving again.',
        }
      case 'trusted_code_unapproved':
        return {
          ok: false,
          kind: 'error',
          message: 'This page contains custom code, so a super admin has to approve it before it can go live.',
        }
      case 'not_authorized':
        return { ok: false, kind: 'error', message: 'You do not have permission to do that on this site.' }
      default:
        return { ok: false, kind: 'error', message: error.message }
    }
  }
  return { ok: false, kind: 'error', message: (error as Error).message }
}

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function messageFor(result: ActionResult, fallback: string): string {
  return result.ok ? fallback : result.message
}
