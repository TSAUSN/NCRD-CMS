import { GuardedLink as Link } from '../../../components/guarded-link.tsx'
import { notFound } from 'next/navigation'
import { AppShell } from '../../../components/app-shell.tsx'
import { navigationFor } from '../../../components/nav.ts'
import { PageHeader } from '../../../components/shell.tsx'
import { currentSession } from '../../../lib/session.ts'
import { stagingBaseDomain } from '../../../lib/site-creation.ts'
import { SiteWizard } from './wizard.tsx'

export const dynamic = 'force-dynamic'
export default async function NewSitePage() {
  const session = await currentSession()
  if (!session?.principal.isSuperAdmin) notFound()
  return (
    <AppShell email={session.email} role="Super admin" groups={navigationFor(undefined, session.principal)}>
      <main id="main" className="wrap wrap-wide">
        <PageHeader
          title="Create a site"
          crumbs={[{ label: 'Sites', href: '/' }, { label: 'New site' }]}
          lede="Choose a starting point, shape its pages, and review everything before creating the site."
        />
        <p>
          Have a content archive? <Link href="/sites/import">Import an existing site</Link>
        </p>
        <SiteWizard
          stagingBase={stagingBaseDomain()}
          managedStaging={!!process.env['FIREBASE_HOSTING_SITE_PREFIX']}
          progressKey={`cms.site-wizard.v1:${session.principal.userId}`}
        />
      </main>
    </AppShell>
  )
}
