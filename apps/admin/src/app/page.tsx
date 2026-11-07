import { AdminHome } from '../components/admin-home.tsx'
import { EditorHome } from '../components/editor-home.tsx'
import { editorialStoryHome } from '../lib/editor-home.ts'
import { GuardedLink as Link } from '../components/guarded-link.tsx'
import { currentSession } from '../lib/session.ts'
import { jobQueueHealth, latestHeartbeats, listSites, roleLabel, getSite, type QueueHealthRow } from '../lib/queries.ts'
import { PageHeader } from '../components/shell.tsx'
import { AppShell } from '../components/app-shell.tsx'
import { navigationFor } from '../components/nav.ts'
import { HealthChip, type HealthLabel } from '../components/status.tsx'
import { EntryPanel } from '../components/entry.tsx'
import { listWorkspacePages } from '../lib/workspace-queries.ts'
import { homeReviewCounts } from '../lib/home-review-counts.ts'
import { Card, Disclosure } from '../components/ui/index.ts'
import styles from '../components/workspace.module.css'
import recordTableStyles from '../components/workspace-styles/record-table.module.css'
import siteSummaryStyles from '../components/workspace-styles/site-summary.module.css'
import { SiteCard } from '../components/site-card.tsx'
import { IconSite, IconPage, IconCollection, IconCheck } from '../components/icons.tsx'

export const dynamic = 'force-dynamic'

