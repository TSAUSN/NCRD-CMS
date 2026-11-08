import type { Session } from '@cms/platform'
import type { SiteSummaryRow } from '../lib/queries.ts'
import type { WorkspacePage } from '../lib/workspace-queries.ts'
import { IconPage, IconCollection } from './icons.tsx'
import styles from './workspace.module.css'
import recordTableStyles from './workspace-styles/record-table.module.css'
import siteSummaryStyles from './workspace-styles/site-summary.module.css'

export function ScopedHomeTasks({
  activeSites,
  pages,
  access,
  reviewCount,
}: {
  activeSites: SiteSummaryRow[]
  pages: WorkspacePage[]
  access: Session['principal']
  reviewCount: number
}) {
  const pagesBySite = new Map<string, WorkspacePage[]>()
  for (const page of pages) {
    const list = pagesBySite.get(page.site_id)
    if (list) list.push(page)
    else pagesBySite.set(page.site_id, [page])
  }
  const chapterSetupSites = new Set([
    ...[...(access.divisionScopes?.values() ?? [])].map(scope => scope.siteId),
    ...[...(access.pageScopes?.values() ?? [])].filter(scope => scope.role === 'editor').map(scope => scope.siteId),
  ])
  return (
    <section aria-labelledby="home-tasks">
      <h2 id="home-tasks">What would you like to do?</h2>
      <div className={styles.grid}>
        {activeSites
          .slice(0, 4)
          .filter(site => access.memberships.has(site.id) || pagesBySite.has(site.id))
          .map(site => {
            const scoped = !access.isSuperAdmin && !access.memberships.has(site.id)
            const home = pagesBySite.get(site.id)?.find(page => scoped || page.slug === '')
            const role = access.memberships.get(site.id)
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
          .filter(site => access.memberships.has(site.id))
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
          .filter(site => !access.memberships.has(site.id) && chapterSetupSites.has(site.id))
          .map(site => (
            <a key={'chapters' + site.id} className={siteSummaryStyles.task} href={'/sites/' + site.id + '/chapters'}>
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
  )
}
