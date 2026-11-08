import { notFound } from 'next/navigation'
import { AppShell } from '../../../../../components/app-shell.tsx'
import { navigationFor } from '../../../../../components/nav.ts'
import { currentSession } from '../../../../../lib/session.ts'
import { getSite, roleLabel } from '../../../../../lib/queries.ts'
import { collectionRights } from '../../../../../lib/collection-queries.ts'
import { getStoriesWorkspace } from '../../../../../lib/stories-workspace.ts'
import { storiesCatalog, storyTagAssignments } from '../../../../../lib/stories-catalog.ts'
import { TagManager } from './workspace.tsx'
import shared from '../../../../../components/workspace.module.css'
import workspaceFormsStyles from '../../../../../components/workspace-styles/workspace-forms.module.css'
export const dynamic = 'force-dynamic'
export default async function TagsPage({ params }: { params: Promise<{ siteId: string }> }) {
  const session = await currentSession()
  if (!session) notFound()
  const { siteId } = await params
  const site = await getSite(session.principal.userId, siteId)
  if (!site) notFound()
  const [list, rights, role] = await Promise.all([
    getStoriesWorkspace(session.principal.userId, siteId),
    collectionRights(session.principal.userId, siteId),
    roleLabel(session.principal.userId),
  ])
  if (!list || !rights.manageSchema) notFound()
  return (
    <AppShell email={session.email} role={role} groups={navigationFor(site, session.principal)}>
      <main id="main" className={'wrap wrap-wide ' + shared.page + ' ' + workspaceFormsStyles.compactForm}>
        <TagManager
          siteId={siteId}
          collectionId={list.id}
          initial={storiesCatalog(list.draft, site.slug)}
          initialRevision={String(list.revision)}
          initialEntryRevision={String(list.entryRevision)}
          initialHasDraft={list.draftSchemaVersionId !== list.publishedSchemaVersionId || list.changedEntries > 0}
          initialEntries={list.entries
            .filter(e => !e.archived)
            .map(e => ({ id: e.id!, values: storyTagAssignments(e.values) }))}
        />
      </main>
    </AppShell>
  )
}
