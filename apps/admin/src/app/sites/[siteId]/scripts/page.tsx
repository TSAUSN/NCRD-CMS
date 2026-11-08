import { notFound } from 'next/navigation'
import { asUser } from '@cms/platform'
import { EMPTY_SITE_FILE_BUNDLE, SiteFileBundle, SiteFileView } from '@cms/schema'
import { currentSession } from '../../../../lib/session.ts'
import { getSite, roleLabel } from '../../../../lib/queries.ts'
import { AppShell } from '../../../../components/app-shell.tsx'
import { navigationFor } from '../../../../components/nav.ts'
import { PageHeader } from '../../../../components/ui/index.ts'
import { SiteFilesWorkspace } from './workspace.tsx'
export const dynamic = 'force-dynamic'
export default async function SiteScripts({ params }: { params: Promise<{ siteId: string }> }) {
  const session = await currentSession()
  if (!session?.principal.isSuperAdmin) notFound()
  const { siteId } = await params
  const site = await getSite(session.principal.userId, siteId)
  if (!site) notFound()
  const [role, data] = await Promise.all([
    roleLabel(session.principal.userId),
    asUser({ userId: session.principal.userId }, async client => {
      const head = (
        await client.query<{ revision: string; draft_version_id: string | null; published_version_id: string | null }>(
          'SELECT revision,draft_version_id,published_version_id FROM site_file_heads WHERE site_id=$1',
          [siteId],
        )
      ).rows[0]
      const files = (
        await client.query(
          'SELECT id,kind,name,source,bytes::integer,sha256 FROM site_files WHERE site_id=$1 ORDER BY created_at,id',
          [siteId],
        )
      ).rows.map(file => SiteFileView.parse(file))
      const versions = (
        await client.query<{ id: string; version: string; bundle: unknown; reviewed_at: Date }>(
          'SELECT id,version,bundle,reviewed_at FROM site_file_versions WHERE site_id=$1 ORDER BY version DESC',
          [siteId],
        )
      ).rows.map(row => ({
        ...row,
        bundle: SiteFileBundle.parse(row.bundle),
        reviewed_at: row.reviewed_at.toISOString(),
      }))
      const pages = (
        await client.query<{ id: string; title: string }>(
          'SELECT id,title FROM pages WHERE site_id=$1 AND archived_at IS NULL ORDER BY sort_index,title,id',
          [siteId],
        )
      ).rows
      const nativeResources = (
        await client.query<{ kind: 'media' | 'asset'; id: string; name: string; bytes: string; source: string }>(
          `SELECT 'media' AS kind,id,COALESCE(NULLIF(original_name,''),'Saved image') AS name,bytes::text,source FROM media WHERE site_id=$1
   UNION ALL SELECT 'asset',id,original_name,bytes::text,provenance->>'path' FROM site_assets WHERE site_id=$1`,
          [siteId],
        )
      ).rows.map(row => ({ ...row, bytes: Number(row.bytes) }))
      return {
        nativeResources,
        revision: head?.revision ?? '0',
        draftVersionId: head?.draft_version_id ?? null,
        publishedVersionId: head?.published_version_id ?? null,
        files,
        versions,
        pages,
        bundle: versions.find(version => version.id === head?.draft_version_id)?.bundle ?? EMPTY_SITE_FILE_BUNDLE,
      }
    }),
  ])
  return (
    <AppShell email={session.email} role={role} groups={navigationFor(site, session.principal)}>
      <main id="main" className="wrap">
        <PageHeader
          title="Site scripts and files"
          crumbs={[
            { label: 'All sites', href: '/sites' },
            { label: site.name, href: '/sites/' + siteId },
            { label: 'Settings', href: '/sites/' + siteId + '/settings' },
            { label: 'Site scripts and files' },
          ]}
          lede="Review the files that make this site's menus, carousels and other interactions work. Only a Super Admin can change them."
        />
        <SiteFilesWorkspace siteId={siteId} siteName={site.name} archived={site.status === 'archived'} {...data} />
      </main>
    </AppShell>
  )
}
