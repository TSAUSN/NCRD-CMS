import { GuardedLink as Link } from '../../../../../../components/guarded-link.tsx'
import { notFound } from 'next/navigation'
import { AppShell } from '../../../../../../components/app-shell.tsx'
import { navigationFor } from '../../../../../../components/nav.ts'
import { PageHeader } from '../../../../../../components/shell.tsx'
import { currentSession } from '../../../../../../lib/session.ts'
import { getSite, listSectionLibrary, listSectionUsage, roleLabel } from '../../../../../../lib/queries.ts'

export const dynamic = 'force-dynamic'

export default async function SectionUsage({
  params,
  searchParams,
}: {
  params: Promise<{ siteId: string; definitionId: string }>
  searchParams: Promise<{ after?: string }>
}) {
  const session = await currentSession()
  if (!session) notFound()
  const { siteId, definitionId } = await params
  const { after } = await searchParams
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  if (!uuid.test(siteId) || !uuid.test(definitionId) || (after && (typeof after !== 'string' || !uuid.test(after))))
    notFound()
  const userId = session.principal.userId
  const site = await getSite(userId, siteId)
  if (!site) notFound()
  // The definition must belong to the requested library, even for a global admin.
  const library = await listSectionLibrary(userId, siteId)
  const definition = library.find(entry => entry.section_def_id === definitionId)
  if (!definition) notFound()
  const [role, usage] = await Promise.all([roleLabel(userId), listSectionUsage(userId, definitionId, after)])
  const href = `/sites/${siteId}/sections/${definitionId}/usage`

  return (
    <AppShell email={session.email} role={role} groups={navigationFor(site, session.principal)}>
      <main id="main" className="wrap">
        <PageHeader
          title={`Pages using ${definition.name}`}
          crumbs={[
            { label: 'Sites', href: '/' },
            { label: site.name, href: `/sites/${siteId}` },
            { label: 'Sections', href: `/sites/${siteId}/sections` },
            { label: 'Usage' },
          ]}
          sub={
            <span>
              {definition.used_on_pages} {definition.used_on_pages === 1 ? 'page' : 'pages'} across{' '}
              {definition.used_on_sites} accessible {definition.used_on_sites === 1 ? 'site' : 'sites'}
            </span>
          }
          lede="Each page keeps its chosen section version until an editor deliberately updates it. This list includes current drafts and published versions, including hidden sections. Older history and archived pages are excluded."
          actions={
            <Link className="btn secondary" href={`/sites/${siteId}/sections`}>
              Back to sections
            </Link>
          }
        />

        {usage.rows.length === 0 ? (
          <div className="empty-state">
            <h2>{after ? 'No more pages' : 'No current pages use this section'}</h2>
            <p>
              {after
                ? 'Return to the first page of results to review current usage.'
                : 'You can add this section from a page editor. It may also appear in historical versions or on sites outside your access.'}
            </p>
          </div>
        ) : (
          <ol className="activity-list" aria-label="Pages using this section">
            {usage.rows.map(page => (
              <li className="card activity-entry" key={page.page_id}>
                <div className="activity-entry-heading">
                  <h2>
                    <Link
                      href={`/pages/${page.page_id}${page.first_draft_index === null ? '' : `?section=${page.first_draft_index}`}`}
                    >
                      {page.page_title}
                    </Link>
                  </h2>
                  <Link href={`/sites/${page.site_id}`}>{page.site_name}</Link>
                </div>
                {page.site_status === 'archived' && (
                  <p className="notice">This site is archived and does not serve public pages.</p>
                )}
                <p>
                  <strong>Current draft:</strong>{' '}
                  {page.draft_versions?.length
                    ? `${page.draft_instances} ${page.draft_instances === 1 ? 'placement' : 'placements'} · section ${page.draft_versions.map(version => `v${version}`).join(', ')}`
                    : 'Not in the draft — the published version still uses it.'}
                  {page.hidden_draft_instances > 0 && ` · ${page.hidden_draft_instances} hidden everywhere`}
                </p>
                <p>
                  <strong>Published version:</strong>{' '}
                  {page.live_versions?.length
                    ? `${page.live_instances} ${page.live_instances === 1 ? 'placement' : 'placements'} · section ${page.live_versions.map(version => `v${version}`).join(', ')}`
                    : 'Not published with this section'}
                  {page.hidden_live_instances > 0 && ` · ${page.hidden_live_instances} hidden everywhere`}
                </p>
                <div className="actions">
                  <Link
                    className="btn secondary small"
                    href={`/pages/${page.page_id}${page.first_draft_index === null ? '' : `?section=${page.first_draft_index}`}`}
                  >
                    Open draft
                  </Link>
                  {page.live_version_id && (
                    <Link
                      className="btn secondary small"
                      href={`/pages/${page.page_id}/history?version=${page.live_version_id}`}
                    >
                      View published version
                    </Link>
                  )}
                </div>
              </li>
            ))}
          </ol>
        )}
        <nav className="actions" aria-label="Section usage pages">
          {after && (
            <Link className="btn secondary" href={href}>
              First pages
            </Link>
          )}
          {usage.next && (
            <Link className="btn secondary" href={`${href}?after=${usage.next}`}>
              More pages
            </Link>
          )}
        </nav>
      </main>
    </AppShell>
  )
}
