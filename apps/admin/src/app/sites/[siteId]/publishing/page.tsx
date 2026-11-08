import { releaseStamps } from '../../../../lib/release-stamps.ts'
import shared from '../../../../components/workspace.module.css'
import workspaceFormsStyles from '../../../../components/workspace-styles/workspace-forms.module.css'
import { validStoryDay } from '../../../../lib/story-calendar.ts'
import { initialReleasePick } from '../../../../lib/release-selection.ts'
import { CollectionReviewSection } from '../../../../components/collection-review-section.tsx'
import { notFound } from 'next/navigation'
import { AppShell } from '../../../../components/app-shell.tsx'
import { navigationFor } from '../../../../components/nav.ts'
import { PageHeader } from '../../../../components/shell.tsx'
import { getSite, listPages, roleLabel } from '../../../../lib/queries.ts'
import { listSiteSchedules, schedulingAvailable } from '../../../../lib/scheduling.ts'
import {
  getReviewSubmission,
  listReviewComments,
  listReviewPeople,
  listReviewSubmissions,
} from '../../../../lib/review-queries.ts'
import { currentSession } from '../../../../lib/session.ts'
import { runReadiness } from '../../../actions/page-publish.ts'
import { ReviewWorkspace } from '../../../inbox/review-workspace.tsx'
import { ScheduleWorkspace } from './schedule-workspace.tsx'
import styles from './publish.module.css'
import { PublishTabs } from './publish-tabs.tsx'
import { EmptyState, TextLink } from '../../../../components/ui/index.ts'
import { releasePresentations } from '../../../../lib/release-presentation.ts'
import { listReleaseCandidates, listSiteReleases } from '../../../../lib/releases.ts'
import { ReleaseWorkspace } from './release-workspace.tsx'

export const dynamic = 'force-dynamic'

