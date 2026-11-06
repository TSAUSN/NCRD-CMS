import type { ReactNode } from 'react'
import { notFound } from 'next/navigation'
import { currentSession } from '../../../../lib/session.ts'
import { getSite, roleLabel } from '../../../../lib/queries.ts'
import { AppShell } from '../../../../components/app-shell.tsx'
import { navigationFor } from '../../../../components/nav.ts'
export default async function DataValuesLayout({
  params,
  children,
}: {
  params: Promise<{ siteId: string }>
  children: ReactNode
}) {
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
  const role = await roleLabel(session.principal.userId)
  return (
    <AppShell email={session.email} role={role} groups={navigationFor(site, session.principal)}>
      {children}
    </AppShell>
  )
}
