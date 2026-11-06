import { notFound } from 'next/navigation'
import { asUser } from '@cms/platform'
import { AppShell } from '../../../../components/app-shell.tsx'
import { navigationFor } from '../../../../components/nav.ts'
import { currentSession } from '../../../../lib/session.ts'
import { getSite } from '../../../../lib/queries.ts'
import { nationalTemplateSites, reviewNationalSite } from '../../../../lib/national-template.ts'
import styles from '../../../../components/workspace.module.css'
import { NationalTemplateWorkspace } from './workspace.tsx'
export const dynamic = 'force-dynamic'
export default async function NationalTemplatePage({ params }: { params: Promise<{ siteId: string }> }) {
  const session = await currentSession()
  if (!session?.principal.isSuperAdmin) notFound()
  const { siteId } = await params,
    site = await getSite(session.principal.userId, siteId)
  if (!site || site.original_design) notFound()
  const initial = await asUser({ userId: session.principal.userId }, async client => {
    const reviews = []
    for (const site of await nationalTemplateSites(client))
      reviews.push((await reviewNationalSite(client, site.id)).review)
    return reviews
  })
  return (
    <AppShell email={session.email} role="Super admin" groups={navigationFor(site, session.principal)}>
      <main id="main" className={'wrap wrap-wide ' + styles.page}>
        <NationalTemplateWorkspace actorId={session.principal.userId} initial={initial} siteId={siteId} />
      </main>
    </AppShell>
  )
}