export default async function PublishingWorkspace({
  params,
  searchParams,
}: {
  params: Promise<{ siteId: string }>
  searchParams: Promise<{
    review?: string
    collectionReview?: string
    tab?: string
    area?: string
    release?: string
    pages?: string
    siteLook?: string
    lists?: string
    intent?: string
    day?: string
  }>
}) {
  const session = await currentSession()
  if (!session) notFound()
  const { siteId } = await params
  const [
    {
      review: selectedId,
      collectionReview: collectionReviewId,
      tab,
      area,
      release: releaseId,
      pages: requestedPages,
      siteLook: requestedLook,
      lists: requestedLists,
      intent,
      day,
    },
    site,
  ] = await Promise.all([searchParams, getSite(session.principal.userId, siteId)])
  if (!site) notFound()
  const [listedReviews, role, exactRequested, pages, schedules, schedulerReady, releaseItems, releases] =
    await Promise.all([
      listReviewSubmissions(session.principal.userId, { siteId, includeDecided: true }),
      roleLabel(session.principal.userId),
      selectedId ? getReviewSubmission(session.principal.userId, selectedId) : null,
      listPages(session.principal.userId, siteId),
      listSiteSchedules(session.principal.userId, siteId),
      schedulingAvailable(session.principal.userId),
      listReleaseCandidates(session.principal.userId, siteId),
      listSiteReleases(session.principal.userId, siteId),
    ])
  const requested = exactRequested?.siteId === siteId ? exactRequested : null
  const selected = selectedId
    ? requested
    : (listedReviews.find(item => item.status === 'open') ?? listedReviews[0] ?? null)
  const reviews =
    selected && !listedReviews.some(item => item.id === selected.id) ? [selected, ...listedReviews] : listedReviews
  const [comments, people, readiness] = selected
    ? await Promise.all([
        listReviewComments(session.principal.userId, selected.id),
        listReviewPeople(session.principal.userId, siteId),
        runReadiness(selected.versionId).catch(() => null),
      ])
    : [[], await listReviewPeople(session.principal.userId, siteId), null]
  const canPublish =
    session.principal.isSuperAdmin || ['editor', 'site_admin'].includes(session.principal.memberships.get(siteId) ?? '')
  const canAdminister = session.principal.isSuperAdmin || session.principal.memberships.get(siteId) === 'site_admin'
  const presentations = await releasePresentations(session.principal.userId, siteId, releaseItems)
  const requestedRelease = releases.find(release => release.id === releaseId),
    reviewPresentations =
      requestedRelease?.status === 'planned' && !requestedRelease.stale
        ? await releasePresentations(session.principal.userId, siteId, requestedRelease.snapshot)
        : {}
  const listedReleases = releases.map(release => ({
    ...release,
    actorLabel:
      people.find(person => person.id === (release.finished_by ?? release.created_by))?.displayName ?? 'Another editor',
    created_at: release.created_at.toISOString(),
    finished_at: release.finished_at?.toISOString() ?? null,
  }))
  const native = !site.original_design,
    stamps = native ? await releaseStamps(session.principal.userId, siteId, releaseItems) : {}
  const chosenTab =
    tab === 'history'
      ? 'history'
      : native && tab === 'scheduled'
        ? 'scheduled'
        : canPublish && (tab === 'review' || selectedId || collectionReviewId)
          ? 'review'
          : 'changes'
  const releaseProps = {
    siteId,
    actorId: session.principal.userId,
    native,
    stamps,
    headerActionsId: native ? 'publish-actions-' + siteId : undefined,
    items: releaseItems,
    releases: listedReleases,
    initialRelease: site.initial_release_required === true,
    isSuperAdmin: session.principal.isSuperAdmin,
    archived: site.status === 'archived',
    canPublish,
    canAdminister,
    presentations,
    initialArea: area,
    schedulingAvailable: schedulerReady,
    initialReleaseId: releaseId,
    initialReviewPresentations: reviewPresentations,
    initialScheduleTime: validStoryDay(day) ? day + 'T09:00' : '',
    initialSchedule: intent === 'schedule' && schedulerReady && canPublish,
    initialPick: initialReleasePick(requestedPages, requestedLook, requestedLists),
  }

  return (
    <AppShell email={session.email} role={role} groups={navigationFor(site, session.principal)}>
      <main
        id="main"
        className={native ? 'wrap wrap-wide ' + shared.page + ' ' + workspaceFormsStyles.compactForm : 'wrap wrap-wide'}
      >
        <PageHeader
          density={native ? 'compact' : undefined}
          showWayfinding={!native}
          actions={native ? <div id={'publish-actions-' + siteId} /> : undefined}
          crumbs={[
            { label: 'All sites', href: '/' },
            { label: site.name, href: `/sites/${site.id}` },
            { label: 'Publish' },
          ]}
          title="Publish"
          lede={native ? undefined : 'Review saved changes, put them live together, or choose a time for later.'}
          sub={native ? 'Everything saved but not live, in plain words.' : undefined}
        />
        {native && site.status === 'archived' && (
          <p role="status">
            This site is archived. Publishing and scheduling are disabled. Open{' '}
            <TextLink href={'/sites/' + siteId + '/publishing?tab=history'}>History</TextLink> to view earlier releases.
          </p>
        )}
        <PublishTabs
          value={chosenTab}
          canReview={canPublish}
          native={native}
          counts={{
            ready: releaseItems.length,
            scheduled: schedules.filter(job => ['pending', 'running'].includes(job.status)).length,
            review: reviews.filter(review => review.status === 'open').length,
          }}
          scheduled={
            <ScheduleWorkspace
              actorId={session.principal.userId}
              pages={pages}
              siteId={siteId}
              schedules={schedules.map(job => ({ ...job, run_at: job.run_at.toISOString() }))}
              available={schedulerReady}
              archived={site.status === 'archived'}
              canManage={canPublish}
            />
          }
          changes={
            <div className={styles.stack}>
              <ReleaseWorkspace key="changes" {...releaseProps} />
              {!native && (
                <ScheduleWorkspace
                  actorId={session.principal.userId}
                  pages={pages}
                  siteId={siteId}
                  schedules={schedules.map(job => ({ ...job, run_at: job.run_at.toISOString() }))}
                  available={schedulerReady}
                  archived={site.status === 'archived'}
                  canManage={canPublish}
                />
              )}
            </div>
          }
          review={
            <>
              <CollectionReviewSection
                userId={session.principal.userId}
                siteId={siteId}
                selectedId={collectionReviewId}
                basePath={`/sites/${siteId}/publishing`}
                hideWhenEmpty
              />
              {reviews.length === 0 ? (
                <EmptyState title="No pages waiting for review">
                  Submitted pages appear here for an editor to check.
                </EmptyState>
              ) : (
                <ReviewWorkspace
                  actorId={session.principal.userId}
                  reviews={reviews}
                  selected={selected}
                  comments={comments}
                  people={people}
                  readiness={readiness}
                  basePath={`/sites/${site.id}/publishing`}
                />
              )}
            </>
          }
          history={<ReleaseWorkspace key="history" {...releaseProps} view="history" />}
        />
      </main>
    </AppShell>
  )
}
