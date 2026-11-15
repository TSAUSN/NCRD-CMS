import workspaceFormsStyles from '../../../../components/workspace-styles/workspace-forms.module.css'
import { notFound } from 'next/navigation'
import { asUser } from '@cms/platform'
import { AppShell } from '../../../../components/app-shell.tsx'
import { navigationFor } from '../../../../components/nav.ts'
import { PageHeader } from '../../../../components/shell.tsx'
import { SettingsNavigation } from '../../../../components/settings-navigation.tsx'
import { getSite, roleLabel } from '../../../../lib/queries.ts'
import { currentSession } from '../../../../lib/session.ts'
import { DOMAIN_ROWS_SQL, type DomainRow } from '../../../../lib/domains.ts'
import { Card } from '../../../../components/ui/card.tsx'
import { Badge } from '../../../../components/ui/status-pill.tsx'
import { stagingAddressStatusLabel } from '../../../../lib/domains.ts'
import styles from './domain-styles.module.css'
import { DomainWorkspace } from './workspace.tsx'
import { localDomainsUnavailable, LOCAL_DOMAIN_GUIDANCE } from '../../../../lib/domain-setup.ts'
export const dynamic = 'force-dynamic'
export default async function Domains({ params }: { params: Promise<{ siteId: string }> }) {
  const session = await currentSession()
  if (!session) notFound()
  const { siteId } = await params
  const site = await getSite(session.principal.userId, siteId)
  if (!site) notFound()
  const [rows, role, hosting] = await Promise.all([
    asUser(
      { userId: session.principal.userId },
      async client => (await client.query<DomainRow>(DOMAIN_ROWS_SQL, [siteId])).rows,
    ),
    roleLabel(session.principal.userId),
    asUser(
      { userId: session.principal.userId },
      async client =>
        (await client.query<{ status: string }>('SELECT app.site_hosting_status($1) AS status', [siteId])).rows[0]
          ?.status ?? 'preparing',
    ),
  ])
  return (
    <AppShell email={session.email} role={role} groups={navigationFor(site, session.principal)}>
      <main id="main" className={'wrap ' + workspaceFormsStyles.compactForm}>
        <PageHeader
          title="Settings"
          crumbs={[
            { label: 'Sites', href: '/' },
            { label: site.name, href: `/sites/${siteId}` },
            { label: 'Settings' },
          ]}
          lede="Connect a web address to this site and choose the one visitors use."
        />
        <SettingsNavigation siteId={siteId} current="Domains" layout="tabs" />
        <Card
          title="Test address"
          description="Use this address to review the site while you connect a custom domain. Test pages ask search engines not to index them."
          density="settings"
        >
          <div className={styles.heading}>
            <code className={styles.hostname}>{site.staging_hostname ?? 'Not configured'}</code>
            <Badge tone={hosting === 'ready' ? 'live' : hosting === 'error' ? 'error' : 'pending'}>
              {site.staging_hostname ? stagingAddressStatusLabel(site.staging_hostname, hosting) : 'Not configured'}
            </Badge>
          </div>
          {hosting === 'ready' && site.staging_hostname?.endsWith('.web.app') && (
            <a href={`https://${site.staging_hostname}`} target="_blank" rel="noopener noreferrer">
              Open test site <span className="sr-only">(opens in a new tab)</span>
            </a>
          )}
        </Card>
        {!session.principal.isSuperAdmin && (
          <p className="notice">
            You can inspect these addresses. Only a Super Admin can connect, verify, change or remove domains.
          </p>
        )}
        {localDomainsUnavailable() && (
          <section className={'card stack ' + workspaceFormsStyles.formPanel} aria-label="Domain setup">
            <h2>Local preview only</h2>
            <p>{LOCAL_DOMAIN_GUIDANCE}</p>
          </section>
        )}
        {process.env['CMS_LOCAL_TEST_MODE'] === 'true' && process.env['DOMAIN_PROVIDER'] === 'fake' && (
          <p className="notice">
            This local pilot uses simulated domain checks. No DNS records or certificates are changed outside the pilot.
          </p>
        )}
        <DomainWorkspace
          siteId={siteId}
          rows={rows}
          archived={site.status === 'archived'}
          canManage={session.principal.isSuperAdmin}
          canConnect={!localDomainsUnavailable()}
        />
      </main>
    </AppShell>
  )
}
