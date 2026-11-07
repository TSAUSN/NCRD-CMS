import { notFound } from 'next/navigation'
import { asUser } from '@cms/platform'
import { GuardedLink as Link } from '../../components/guarded-link.tsx'
import { AppShell } from '../../components/app-shell.tsx'
import { navigationFor } from '../../components/nav.ts'
import { PageHeader } from '../../components/shell.tsx'
import { Card, EmptyState } from '../../components/ui/index.ts'
import recordTableStyles from '../../components/workspace-styles/record-table.module.css'
import ownedStyles from './page-styles.module.css'
import { currentSession } from '../../lib/session.ts'
import { domainStatusLabel, stagingAddressStatusLabel } from '../../lib/domains.ts'
export const dynamic = 'force-dynamic'
type Address = { site_id: string; site_name: string; hostname: string; kind: string; status: string }
export default async function Domains() {
  const session = await currentSession()
  if (!session?.principal.isSuperAdmin) notFound()
  const rows = await asUser(
    { userId: session.principal.userId },
    async c =>
      (
        await c.query<Address>(`
 SELECT s.id AS site_id,s.name AS site_name,d.hostname_normalized AS hostname,d.kind::text AS kind,d.status::text AS status
 FROM domains d JOIN sites s ON s.id=d.site_id WHERE d.removed_at IS NULL AND s.archived_at IS NULL
 UNION ALL
 SELECT s.id,s.name,s.staging_hostname,'staging',app.site_hosting_status(s.id) FROM sites s
 WHERE s.archived_at IS NULL AND s.staging_hostname IS NOT NULL AND NOT EXISTS(SELECT 1 FROM domains d WHERE d.site_id=s.id AND d.hostname_normalized=s.staging_hostname AND d.removed_at IS NULL)
 ORDER BY site_name,hostname`)
      ).rows,
  )
  return (
    <AppShell email={session.email} role="Super admin" groups={navigationFor(undefined, session.principal)}>
      <main id="main" className="wrap">
        <PageHeader
          title="Domains"
          crumbs={[{ label: 'Home', href: '/' }, { label: 'Domains' }]}
          lede="Web addresses for your sites. This list is read-only."
        />
        <Card title="Web addresses" density="compact">
          {rows.length ? (
            <div className={recordTableStyles.tableWrap}>
              <p className={ownedStyles.addressScrollHint}>Scroll sideways to see all address details.</p>
              <table
                className={
                  recordTableStyles.table + ' ' + recordTableStyles.compactTable + ' ' + ownedStyles.addressTable
                }
                aria-label="Domains"
              >
                <thead>
                  <tr>
                    <th scope="col">Address</th>
                    <th scope="col">Site</th>
                    <th scope="col">Type</th>
                    <th scope="col">Status</th>
                    <th scope="col">
                      <span className="sr-only">Details</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(row => (
                    <tr key={row.site_id + row.hostname}>
                      <td>
                        <code>{row.hostname}</code>
                      </td>
                      <td>
                        <Link href={'/sites/' + row.site_id}>{row.site_name}</Link>
                      </td>
                      <td>{row.kind === 'staging' ? 'Test address' : row.kind}</td>
                      <td>
                        {row.kind === 'staging'
                          ? stagingAddressStatusLabel(row.hostname, row.status)
                          : domainStatusLabel(row.status)}
                      </td>
                      <td>
                        <Link href={'/sites/' + row.site_id + '/domains'}>Open site settings</Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState title="No addresses yet">Site addresses will appear here when they exist.</EmptyState>
          )}
        </Card>
      </main>
    </AppShell>
  )
}
