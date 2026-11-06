import { notFound } from 'next/navigation'
import { AppShell } from '../../../components/app-shell.tsx'
import { navigationFor } from '../../../components/nav.ts'
import { PageHeader } from '../../../components/shell.tsx'
import { currentSession } from '../../../lib/session.ts'
import { SiteImportForm } from './import-form.tsx'
export const dynamic = 'force-dynamic'
export default async function ImportSitePage() {
  const session = await currentSession()
  if (!session?.principal.isSuperAdmin) notFound()
  return (
    <AppShell email={session.email} role="Super admin" groups={navigationFor(undefined, session.principal)}>
      <main id="main" className="wrap">
        <PageHeader
          title="Import site content"
          crumbs={[{ label: 'Sites', href: '/' }, { label: 'Import content' }]}
          lede="Create a private draft copy from an exported site, including its version history and images."
        />
        <SiteImportForm actorId={session.principal.userId} />
      </main>
    </AppShell>
  )
}
