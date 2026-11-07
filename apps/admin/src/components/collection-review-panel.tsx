'use client'
import { reviewTime } from '../lib/review-time.ts'
import { GuardedLink as Link } from './guarded-link.tsx'
import { useCommentDraft } from './use-comment-draft.ts'
import { requestClientNavigation } from './navigation-guard.ts'
import { useRouter } from 'next/navigation'
import { useEffect, useMemo, useState, useTransition, type ReactNode } from 'react'
import { reviewStatusLabel } from '@cms/domain'
import type { CollectionReview, CollectionReviewComment } from '../lib/collection-review.ts'
import type { ReviewPerson } from '../lib/review-queries.ts'
import {
  addCollectionReviewComment,
  decideCollectionReview,
  resolveCollectionReviewComment,
  type CollectionReviewResult,
} from '../app/collection-review-actions.ts'
import { Button, ButtonLink, StatusPill, Workbench, Field, Tabs, EmptyState, type StatusLabel } from './ui/index.ts'
import { ConfirmDialog, ReasonDialog } from './confirm.tsx'
import styles from './collection-review.module.css'
import workspaceFormsStyles from './workspace-styles/workspace-forms.module.css'
import listInspectorStyles from './workspace-styles/list-inspector.module.css'
import reviewWorkbenchStyles from './workspace-styles/review-workbench.module.css'

