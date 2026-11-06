import Link from 'next/link'
import { notFound } from 'next/navigation'
import { AppShell } from '../../../../../components/app-shell.tsx'
import { navigationFor } from '../../../../../components/nav.ts'
import { PageHeader } from '../../../../../components/shell.tsx'
import { getSite, isSuperAdmin, roleLabel } from '../../../../../lib/queries.ts'
import { listFrameLibrary } from '../../../../../lib/frame-library.ts'
import { currentSession } from '../../../../../lib/session.ts'
import { FrameLibrary } from './frame-library.tsx'

export const dynamic = 'force-dynamic'
export default async function FrameLibraryPage({ params }: { params: Promise<{ siteId: string }> }) {
  const session = await currentSession()
  if (!session || !(await isSuperAdmin(session.principal.userId))) notFound()
  const { siteId } = await params
  const site = await getSite(session.principal.userId, siteId)
  if (!site) notFound()
  const [entries, role] = await Promise.all([
    listFrameLibrary(session.principal.userId, siteId),
    roleLabel(session.principal.userId),
  ])
  return (
    <AppShell email={session.email} role={role} groups={navigationFor(site, session.principal)}>
      <main id="main" className="wrap">
        <PageHeader
          title="Custom header & footer designs"
          crumbs={[
            { label: 'Sites', href: '/' },
            { label: site.name, href: `/sites/${siteId}` },
            { label: 'Header & footer', href: `/sites/${siteId}/global-elements` },
            { label: 'Custom designs' },
          ]}
          lede="Headers and footers built from a site's own HTML and CSS, for when the built-in layouts cannot match a site. Retiring one hides it from new choices without changing any site that uses it."
          actions={
            <Link className="btn navy" href={`/sites/${siteId}/sections/new`}>
              Create a design
            </Link>
          }
        />
        <FrameLibrary siteId={siteId} initial={entries} />
      </main>
    </AppShell>
  )
}
