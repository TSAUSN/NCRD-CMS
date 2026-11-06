import { notFound } from 'next/navigation'
import { currentSession } from '../../../../lib/session.ts'
import { getSite } from '../../../../lib/queries.ts'
import { getSiteSettingsWorkspace } from '../../../../lib/site-settings.ts'
import { getDataValueUsage } from '../../../../lib/data-values.ts'
import shared from '../../../../components/workspace.module.css'
import { DataValuesWorkspace } from './workspace.tsx'
export const dynamic = 'force-dynamic'
export default async function DataValuesPage({ params }: { params: Promise<{ siteId: string }> }) {
  const session = await currentSession()
  if (!session) notFound()
  const { siteId } = await params,
    site = await getSite(session.principal.userId, siteId)
  if (
    !site ||
    site.original_design ||
    (!session.principal.isSuperAdmin && session.principal.memberships.get(siteId) !== 'site_admin')
  )
    notFound()
  const [initial, usage] = await Promise.all([
    getSiteSettingsWorkspace(session.principal.userId, siteId),
    getDataValueUsage(session.principal.userId, siteId),
  ])
  return (
    <main id="main" className={'wrap wrap-wide ' + shared.page + ' ' + shared.compactForm}>
      <DataValuesWorkspace siteId={siteId} archived={site.status === 'archived'} initial={initial} usage={usage} />
    </main>
  )
}
