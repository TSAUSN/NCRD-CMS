import { reviewDate } from '../lib/review-time.ts'
import type { ReactNode } from 'react'
import { GuardedLink as Link } from './guarded-link.tsx'
import { AppShell } from './app-shell.tsx'
import { navigationFor, type NavigationAccess } from './nav.ts'
import { PageHeader } from './shell.tsx'
import { ButtonLink, Card, Disclosure } from './ui/index.ts'
import { SiteCard } from './site-card.tsx'
import { StatusChip, pageStatus } from './status.tsx'
import { IconAlert, IconCheck, IconClock, IconMail, IconPage, IconPlus } from './icons.tsx'
import type { SiteSummaryRow } from '../lib/queries.ts'
import type { WorkspacePage } from '../lib/workspace-queries.ts'
import shared from './workspace.module.css'

type Props = {
  email: string
  role: string
  access: NavigationAccess
  sites: SiteSummaryRow[]
  pages: WorkspacePage[]
  reviewCounts: Record<string, number>
  operations: ReactNode
}
/** Operator Home reports authorized saved work, with no feed refresh or hosting action. */
export function AdminHome({ email, role, access, sites, pages, reviewCounts, operations }: Props) {
  const active = sites.filter(site => site.status !== 'archived'),
    archived = sites.filter(site => site.status === 'archived'),
    recent = [...pages].sort((a, b) => Date.parse(b.edited_at) - Date.parse(a.edited_at)).slice(0, 6)
  const attention = active.flatMap(site => {
    const base = '/sites/' + site.id,
      reviews = reviewCounts[site.id] ?? 0,
      samples = pages.filter(page => page.site_id === site.id && page.live_samples),
      changed = Number(site.changed_count)
    return [
      ...(reviews
        ? [
            {
              key: site.id + '-review',
              site,
              tone: 'review',
              title: reviews + ' ' + (reviews === 1 ? 'submission needs' : 'submissions need') + ' review',
              detail: 'Read the submitted changes before deciding.',
              href: '/inbox',
              action: 'Review',
            },
          ]
        : []),
      ...(changed
        ? [
            {
              key: site.id + '-changes',
              site,
              tone: 'scheduled',
              title: changed + ' ' + (changed === 1 ? 'change is' : 'changes are') + ' not live',
              detail: 'Saved work stays private until reviewed publication.',
              href: base + '/publishing',
              action: 'Review changes',
            },
          ]
        : []),
      ...(samples.length
        ? [
            {
              key: site.id + '-samples',
              site,
              tone: 'pending',
              title: samples.length + ' ' + (samples.length === 1 ? 'page has' : 'pages have') + ' sample content live',
              detail: 'Replace marked samples with reviewed content.',
              href: '/pages/' + samples[0]!.id,
              action: 'Open page',
            },
          ]
        : []),
      ...(['preparing', 'error'].includes(site.hosting_status ?? '')
        ? [
            {
              key: site.id + '-address',
              site,
              tone: 'live',
              title:
                site.hosting_status === 'error' ? 'Test address needs attention' : 'Test address is being prepared',
              detail: 'Open the saved setup status before taking another step.',
              href: base,
              action: 'Open site',
            },
          ]
        : []),
    ]
  })
  return (
    <AppShell email={email} role={role} groups={navigationFor(undefined, access)}>
      <main
        id="main"
        className={'wrap wrap-wide ' + shared.page + ' ' + shared.compactForm + ' ' + shared.documentStack}
        data-layout="compact"
      >
        <PageHeader
          title="Home"
          showWayfinding={false}
          sub={
            active.length ? (
              <>
                Here’s what needs you across your {active.length} {active.length === 1 ? 'site' : 'sites'}.
              </>
            ) : (
              'Nobody has given you access to an active site yet.'
            )
          }
          actions={
            access.isSuperAdmin ? (
              <ButtonLink href="/sites/new" aria-label="Create a site">
                <IconPlus size={16} />
                New site
              </ButtonLink>
            ) : undefined
          }
        />
        <Card
          title="Needs you"
          density="compact"
          headerActions={
            <span className={shared.meta}>
              {attention.length} {attention.length === 1 ? 'item' : 'items'}
            </span>
          }
        >
          <ul className={shared.rowList}>
            {attention.map(item => (
              <li key={item.key} data-attention-site={item.site.id} className={shared.attentionRow}>
                <span className={shared.taskIcon} data-tone={item.tone}>
                  {item.tone === 'review' ? (
                    <IconMail size={18} />
                  ) : item.tone === 'scheduled' ? (
                    <IconClock size={18} />
                  ) : (
                    <IconAlert size={18} />
                  )}
                </span>
                <div className={shared.rowCopy}>
                  <strong>{item.title}</strong>
                  <span className={shared.meta}>{item.detail}</span>
                </div>
                <div className={shared.attentionActions}>
                  <span className={shared.homeSiteTag}>{item.site.name}</span>
                  <ButtonLink variant="secondary" href={item.href}>
                    {item.action}
                  </ButtonLink>
                </div>
              </li>
            ))}
            {!attention.length && (
              <li>
                <span className={shared.taskIcon}>
                  <IconCheck size={18} />
                </span>
                <div className={shared.rowCopy}>
                  <strong>Nothing needs your attention</strong>
                  <span className={shared.meta}>
                    {active.length
                      ? 'Open a site or return to recent work below.'
                      : access.isSuperAdmin
                        ? 'Create a site to begin.'
                        : 'Sites appear when somebody gives you access.'}
                  </span>
                </div>
              </li>
            )}
          </ul>
        </Card>
        <section aria-labelledby="your-sites">
          <div className={shared.sectionHeading}>
            <h2 id="your-sites">Your sites</h2>
            <span className={shared.meta}>
              {active.length} {active.length === 1 ? 'site' : 'sites'}
            </span>
          </div>
          <div className={shared.homeSites}>
            {active.map(site => (
              <SiteCard key={site.id} site={site} compactHome />
            ))}
            {access.isSuperAdmin && (
              <Link href="/sites/new" className={shared.homeNewSite}>
                <IconPlus size={22} />
                <strong>Start a new site</strong>
                <span>Event, organization or chapter network</span>
              </Link>
            )}
          </div>
          {!active.length && !access.isSuperAdmin && (
            <p>No active sites. Your saved history remains available when access permits.</p>
          )}
        </section>
        <Card title="Jump back in" density="compact">
          <ul className={shared.rowList}>
            {recent.map(page => (
              <li key={page.id}>
                <span className={shared.taskIcon}>
                  <IconPage size={18} />
                </span>
                <div className={shared.rowCopy}>
                  <Link href={'/pages/' + page.id}>{page.title}</Link>
                  <time className={shared.meta} dateTime={page.edited_at}>
                    {page.site_name} · {page.edited_by} · {reviewDate(page.edited_at)}
                  </time>
                </div>
                <StatusChip status={pageStatus(page)} />
              </li>
            ))}
            {!recent.length && <li>No recent page work. Open a site to get started.</li>}
          </ul>
        </Card>
        {active.length > 0 && (
          <Disclosure title="More tasks" className={shared.homeTasks}>
            <section aria-labelledby="home-tasks">
              <h2 id="home-tasks">What would you like to do?</h2>
              <div className={shared.grid}>
                {active.slice(0, 4).map(site => {
                  const home = pages.find(page => page.site_id === site.id && page.slug === '')
                  return (
                    <Link key={site.id} className={shared.task} href={home ? '/pages/' + home.id : '/sites/' + site.id}>
                      <strong>{home ? 'Edit ' + site.name + ' home page' : 'Open ' + site.name}</strong>
                      <span>Open the real page and click what you want to change.</span>
                    </Link>
                  )
                })}
                {active
                  .filter(site => site.has_stories || site.has_content_lists)
                  .slice(0, 2)
                  .map(site => (
                    <Link
                      key={site.id + '-lists'}
                      className={shared.task}
                      href={'/sites/' + site.id + (site.has_stories ? '/stories' : '/content')}
                    >
                      <strong>
                        {site.name} · {site.has_stories ? 'Update stories' : 'Update lists'}
                      </strong>
                    </Link>
                  ))}
              </div>
            </section>
          </Disclosure>
        )}
        {archived.length > 0 && (
          <Disclosure title={<>Archived sites ({archived.length})</>} className="archived-pages">
            <p>These sites are off the public web. Their content and history remain in the CMS.</p>
            <div className={shared.grid}>
              {archived.map(site => (
                <SiteCard key={site.id} site={site} />
              ))}
            </div>
          </Disclosure>
        )}
        {operations && <Disclosure title="Test tools (this computer only)">{operations}</Disclosure>}
      </main>
    </AppShell>
  )
}
