import { notFound } from 'next/navigation'
import { AppShell } from '../../../../components/app-shell.tsx'
import { navigationFor } from '../../../../components/nav.ts'
import { PageHeader } from '../../../../components/ui/page-header.tsx'
import { currentSession } from '../../../../lib/session.ts'
import { getSite, roleLabel } from '../../../../lib/queries.ts'
import { localChapterMailOrigin, localChapterMessages } from '../../../../lib/local-chapter-mail.ts'
import { LocalMessages } from './messages.tsx'
export const dynamic = 'force-dynamic'
export default async function LocalOutbox({ params }: { params: Promise<{ siteId: string }> }) {
  if (!localChapterMailOrigin()) notFound()
  const session = await currentSession()
  if (!session) notFound()
  const { siteId } = await params
  const site = await getSite(session.principal.userId, siteId)
  const manage =
    session.principal.isSuperAdmin ||
    session.principal.memberships.get(siteId) === 'site_admin' ||
    [...(session.principal.divisionScopes?.values() ?? [])].some(scope => scope.siteId === siteId) ||
    [...(session.principal.pageScopes?.values() ?? [])].some(
      scope => scope.siteId === siteId && scope.role === 'editor',
    )
  if (!site?.chapters_enabled || !manage) notFound()
  const [items, role] = await Promise.all([
    localChapterMessages(session.principal.userId, siteId),
    roleLabel(session.principal.userId),
  ])
  return (
    <AppShell email={session.email} role={role} groups={navigationFor(site, session.principal)}>
      <main id="main" className="wrap">
        <PageHeader
          title="Local outbox"
          lede="No email is sent. These messages are recorded on this Mac."
          crumbs={[
            { label: 'All sites', href: '/sites' },
            { label: site.name, href: '/sites/' + siteId },
            { label: 'Chapters', href: '/sites/' + siteId + '/chapters' },
            { label: 'Local outbox' },
          ]}
        />
        <LocalMessages items={items} />
      </main>
    </AppShell>
  )
}
