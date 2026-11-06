import Link from 'next/link'
import { AppShell } from '../../../components/app-shell.tsx'
import { navigationFor, type NavigationAccess } from '../../../components/nav.ts'
import { PageHeader } from '../../../components/shell.tsx'
import { ScriptlessPreview } from '../../../components/scriptless-preview.tsx'
import type { SiteRow } from '../../../lib/queries.ts'

/** Archived sites retain authorized content/history access without mounting any
 * page editor, save loop or canvas mutation bridge. */
export function ArchivedPagePreview({
  pageId,
  title,
  versionId,
  site,
  email,
  role,
  access,
}: {
  access?: NavigationAccess
  pageId: string
  title: string
  versionId: string | null
  site: SiteRow
  email: string
  role: string
}) {
  return (
    <AppShell email={email} role={role} groups={navigationFor(site, access)}>
      <main id="main" className="wrap wrap-wide">
        <PageHeader
          title={title}
          crumbs={[{ label: 'Sites', href: '/' }, { label: site.name, href: `/sites/${site.id}` }, { label: title }]}
          lede="This site is archived. Its saved page and history remain available for reference; editing and restoring are disabled."
          actions={
            <Link className="btn secondary" href={`/pages/${pageId}/history`}>
              View page history
            </Link>
          }
        />
        <p className="notice notice-info" role="status">
          Read-only saved page · Archived site ·{' '}
          {site.initial_release_required ? 'Saved site appearance' : 'Published site appearance'}
        </p>
        {versionId ? (
          <ScriptlessPreview
            title="Read-only saved page"
            src={`/preview/${versionId}?readonly=1${site.initial_release_required ? '&site=draft' : ''}`}
            style={{
              width: '100%',
              height: '75vh',
              minHeight: '360px',
              border: '1px solid var(--line)',
              background: 'white',
            }}
          />
        ) : (
          <p>No saved page content is available.</p>
        )}
      </main>
    </AppShell>
  )
}
