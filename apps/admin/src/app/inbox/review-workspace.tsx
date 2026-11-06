'use client'

import state from '../../components/state.module.css'
import workspace from '../../components/workspace.module.css'
import { Dialog, Button } from '../../components/ui/index.ts'
import { reviewTime as formatWhen } from '../../lib/review-time.ts'
import { ScriptlessPreview } from '../../components/scriptless-preview.tsx'
import { GuardedLink as Link } from '../../components/guarded-link.tsx'
import { Workbench, Tabs, Field, EmptyState, ButtonLink, SegmentedControl } from '../../components/ui/index.ts'
import { useCommentDraft } from '../../components/use-comment-draft.ts'
import { requestClientNavigation } from '../../components/navigation-guard.ts'
import type { ReleasePresentation } from '../../lib/release-copy.ts'
import { useRouter } from 'next/navigation'
import { useEffect, useMemo, useState, useTransition, useRef, type ReactNode } from 'react'
import type { ReadinessReport } from '@cms/domain'
import { reviewStatusLabel } from '@cms/domain'
import {
  addReviewComment,
  approveReviewSubmission,
  rejectReviewSubmission,
  resolveReviewComment,
} from '../actions/reviews.ts'
import { type ActionResult } from '../../lib/action-result.ts'
import { ConfirmDialog, ReasonDialog } from '../../components/confirm.tsx'
import {
  IconAlert,
  IconCheck,
  IconClock,
  IconExternal,
  IconMail,
  IconPage,
  IconSearch,
} from '../../components/icons.tsx'
import type { ReviewComment, ReviewPerson, ReviewSubmission } from '../../lib/review-queries.ts'

type Filter = 'waiting' | 'returned' | 'decided' | 'all'

