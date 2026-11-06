import workspace from '../../../../components/workspace.module.css'
import { notFound } from 'next/navigation'
import { asUser } from '@cms/platform'
import { AppShell } from '../../../../components/app-shell.tsx'
import { navigationFor } from '../../../../components/nav.ts'
import { PageHeader, siteAreaTabs } from '../../../../components/shell.tsx'
import { getSite, roleLabel } from '../../../../lib/queries.ts'
import { currentSession } from '../../../../lib/session.ts'
import { DOMAIN_ROWS_SQL, type DomainRow } from '../../../../lib/domains.ts'
import { DomainWorkspace } from './workspace.tsx'
import { localDomainsUnavailable, LOCAL_DOMAIN_GUIDANCE } from '../../../../lib/domain-setup.ts'
export const dynamic = 'force-dynamic'
export default async function Domains({ params }: { params: Promise<{ siteId: string }> }) {
  const session = await currentSession()
  if (!session) notFound()
  const { siteId } = await params
  const site = await getSite(session.principal.userId, siteId)
  if (!site) notFound()
  const [rows, role] = await Promise.all([
    asUser(
      { userId: session.principal.userId },
      async client => (await client.query<DomainRow>(DOMAIN_ROWS_SQL, [siteId])).rows,
    ),
    roleLabel(session.principal.userId),
  ])
  return (
    <AppShell email={session.email} role={role} groups={navigationFor(site, session.principal)}>
      <main id="main" className={'wrap ' + workspace.compactForm}>
        <PageHeader
          title="Settings"
          crumbs={[
            { label: 'Sites', href: '/' },
            { label: site.name, href: `/sites/${siteId}` },
            { label: 'Settings' },
          ]}
          lede="Connect a web address to this site and choose the one visitors use."
          tabs={siteAreaTabs(siteId, 'settings', 'domains')}
        />
        <p>
          Staging address: {site.staging_hostname ?? 'Not configured'}. Staging pages ask search engines not to index
          them.
        </p>
        {!session.principal.isSuperAdmin && (
          <p className="notice">
            You can inspect these addresses. Only a Super Admin can connect, verify, change or remove domains.
          </p>
        )}
        {localDomainsUnavailable() && (
          <section className={'card stack ' + workspace.formPanel} aria-label="Domain setup">
            <h2>Local preview only</h2>
            <p>{LOCAL_DOMAIN_GUIDANCE}</p>
          </section>
        )}
        <section className={'card stack ' + workspace.formPanel} aria-label="Connection checklist">
          <h2>What you need to connect</h2>
          <ol>
            <li>
              <strong>Your domain owner:</strong> supply the full website addresses to test, such as{' '}
              <code>test-one.example.org</code> and <code>test-two.example.org</code>. Connect each address inside the
              site it should display.
            </li>
            <li>
              <strong>Your hosting operator:</strong> make the CMS publicly reachable and configure domain verification
              and HTTPS. A localhost preview cannot receive visitors from public DNS.
            </li>
            <li>
              <strong>The CMS and your domain owner:</strong> connect an address here to generate its exact A or CNAME,
              ownership TXT and any certificate records. Your domain owner adds them at the DNS provider; then use
              Verify now.
            </li>
          </ol>
          <p className="hint">
            Nameserver addresses identify your DNS service. Enter the website address you want visitors to use, rather
            than an ns1 or ns2 nameserver. Keep the existing nameservers when adding these records.
          </p>
        </section>
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
