import Link from 'next/link'
import { notFound } from 'next/navigation'
import { StructuredDocument } from '@cms/schema'
import { AppShell } from '../../../../../../components/app-shell.tsx'
import { navigationFor } from '../../../../../../components/nav.ts'
import { PageHeader } from '../../../../../../components/shell.tsx'
import { getDefinitionSource } from '../../../../../../lib/definition-source.ts'
import { authoringRights, getSite, roleLabel } from '../../../../../../lib/queries.ts'
import { currentSession } from '../../../../../../lib/session.ts'
import { SectionAuthor } from '../../section-author.tsx'

export const dynamic = 'force-dynamic'
export default async function EditDefinition({
  params,
}: {
  params: Promise<{ siteId: string; definitionId: string }>
}) {
  const session = await currentSession()
  if (!session) notFound()
  const { siteId, definitionId } = await params
  const site = await getSite(session.principal.userId, siteId)
  if (!site) notFound()
  const [source, rights, role] = await Promise.all([
    getDefinitionSource(session.principal.userId, siteId, definitionId),
    authoringRights(session.principal.userId, siteId),
    roleLabel(session.principal.userId),
  ])
  if (!source || !(source.scope === 'global' ? rights.global : rights.site)) notFound()
  const invalid = source.kind === 'structured' && !StructuredDocument.safeParse(source.structuredDoc).success
  return (
    <AppShell email={session.email} role={role} groups={navigationFor(site, session.principal)}>
      <main id="main" className="wrap wrap-wide">
        {invalid ? (
          <>
            <PageHeader
              crumbs={[
                { label: 'All sites', href: '/' },
                { label: site.name, href: `/sites/${siteId}` },
                { label: 'Sections', href: `/sites/${siteId}/sections` },
                { label: 'Edit section' },
              ]}
              title="This section needs revalidation"
              lede="Its stored structure is not supported by this build. The existing source has been preserved."
            />
            <p>
              Revalidate or migrate the definition before editing it; the visual builder will not replace it with a
              blank template.
            </p>
          </>
        ) : (
          <>
            <SectionAuthor siteId={siteId} siteName={site.name} rights={rights} initial={source} />
          </>
        )}
      </main>
    </AppShell>
  )
}
