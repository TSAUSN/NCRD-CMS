import { notFound } from 'next/navigation'
import { currentSession } from '../../../../../lib/session.ts'
import { authoringRights, getSite, roleLabel } from '../../../../../lib/queries.ts'
import Link from 'next/link'
import { PageHeader } from '../../../../../components/shell.tsx'
import { AppShell } from '../../../../../components/app-shell.tsx'
import { navigationFor } from '../../../../../components/nav.ts'
import { IconLock } from '../../../../../components/icons.tsx'
import { SectionAuthor } from '../section-author.tsx'

export const dynamic = 'force-dynamic'

export default async function NewSection({ params }: { params: Promise<{ siteId: string }> }) {
  const session = await currentSession()
  if (!session) notFound()
  const { siteId } = await params

  const site = await getSite(session.principal.userId, siteId)
  if (!site) notFound()
  const [rights, role] = await Promise.all([
    authoringRights(session.principal.userId, siteId),
    roleLabel(session.principal.userId),
  ])

  return (
    <AppShell email={session.email} role={role} groups={navigationFor(site, session.principal)}>
      <main id="main" className="wrap">
        {!rights.site && !rights.global ? (
          // Said plainly and early. A creator that renders in full and refuses
          // at the last step has wasted somebody's afternoon.
          //
          // A refusal with no way onward is a dead end, so this one names who
          // can help and offers both routes back — to the sections this site
          // already has, and to the site itself.
          <div className="empty-state">
            <PageHeader
              title="Sections"
              crumbs={[
                { label: 'All sites', href: '/' },
                { label: site.name, href: `/sites/${siteId}` },
                { label: 'Sections' },
              ]}
            />
            <div className="empty-icon">
              <IconLock size={22} />
            </div>
            <h2>You cannot create sections on this site</h2>
            <p>
              Creating a section changes what everybody editing {site.name} can put on a page, so it is limited to site
              admins. Whoever gave you access to this site can either make the section for you or give you the
              permission.
            </p>
            <div className="actions">
              <Link className="btn" href={`/sites/${site.id}/sections`}>
                See this site’s sections
              </Link>
              <Link className="btn secondary" href={`/sites/${site.id}`}>
                Back to {site.name}
              </Link>
            </div>
          </div>
        ) : (
          <SectionAuthor siteId={site.id} siteName={site.name} rights={rights} />
        )}
      </main>
    </AppShell>
  )
}
