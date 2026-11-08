import workspace from '../../../../components/workspace.module.css'
import { localChapterMailOrigin } from '../../../../lib/local-chapter-mail.ts'
import { TestTools, TextLink } from '../../../../components/ui/index.ts'
import { notFound } from 'next/navigation'
import { AppShell } from '../../../../components/app-shell.tsx'
import { navigationFor } from '../../../../components/nav.ts'
import { PageHeader } from '../../../../components/ui/page-header.tsx'
import { currentSession } from '../../../../lib/session.ts'
import { getSite, roleLabel } from '../../../../lib/queries.ts'
import { listChapters, chapterWorkspaceOptions } from '../../../../lib/chapters.ts'
import { ChaptersWorkspace } from './workspace.tsx'
export const dynamic = 'force-dynamic'
export default async function ChaptersPage({ params }: { params: Promise<{ siteId: string }> }) {
  const session = await currentSession()
  if (!session) notFound()
  const { siteId } = await params
  const site = await getSite(session.principal.userId, siteId)
  if (
    !site?.chapters_enabled ||
    !(
      session.principal.isSuperAdmin ||
      session.principal.memberships.get(siteId) === 'site_admin' ||
      [...(session.principal.divisionScopes?.values() ?? [])].some(scope => scope.siteId === siteId) ||
      [...(session.principal.pageScopes?.values() ?? [])].some(
        scope => scope.siteId === siteId && scope.role === 'editor',
      )
    )
  )
    notFound()
  const [rows, role, options] = await Promise.all([
    listChapters(session.principal.userId, siteId),
    roleLabel(session.principal.userId),
    chapterWorkspaceOptions(session.principal.userId, siteId),
  ])
  return (
    <AppShell email={session.email} role={role} groups={navigationFor(site, session.principal)}>
      <main id="main" className={'wrap wrap-wide' + (!site.original_design ? ' ' + workspace.page : '')}>
        <PageHeader
          showWayfinding={false}
          density="compact"
          title="Chapters"
          actions={<div id="chapter-actions" />}
          crumbs={[
            { label: 'All sites', href: '/sites' },
            { label: site.name, href: '/sites/' + siteId },
            { label: 'Chapters' },
          ]}
          lede={site.original_design ? 'Every chapter, and where it sends visitors.' : undefined}
          sub={
            !site.original_design
              ? rows.length + ' chapters · where they send visitors and how each page gets updated.'
              : undefined
          }
        />
        <ChaptersWorkspace
          native={!site.original_design}
          headerActionsId={!site.original_design ? 'chapter-actions' : undefined}
          localInvitations={Boolean(localChapterMailOrigin())}
          divisions={options.divisions}
          defaultMode={options.defaultMode}
          canAssignDivision={
            session.principal.isSuperAdmin || session.principal.memberships.get(siteId) === 'site_admin'
          }
          canAdd={
            session.principal.isSuperAdmin ||
            session.principal.memberships.get(siteId) === 'site_admin' ||
            options.divisions.length > 0
          }
          siteId={siteId}
          rows={rows}
        />
        {localChapterMailOrigin() && (
          <TestTools isSuperAdmin={session.principal.isSuperAdmin}>
            <TextLink href={'/sites/' + siteId + '/outbox'}>Local outbox</TextLink>
          </TestTools>
        )}
      </main>
    </AppShell>
  )
}
