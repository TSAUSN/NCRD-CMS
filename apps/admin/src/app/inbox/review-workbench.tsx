import { useRouter } from 'next/navigation'
import workspaceFormsStyles from '../../components/workspace-styles/workspace-forms.module.css'
import recordTableStyles from '../../components/workspace-styles/record-table.module.css'
import listInspectorStyles from '../../components/workspace-styles/list-inspector.module.css'
import reviewWorkbenchStyles from '../../components/workspace-styles/review-workbench.module.css'
import versionHistoryStyles from '../../components/workspace-styles/version-history.module.css'
import ownedStyles from './review-workspace-styles.module.css'
import { Button } from '../../components/ui/index.ts'
import { reviewTime as formatWhen } from '../../lib/review-time.ts'
import { ScriptlessPreview } from '../../components/scriptless-preview.tsx'
import { GuardedLink as Link } from '../../components/guarded-link.tsx'
import { Workbench, Tabs, Field, EmptyState, ButtonLink, SegmentedControl } from '../../components/ui/index.ts'
import { type ReactNode } from 'react'
import { reviewStatusLabel } from '@cms/domain'
import { IconAlert, IconCheck, IconClock } from '../../components/icons.tsx'

import type { Filter, ReviewModel } from './use-review-model.ts'
import { reviewAge } from './review-display.tsx'
import { FullReviewDiscussion } from './review-discussion.tsx'

function FullReviewQueue({ model }: { model: ReviewModel }) {
  const { queueHeader, selected, basePath, filter, setFilter, query, setQuery, visible } = model
  return (
    <>
      {queueHeader}
      <div className={reviewWorkbenchStyles.queueTools}>
        <Field id="review-search" label="Search review requests">
          <input
            type="search"
            id="review-search"
            value={query}
            placeholder="Search pages, sites or people"
            onChange={event => setQuery(event.target.value)}
          />
        </Field>
        <SegmentedControl
          label="Review status"
          appearance="pills"
          size="s"
          value={filter}
          onChange={value => setFilter(value as Filter)}
          options={[
            { value: 'waiting', label: 'Waiting' },
            { value: 'returned', label: 'Returned' },
            { value: 'decided', label: 'Decided' },
            { value: 'all', label: 'All' },
          ]}
        />
      </div>
      {visible.length ? (
        <ol className={reviewWorkbenchStyles.queueItems}>
          {visible.map(review => (
            <li key={review.id}>
              <Link
                href={`${basePath}?review=${review.id}&q=${encodeURIComponent(query)}&reviewStatus=${filter}`}
                aria-current={selected?.id === review.id ? 'true' : undefined}
              >
                <strong>{review.pageTitle}</strong>
                <small>
                  {review.submittedByName} ·{' '}
                  <time dateTime={review.submittedAt} title={formatWhen(review.submittedAt)}>
                    {reviewAge(review.submittedAt)}
                  </time>
                </small>
                <span className={reviewWorkbenchStyles.queueTag}>{review.siteName}</span>
                {review.unresolvedCommentCount > 0 && <small>{review.unresolvedCommentCount} open comments</small>}
              </Link>
            </li>
          ))}
        </ol>
      ) : (
        <p role="status" className={reviewWorkbenchStyles.queueNote}>
          {query
            ? 'No matching requests. Try a page, site or person.'
            : filter === 'waiting'
              ? 'No changes are waiting for review.'
              : 'No requests in this view.'}
        </p>
      )}
      <p className={reviewWorkbenchStyles.queueNote}>
        Approving publishes the change. Asking for changes sends it back with your note.
      </p>
    </>
  )
}

