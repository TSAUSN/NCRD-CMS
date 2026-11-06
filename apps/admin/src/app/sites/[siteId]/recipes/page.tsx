import { notFound } from 'next/navigation'
import { currentSession } from '../../../../lib/session.ts'
import { getSite, roleLabel } from '../../../../lib/queries.ts'
import { readPageRecipes } from '../../../../lib/page-recipes.ts'
import { readRecipeTargets } from '../../../../lib/recipe-targets.ts'
import { AppShell } from '../../../../components/app-shell.tsx'
import { PageHeader, siteAreaTabs } from '../../../../components/shell.tsx'
import { navigationFor } from '../../../../components/nav.ts'
import { RecipesWorkspace } from './recipes-workspace.tsx'

export const dynamic = 'force-dynamic'
export default async function PageRecipes({ params }: { params: Promise<{ siteId: string }> }) {
  const session = await currentSession()
  if (!session) notFound()
  const { siteId } = await params
  const site = await getSite(session.principal.userId, siteId)
  if (!site) notFound()
  const [data, role, targets] = await Promise.all([
    readPageRecipes(session.principal.userId, siteId),
    roleLabel(session.principal.userId),
    readRecipeTargets(session.principal.userId),
  ])
  const membership = session.principal.memberships.get(siteId)
  const canManage = session.principal.isSuperAdmin || membership === 'editor' || membership === 'site_admin'
  return (
    <AppShell email={session.email} role={role} groups={navigationFor(site, session.principal)}>
      <main id="main" className="wrap">
        <PageHeader
          title="Section library"
          crumbs={[
            { label: 'Sites', href: '/' },
            { label: site.name, href: `/sites/${siteId}` },
            { label: 'Section library' },
          ]}
          lede="Page templates are saved arrangements of sections. Starting a page from one copies its sections; the template itself never changes your pages."
          tabs={siteAreaTabs(siteId, 'library', 'recipes')}
        />
        {site.status === 'archived' ? (
          <p className="notice">This site is archived. Restore it before using or changing recipes.</p>
        ) : (
          <RecipesWorkspace
            key={siteId}
            siteId={siteId}
            canManage={canManage}
            isSuperAdmin={session.principal.isSuperAdmin}
            targets={targets}
            {...data}
          />
        )}
      </main>
    </AppShell>
  )
}
