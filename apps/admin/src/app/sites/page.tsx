import Link from 'next/link'
import { notFound } from 'next/navigation'
import { currentSession } from '../../lib/session.ts'
import { roleLabel } from '../../lib/queries.ts'
import { listSiteDirectory } from '../../server/queries/sites.ts'
import { AppShell } from '../../components/app-shell.tsx'
import { navigationFor } from '../../components/nav.ts'
import { PageHeader } from '../../components/shell.tsx'
import { SiteCard } from '../../components/site-card.tsx'
import { EmptyState } from '../../components/ui/index.ts'
export const dynamic = 'force-dynamic'
export default async function SitesPage() {
  const session = await currentSession()
  if (!session) notFound()
  const [sites, role] = await Promise.all([
    listSiteDirectory(session.principal.userId),
    roleLabel(session.principal.userId),
  ])
  const active = sites.filter(site => site.status !== 'archived'),
    archived = sites.filter(site => site.status === 'archived')
  return (
    <AppShell email={session.email} role={role} groups={navigationFor(undefined, session.principal)}>
      <main id="main" className="wrap">
        <PageHeader
          title="All sites"
          crumbs={[{ label: 'Home', href: '/' }, { label: 'All sites' }]}
          lede="Choose a website to open its pages, shared lists and site look."
          actions={
            session.principal.isSuperAdmin ? (
              <Link className="btn navy" href="/sites/new">
                Create a site
              </Link>
            ) : undefined
          }
        />
        {active.length ? (
          <div className="grid grid-cards">
            {active.map(site => (
              <SiteCard key={site.id} site={site} />
            ))}
          </div>
        ) : (
          <EmptyState title={archived.length ? 'No active sites' : 'No sites yet'}>
            {session.principal.isSuperAdmin
              ? 'Create your first site to begin.'
              : 'Sites appear here when an administrator gives you access.'}
          </EmptyState>
        )}
        {archived.length > 0 && (
          <details className="archived-pages">
            <summary>Archived sites ({archived.length})</summary>
            <p>These sites are off the public web. Their content and history remain in the CMS.</p>
            <div className="grid grid-cards">
              {archived.map(site => (
                <SiteCard key={site.id} site={site} />
              ))}
            </div>
          </details>
        )}
      </main>
    </AppShell>
  )
}
