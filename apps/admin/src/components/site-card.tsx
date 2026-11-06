import { contentCounts } from '../lib/content-counts.ts'
import { SiteCardPreview } from './site-card-preview.tsx'
import styles from './workspace.module.css'
import { GuardedLink as Link } from './guarded-link.tsx'
import { publicSiteOrigin } from '../lib/public-site-url.ts'
import type { SiteSummaryRow } from '../lib/queries.ts'
import { siteStatus, StatusChip } from './status.tsx'
import { Badge, Menu } from './ui/index.ts'
import { IconMore, IconExternal } from './icons.tsx'

/**
 * One site, as much of it as this reader can see.
 *
 * The name is the link because the name is what somebody is looking for; Open
 * is there as well because a card with one obvious button is faster to use than
 * a card you have to aim at. The two counts are the only numbers on it and both
 * are facts from the pages table — this screen does not invent an activity feed
 * out of data the product does not keep.
 */
export function SiteCard({ site, compactHome = false }: { site: SiteSummaryRow; compactHome?: boolean }) {
  const pages = Number(site.page_count)
  const published = Number(site.published_count)
  const changed = Number(site.changed_count)
  const liveOrigin = publicSiteOrigin(site.primary_hostname || site.staging_hostname)
  const live =
    site.status !== 'archived' &&
    published > 0 &&
    liveOrigin !== null &&
    (!!site.primary_hostname || !site.hosting_status || site.hosting_status === 'ready')
  if (compactHome)
    return (
      <article className={'site-card ' + styles.siteCard + ' ' + styles.homeSiteCard}>
        <Link className={styles.homeSitePreview} href={'/sites/' + site.id} aria-label={'Open ' + site.name}>
          {site.preview_image ? (
            <SiteCardPreview key={site.preview_image} src={site.preview_image} name={site.name} />
          ) : (
            <span>No home-page preview</span>
          )}
        </Link>
        <div className={styles.cardSummary}>
          <div className={styles.cardTitleRow}>
            <Link className={styles.cardTitle} href={'/sites/' + site.id} title={site.name}>
              {site.name}
            </Link>
            <Badge
              tone={site.status === 'archived' ? 'neutral' : changed ? 'pending' : published ? 'live' : 'neutral'}
              title={siteStatus(site)}
            >
              {site.status === 'archived' ? 'Archived' : changed ? changed + ' waiting' : published ? 'Live' : 'Draft'}
            </Badge>
            <Menu label={<IconMore size={16} />} accessibleLabel={'Actions for ' + site.name}>
              <Link href={'/sites/' + site.id}>Open</Link>
              {live && (
                <a rel="noopener" target="_blank" href={liveOrigin + '/'}>
                  <IconExternal size={15} />
                  {site.primary_hostname ? 'Visit site' : 'View site'}
                </a>
              )}
              <p className={styles.meta}>
                {contentCounts(pages, Number(site.story_count ?? 0))} · {published} published
                {changed ? ' · ' + changed + ' ' + (changed === 1 ? 'change' : 'changes') + ' not live' : ''}
              </p>
            </Menu>
          </div>
          <p className={styles.meta}>
            {siteKindLabel(site.kind)} · {contentCounts(pages, Number(site.story_count ?? 0))}
          </p>
        </div>
      </article>
    )
  return (
    <article className={'site-card ' + styles.siteCard}>
      <div className="site-card-top">
        <span className="site-card-mark" aria-hidden="true">
          {initials(site.name)}
        </span>
        <div className="site-card-id">
          <Link className="site-card-name" href={`/sites/${site.id}`}>
            {site.name}
          </Link>
          {/* The real address once it has one; until then what kind of site it
              is, as V1 did. A staging hostname is plumbing, not an identity. */}
          <p className="site-card-host">{site.primary_hostname ?? siteKindLabel(site.kind)}</p>
        </div>
        {site.status === 'archived' ? (
          <span className="chip chip-neutral">Archived</span>
        ) : (
          <StatusChip
            status={siteStatus(site)}
            title={
              published > 0
                ? site.primary_hostname
                  ? 'Published pages are available at the verified primary domain'
                  : 'Published pages are available at the staging address'
                : 'This site has no published pages'
            }
          />
        )}
      </div>

      <div className="site-card-facts">
        {site.hosting_status === 'preparing' && !site.primary_hostname && <span>Preparing test address</span>}
        {site.hosting_status === 'error' && !site.primary_hostname && (
          <span className="attention-copy">Test address needs attention</span>
        )}
        <span>{contentCounts(pages, Number(site.story_count ?? 0))}</span>
        <span>
          <b>{published}</b> published
        </span>
        {changed > 0 && (
          <span className="attention-copy">
            <b>{changed}</b> {changed === 1 ? 'change' : 'changes'} not live
          </span>
        )}
      </div>

      {/* Navy rather than red. Red is the identity accent and the primary
          action, and a grid of site cards each carrying a full-width red button
          is a wall of red in which nothing is primary any more. */}
      <div className="site-card-actions">
        <Link className="btn navy" href={`/sites/${site.id}`}>
          Open
        </Link>
        {live && (
          <a className="btn secondary" rel="noopener" target="_blank" href={`${liveOrigin}/`}>
            <IconExternal size={15} /> {site.primary_hostname ? 'Visit site' : 'View site'}
          </a>
        )}
      </div>
    </article>
  )
}

function siteKindLabel(kind: string | null | undefined): string {
  if (kind === 'event') return 'Event site'
  if (kind === 'resource') return 'Resource site'
  return 'Website'
}

/** Up to two letters, so a card has an identity before anyone adds a logo. */
function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return '?'
  if (words.length === 1) return words[0]!.slice(0, 2).toUpperCase()
  return (words[0]![0]! + words[1]![0]!).toUpperCase()
}
