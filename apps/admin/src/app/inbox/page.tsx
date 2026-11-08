import { CollectionReviewSection } from '../../components/collection-review-section.tsx'
import { listCollectionReviews } from '../../lib/collection-review.ts'
import { notFound } from 'next/navigation'
import { GuardedLink as Link } from '../../components/guarded-link.tsx'
import { LegacyReviewLink } from './legacy-review-link.tsx'
import { Workbench, EmptyState } from '../../components/ui/index.ts'
import workspace from '../../components/workspace.module.css'
import reviewWorkbenchStyles from '../../components/workspace-styles/review-workbench.module.css'
import {
  getReviewSubmission,
  listReviewComments,
  listReviewPeople,
  listReviewSubmissions,
  reviewChangePresentation,
} from '../../lib/review-queries.ts'
import { currentSession } from '../../lib/session.ts'
import { runReviewReadiness } from '../actions/page-publish.ts'
import { ReviewWorkspace } from './review-workspace.tsx'
import { getInboxSnapshot, listSectionRequests } from '../../lib/inbox.ts'
import { ThumbnailRetry } from './thumbnail-retry.tsx'
import { SectionRequestCard } from '../../components/section-request.tsx'

export const dynamic = 'force-dynamic'

export default async function ReviewInbox({
  searchParams,
}: {
  searchParams: Promise<{
    review?: string
    collectionReview?: string
    area?: string
    task?: string
    q?: string
    reviewStatus?: string
  }>
}) {
  const session = await currentSession()
  if (!session) notFound()
  const {
    review: selectedId,
    collectionReview: collectionReviewId,
    area: requestedArea,
    task,
    q,
    reviewStatus,
  } = await searchParams
  const [listedReviews, requested, customRequests, inbox, collectionReviews] = await Promise.all([
    listReviewSubmissions(session.principal.userId, { includeDecided: true }),
    selectedId ? getReviewSubmission(session.principal.userId, selectedId) : null,
    listSectionRequests(session.principal.userId),
    getInboxSnapshot(session.principal.userId),
    listCollectionReviews(session.principal.userId),
  ])
  // An exact deep link either shows that exact authorized request or nothing.
  // Falling back to a different request is a dangerous lie on a decision page.
  const selected = selectedId
    ? requested
    : (listedReviews.find(item => item.status === 'open') ?? listedReviews[0] ?? null)
  const reviews =
    selected && !listedReviews.some(item => item.id === selected.id) ? [selected, ...listedReviews] : listedReviews
  const [comments, people, readiness, comparison] = selected
    ? await Promise.all([
        listReviewComments(session.principal.userId, selected.id),
        listReviewPeople(session.principal.userId, selected.siteId),
        runReviewReadiness(selected.versionId).catch(() => null),
        selected.story
          ? Promise.resolve(selected.story)
          : reviewChangePresentation(session.principal.userId, selected.id).catch(() => null),
      ])
    : [[], [], null, null]
  const administer =
    session.principal.isSuperAdmin || [...session.principal.memberships.values()].includes('site_admin')
  const canAdvanced = administer || customRequests.length > 0 || inbox.operations > 0
  const area = collectionReviewId
    ? 'lists'
    : requestedArea === 'advanced'
      ? 'advanced'
      : requestedArea === 'lists'
        ? 'lists'
        : 'pages'
  const areas = [
    { key: 'pages', label: 'Pages', href: '/inbox' },
    ...(administer || collectionReviews.length || area === 'lists'
      ? [{ key: 'lists', label: 'Lists', href: '/inbox?area=lists' }]
      : []),
    ...(canAdvanced ? [{ key: 'advanced', label: 'Advanced', href: '/inbox?area=advanced' }] : []),
  ]
  const navigation = (
    <nav className={workspace.areaNav} aria-label="Review areas">
      {areas.map(item => (
        <Link key={item.key} href={item.href} aria-current={area === item.key ? 'page' : undefined}>
          {item.label}
        </Link>
      ))}
    </nav>
  )
  const queueHeader = (
    <div className={reviewWorkbenchStyles.queueHeading}>
      <h1>Reviews</h1>
      <p>Changes people sent you to approve</p>
      {navigation}
    </div>
  )
  return (
    <>
      <LegacyReviewLink active={area} selected={Boolean(selectedId || collectionReviewId)} />
      <main id="main">
        {area === 'pages' ? (
          <section aria-label="Page reviews">
            <ReviewWorkspace
              fullScreen
              ageReferenceTime={Date.now()}
              actorId={session.principal.userId}
              queueHeader={queueHeader}
              unavailable={Boolean(selectedId && !selected)}
              comparison={comparison}
              initialQuery={q}
              initialFilter={reviewStatus}
              reviews={reviews}
              selected={selected}
              comments={comments}
              people={people}
              readiness={readiness}
              basePath="/inbox"
            />
          </section>
        ) : area === 'lists' ? (
          <CollectionReviewSection
            fullScreen
            initialQuery={q}
            initialIncludeHistory={reviewStatus ? reviewStatus === 'all' : undefined}
            queueHeader={queueHeader}
            userId={session.principal.userId}
            selectedId={collectionReviewId}
            basePath="/inbox"
          />
        ) : (
          <Workbench
            queueLabel="Review administration"
            storageKey="cms.reviews.queue-width"
            queue={
              <>
                {queueHeader}
                {canAdvanced && (
                  <ul className={reviewWorkbenchStyles.queueItems}>
                    <li>
                      <Link href="/inbox?area=advanced" aria-current={task !== 'background' ? 'true' : undefined}>
                        <strong>Section requests</strong>
                        <small>Requests and replies for your sites</small>
                      </Link>
                    </li>
                    <li>
                      <Link
                        href="/inbox?area=advanced&task=background"
                        aria-current={task === 'background' ? 'true' : undefined}
                      >
                        <strong>Background work</strong>
                        <small>Work that needs an administrator</small>
                      </Link>
                    </li>
                  </ul>
                )}
              </>
            }
          >
            {canAdvanced ? (
              <>
                <section
                  hidden={task === 'background'}
                  id="custom-requests"
                  className="inbox-section"
                  aria-labelledby="custom-requests-title"
                >
                  <h2 id="custom-requests-title">Custom-section requests</h2>
                  <p>
                    Ask for a new building block from any site’s Sections screen. Requests and replies stay visible to
                    that site’s team.
                  </p>
                  {!customRequests.length ? (
                    <p className="notice">
                      No requests yet. Open a site’s Sections screen and choose “Request a custom section” when an
                      existing section does not meet your needs.
                    </p>
                  ) : (
                    <>
                      <p className="hint">Showing up to 100 requests, with open work first.</p>
                      <div className="request-list">
                        {customRequests.map(request => (
                          <SectionRequestCard
                            key={`${request.id}:${request.revision}`}
                            request={{
                              ...request,
                              created_at: request.created_at.toISOString(),
                              updated_at: request.updated_at.toISOString(),
                            }}
                          />
                        ))}
                      </div>
                    </>
                  )}
                </section>
                <section
                  hidden={task !== 'background'}
                  id="operational-issues"
                  className="inbox-section"
                  aria-labelledby="operational-issues-title"
                >
                  <h2 id="operational-issues-title">Background work needing attention</h2>
                  <p>
                    Only issues within your management permissions appear here. Successful linked section-preview
                    retries leave this list; the original failed delivery and audit history remain available.
                  </p>
                  {!inbox.items.length ? (
                    <p className="notice">
                      No background issues need attention within your permissions. Worker health is shown on the Sites
                      dashboard.
                    </p>
                  ) : (
                    <>
                      <p className="hint">
                        Showing {inbox.items.length} of {inbox.operations} background issues.
                      </p>
                      <ul className="activity-list">
                        {inbox.items.map(item => (
                          <li className="card" key={`${item.kind}:${item.id}`}>
                            <h3>{item.title}</h3>
                            <p>
                              {item.siteName ?? 'CMS-wide delivery'} ·{' '}
                              {item.kind === 'domain'
                                ? 'Domain connection'
                                : item.kind === 'schedule'
                                  ? 'Scheduled action'
                                  : 'Background delivery'}
                            </p>
                            <details>
                              <summary>Failure details</summary>
                              <p className="request-body">{item.error}</p>
                              <p className="hint">Reference: {item.id}</p>
                            </details>
                            {item.canRetryThumbnail || item.retryId ? (
                              <ThumbnailRetry
                                failedId={item.id}
                                retryId={item.retryId ?? null}
                                retryStatus={item.retryStatus ?? null}
                              />
                            ) : item.kind === 'schedule' && item.siteId ? (
                              <p>
                                <Link href={`/sites/${item.siteId}/publishing`}>
                                  Review the pinned version and schedule a corrected action
                                </Link>
                              </p>
                            ) : (
                              <p>
                                Ask the installation operator to inspect this reference before retrying. Repeated
                                retries cannot fix missing credentials, DNS records, or a stopped worker.
                              </p>
                            )}
                            <p>
                              <Link href={item.siteId ? `/activity?site=${item.siteId}` : '/activity'}>
                                View related activity
                              </Link>
                            </p>
                          </li>
                        ))}
                      </ul>
                    </>
                  )}
                </section>
              </>
            ) : (
              <EmptyState title="This area is unavailable">
                <p>Your review requests are still available.</p>
                <Link href="/inbox">Open Reviews</Link>
              </EmptyState>
            )}
          </Workbench>
        )}
      </main>
    </>
  )
}