export function ReviewWorkspace({
  fullScreen = false,
  actorId = '',
  queueHeader,
  unavailable = false,
  comparison,
  initialQuery = '',
  initialFilter,
  reviews,
  selected,
  comments,
  people,
  readiness,
  basePath,
}: {
  fullScreen?: boolean
  actorId?: string
  queueHeader?: ReactNode
  unavailable?: boolean
  comparison?: ReleasePresentation | null
  initialQuery?: string
  initialFilter?: string
  reviews: ReviewSubmission[]
  selected: ReviewSubmission | null
  comments: ReviewComment[]
  people: ReviewPerson[]
  readiness: ReadinessReport | null
  basePath: string
}) {
  const router = useRouter()
  const [filter, setFilter] = useState<Filter>(
    ['waiting', 'returned', 'decided', 'all'].includes(initialFilter ?? '')
      ? (initialFilter as Filter)
      : fullScreen && selected?.status === 'rejected'
        ? 'returned'
        : fullScreen && selected && selected.status !== 'open'
          ? 'decided'
          : 'waiting',
  )
  const [query, setQuery] = useState(initialQuery)
  const [result, setResult] = useState<ActionResult | null>(null)
  const [confirmApprove, setConfirmApprove] = useState(false)
  const [rejectOpen, setRejectOpen] = useState(false)
  const [rejectReason, setRejectReason] = useState('')
  const [sampleOpen, setSampleOpen] = useState(false)
  const [samplesConfirmed, setSamplesConfirmed] = useState(false)
  const [overrideOpen, setOverrideOpen] = useState(false)
  const [overrideReason, setOverrideReason] = useState('')
  const [pending, startTransition] = useTransition()
  const commentDraft = useCommentDraft(
    actorId,
    selected?.id ?? '',
    pending,
    Boolean(actorId),
    fullScreen ? undefined : 'your page review comment (saved only in this browser)',
  )
  const { body: commentBody, setBody: setCommentBody, mentions, setMentions } = commentDraft
  const [tab, setTab] = useState('changes'),
    [phase, setPhase] = useState<'approve' | 'return' | 'comment' | 'resolve' | null>(null)
  const lastStatus = useRef(selected?.status)
  useEffect(() => {
    if (fullScreen && selected && lastStatus.current !== selected.status)
      setFilter(selected.status === 'open' ? 'waiting' : selected.status === 'rejected' ? 'returned' : 'decided')
    lastStatus.current = selected?.status
  }, [fullScreen, selected?.status])

  // Every draft control below belongs to one immutable request. A route change
  // swaps `selected` without remounting this workbench; clear the old request's
  // words before they can be posted or used as a decision on the new one.
  useEffect(() => {
    setResult(null)
    setConfirmApprove(false)
    setSampleOpen(false)
    setSamplesConfirmed(false)
    setRejectOpen(false)
    setRejectReason('')
    setOverrideOpen(false)
    setOverrideReason('')
  }, [selected?.id])

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return reviews.filter(review => {
      const matchesFilter =
        filter === 'all' ||
        (filter === 'waiting' && review.status === 'open') ||
        (filter === 'returned' && review.status === 'rejected') ||
        (filter === 'decided' && (review.status === 'approved' || review.status === 'superseded'))
      const matchesQuery =
        !needle ||
        [review.pageTitle, review.siteName, review.submittedByName, review.requestNote].some(value =>
          value.toLowerCase().includes(needle),
        )
      return matchesFilter && matchesQuery
    })
  }, [filter, query, reviews])

  function approve(override?: string, sampleConsent = samplesConfirmed) {
    if (!selected) return
    setPhase('approve')
    startTransition(async () => {
      try {
        const data = new FormData()
        data.set('submissionId', selected.id)
        if (override) data.set('overrideReason', override)
        if (sampleConsent) data.set('sampleContentConfirmed', 'true')
        const outcome = await approveReviewSubmission(data)
        setResult(outcome)
        if (!outcome.ok && outcome.kind === 'blocked') {
          if (outcome.report.blocking.some(finding => finding.rule === 'sample_content') && !sampleConsent)
            setSampleOpen(true)
          else setOverrideOpen(true)
        }
        if (outcome.ok) {
          window.dispatchEvent(new Event('cms:inbox-changed'))
          // The action revalidates this route; a second refresh can overtake its result.
        }
      } catch {
        setResult({
          ok: false,
          kind: 'error',
          message: 'The result could not be confirmed. Check the saved review status before trying again.',
        })
      }
    })
  }

  function reject(reason: string) {
    if (!selected) return
    setPhase('return')
    startTransition(async () => {
      try {
        const data = new FormData()
        data.set('submissionId', selected.id)
        data.set('reason', reason)
        const outcome = await rejectReviewSubmission(data)
        setResult(outcome)
        if (outcome.ok) {
          window.dispatchEvent(new Event('cms:inbox-changed'))
          // The action revalidates this route; a second refresh can overtake its result.
        }
      } catch {
        setResult({
          ok: false,
          kind: 'error',
          message: 'The result could not be confirmed. Check the saved review status before trying again.',
        })
      }
    })
  }

  function postComment() {
    if (!selected || !commentBody.trim()) return
    setPhase('comment')
    startTransition(async () => {
      try {
        const data = new FormData()
        data.set('submissionId', selected.id)
        data.set('body', commentBody)
        data.set('mentions', JSON.stringify(mentions))
        const outcome = await addReviewComment(data)
        setResult(outcome)
        if (outcome.ok) {
          commentDraft.clear()
          // The action revalidates this route; a second refresh can overtake its result.
        }
      } catch {
        setResult({
          ok: false,
          kind: 'error',
          message: 'The result could not be confirmed. Check the saved review status before trying again.',
        })
      }
    })
  }

  function toggleResolved(comment: ReviewComment) {
    setPhase('resolve')
    startTransition(async () => {
      try {
        const data = new FormData()
        data.set('commentId', comment.id)
        data.set('resolved', String(comment.resolvedAt === null))
        const outcome = await resolveReviewComment(data)
        setResult(outcome)
        // resolveReviewComment revalidates this route with the saved result.
      } catch {
        setResult({
          ok: false,
          kind: 'error',
          message: 'The result could not be confirmed. Check the saved review status before trying again.',
        })
      }
    })
  }

  const dialogs = (
    <>
      {confirmApprove && selected && (
        <ConfirmDialog
          tone="publish"
          title="Approve and publish this version?"
          what={<>The submitted version of “{selected.pageTitle}” will become the live page now.</>}
          reassurance="Only the saved changes you reviewed are published. Newer drafts stay private."
          confirmLabel="Approve and publish"
          onCancel={() => setConfirmApprove(false)}
          onConfirm={() => {
            setConfirmApprove(false)
            approve()
          }}
        />
      )}
      {rejectOpen && (
        <ReasonDialog
          title="Return this page for changes?"
          explanation="The page stays exactly as it is on the live site. The author will see this feedback when they reopen the draft."
          label="What should change?"
          value={rejectReason}
          confirmLabel="Return with feedback"
          onChange={setRejectReason}
          onCancel={() => {
            setRejectOpen(false)
            setRejectReason('')
          }}
          onConfirm={() => {
            const reason = rejectReason.trim()
            if (!reason) return
            setRejectOpen(false)
            setRejectReason('')
            reject(reason)
          }}
        />
      )}
      {sampleOpen && (
        <Dialog title="Publish with sample content?" onClose={() => setSampleOpen(false)}>
          <p>This submitted version still contains examples. Visitors will see them if you approve it.</p>
          {result && !result.ok && result.kind === 'blocked' && (
            <ul>
              {result.report.blocking
                .filter(finding => finding.rule === 'sample_content')
                .map((finding, index) => (
                  <li key={index}>{finding.message}</li>
                ))}
            </ul>
          )}
          <div className="actions">
            <Button variant="secondary" onClick={() => setSampleOpen(false)}>
              Keep in review
            </Button>
            <Button
              variant="publish"
              onClick={() => {
                setSampleOpen(false)
                setSamplesConfirmed(true)
                approve(undefined, true)
              }}
            >
              Publish with sample content
            </Button>
          </div>
        </Dialog>
      )}
      {overrideOpen && (
        <ReasonDialog
          title="Approve despite the readiness warning?"
          explanation="This exception and the blocking findings are recorded with the publication. Return the page instead if the author should fix them."
          label="Why is publishing now the right decision?"
          value={overrideReason}
          confirmLabel="Approve with recorded reason"
          onChange={setOverrideReason}
          onCancel={() => {
            setOverrideOpen(false)
            setOverrideReason('')
          }}
          onConfirm={() => {
            const reason = overrideReason.trim()
            if (!reason) return
            setOverrideOpen(false)
            setOverrideReason('')
            approve(reason)
          }}
        />
      )}
    </>
  )
  const chooseDecision = (run: () => void) => {
    if (!actorId || requestClientNavigation(run)) run()
  }
  const presentation = selected?.story ?? comparison
  const notes = comments.filter(comment => comment.resolvedAt === null).length
  const canDecide = selected?.status === 'open' && selected.isCurrent && selected.canReview
  const checks = (
    <section className={workspace.workbenchChecks} aria-label="Checks">
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
  if (fullScreen)
    return (
      <>
        <Workbench
          className="review-board"
          queueLabel="Review requests"
          storageKey="cms.reviews.queue-width"
          queue={
            <>
              {queueHeader}
              <div className={workspace.queueTools}>
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
                <ol className={workspace.queueItems}>
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
                        <span className={workspace.queueTag}>{review.siteName}</span>
                        {review.unresolvedCommentCount > 0 && (
                          <small>{review.unresolvedCommentCount} open comments</small>
                        )}
                      </Link>
                    </li>
                  ))}
                </ol>
              ) : (
                <p role="status" className={workspace.queueNote}>
                  {query
                    ? 'No matching requests. Try a page, site or person.'
                    : filter === 'waiting'
                      ? 'No changes are waiting for review.'
                      : 'No requests in this view.'}
                </p>
              )}
              <p className={workspace.queueNote}>
                Approving publishes the change. Asking for changes sends it back with your note.
              </p>
            </>
          }
        >
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
              <header className={workspace.workbenchHeader}>
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
                <div className={workspace.workbenchActions} role="group" aria-label="Review decision">
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
                <blockquote className={workspace.workbenchQuote}>“{selected.requestNote}”</blockquote>
              )}
              {selected.status === 'rejected' && selected.decisionNote && (
                <section className={workspace.formPanel + ' ' + workspace.panel}>
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
                  <div className={workspace.formStack}>
                    <section
                      className={workspace.workbenchCompare}
                      aria-label={selected.story ? 'Story changes' : 'Saved changes'}
                    >
                      <h3>{selected.story ? 'Story changes' : 'Saved changes'}</h3>
                      {presentation ? (
                        <>
                          <p className={workspace.meta}>
                            {selected.status === 'approved' && !selected.story
                              ? 'These saved changes were approved and published.'
                              : presentation.summary}
                          </p>
                          {selected.story && (
                            <p className={workspace.meta}>
                              Approval publishes this story and its article together. Other story drafts stay private.
                            </p>
                          )}
                          {presentation.cells.length > 0 && (
                            <>
                              <div className={workspace.comparisonLabels}>
                                <span>{selected.story ? 'Live when sent' : 'Live now'}</span>
                                <span>After approval</span>
                              </div>
                              <dl className={workspace.comparisonRows}>
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
                  <div className={workspace.formStack}>
                    <div className={workspace.actions}>
                      <p>Submitted page · read-only</p>
                      <Link href={`/preview/${selected.versionId}?readonly=1`} target="_blank">
                        Open preview
                      </Link>
                    </div>
                    <ScriptlessPreview
                      className={workspace.workbenchPreview}
                      title={`Submitted version of ${selected.pageTitle}`}
                      src={`/preview/${selected.versionId}?readonly=1`}
                    />
                  </div>
                ) : (
                  <section className={workspace.formStack} aria-label="Discussion">
                    <h3>Discussion</h3>
                    {comments.length === 0 ? (
                      <p>No comments yet. Add a comment about anything that should change.</p>
                    ) : (
                      comments.map(comment => (
                        <article className={workspace.formPanel + ' ' + workspace.panel} key={comment.id}>
                          <div className={workspace.workbenchHeader}>
                            <div>
                              <strong>{comment.authorName}</strong>
                              <p>
                                <time dateTime={comment.createdAt}>{formatWhen(comment.createdAt)}</time>
                              </p>
                            </div>
                            {comment.canResolve && (
                              <Button
                                variant="secondary"
                                size="s"
                                disabled={pending}
                                onClick={() => toggleResolved(comment)}
                              >
                                {comment.resolvedAt ? 'Reopen' : 'Resolve'}
                              </Button>
                            )}
                          </div>
                          <p>{comment.body}</p>
                          {comment.mentions.length > 0 && (
                            <p className={workspace.meta}>
                              Mentioned{' '}
                              {comment.mentions
                                .map(id => people.find(person => person.id === id)?.displayName ?? 'a teammate')
                                .join(', ')}
                            </p>
                          )}
                        </article>
                      ))
                    )}
                    {selected.status === 'open' ? (
                      <>
                        <Field id="review-comment" label="Add a comment">
                          <textarea
                            id="review-comment"
                            rows={4}
                            maxLength={4000}
                            value={commentBody}
                            disabled={pending}
                            onChange={event => setCommentBody(event.target.value)}
                          />
                        </Field>
                        <div className={workspace.actions} role="group" aria-label="Mention a teammate">
                          {people.map(person => (
                            <Button
                              key={person.id}
                              variant="secondary"
                              size="s"
                              aria-pressed={mentions.includes(person.id)}
                              disabled={pending}
                              onClick={() =>
                                setMentions(current =>
                                  current.includes(person.id)
                                    ? current.filter(id => id !== person.id)
                                    : [...current, person.id],
                                )
                              }
                            >
                              @{person.displayName}
                            </Button>
                          ))}
                        </div>
                        {commentDraft.restored && (
                          <p role="status">
                            {commentDraft.dirty
                              ? 'An earlier comment draft is saved in this browser. Your latest edits are unsaved.'
                              : 'A private comment draft is saved in this browser. Add comment sends it to the review.'}
                          </p>
                        )}
                        <div className={workspace.actions}>
                          <Button
                            variant={selected.canApprove ? 'secondary' : 'primary'}
                            disabled={pending || !commentBody.trim()}
                            onClick={postComment}
                          >
                            Add comment
                          </Button>
                          {commentBody && (
                            <Button
                              variant="secondary"
                              disabled={pending}
                              onClick={async () => {
                                const saved = await commentDraft.saveDraft()
                                if (!saved.ok)
                                  setResult({
                                    ok: false,
                                    kind: 'error',
                                    message: saved.message ?? 'The draft could not be saved.',
                                  })
                              }}
                            >
                              Save comment draft
                            </Button>
                          )}
                        </div>
                      </>
                    ) : commentBody ? (
                      <section className={workspace.panel + ' ' + workspace.formPanel}>
                        <h3>Your unsent comment</h3>
                        <p>{commentBody}</p>
                        <p>This private draft has not been added to the review.</p>
                        <Button variant="secondary" onClick={commentDraft.clear}>
                          Discard comment draft
                        </Button>
                      </section>
                    ) : null}
                  </section>
                )}
              </Tabs>
            </>
          )}
        </Workbench>
        {dialogs}
      </>
    )
  return (
    <div className={'review-board ' + workspace.workbench}>
      <aside className={'review-queue ' + workspace.workbenchRail} aria-label="Review requests">
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
          <ol className={'review-list ' + workspace.workbenchList}>
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

      <section className={'review-detail ' + workspace.workbenchBody} aria-live="polite">
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
            <header className={'review-detail-head ' + workspace.workbenchHeading}>
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
              <blockquote className={'review-request-note ' + workspace.workbenchQuote}>
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
              <section className={workspace.panel} aria-label="Story changes">
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
              <section className={'review-preview-panel ' + workspace.panel}>
                <div className={'review-panel-head ' + workspace.workbenchHeading}>
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

              <aside className={'review-readiness ' + workspace.panel}>
                <div className={'review-panel-head ' + workspace.workbenchHeading}>
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

            <section className={'review-discussion ' + workspace.panel}>
              <div className={'review-panel-head ' + workspace.workbenchHeading}>
                <div>
                  <p className="eyebrow">Team context</p>
                  <h3>Discussion</h3>
                </div>
                <span>{comments.filter(comment => comment.resolvedAt === null).length} unresolved</span>
              </div>
              <div className="review-comments">
                {comments.length === 0 ? (
                  <p className="muted">No comments yet. Add one when context will help the next person.</p>
                ) : (
                  comments.map(comment => (
                    <article key={comment.id} className={comment.resolvedAt ? 'is-resolved' : undefined}>
                      <div className="review-comment-head">
                        <span className="review-avatar" aria-hidden="true">
                          {initials(comment.authorName)}
                        </span>
                        <div>
                          <strong>{comment.authorName}</strong>
                          <small>{formatWhen(comment.createdAt)}</small>
                        </div>
                        {comment.canResolve && (
                          <button
                            type="button"
                            className="link"
                            disabled={pending}
                            onClick={() => toggleResolved(comment)}
                          >
                            {comment.resolvedAt ? 'Reopen' : 'Resolve'}
                          </button>
                        )}
                      </div>
                      <p>{comment.body}</p>
                      {comment.mentions.length > 0 && (
                        <small>
                          Mentioned{' '}
                          {comment.mentions
                            .map(id => people.find(person => person.id === id)?.displayName ?? 'a teammate')
                            .join(', ')}
                        </small>
                      )}
                    </article>
                  ))
                )}
              </div>
              {selected.status === 'open' ? (
                <div className="review-comment-compose">
                  <label htmlFor="review-comment">Add a comment</label>
                  <textarea
                    id="review-comment"
                    rows={3}
                    maxLength={4000}
                    disabled={pending}
                    value={commentBody}
                    placeholder="Record context, a question, or a specific change."
                    onChange={event => setCommentBody(event.target.value)}
                  />
                  <div className="review-mentions">
                    <span>Mention</span>
                    {people.map(person => (
                      <button
                        key={person.id}
                        type="button"
                        disabled={pending}
                        aria-pressed={mentions.includes(person.id)}
                        onClick={() =>
                          setMentions(current =>
                            current.includes(person.id)
                              ? current.filter(id => id !== person.id)
                              : [...current, person.id],
                          )
                        }
                      >
                        @{person.displayName}
                      </button>
                    ))}
                  </div>
                  {commentDraft.restored && (
                    <p role="status">
                      {commentDraft.dirty
                        ? 'An earlier comment draft is saved in this browser. Your latest edits are unsaved.'
                        : 'A private comment draft is saved in this browser. Add comment sends it to the review.'}
                    </p>
                  )}
                  <div className={workspace.actions}>
                    <button
                      type="button"
                      className="navy"
                      disabled={pending || !commentBody.trim()}
                      onClick={postComment}
                    >
                      Add comment
                    </button>
                    {actorId && commentBody && (
                      <Button
                        variant="secondary"
                        disabled={pending}
                        onClick={async () => {
                          const saved = await commentDraft.saveDraft()
                          if (!saved.ok)
                            setResult({
                              ok: false,
                              kind: 'error',
                              message: saved.message ?? 'The draft could not be saved.',
                            })
                        }}
                      >
                        Save comment draft
                      </Button>
                    )}
                  </div>
                </div>
              ) : actorId && commentBody ? (
                <section className={workspace.formPanel + ' ' + workspace.panel}>
                  <h4>Your unsent comment</h4>
                  <p>{commentBody}</p>
                  <p>This private draft has not been added to the review.</p>
                  <Button variant="secondary" onClick={commentDraft.clear}>
                    Discard comment draft
                  </Button>
                </section>
              ) : null}
            </section>

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
              <footer className={'review-decision-bar ' + workspace.inlineReviewDecisions}>
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

function ReviewFact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}

function summaryOf(review: ReviewSubmission): string {
  const summary = review.summary
  if (summary.firstPublication) return `${summary.submittedSections} ready to go live`
  const facts: string[] = []
  if (summary.addedSections) facts.push(`${summary.addedSections} added`)
  if (summary.removedSections) facts.push(`${summary.removedSections} removed`)
  if (summary.changedSections) facts.push(`${summary.changedSections} changed`)
  if (summary.reordered) facts.push('order changed')
  if (summary.changedMetadata.length) facts.push('metadata changed')
  return facts.length > 0 ? facts.join(' · ') : 'No visible difference found'
}

function initials(value: string): string {
  const words = value.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return '?'
  return (words[0]![0]! + (words[1]?.[0] ?? words[0]![1] ?? '')).toUpperCase()
}

function reviewAge(value: string) {
  const minutes = Math.max(0, Math.floor((Date.now() - Date.parse(value)) / 60000))
  return minutes < 1
    ? 'sent just now'
    : minutes < 60
      ? 'sent ' + minutes + ' ' + (minutes === 1 ? 'minute' : 'minutes') + ' ago'
      : minutes < 1440
        ? 'sent ' + Math.floor(minutes / 60) + ' ' + (minutes < 120 ? 'hour' : 'hours') + ' ago'
        : 'sent ' + Math.floor(minutes / 1440) + ' ' + (minutes < 2880 ? 'day' : 'days') + ' ago'
}