export function CollectionReviewPanel({
  reviews,
  selected,
  comments,
  people,
  basePath,
  children,
  fullScreen = false,
  actorId = '',
  queueHeader,
  unavailable = false,
  initialQuery = '',
  initialIncludeHistory,
}: {
  reviews: CollectionReview[]
  selected: CollectionReview | null
  comments: CollectionReviewComment[]
  people: ReviewPerson[]
  basePath: string
  children: ReactNode
  fullScreen?: boolean
  actorId?: string
  queueHeader?: ReactNode
  unavailable?: boolean
  initialQuery?: string
  initialIncludeHistory?: boolean
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [result, setResult] = useState<CollectionReviewResult | null>(null)
  const [confirm, setConfirm] = useState(false)
  const [returnOpen, setReturnOpen] = useState(false)
  const [reason, setReason] = useState('')
  const commentDraft = useCommentDraft(
    actorId,
    selected?.id ?? '',
    pending,
    Boolean(actorId),
    fullScreen ? undefined : 'your list review comment (saved only in this browser)',
  )
  const { body, setBody, mentions, setMentions } = commentDraft
  const [tab, setTab] = useState('changes')
  const [query, setQuery] = useState(initialQuery)
  const [includeHistory, setIncludeHistory] = useState(initialIncludeHistory ?? selected?.status !== 'open')
  function act(
    action: (data: FormData) => Promise<CollectionReviewResult>,
    values: Record<string, string>,
    comment = false,
  ) {
    startTransition(async () => {
      const data = new FormData()
      for (const [key, value] of Object.entries(values)) data.set(key, value)
      try {
        const outcome = await action(data)
        setResult(outcome)
        if (outcome.ok) {
          if (comment) commentDraft.clear()
          window.dispatchEvent(new Event('cms:inbox-changed'))
          router.refresh()
        }
      } catch {
        setResult({
          ok: false,
          message: 'The result could not be confirmed. Check the saved review status before trying again.',
        })
      }
    })
  }
  useEffect(() => {
    if (selected?.status !== 'open') setIncludeHistory(true)
  }, [selected?.status])
  const visible = useMemo(
    () =>
      reviews.filter(
        item =>
          (includeHistory || item.status === 'open') &&
          (!query.trim() ||
            [item.submitted.name, item.siteName, item.submittedByName, item.note].some(value =>
              value.toLowerCase().includes(query.trim().toLowerCase()),
            )),
      ),
    [reviews, includeHistory, query],
  )
  const chooseDecision = (run: () => void) => {
    if (!actorId || requestClientNavigation(run)) run()
  }
  const dialogs = (
    <>
      {' '}
      {confirm && selected && (
        <ConfirmDialog
          tone="publish"
          title="Publish this submitted list?"
          what={`The submitted items, order and removals in “${selected.submitted.name}” will become live wherever pages use this list.`}
          reassurance="A changed draft cannot replace the content you reviewed."
          confirmLabel="Approve and publish list"
          onCancel={() => setConfirm(false)}
          onConfirm={() => {
            setConfirm(false)
            act(decideCollectionReview, { reviewId: selected.id, approve: 'true' })
          }}
        />
      )}
      {returnOpen && selected && (
        <ReasonDialog
          title="Return this list for changes?"
          explanation="The author will see your feedback in the list workspace. Live content stays as it is."
          label="What should change?"
          value={reason}
          onChange={setReason}
          confirmLabel="Return with feedback"
          onCancel={() => setReturnOpen(false)}
          onConfirm={() => {
            if (!reason.trim()) return
            setReturnOpen(false)
            act(decideCollectionReview, { reviewId: selected.id, approve: 'false', reason })
          }}
        />
      )}
    </>
  )
  const decision =
    selected?.status === 'open' && selected.canReview ? (
      <>
        <Button
          variant="secondary"
          disabled={pending || !selected.isCurrent}
          onClick={() => chooseDecision(() => setReturnOpen(true))}
        >
          Return with feedback
        </Button>
        <Button
          variant="publish"
          disabled={pending || !selected.isCurrent || !selected.canApprove}
          onClick={() => chooseDecision(() => setConfirm(true))}
        >
          Approve and publish list
        </Button>
      </>
    ) : null
  const discussion = selected && (
    <section className={fullScreen ? listInspectorStyles.formStack : 'review-discussion'} aria-label="Discussion">
      <h3>Discussion</h3>
      {!comments.length && <p className="muted">No comments yet. Add context or ask about a specific field.</p>}
      <div className="review-comments">
        {comments.map(comment => (
          <article key={comment.id} className={comment.resolvedAt ? 'is-resolved' : undefined}>
            <div className="review-comment-head">
              <strong>{comment.authorName}</strong>
              <small>{reviewTime(comment.createdAt)}</small>
              {comment.canResolve && (
                <Button
                  variant="secondary"
                  size="s"
                  disabled={pending}
                  onClick={() =>
                    act(resolveCollectionReviewComment, {
                      commentId: comment.id,
                      resolved: String(!comment.resolvedAt),
                    })
                  }
                >
                  {comment.resolvedAt ? 'Reopen' : 'Resolve'}
                </Button>
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
        ))}
      </div>
      {selected.status === 'open' ? (
        <>
          <Field id="collection-review-comment" label="Add a comment">
            <textarea
              id="collection-review-comment"
              rows={3}
              maxLength={4000}
              disabled={pending}
              value={body}
              onChange={event => setBody(event.target.value)}
            />
          </Field>
          <div className={workspaceFormsStyles.actions} role="group" aria-label="Mention a teammate">
            {people.map(person => (
              <Button
                key={person.id}
                variant="secondary"
                size="s"
                disabled={pending}
                aria-pressed={mentions.includes(person.id)}
                onClick={() =>
                  setMentions(current =>
                    current.includes(person.id) ? current.filter(id => id !== person.id) : [...current, person.id],
                  )
                }
              >
                @{person.displayName}
              </Button>
            ))}
          </div>
          {actorId && commentDraft.restored && (
            <p role="status">
              {commentDraft.dirty
                ? 'An earlier comment draft is saved in this browser. Your latest edits are unsaved.'
                : 'A private comment draft is saved in this browser. Add comment sends it to the review.'}
            </p>
          )}
          <div className={workspaceFormsStyles.actions}>
            <Button
              disabled={pending || !body.trim()}
              onClick={() =>
                act(
                  addCollectionReviewComment,
                  { reviewId: selected.id, body, mentions: JSON.stringify(mentions) },
                  true,
                )
              }
            >
              Add comment
            </Button>
            {actorId && body && (
              <Button
                variant="secondary"
                disabled={pending}
                onClick={async () => {
                  const saved = await commentDraft.saveDraft()
                  if (!saved.ok) setResult({ ok: false, message: saved.message ?? 'The draft could not be saved.' })
                }}
              >
                Save comment draft
              </Button>
            )}
          </div>
        </>
      ) : actorId && body ? (
        <>
          <h4>Your unsent comment</h4>
          <p>{body}</p>
          <p>This private draft has not been added to the review.</p>
          <Button variant="secondary" onClick={commentDraft.clear}>
            Discard comment draft
          </Button>
        </>
      ) : null}
    </section>
  )
  if (fullScreen)
    return (
      <>
        <Workbench
          className="review-board"
          queueLabel="List review requests"
          storageKey="cms.reviews.queue-width"
          queue={
            <>
              {queueHeader}
              <div className={reviewWorkbenchStyles.queueTools}>
                <Field id="list-review-search" label="Search list review requests">
                  <input
                    type="search"
                    id="list-review-search"
                    placeholder="Search lists, sites or people"
                    value={query}
                    onChange={event => setQuery(event.target.value)}
                  />
                </Field>
                <label className={styles.includeHistory}>
                  <input
                    type="checkbox"
                    checked={includeHistory}
                    onChange={event => setIncludeHistory(event.target.checked)}
                  />{' '}
                  Include decided requests
                </label>
              </div>
              {visible.length ? (
                <ol className={reviewWorkbenchStyles.queueItems}>
                  {visible.map(item => (
                    <li key={item.id}>
                      <Link
                        href={`${basePath}?collectionReview=${item.id}&q=${encodeURIComponent(query)}&reviewStatus=${includeHistory ? 'all' : 'waiting'}`}
                        aria-current={selected?.id === item.id ? 'true' : undefined}
                      >
                        <strong>{item.submitted.name}</strong>
                        <small>
                          {item.submittedByName} ·{' '}
                          <time dateTime={item.submittedAt}>{reviewTime(item.submittedAt)}</time>
                        </small>
                        <span className={reviewWorkbenchStyles.queueTag}>
                          {item.siteName} · {reviewStatusLabel(item.status)}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className={reviewWorkbenchStyles.queueNote} role="status">
                  {query ? 'No matching requests. Try a list, site or person.' : 'No list requests in this view.'}
                </p>
              )}
              <p className={reviewWorkbenchStyles.queueNote}>
                Approving publishes the submitted list everywhere pages use it. Returning sends your note to the author.
              </p>
            </>
          }
        >
          {!selected ? (
            <EmptyState
              title={
                unavailable
                  ? 'This list review is unavailable'
                  : reviews.length
                    ? 'Choose a list request'
                    : 'No list submissions yet'
              }
            >
              <p>
                {unavailable
                  ? 'Choose a request you can see, or ask the author to check your access.'
                  : 'Save a list’s draft, then choose Submit for review.'}
              </p>
              <Link href="/inbox?area=lists">Open your list reviews</Link>
            </EmptyState>
          ) : (
            <>
              <header className={reviewWorkbenchStyles.workbenchHeader}>
                <div>
                  <p>{selected.siteName} · List</p>
                  <h2>{selected.submitted.name}</h2>
                  <p>
                    Submitted by <strong>{selected.submittedByName}</strong> ·{' '}
                    <time dateTime={selected.submittedAt}>{reviewTime(selected.submittedAt)}</time>
                  </p>
                  <StatusPill status={reviewPill(selected.status)} title={reviewStatusLabel(selected.status)} />
                </div>
                <div className={reviewWorkbenchStyles.workbenchActions} role="group" aria-label="List review decision">
                  <ButtonLink
                    variant="secondary"
                    href={`/sites/${selected.siteId}/content?collection=${selected.collectionId}`}
                  >
                    Open this list
                  </ButtonLink>
                  {decision}
                </div>
              </header>
              {selected.note && (
                <blockquote className={reviewWorkbenchStyles.workbenchQuote}>“{selected.note}”</blockquote>
              )}
              {selected.decisionNote && (
                <section className={reviewWorkbenchStyles.panel + ' ' + workspaceFormsStyles.formPanel}>
                  <h3>Reviewer feedback</h3>
                  <p>{selected.decisionNote}</p>
                </section>
              )}
              {!selected.isCurrent && (
                <p className="notice notice-warn" role="alert">
                  The saved list has changed since submission. Review the submitted content beside the current draft
                  below. Approval of this old submission is unavailable.
                </p>
              )}
              {pending && <p role="status">Saving this review… Check the saved review status before trying again.</p>}
              {result && (
                <p className={`notice notice-${result.ok ? 'ok' : 'error'}`} role={result.ok ? 'status' : 'alert'}>
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
                </p>
              )}
              <Tabs
                label="List review details"
                value={tab}
                onChange={setTab}
                tabs={[
                  { value: 'changes', label: 'Changes' },
                  {
                    value: 'discussion',
                    label: comments.some(item => !item.resolvedAt)
                      ? 'Discussion (' + comments.filter(item => !item.resolvedAt).length + ')'
                      : 'Discussion',
                  },
                ]}
              >
                {tab === 'changes' ? (
                  <div className={listInspectorStyles.formStack}>
                    {children}
                    <section className={reviewWorkbenchStyles.workbenchChecks} aria-label="Checks">
                      <h3>Checks</h3>
                      <ul>
                        <li>
                          {selected.isCurrent
                            ? 'The submission matches the saved list.'
                            : 'Newer saved work needs another submission.'}
                        </li>
                        <li>Approval publishes the exact submitted items, order and removals.</li>
                        {!selected.canApprove && (
                          <li>
                            {selected.canReview
                              ? 'A site administrator must approve the included field changes.'
                              : 'Your submitted items remain private until approved.'}
                          </li>
                        )}
                      </ul>
                    </section>
                  </div>
                ) : (
                  discussion
                )}
              </Tabs>
            </>
          )}
        </Workbench>
        {dialogs}
      </>
    )
  return (
    <div className={`review-board ${styles.board} ${reviewWorkbenchStyles.workbench}`}>
      <aside className={'review-queue ' + reviewWorkbenchStyles.workbenchRail} aria-label="List review requests">
        <label className={styles.history}>
          <input type="checkbox" checked={includeHistory} onChange={event => setIncludeHistory(event.target.checked)} />{' '}
          Include decided requests
        </label>
        <ol className={styles.queueList}>
          {visible.map(item => (
            <li key={item.id}>
              <Link
                href={`${basePath}?collectionReview=${item.id}#collection-reviews`}
                className={`${styles.queueLink} ${selected?.id === item.id ? styles.active : ''}`}
              >
                <span className={styles.queueCopy}>
                  <strong>{item.submitted.name}</strong>
                  <span>
                    {item.siteName} · {item.submittedByName}
                  </span>
                  <StatusPill status={reviewPill(item.status)} title={reviewStatusLabel(item.status)} />
                </span>
              </Link>
            </li>
          ))}
        </ol>
      </aside>
      <section className={'review-detail ' + reviewWorkbenchStyles.workbenchBody}>
        {!selected ? (
          <p>Select a list request to inspect the submitted content.</p>
        ) : (
          <>
            <header className="review-detail-head">
              <div>
                <p className="eyebrow">{selected.siteName} · List</p>
                <h3>{selected.submitted.name}</h3>
                <p>
                  Submitted by {selected.submittedByName} ·{' '}
                  <time dateTime={selected.submittedAt}>{reviewTime(selected.submittedAt)}</time>
                </p>
              </div>
              <StatusPill status={reviewPill(selected.status)} title={reviewStatusLabel(selected.status)} />
            </header>
            {selected.note && <blockquote className="review-request-note">{selected.note}</blockquote>}
            {selected.decisionNote && (
              <div className="review-returned-note">
                <strong>Reviewer feedback</strong>
                <p>{selected.decisionNote}</p>
              </div>
            )}
            {!selected.isCurrent && (
              <p className="notice notice-warn">
                The saved list has changed since submission. Review the submitted content beside the current draft
                below. Approval of this old submission is unavailable.
              </p>
            )}
            {children}
            <p>
              <Link href={`/sites/${selected.siteId}/content?collection=${selected.collectionId}`}>Open this list</Link>
            </p>
            {discussion}
            {result && (
              <p className={`notice notice-${result.ok ? 'ok' : 'error'}`} role={result.ok ? 'status' : 'alert'}>
                {result.message}
              </p>
            )}
            {selected.status === 'open' && (
              <footer className="review-decision-bar">
                <div>
                  <strong>{selected.canReview ? 'Make the review decision' : 'Waiting for an editor'}</strong>
                  <span>
                    {selected.canApprove
                      ? 'Approval publishes these exact saved items and their order.'
                      : selected.canReview
                        ? 'A site administrator must approve the included field changes.'
                        : 'Your submitted items remain private until approved.'}
                  </span>
                </div>
                {selected.canReview && <div>{decision}</div>}
              </footer>
            )}
          </>
        )}
      </section>
      {dialogs}
    </div>
  )
}

function reviewPill(status: CollectionReview['status']): StatusLabel {
  return status === 'open'
    ? 'In review'
    : status === 'approved'
      ? 'Live'
      : status === 'superseded'
        ? 'Archived'
        : 'Draft'
}
