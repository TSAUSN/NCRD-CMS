'use server'
import { revalidatePath } from 'next/cache'
import { randomUUID } from 'node:crypto'
import { asUser } from '@cms/platform'
import { getReviewSubmission } from '../../lib/review-queries.ts'
import { ActionResult, requireSession, toActionResult } from '../../lib/action-result.ts'
import { runReviewReadiness } from './page-publish.ts'

/**
 * Freeze what is on the page into the exact immutable version a reviewer will
 * decide. Contributors reach this instead of a Publish button; editors may use
 * it too when another person should make the final decision.
 */
export async function submitPageForReview(formData: FormData): Promise<ActionResult> {
  const session = await requireSession()
  const pageId = String(formData.get('pageId') ?? '')
  const expectedRevision = String(formData.get('revision') ?? '')
  const note = String(formData.get('note') ?? '').trim()
  try {
    const submitted = await asUser({ userId: session.principal.userId, requestId: randomUUID() }, async client => {
      const { rows } = await client.query<{ version_id: string; revision: string }>(
        'SELECT version_id, revision FROM app.submit_page_for_review($1,$2,$3)',
        [pageId, expectedRevision, note],
      )
      return { versionId: rows[0]!.version_id, revision: Number(rows[0]!.revision) }
    })
    revalidatePath(`/pages/${pageId}`)
    revalidatePath('/inbox')
    return {
      ok: true,
      revision: submitted.revision,
      versionId: submitted.versionId,
      message: 'Submitted for review. The live site has not changed.',
    }
  } catch (error) {
    return toActionResult(error)
  }
}

/** Approval publishes the submitted version, never whatever draft is newest. */
export async function approveReviewSubmission(formData: FormData): Promise<ActionResult> {
  const session = await requireSession()
  const submissionId = String(formData.get('submissionId') ?? '')
  let override = String(formData.get('overrideReason') ?? '').trim()

  try {
    const submission = await getReviewSubmission(session.principal.userId, submissionId)
    if (!submission) return { ok: false, kind: 'error', message: 'That review request is no longer available.' }
    const report = await runReviewReadiness(submission.versionId)
    if (report.blocking.some(finding => finding.rule === 'sample_content')) {
      if (formData.get('sampleContentConfirmed') !== 'true')
        return {
          ok: false,
          kind: 'blocked',
          report,
          message: 'This version still contains sample content. Review the examples and confirm publication.',
        }
      if (report.blocking.every(finding => finding.rule === 'sample_content'))
        override ||= 'Confirmed: Publish with sample content.'
    }
    if (!report.ok && !override) {
      return {
        ok: false,
        kind: 'blocked',
        report,
        message:
          'This submitted version is not ready to publish yet. Return it for changes, or approve with a recorded reason.',
      }
    }

    const published = await asUser({ userId: session.principal.userId, requestId: randomUUID() }, async client => {
      const { rows } = await client.query<{ revision: string }>(
        'SELECT revision FROM app.approve_page_submission($1,$2,$3,$4)',
        [submissionId, report.policyVersion, override || null, JSON.stringify(report.findings)],
      )
      return Number(rows[0]!.revision)
    })
    revalidatePath('/inbox')
    revalidatePath(`/pages/${submission.pageId}`)
    revalidatePath(`/sites/${submission.siteId}`)
    revalidatePath(`/sites/${submission.siteId}/publishing`)
    revalidatePath(`/sites/${submission.siteId}/stories`, 'layout')
    return {
      ok: true,
      revision: published,
      versionId: null,
      message:
        `Approved and published “${submission.pageTitle}”.` +
        (submission.story ? ' Story feeds are updating; this can take up to a minute.' : ''),
    }
  } catch (error) {
    return toActionResult(error)
  }
}

export async function rejectReviewSubmission(formData: FormData): Promise<ActionResult> {
  const session = await requireSession()
  const submissionId = String(formData.get('submissionId') ?? '')
  const reason = String(formData.get('reason') ?? '').trim()
  try {
    const submission = await getReviewSubmission(session.principal.userId, submissionId)
    if (!submission) return { ok: false, kind: 'error', message: 'That review request is no longer available.' }
    await asUser({ userId: session.principal.userId, requestId: randomUUID() }, client =>
      client.query('SELECT app.reject_page_submission($1,$2)', [submissionId, reason]),
    )
    revalidatePath('/inbox')
    revalidatePath(`/pages/${submission.pageId}`)
    revalidatePath(`/sites/${submission.siteId}/publishing`)
    return {
      ok: true,
      revision: submission.pageRevision,
      versionId: submission.versionId,
      message: `Returned “${submission.pageTitle}” with clear feedback. Nothing changed on the live site.`,
    }
  } catch (error) {
    return toActionResult(error)
  }
}

export async function addReviewComment(formData: FormData): Promise<ActionResult> {
  const session = await requireSession()
  const submissionId = String(formData.get('submissionId') ?? '')
  const body = String(formData.get('body') ?? '')
  let mentions: unknown = []
  try {
    mentions = JSON.parse(String(formData.get('mentions') ?? '[]'))
  } catch {
    return { ok: false, kind: 'error', message: 'The people mentioned in that comment could not be read.' }
  }
  try {
    const submission = await getReviewSubmission(session.principal.userId, submissionId)
    if (!submission) return { ok: false, kind: 'error', message: 'That review request is no longer available.' }
    await asUser({ userId: session.principal.userId, requestId: randomUUID() }, client =>
      client.query('SELECT app.add_page_comment($1,$2,$3,$4)', [
        submission.pageId,
        submission.versionId,
        body,
        JSON.stringify(mentions),
      ]),
    )
    revalidatePath('/inbox')
    return {
      ok: true,
      revision: submission.pageRevision,
      versionId: submission.versionId,
      message: 'Comment added to this submitted version.',
    }
  } catch (error) {
    return toActionResult(error)
  }
}

export async function resolveReviewComment(formData: FormData): Promise<ActionResult> {
  const session = await requireSession()
  const commentId = String(formData.get('commentId') ?? '')
  const resolved = String(formData.get('resolved') ?? '') === 'true'
  try {
    await asUser({ userId: session.principal.userId, requestId: randomUUID() }, client =>
      client.query('SELECT app.resolve_page_comment($1,$2)', [commentId, resolved]),
    )
    revalidatePath('/inbox')
    return {
      ok: true,
      revision: 0,
      versionId: null,
      message: resolved ? 'Comment resolved.' : 'Comment reopened.',
    }
  } catch (error) {
    return toActionResult(error)
  }
}
