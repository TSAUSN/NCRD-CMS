import { GuardedLink as Link } from '../../components/guarded-link.tsx'
import { notFound } from 'next/navigation'
import { AppShell } from '../../components/app-shell.tsx'
import { navigationFor } from '../../components/nav.ts'
import { PageHeader } from '../../components/shell.tsx'
import { currentSession } from '../../lib/session.ts'
import { listSites, roleLabel } from '../../lib/queries.ts'
import {
  activityHref,
  activityLabel,
  getActivity,
  getActivityOptions,
  parseActivityFilters,
  type ActivityParams,
} from '../../lib/activity.ts'

export const dynamic = 'force-dynamic'

export default async function ActivityPage({ searchParams }: { searchParams: Promise<ActivityParams> }) {
  const session = await currentSession()
  if (!session) notFound()
  const { filters, error } = parseActivityFilters(await searchParams)
  const userId = session.principal.userId
  const [sites, role, options, feed] = await Promise.all([
    listSites(userId),
    roleLabel(userId),
    getActivityOptions(userId, error ? null : filters.site || null),
    error ? { rows: [], next: null } : getActivity(userId, filters),
  ])
  const selectedSite = sites.find(site => site.id === filters.site)
  return (
    <AppShell email={session.email} role={role} groups={navigationFor(selectedSite, session.principal)}>
      <main id="main" className="wrap wrap-wide">
        <PageHeader
          title="Activity history"
          lede="See who changed what and when. Only activity from sites you can access appears here. Dates and times are shown in UTC."
        />
        <form method="get" action="/activity" className="card activity-filters" aria-label="Filter activity history">
          <div className="field">
            <label htmlFor="activity-site">Site</label>
            <select id="activity-site" name="site" defaultValue={filters.site}>
              <option value="">All accessible sites</option>
              {sites.map(site => (
                <option key={site.id} value={site.id}>
                  {site.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="activity-actor">Person</label>
            <select id="activity-actor" name="actor" defaultValue={filters.actor}>
              <option value="">Everyone</option>
              {options.actors.map(actor => (
                <option key={actor.id} value={actor.id}>
                  {actor.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="activity-type">Actor type</label>
            <select id="activity-type" name="actorType" defaultValue={filters.actorType}>
              <option value="">People and automated activity</option>
              <option value="user">Person</option>
              <option value="scheduler">Scheduler</option>
              <option value="system">System</option>
              <option value="migration">Migration</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="activity-action">Action</label>
            <select id="activity-action" name="action" defaultValue={filters.action}>
              <option value="">All actions</option>
              {options.actions.map(action => (
                <option key={action} value={action}>
                  {activityLabel(action)}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="activity-from">From date (UTC)</label>
            <input id="activity-from" type="date" name="from" defaultValue={filters.from} />
          </div>
          <div className="field">
            <label htmlFor="activity-to">Through date (UTC)</label>
            <input id="activity-to" type="date" name="to" defaultValue={filters.to} />
          </div>
          <div className="actions">
            <button type="submit">Apply filters</button>
            <Link className="btn secondary" href="/activity">
              Clear filters
            </Link>
          </div>
        </form>
        {error ? (
          <p className="notice notice-error" role="alert">
            {error}
          </p>
        ) : (
          <>
            <p className="muted">
              {feed.rows.length} entries shown{filters.before ? ' · older history' : ' · newest first'}. Routine draft
              saves are included.
            </p>
            {!feed.rows.length && (
              <div className="empty-state">
                <h2>No activity matches these filters</h2>
                <p>
                  Try a wider date range or clear the filters. Saved changes and publishing decisions appear here
                  automatically.
                </p>
              </div>
            )}
            <ol className="activity-list" aria-label="Activity entries">
              {feed.rows.map(row => (
                <li key={row.id} className="card activity-entry">
                  <div className="activity-entry-heading">
                    <h2>{activityLabel(row.action)}</h2>
                    <time dateTime={row.created_at.toISOString()}>
                      {row.created_at.toISOString().replace('T', ' ').slice(0, 19)} UTC
                    </time>
                  </div>
                  <p>
                    {row.actor_name} <span className="muted">({row.actor_type})</span> ·{' '}
                    {row.site_name ?? 'CMS-wide activity'}
                  </p>
                  {row.item_type === 'page' && row.item_id && (
                    <p>
                      <Link href={`/pages/${row.item_id}`}>Open page</Link>
                      {row.before_ref && (
                        <>
                          {' '}
                          · <Link href={`/preview/${row.before_ref}?readonly=1`}>Previous content</Link>
                        </>
                      )}
                      {row.after_ref && (
                        <>
                          {' '}
                          · <Link href={`/preview/${row.after_ref}?readonly=1`}>Recorded content version</Link>
                        </>
                      )}
                    </p>
                  )}
                  {['site_release', 'scheduled_action'].includes(row.item_type) && row.site_id && (
                    <p>
                      <Link href={`/sites/${row.site_id}/publishing`}>Open publishing workspace</Link>
                    </p>
                  )}
                  <details>
                    <summary>Recorded details</summary>
                    <dl className="activity-references">
                      <dt>Action</dt>
                      <dd>{row.action}</dd>
                      <dt>Activity reference</dt>
                      <dd>{row.id}</dd>
                      {row.item_id && (
                        <>
                          <dt>Item reference</dt>
                          <dd>{row.item_id}</dd>
                        </>
                      )}
                      {row.before_ref && (
                        <>
                          <dt>Before</dt>
                          <dd>{row.before_ref}</dd>
                        </>
                      )}
                      {row.after_ref && (
                        <>
                          <dt>After</dt>
                          <dd>{row.after_ref}</dd>
                        </>
                      )}
                    </dl>
                    <pre>{JSON.stringify(row.detail, null, 2)}</pre>
                  </details>
                </li>
              ))}
            </ol>
            <nav className="actions" aria-label="Activity history pages">
              {filters.before && (
                <Link className="btn secondary" href={activityHref(filters)}>
                  Newest matching activity
                </Link>
              )}
              {feed.next && (
                <Link className="btn secondary" href={activityHref(filters, feed.next)}>
                  Older activity
                </Link>
              )}
            </nav>
          </>
        )}
      </main>
    </AppShell>
  )
}
