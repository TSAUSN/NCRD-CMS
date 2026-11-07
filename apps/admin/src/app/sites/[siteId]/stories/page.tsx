import { StoriesNewsroomOrder } from './newsroom-order.tsx'
import { StoriesComingUp } from './coming-up.tsx'
import { storyCalendarJobs } from '../../../../lib/story-calendar-data.ts'
import { schedulingAvailable } from '../../../../lib/scheduling.ts'
import { notFound } from 'next/navigation'
import { AppShell } from '../../../../components/app-shell.tsx'
import { navigationFor } from '../../../../components/nav.ts'
import { getSite, roleLabel } from '../../../../lib/queries.ts'
import { currentSession } from '../../../../lib/session.ts'
import { collectionRights } from '../../../../lib/collection-queries.ts'
import { getStoryListState } from '../../../../lib/stories-workspace.ts'
import { StoriesList } from './list-workspace.tsx'
import { asUser } from '@cms/platform'
import { storyFeedUse } from '../../../../lib/stories-overview.ts'
import { StoriesSplit } from './split.tsx'
import { StoriesWorld } from './world.tsx'
import { worldChoice, splitChoice } from '../../../../lib/story-widget-choice.ts'
import { StoriesOverview } from './overview.tsx'
import shared from '../../../../components/workspace.module.css'
import workspaceFormsStyles from '../../../../components/workspace-styles/workspace-forms.module.css'
export const dynamic = 'force-dynamic'
export default async function StoriesPage({
  params,
  searchParams,
}: {
  params: Promise<{ siteId: string }>
  searchParams: Promise<{
    view?: string
    sector?: string
    q?: string
    status?: string
    main?: string
    secondary?: string
    heading?: string
    region?: string
    limit?: string
    introduction?: string
    first?: string
    size?: string
  }>
}) {
  const query = await searchParams
  const session = await currentSession()
  if (!session) notFound()
  const { siteId } = await params,
    site = await getSite(session.principal.userId, siteId)
  if (!site) notFound()
  const [state, rights, role] = await Promise.all([
    getStoryListState(session.principal.userId, siteId, site.slug),
    collectionRights(session.principal.userId, siteId),
    roleLabel(session.principal.userId),
  ])
  if (!state || (!rights.editEntries && !rights.manageSchema && !rights.publish)) notFound()
  const siteRole = session.principal.memberships.get(siteId),
    canCreate =
      session.principal.isSuperAdmin || siteRole === 'site_admin' || siteRole === 'editor' || siteRole === 'contributor'
  const overview = query.view === 'gaps'
  const uses = overview
    ? await asUser({ userId: session.principal.userId }, async client =>
        (
          await client.query(
            `SELECT p.id,p.title,p.slug,jsonb_path_query_array(v.content,'$[*] ? (@.hidden == false || !exists(@.hidden)).values.* ? (@.readerKey == "stories")') AS bindings FROM pages p JOIN page_versions v ON v.id=p.draft_version_id WHERE p.site_id=$1 AND p.archived_at IS NULL`,
            [siteId],
          )
        ).rows.flatMap(row => storyFeedUse(row as { id: string; title: string; slug: string; bindings: unknown })),
      )
    : []
  const [calendarJobs, calendarAvailable] =
    query.view === 'soon'
      ? await Promise.all([
          storyCalendarJobs(session.principal.userId, siteId, state.collectionId, state.rows),
          schedulingAvailable(session.principal.userId),
        ])
      : [[], false]
  return (
    <AppShell email={session.email} role={role} groups={navigationFor(site, session.principal)}>
      <main id="main" className={'wrap wrap-wide ' + shared.page + ' ' + workspaceFormsStyles.compactForm}>
        {query.view === 'order' ? (
          <StoriesNewsroomOrder siteId={siteId} initial={state} rights={rights} canCreate={canCreate} />
        ) : query.view === 'soon' ? (
          <StoriesComingUp
            siteId={siteId}
            state={state}
            rights={rights}
            canCreate={canCreate}
            jobs={calendarJobs}
            available={calendarAvailable}
            today={new Date().toISOString().slice(0, 10)}
          />
        ) : query.view === 'split' ? (
          <StoriesSplit
            siteId={siteId}
            state={state}
            rights={rights}
            canCreate={canCreate}
            initial={(() => {
              try {
                return splitChoice(
                  new URLSearchParams(
                    Object.entries(query).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
                  ),
                )
              } catch {
                return splitChoice(new URLSearchParams())
              }
            })()}
          />
        ) : query.view === 'world' ? (
          <StoriesWorld
            siteId={siteId}
            state={state}
            rights={rights}
            canCreate={canCreate}
            initial={(() => {
              try {
                return worldChoice(
                  new URLSearchParams(
                    Object.entries(query).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
                  ),
                )
              } catch {
                return worldChoice(new URLSearchParams())
              }
            })()}
          />
        ) : overview ? (
          <StoriesOverview
            siteId={siteId}
            state={state}
            rights={rights}
            canCreate={canCreate}
            uses={uses}
            initialTag={query.main ?? query.sector}
          />
        ) : (
          <StoriesList
            siteId={siteId}
            initial={state}
            rights={rights}
            canCreate={canCreate}
            initialFilters={{
              q: query.q ?? '',
              status: query.status ?? 'all',
              main: query.main ?? query.sector ?? '',
              secondary: query.secondary ?? '',
            }}
          />
        )}
      </main>
    </AppShell>
  )
}