function ReviewChecks({ model }: { model: ReviewModel }) {
  const { selected, readiness } = model
  return (
    <section className={reviewWorkbenchStyles.workbenchChecks} aria-label="Checks">
      <h3>Checks</h3>
      {!readiness ? (
        <p>Checks could not be completed. Refresh before publishing.</p>
      ) : readiness.findings.length === 0 ? (
        <ul>
          <li>
            <IconCheck size={16} />
            <span>No issues found in the saved changes.</span>
          </li>
        </ul>
      ) : (
        <ul>
          {readiness.findings.map((finding, index) => (
            <li key={index}>
              {finding.severity === 'blocking' ? <IconAlert size={16} /> : <IconClock size={16} />}
              <span>{finding.message}</span>
            </li>
          ))}
        </ul>
      )}
      {selected?.carriesTrustedCode && <p>A Super admin needs to approve this change before it can be published.</p>}
    </section>
  )
}

export function ReviewWorkbench({
  model,
  dialogs,
  receipt,
}: {
  model: ReviewModel
  dialogs: ReactNode
  receipt: string | null
}) {
  const router = useRouter()
  const {
    unavailable,
    reviews,
    selected,
    result,
    setConfirmApprove,
    setRejectOpen,
    pending,
    tab,
    setTab,
    phase,
    chooseDecision,
    presentation,
    notes,
    canDecide,
  } = model
  const checks = <ReviewChecks model={model} />
  return (
    <>
      <Workbench
        className="review-board"
        queueLabel="Review requests"
        storageKey="cms.reviews.queue-width"
        queue={<FullReviewQueue model={model} />}
      >
        {receipt && (
          <div role="status" className="notice notice-ok">
            {receipt}
          </div>
        )}
        {!selected ? (
          <EmptyState
            title={
              unavailable
                ? 'This review is unavailable'
                : reviews.length
                  ? 'Choose a review request'
                  : 'Nothing has been submitted yet'
            }
          >
            <p>
              {unavailable
                ? 'Choose a request you can see, or ask the person who sent it to check your access.'
                : reviews.length
                  ? 'Read its saved changes, checks and discussion before deciding.'
                  : 'Saved pages and stories appear here after someone submits them for review.'}
            </p>
            {unavailable ? <Link href="/inbox">Open your reviews</Link> : <Link href="/">Back to your work</Link>}
          </EmptyState>
        ) : (
          <>
            <header className={reviewWorkbenchStyles.workbenchHeader}>
              <div>
                <p>
                  {selected.siteName} · {selected.pageTitle}
                </p>
                <h2>{selected.pageTitle}</h2>
                <p>
                  Submitted by <strong>{selected.submittedByName}</strong> ·{' '}
                  <time dateTime={selected.submittedAt} title={formatWhen(selected.submittedAt)}>
                    {reviewAge(selected.submittedAt)}
                  </time>
                </p>
                <span className="review-state">{reviewStatusLabel(selected.status)}</span>
              </div>
              <div className={reviewWorkbenchStyles.workbenchActions} role="group" aria-label="Review decision">
                <ButtonLink
                  variant="secondary"
                  size="standard"
                  href={
                    selected.storyEntryId
                      ? `/sites/${selected.siteId}/stories/${selected.storyEntryId}`
                      : `/pages/${selected.pageId}`
                  }
                >
                  Open in editor
                </ButtonLink>
                {canDecide && (
                  <Button
                    variant="secondary"
                    size="standard"
                    disabled={pending}
                    onClick={() => chooseDecision(() => setRejectOpen(true))}
                  >
                    Return with feedback
                  </Button>
                )}
                {canDecide && selected.canApprove && presentation && (
                  <Button
                    variant="publish"
                    size="standard"
                    disabled={pending}
                    loading={pending && phase === 'approve'}
                    onClick={() => chooseDecision(() => setConfirmApprove(true))}
                  >
                    Approve and publish
                  </Button>
                )}
              </div>
            </header>
            {!selected.isCurrent && selected.status === 'open' && (
              <p role="alert">These saved changes were replaced by newer work. Ask the author to submit again.</p>
            )}
            {selected.requestNote && (
              <blockquote className={reviewWorkbenchStyles.workbenchQuote}>“{selected.requestNote}”</blockquote>
            )}
            {selected.status === 'rejected' && selected.decisionNote && (
              <section className={workspaceFormsStyles.formPanel + ' ' + reviewWorkbenchStyles.panel}>
                <h3>Feedback sent to the author</h3>
                <p>{selected.decisionNote}</p>
              </section>
            )}
            {pending && (
              <p role="status">
                {phase === 'approve'
                  ? 'Publishing reviewed changes… This can take up to a minute.'
                  : phase === 'return'
                    ? 'Sending your feedback…'
                    : phase === 'comment'
                      ? 'Adding your comment…'
                      : 'Saving the comment status…'}
              </p>
            )}
            {result && (
              <div
                role={result.ok ? 'status' : 'alert'}
                className={'notice ' + (result.ok ? 'notice-ok' : 'notice-error')}
              >
                {result.message}
                {!result.ok && (
                  <Button
                    variant="secondary"
                    size="s"
                    disabled={pending}
                    onClick={() => chooseDecision(() => router.refresh())}
                  >
                    Check saved review status
                  </Button>
                )}
              </div>
            )}
            <Tabs
              label="Review details"
              value={tab}
              tabs={[
                { value: 'changes', label: 'Changes' },
                { value: 'preview', label: 'Preview' },
                { value: 'discussion', label: notes ? 'Discussion (' + notes + ')' : 'Discussion' },
              ]}
              onChange={setTab}
            >
              {tab === 'changes' ? (
                <div className={listInspectorStyles.formStack}>
                  <section
                    className={reviewWorkbenchStyles.workbenchCompare}
                    aria-label={selected.story ? 'Story changes' : 'Saved changes'}
                  >
                    <h3>{selected.story ? 'Story changes' : 'Saved changes'}</h3>
                    {presentation ? (
                      <>
                        <p className={recordTableStyles.meta}>
                          {selected.status === 'approved' && !selected.story
                            ? 'These saved changes were approved and published.'
                            : presentation.summary}
                        </p>
                        {selected.story && (
                          <p className={recordTableStyles.meta}>
                            Approval publishes this story and its article together. Other story drafts stay private.
                          </p>
                        )}
                        {presentation.cells.length > 0 && (
                          <>
                            <div className={versionHistoryStyles.comparisonLabels}>
                              <span>{selected.story ? 'Live when sent' : 'Live now'}</span>
                              <span>After approval</span>
                            </div>
                            <dl className={versionHistoryStyles.comparisonRows}>
                              {presentation.cells.map((cell, index) => (
                                <div key={index}>
                                  <dt>{cell.label}</dt>
                                  <dd data-changed="before">{cell.before}</dd>
                                  <dd data-changed="after">{cell.after}</dd>
                                </div>
                              ))}
                            </dl>
                          </>
                        )}
                      </>
                    ) : (
                      <>
                        <p role="alert">Saved changes could not be compared. Refresh before publishing.</p>
                        <Button variant="secondary" onClick={() => router.refresh()}>
                          Try again
                        </Button>
                      </>
                    )}
                  </section>
                  {checks}
                </div>
              ) : tab === 'preview' ? (
                <div className={listInspectorStyles.formStack}>
                  <div className={workspaceFormsStyles.actions}>
                    <p>Submitted page · read-only</p>
                    <Link href={`/preview/${selected.versionId}?readonly=1`} target="_blank">
                      Open preview
                    </Link>
                  </div>
                  <ScriptlessPreview
                    className={ownedStyles.workbenchPreview}
                    title={`Submitted version of ${selected.pageTitle}`}
                    src={`/preview/${selected.versionId}?readonly=1`}
                  />
                </div>
              ) : (
                <FullReviewDiscussion model={model} selected={selected} />
              )}
            </Tabs>
          </>
        )}
      </Workbench>
      {dialogs}
    </>
  )
}
