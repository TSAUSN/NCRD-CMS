import state from '../../components/state.module.css'
import reviewWorkbenchStyles from '../../components/workspace-styles/review-workbench.module.css'
import ownedStyles from './review-workspace-styles.module.css'
import { reviewTime as formatWhen } from '../../lib/review-time.ts'
import { ScriptlessPreview } from '../../components/scriptless-preview.tsx'
import { GuardedLink as Link } from '../../components/guarded-link.tsx'
import { type ReactNode } from 'react'
import { reviewStatusLabel } from '@cms/domain'
import { IconAlert, IconCheck, IconClock, IconExternal, IconMail, IconSearch } from '../../components/icons.tsx'

import type { ReviewModel } from './use-review-model.ts'
import { ReviewFact, summaryOf } from './review-display.tsx'
import { EmbeddedReviewDiscussion } from './review-discussion.tsx'

export function EmbeddedReviewRail({ model }: { model: ReviewModel }) {
  const { selected, basePath, filter, setFilter, query, setQuery, visible } = model
  return (
    <aside className={'review-queue ' + reviewWorkbenchStyles.workbenchRail} aria-label="Review requests">
      <div className="review-queue-tools">
        <label className="search review-search">
          <IconSearch size={16} />
          <span className="sr-only">Search review requests</span>
          <input
            value={query}
            onChange={event => setQuery(event.target.value)}
            placeholder="Search pages, sites or people"
          />
        </label>
        <div className="review-filter" role="group" aria-label="Review status">
          {(
            [
              ['waiting', 'Waiting'],
              ['returned', 'Returned'],
              ['decided', 'Decided'],
              ['all', 'All'],
            ] as const
          ).map(([value, label]) => (
            <button key={value} type="button" aria-pressed={filter === value} onClick={() => setFilter(value)}>
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="review-queue-count">
        <strong>{visible.length}</strong> {visible.length === 1 ? 'request' : 'requests'} shown
      </div>
      {visible.length === 0 ? (
        <div className={'review-queue-empty ' + state.state}>
          <span>
            <IconCheck size={20} />
          </span>
          <strong>
            {query ? 'No matching requests' : filter === 'waiting' ? 'Queue is clear' : 'Nothing here yet'}
          </strong>
          <p>{query ? 'Try a page, site or person.' : 'There is no review work in this view.'}</p>
        </div>
      ) : (
        <ol className={'review-list ' + reviewWorkbenchStyles.workbenchList}>
          {visible.map(review => (
            <li key={review.id}>
              <Link
                href={`${basePath}?review=${review.id}`}
                className={selected?.id === review.id ? 'is-active' : undefined}
                aria-current={selected?.id === review.id ? 'true' : undefined}
              >
                <span className={`review-state-dot is-${review.status}`} aria-hidden="true" />
                <span className="review-list-copy">
                  <span className="review-list-topline">
                    <strong>{review.pageTitle}</strong>
                  </span>
                  <span>
                    {review.siteName} · {review.submittedByName}
                  </span>
                  <small>
                    {reviewStatusLabel(review.status)} · {formatWhen(review.submittedAt)}
                  </small>
                </span>
                {review.unresolvedCommentCount > 0 && (
                  <span className="review-comment-count" title="Unresolved comments">
                    {review.unresolvedCommentCount}
                  </span>
                )}
              </Link>
            </li>
          ))}
        </ol>
      )}
    </aside>
  )
}

export function EmbeddedReviewWorkspace({ model, dialogs }: { model: ReviewModel; dialogs: ReactNode }) {
  const { selected, readiness, result, setConfirmApprove, setRejectOpen, pending, chooseDecision } = model
  return (
    <div className={'review-board ' + reviewWorkbenchStyles.workbench}>
      <EmbeddedReviewRail model={model} />

      <section className={'review-detail ' + reviewWorkbenchStyles.workbenchBody} aria-live="polite">
        {!selected ? (
          <div className={'review-detail-empty ' + state.state}>
            <span>
              <IconMail size={24} />
            </span>
            <h2>Select a review request</h2>
            <p>The submitted version, readiness checks and discussion will appear here.</p>
          </div>
        ) : (
          <>
            <header className={'review-detail-head ' + ownedStyles.workbenchHeading}>
              <div>
                <p className="eyebrow">
                  {selected.siteName} · {selected.pagePath}
                </p>
                <h2>{selected.pageTitle}</h2>
                <p>
                  Submitted by <strong>{selected.submittedByName}</strong> on{' '}
                  <time dateTime={selected.submittedAt}>{formatWhen(selected.submittedAt)}</time>
                </p>
              </div>
              <span className={`review-state is-${selected.status}`}>{reviewStatusLabel(selected.status)}</span>
            </header>

            {!selected.isCurrent && selected.status === 'open' && (
              <div className="notice notice-warn" role="alert">
                <IconAlert size={16} />
                <span className="notice-body">
                  This page changed after it was submitted. Approval is locked so newer work can never be mistaken for
                  the reviewed version. Ask the author to submit again.
                </span>
              </div>
            )}
            {selected.requestNote && (
              <blockquote className={'review-request-note ' + reviewWorkbenchStyles.workbenchQuote}>
                “{selected.requestNote}”
              </blockquote>
            )}
            {selected.status === 'rejected' && selected.decisionNote && (
              <div className="review-returned-note">
                <strong>Feedback sent to the author</strong>
                <p>{selected.decisionNote}</p>
              </div>
            )}

            {selected.story && (
              <section className={reviewWorkbenchStyles.panel} aria-label="Story changes">
                <h3>Story changes</h3>
                <p>{selected.story.summary}</p>
                <p>Approval publishes this story and its article together. Other story drafts stay private.</p>
                <details>
                  <summary>What changed</summary>
                  <dl>
                    {selected.story.cells.map((cell, index) => (
                      <div key={index}>
                        <dt>{cell.label}</dt>
                        <dd>{cell.after}</dd>
                      </div>
                    ))}
                  </dl>
                </details>
              </section>
            )}
            <div className="review-facts">
              <ReviewFact
                label="Publication"
                value={selected.summary.firstPublication ? 'First publication' : 'Updates the live page'}
              />
              <ReviewFact label="Sections" value={summaryOf(selected)} />
              <ReviewFact
                label="Discussion"
                value={`${selected.commentCount} ${selected.commentCount === 1 ? 'comment' : 'comments'}`}
              />
            </div>

            <div className="review-content-grid">
              <section className={'review-preview-panel ' + reviewWorkbenchStyles.panel}>
                <div className={'review-panel-head ' + ownedStyles.workbenchHeading}>
                  <div>
                    <p className="eyebrow">Exact evidence</p>
                    <h3>Submitted page</h3>
                  </div>
                  <Link
                    className="btn secondary small"
                    href={`/preview/${selected.versionId}?readonly=1`}
                    target="_blank"
                  >
                    <IconExternal size={14} /> Open preview
                  </Link>
                </div>
                <div className="review-preview-frame">
                  <div className="review-preview-bar">Read-only · exactly as submitted</div>
                  <ScriptlessPreview
                    title={`Submitted version of ${selected.pageTitle}`}
                    src={`/preview/${selected.versionId}?readonly=1`}
                  />
                </div>
              </section>

              <aside className={'review-readiness ' + reviewWorkbenchStyles.panel}>
                <div className={'review-panel-head ' + ownedStyles.workbenchHeading}>
                  <div>
                    <p className="eyebrow">Publication checks</p>
                    <h3>Readiness</h3>
                  </div>
                  <span className={`review-ready-mark ${readiness?.ok ? 'is-ready' : 'is-blocked'}`}>
                    {readiness === null
                      ? 'Unavailable'
                      : readiness.ok
                        ? 'Ready'
                        : `${readiness.findings.filter(item => item.severity === 'blocking').length} blocking`}
                  </span>
                </div>
                {!readiness ? (
                  <p className="muted">Readiness could not be evaluated for this version.</p>
                ) : readiness.findings.length === 0 ? (
                  <div className="review-ready-empty">
                    <IconCheck size={20} />
                    <strong>No issues found</strong>
                    <p>The submitted version passed the current publication policy.</p>
                  </div>
                ) : (
                  <ul className="review-findings">
                    {readiness.findings.map((finding, index) => (
                      <li key={`${finding.rule}-${index}`} className={`is-${finding.severity}`}>
                        {finding.severity === 'blocking' ? <IconAlert size={15} /> : <IconClock size={15} />}
                        <span>
                          <strong>
                            {finding.severity === 'blocking' ? 'Fix before publishing' : 'Worth checking'}
                          </strong>
                          {finding.message}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
                {selected.carriesTrustedCode && (
                  <div className="notice notice-warn">
                    <IconAlert size={15} />
                    <span className="notice-body">
                      This version contains governed custom code. Only a super admin can approve it.
                    </span>
                  </div>
                )}
              </aside>
            </div>

            <EmbeddedReviewDiscussion model={model} selected={selected} />

            {result && (
              <div
                className={`notice notice-${result.ok ? 'ok' : result.kind === 'blocked' ? 'warn' : 'error'}`}
                role={result.ok ? 'status' : 'alert'}
              >
                {result.ok ? <IconCheck size={16} /> : <IconAlert size={16} />}
                <span className="notice-body">{result.message}</span>
              </div>
            )}

            {selected.status === 'open' && (
              <footer className={'review-decision-bar ' + ownedStyles.inlineReviewDecisions}>
                <div>
                  <strong>
                    {selected.canReview
                      ? selected.canApprove
                        ? 'Make the review decision'
                        : 'A super admin must approve this version'
                      : 'Waiting for an editor'}
                  </strong>
                  <span>
                    {selected.canReview
                      ? selected.canApprove
                        ? 'Approval publishes this exact version. Returning it changes nothing live.'
                        : 'You can return it with feedback, but governed custom code needs super-admin approval.'
                      : 'You can keep the discussion here while this exact version waits.'}
                  </span>
                </div>
                {selected.canReview && (
                  <div>
                    <button
                      type="button"
                      className="danger"
                      disabled={pending || !selected.isCurrent}
                      onClick={() => chooseDecision(() => setRejectOpen(true))}
                    >
                      Return with feedback
                    </button>
                    {selected.canApprove ? (
                      <button
                        type="button"
                        disabled={pending || !selected.isCurrent}
                        onClick={() => chooseDecision(() => setConfirmApprove(true))}
                      >
                        <IconCheck size={15} /> {pending ? 'Working…' : 'Approve and publish'}
                      </button>
                    ) : (
                      <button type="button" disabled>
                        Super-admin approval required
                      </button>
                    )}
                  </div>
                )}
              </footer>
            )}
          </>
        )}
      </section>

      {dialogs}
    </div>
  )
}