export default async function Dashboard({ searchParams }: { searchParams: Promise<{ site?: string }> }) {
  const session = await currentSession()

  // Authenticated is not authorized: a verified sign-in with no product record
  // sees no tenant data at all (SPEC §6.1).
  if (!session) {
    return (
      <EntryPanel heading="You are not signed in" lede="Sign in to see the sites you have been given access to.">
        <Link className="btn large wide" href="/sign-in">
          Go to sign in
        </Link>
      </EntryPanel>
    )
  }

  const [sites, role, pages, reviewCounts] = await Promise.all([
    listSites(session.principal.userId),
    roleLabel(session.principal.userId),
    listWorkspacePages(session.principal.userId),
    homeReviewCounts(session.principal.userId),
  ])
  // Queue internals are an operator surface. Editors need an editorial
  // overview, while a super admin still gets the exact worker evidence needed
  // to act when scheduled publishing is unhealthy.
  const operations =
    role === 'Super admin'
      ? await Promise.all([latestHeartbeats(session.principal.userId), jobQueueHealth(session.principal.userId)])
      : null
  const activeSites = sites.filter(site => site.status !== 'archived')
  const archivedSites = sites.filter(site => site.status === 'archived')
  const query = await searchParams,
    contentOnly =
      !session.principal.isSuperAdmin &&
      Boolean(
        session.principal.memberships.size ||
        session.principal.pageScopes?.size ||
        session.principal.divisionScopes?.size,
      ) &&
      ![...session.principal.memberships.values()].some(value => value === 'site_admin')
  if (contentOnly && activeSites.length) {
    const choices = [...activeSites].sort(
      (a, b) =>
        Number(b.id === query.site) - Number(a.id === query.site) ||
        Number(b.slug === 'sawso') - Number(a.slug === 'sawso') ||
        a.name.localeCompare(b.name),
    )
    for (const choice of choices) {
      const selected = await getSite(session.principal.userId, choice.id)
      if (selected?.original_design && query.site === selected.id) break
      if (!selected || selected.original_design) continue
      const siteRole = session.principal.memberships.get(selected.id),
        full = siteRole === 'editor' || siteRole === 'contributor'
      let storyError = false
      const stories =
        full && selected.has_stories
          ? await editorialStoryHome(session.principal.userId, selected.id, selected.slug).catch(() => {
              storyError = true
              return null
            })
          : null
      if (full && selected.has_stories && !stories) storyError = true
      const ownReviews = (reviewCounts.pages.get(selected.id) ?? 0) + (reviewCounts.lists.get(selected.id) ?? 0)
      return (
        <EditorHome
          email={session.email}
          role={role}
          access={session.principal}
          site={selected}
          pages={pages}
          stories={stories}
          storyError={storyError}
          reviewCount={ownReviews}
          siteNotice={
            query.site && !activeSites.some(site => site.id === query.site)
              ? 'That site is not available to you. Your accessible work is shown.'
              : undefined
          }
        />
      )
    }
  }
  if (
    session.principal.isSuperAdmin ||
    [...session.principal.memberships.values()].some(value => value === 'site_admin')
  )
    return (
      <AdminHome
        email={session.email}
        role={role}
        access={session.principal}
        sites={sites}
        pages={pages}
        reviewCounts={Object.fromEntries(
          activeSites.map(site => [
            site.id,
            (reviewCounts.pages.get(site.id) ?? 0) + (reviewCounts.lists.get(site.id) ?? 0),
          ]),
        )}
        operations={operations ? <BackgroundJobs heartbeat={operations[0][0]} queue={operations[1]} /> : null}
      />
    )
  const recent = [...pages].sort((a, b) => Date.parse(b.edited_at) - Date.parse(a.edited_at)).slice(0, 6)
  const total = (counts: Map<string, number>) => [...counts.values()].reduce((sum, count) => sum + count, 0)
  const reviewCount = total(reviewCounts.pages) + total(reviewCounts.lists)

  const attention = activeSites
    .map(site => ({
      site,
      changed: Number(site.changed_count),
      samples: pages.filter(page => page.site_id === site.id && page.live_samples).length,
      reviews: (reviewCounts.pages.get(site.id) ?? 0) + (reviewCounts.lists.get(site.id) ?? 0),
    }))
    .filter(item => item.changed || item.samples || item.reviews)
    .sort(
      (a, b) =>
        Number(b.site.slug === 'sawso') - Number(a.site.slug === 'sawso') || a.site.name.localeCompare(b.site.name),
    )
  return (
    <AppShell email={session.email} role={role} groups={navigationFor(undefined, session.principal)}>
      <main id="main" className="wrap">
        <PageHeader
          title="Home"
          crumbs={[{ label: 'Home' }]}
          actions={
            session.principal.isSuperAdmin ? (
              <Link className="btn navy" href="/sites/new">
                Create a site
              </Link>
            ) : undefined
          }
          lede={
            sites.length === 0
              ? 'Nobody has given you access to a site yet.'
              : 'Welcome back. Your sites and recent work are here.'
          }
        />

        {activeSites.length > 0 && (
          <div className={styles.stack}>
            <section aria-labelledby="home-tasks">
              <h2 id="home-tasks">What would you like to do?</h2>
              <div className={styles.grid}>
                {activeSites
                  .slice(0, 4)
                  .filter(
                    site =>
                      session.principal.isSuperAdmin ||
                      session.principal.memberships.has(site.id) ||
                      pages.some(page => page.site_id === site.id),
                  )
                  .map(site => {
                    const scoped = !session.principal.isSuperAdmin && !session.principal.memberships.has(site.id)
                    const home = pages.find(page => page.site_id === site.id && (scoped || page.slug === ''))
                    const role = session.principal.memberships.get(site.id)
                    return (
                      <a
                        key={site.id}
                        className={siteSummaryStyles.task}
                        href={home ? '/pages/' + home.id : '/sites/' + site.id}
                      >
                        <span className={siteSummaryStyles.taskIcon}>
                          <IconPage size={18} />
                        </span>
                        <span className={recordTableStyles.meta}>
                          {site.name} ·{' '}
                          {scoped
                            ? 'Your assigned pages'
                            : role === 'contributor'
                              ? 'Draft content'
                              : role === 'editor'
                                ? 'Edit and publish'
                                : 'Manage site'}
                        </span>
                        <strong>
                          {home ? 'Edit ' + (scoped ? home.title : site.name + ' home page') : 'Open ' + site.name}
                        </strong>
                        <span>Open the real page and click anything to edit.</span>
                      </a>
                    )
                  })}
                {activeSites
                  .filter(site => session.principal.isSuperAdmin || session.principal.memberships.has(site.id))
                  .slice(0, 2)
                  .map(site => (
                    <a
                      key={'list' + site.id}
                      className={siteSummaryStyles.task}
                      href={'/sites/' + site.id + (site.has_stories ? '/stories' : '/content')}
                    >
                      <span className={siteSummaryStyles.taskIcon}>
                        <IconCollection size={18} />
                      </span>
                      <span className={recordTableStyles.meta}>{site.name}</span>
                      <strong>{site.has_stories ? 'Update stories' : 'Update lists'}</strong>
                      <span>
                        {site.has_stories
                          ? 'Add and tag stories for sector pages and the newsroom.'
                          : 'Keep speakers, sessions and resources up to date.'}
                      </span>
                    </a>
                  ))}
                {activeSites
                  .filter(
                    site =>
                      !session.principal.isSuperAdmin &&
                      !session.principal.memberships.has(site.id) &&
                      ([...(session.principal.divisionScopes?.values() ?? [])].some(
                        scope => scope.siteId === site.id,
                      ) ||
                        [...(session.principal.pageScopes?.values() ?? [])].some(
                          scope => scope.siteId === site.id && scope.role === 'editor',
                        )),
                  )
                  .map(site => (
                    <a
                      key={'chapters' + site.id}
                      className={siteSummaryStyles.task}
                      href={'/sites/' + site.id + '/chapters'}
                    >
                      <span className={recordTableStyles.meta}>{site.name}</span>
                      <strong>Set up chapters</strong>
                      <span>Choose page sections and invite chapter volunteers.</span>
                    </a>
                  ))}
                {reviewCount > 0 && (
                  <a className={siteSummaryStyles.task} href="/inbox">
                    <strong>
                      Review {reviewCount} {reviewCount === 1 ? 'submission' : 'submissions'}
                    </strong>
                    <span>Check the proposed changes before publishing.</span>
                  </a>
                )}
              </div>
            </section>
            <Card title="Needs attention" density="compact">
              <ul className={siteSummaryStyles.rowList}>
                {attention.map(({ site, changed, samples, reviews }) => (
                  <li key={site.id} data-attention-site={site.id}>
                    <div className={recordTableStyles.rowCopy}>
                      <strong>{site.name}</strong>
                      <span className={recordTableStyles.meta}>
                        {[
                          changed ? `${changed} ${changed === 1 ? 'change' : 'changes'} not live` : null,
                          samples
                            ? `${samples} ${samples === 1 ? 'page has' : 'pages have'} sample content live`
                            : null,
                          reviews
                            ? `${reviews} ${reviews === 1 ? 'submission needs' : 'submissions need'} review`
                            : null,
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </span>
                    </div>
                    <Link className="btn secondary" href={'/sites/' + site.id}>
                      Open site
                    </Link>
                  </li>
                ))}
                {!attention.length && (
                  <li>
                    <span className={siteSummaryStyles.taskIcon}>
                      <IconCheck size={18} />
                    </span>
                    <div className={recordTableStyles.rowCopy}>
                      <strong>Nothing needs your attention</strong>
                      <span className={recordTableStyles.meta}>
                        Your visible pages and lists have no waiting changes.
                      </span>
                    </div>
                  </li>
                )}
              </ul>
            </Card>
            <h2 id="all-sites">All sites</h2>
          </div>
        )}

        {activeSites.length === 0 ? (
          // Empty states teach: what the thing is, and what happens next
          // (SPEC §7). There is no primary action here on purpose — being given
          // access is somebody else's action, and offering a button that cannot
          // work is worse than saying so.
          <div className="empty-state">
            <div className="empty-icon">
              <IconSite size={22} />
            </div>
            <h2>{archivedSites.length ? 'No active sites' : 'No sites yet'}</h2>
            <p>
              A site is one website you look after — its pages, its sections and its published address.{' '}
              {session.principal.isSuperAdmin
                ? 'Create your first site with a resource or event starter.'
                : 'When somebody gives you access to one it appears here.'}
            </p>
          </div>
        ) : (
          <div className={styles.grid}>
            {activeSites.map(site => (
              <SiteCard key={site.id} site={site} />
            ))}
          </div>
        )}

        {recent.length > 0 && (
          <Card title="Recent work" density="compact">
            <ul className={siteSummaryStyles.rowList}>
              {recent.map(page => (
                <li key={page.id}>
                  <div className={recordTableStyles.rowCopy}>
                    <Link href={'/pages/' + page.id}>{page.title}</Link>
                    <span className={recordTableStyles.meta}>{page.site_name}</span>
                  </div>
                  <span className={recordTableStyles.meta}>
                    {page.edited_by} ·{' '}
                    {new Date(page.edited_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        )}

        {archivedSites.length > 0 && (
          <details className="archived-pages">
            <summary>Archived sites ({archivedSites.length})</summary>
            <p>These sites are off the public web. Their content and history remain in the CMS.</p>
            <div className="grid grid-cards">
              {archivedSites.map(site => (
                <SiteCard key={site.id} site={site} />
              ))}
            </div>
          </details>
        )}

        {operations && <BackgroundJobs heartbeat={operations[0][0]} queue={operations[1]} />}
      </main>
    </AppShell>
  )
}

type Heartbeat = { worker_id: string; last_seen_at: Date; version: string }

/**
 * The operator's answer to "is anything stuck". Every number here is a real
 * queue fact, and a stopped worker is stated rather than implied by silence —
 * v1's scheduling queue was inert and only honest labelling saved it from
 * being a lie (SPEC §6.8, D7).
 *
 * It is a disclosure rather than a panel, and closed by default when the queue
 * is healthy. An editor signing in to change a headline was being shown eight
 * queue depth figures above the fold; the M0 exit criterion is that the
 * heartbeat is *visible in the product*, not that it is the first thing on the
 * first screen. When something is actually wrong it opens itself, because at
 * that point it is the most important thing on the page.
 *
 * The chip says `Healthy`, `Delayed` or `Error` — not `Published`, which is what
 * it used to say and which is the content vocabulary applied to a thing that is
 * not content. Nothing is published about a job queue.
 */
function BackgroundJobs({ heartbeat, queue }: { heartbeat: Heartbeat | undefined; queue: QueueHealthRow }) {
  const running = Number(queue.live_workers) > 0
  const waiting = Number(queue.outbox_waiting)
  const inFlight = Number(queue.outbox_running)
  // "Trying again" now means what a reader assumes: this has failed before.
  // It used to count anything claimed even once, so it was never zero while the
  // queue was healthy and busy.
  const retrying = Number(queue.outbox_retrying)
  const dead = Number(queue.outbox_dead)
  // Claimed then abandoned. Before 0009 these rows were in no bucket at all,
  // so a queue full of stranded work read as empty.
  const stalled = Number(queue.outbox_stalled) + Number(queue.schedules_stalled)
  const schedulesPending = Number(queue.schedules_waiting)
  const schedulesFailed = Number(queue.schedules_failed)
  const oldestSeconds =
    queue.outbox_oldest_waiting_seconds === null ? null : Math.round(Number(queue.outbox_oldest_waiting_seconds))
  const lagging = oldestSeconds !== null && oldestSeconds > 300
  // The chip stays in the health vocabulary and the sentence beside it says
  // *what* is wrong, because "Error" on its own is a colour with a word on it.
  // Ordered by what an operator would act on first: nothing else in this list
  // can be fixed while the worker is stopped.
  const wrong = !running
    ? 'The worker is not running'
    : dead > 0
      ? 'Some updates could not be sent'
      : stalled > 0
        ? 'Some updates were interrupted'
        : schedulesFailed > 0
          ? 'A scheduled publish failed'
          : lagging
            ? 'Updates are taking longer than usual'
            : null
  // Delayed is "behind but working"; Error is "somebody has to do something".
  const health: HealthLabel =
    wrong === null ? 'Healthy' : !running || dead > 0 || schedulesFailed > 0 ? 'Error' : 'Delayed'

  return (
    <Disclosure
      className="ops"
      open={wrong !== null}
      title={
        <>
          <span className="ops-label">Background jobs</span>
          <HealthChip health={health} />
          <span className="ops-note">{wrong ?? 'Everything is up to date'}</span>
        </>
      }
    >
      <div className="ops-body">
        {!running ? (
          <p style={{ margin: '0 0 1rem' }}>
            Scheduled publishing and cache updates are paused until a worker is running.
            {heartbeat && ` Last seen ${new Date(heartbeat.last_seen_at).toLocaleString()}.`}
          </p>
        ) : (
          <p className="ops-meta">
            {heartbeat?.worker_id} · version {heartbeat?.version || 'unknown'} · last seen{' '}
            {heartbeat && new Date(heartbeat.last_seen_at).toLocaleTimeString()}
            {Number(queue.stale_workers) > 0 && ` · ${queue.stale_workers} stopped worker(s) recorded`}
          </p>
        )}

        <dl className="stats">
          <div>
            <dt>Waiting to send</dt>
            <dd>{waiting}</dd>
          </div>
          <div>
            <dt>Sending now</dt>
            <dd>{inFlight}</dd>
          </div>
          <div>
            <dt>Stalled</dt>
            <dd className={stalled > 0 ? 'bad' : undefined}>{stalled}</dd>
          </div>
          <div>
            <dt>Trying again</dt>
            <dd>{retrying}</dd>
          </div>
          <div>
            <dt>Gave up</dt>
            <dd className={dead > 0 ? 'bad' : undefined}>{dead}</dd>
          </div>
          <div>
            <dt>Scheduled</dt>
            <dd>{schedulesPending}</dd>
          </div>
          <div>
            <dt>Failed schedules</dt>
            <dd className={schedulesFailed > 0 ? 'bad' : undefined}>{schedulesFailed}</dd>
          </div>
          <div>
            <dt>Oldest waiting</dt>
            <dd className={`${oldestSeconds === null ? 'words' : ''} ${lagging ? 'bad' : ''}`.trim()}>
              {oldestSeconds === null ? 'nothing waiting' : formatAge(oldestSeconds)}
            </dd>
          </div>
        </dl>

        {dead > 0 && (
          <p className="notice notice-error" style={{ margin: '1rem 0 0' }}>
            <span className="notice-body">
              {dead === 1 ? 'One background task has' : `${dead} background tasks have`} stopped after a permanent error
              or repeated failures. Open the Inbox to see which task failed and what it affects.
            </span>
          </p>
        )}
        {stalled > 0 && (
          <p className="notice notice-warn" style={{ margin: '1rem 0 0' }}>
            <span className="notice-body">
              {stalled === 1 ? 'One update was' : `${stalled} updates were`} picked up by a worker that stopped before
              finishing. {stalled === 1 ? 'It' : 'They'} will be retried automatically.
            </span>
          </p>
        )}
        {lagging && dead === 0 && stalled === 0 && (
          <p className="notice notice-warn" style={{ margin: '1rem 0 0' }}>
            <span className="notice-body">
              Updates have been waiting for {formatAge(oldestSeconds!)}. That usually means the worker stopped or cannot
              reach the cache.
            </span>
          </p>
        )}
      </div>
    </Disclosure>
  )
}

function formatAge(seconds: number): string {
  if (seconds < 60) return `${seconds}s`
  if (seconds < 3600) return `${Math.round(seconds / 60)} min`
  return `${Math.round(seconds / 360) / 10} hours`
}
