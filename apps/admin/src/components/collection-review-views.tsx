import type { ReactNode } from 'react'
import { reviewStatusLabel } from '@cms/domain'
import type { CollectionReview } from '../lib/collection-review.ts'
import type { CollectionReviewResult } from '../app/collection-review-actions.ts'
import { reviewTime } from '../lib/review-time.ts'
import { GuardedLink as Link } from './guarded-link.tsx'
import { Button, ButtonLink, StatusPill, Workbench, Field, Tabs, EmptyState, type StatusLabel } from './ui/index.ts'
import styles from './collection-review.module.css'
import workspaceFormsStyles from './workspace-styles/workspace-forms.module.css'
import listInspectorStyles from './workspace-styles/list-inspector.module.css'
import reviewWorkbenchStyles from './workspace-styles/review-workbench.module.css'

type ReviewViewProps = {
  visible: CollectionReview[]
  selected: CollectionReview | null
  basePath: string
  children: ReactNode
  includeHistory: boolean
  setIncludeHistory: (show: boolean) => void
  decision: ReactNode
  discussion: ReactNode
  dialogs: ReactNode
  result: CollectionReviewResult | null
}

type FullReviewProps = ReviewViewProps & {
  queueHeader?: ReactNode
  unavailable: boolean
  reviewCount: number
  query: string
  setQuery: (query: string) => void
  pending: boolean
  checkSavedStatus: () => void
  tab: string
  setTab: (tab: string) => void
  unresolvedComments: number
}

export function FullCollectionReview({
  visible,
  selected,
  basePath,
  children,
  includeHistory,
  setIncludeHistory,
  decision,
  discussion,
  dialogs,
  result,
  queueHeader,
  unavailable,
  reviewCount,
  query,
  setQuery,
  pending,
  checkSavedStatus,
  tab,
  setTab,
  unresolvedComments,
}: FullReviewProps) {
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
                        {item.submittedByName} · <time dateTime={item.submittedAt}>{reviewTime(item.submittedAt)}</time>
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
                : reviewCount
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
                  <Button variant="secondary" size="s" disabled={pending} onClick={checkSavedStatus}>
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
                  label: unresolvedComments ? `Discussion (${unresolvedComments})` : 'Discussion',
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
}

export function CompactCollectionReview({
  visible,
  selected,
  basePath,
  children,
  includeHistory,
  setIncludeHistory,
  decision,
  discussion,
  dialogs,
  result,
}: ReviewViewProps) {
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
