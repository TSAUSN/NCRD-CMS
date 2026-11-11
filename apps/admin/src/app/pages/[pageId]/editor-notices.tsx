import { GuardedLink as Link } from '../../../components/guarded-link.tsx'
import { IconAlert, IconCheck, IconMail } from '../../../components/icons.tsx'
import type { ActionResult } from '../../../lib/action-result.ts'
import { publishTogetherReviewHref } from '../../../lib/publish-together-copy.ts'

type EditorNoticesProps = {
  result: ActionResult | null
  needsReview: boolean
  approved: boolean
  reviewFeedback: string | null
  scheduleFirstReview: boolean
  siteId: string
  pageId: string
  canPublish: boolean
  canApproveTrustedCode: boolean
  dismissResult: () => void
  confirmOverride: () => void
  approveCode: () => void
}

/** Save outcomes, code approval and reviewer feedback above the canvas. */
export function EditorNotices({
  result,
  needsReview,
  approved,
  reviewFeedback,
  scheduleFirstReview,
  siteId,
  pageId,
  canPublish,
  canApproveTrustedCode,
  dismissResult,
  confirmOverride,
  approveCode,
}: EditorNoticesProps) {
  if (!(result || (needsReview && !approved) || reviewFeedback)) return null
  return (
    <div className="editor-notices">
      {result && (
        <div
          className={`notice notice-${result.ok ? 'ok' : result.kind === 'blocked' ? 'warn' : 'error'}`}
          role={result.ok ? 'status' : 'alert'}
        >
          {result.ok ? <IconCheck size={16} /> : <IconAlert size={16} />}
          <div className="notice-body">
            {result.message}
            {!result.ok && result.message.includes('Publish the saved numbers with this page') && (
              <p>
                This page uses shared Data values that are still a draft. Ask an administrator to review and publish
                those values with the intended page changes. Your page draft is kept.{' '}
                <Link href="/help?topic=saved-numbers">How to publish saved numbers</Link>
              </p>
            )}
            {scheduleFirstReview && (
              <div>
                <Link className="btn small" href={'/sites/' + siteId + '/publishing'}>
                  Review first site publication
                </Link>
              </div>
            )}
            {!result.ok && result.kind === 'conflict' && (
              <>
                {' '}
                Your work is still on screen.{' '}
                <button type="button" className="link" onClick={() => window.location.reload()}>
                  Reload to see their version
                </button>
                .
              </>
            )}
            {!result.ok && result.kind === 'blocked' && result.together && (
              <div className="together">
                {result.together.pages.length > 0 && (
                  <ul className="together-pages" aria-label="Pages that go live with this one">
                    {result.together.pages.map(page => (
                      <li key={page.id}>
                        {page.title} <span>{page.path}</span>
                      </li>
                    ))}
                  </ul>
                )}
                <div className="cluster">
                  <Link className="btn small" href={publishTogetherReviewHref(pageId, result.together)}>
                    Review related changes in Publish
                  </Link>
                  <button type="button" className="ghost small" onClick={dismissResult}>
                    Not now
                  </button>
                </div>
              </div>
            )}
            {!result.ok && result.kind === 'blocked' && !result.together && (
              <>
                {result.report.findings.filter(f => f.severity === 'blocking').length > 0 && (
                  <ul>
                    {result.report.findings
                      .filter(f => f.severity === 'blocking')
                      .map((finding, i) => (
                        <li key={`${finding.rule}-${i}`}>{finding.message}</li>
                      ))}
                  </ul>
                )}
                {canPublish && (
                  <button type="button" className="link" onClick={confirmOverride}>
                    Publish anyway…
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {needsReview && !approved && (
        <div className="notice notice-warn" role="alert">
          <IconAlert size={16} />
          <div className="notice-body">
            This page has custom code on it, so a super admin has to look at it before the page can go live. Everything
            else about the page works as usual.
            {canApproveTrustedCode && (
              <>
                {' '}
                <button type="button" className="link" onClick={approveCode}>
                  Approve this code…
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {reviewFeedback && (
        <div className="notice notice-warn" role="status">
          <IconMail size={16} />
          <div className="notice-body">
            <strong>Changes requested.</strong> {reviewFeedback} Make the update, then submit this page again when it is
            ready.
          </div>
        </div>
      )}
    </div>
  )
}
