import Link from 'next/link'
import { notFound } from 'next/navigation'
import { AppShell } from '../../../../../components/app-shell.tsx'
import { navigationFor } from '../../../../../components/nav.ts'
import { PageHeader } from '../../../../../components/shell.tsx'
import { SectionLivePreview } from '../../../../../components/section-live-preview.tsx'
import { SectionFavourite } from '../../../../../components/section-favourite.tsx'
import { currentSession } from '../../../../../lib/session.ts'
import { authoringRights, getSite, listSectionLibrary, roleLabel } from '../../../../../lib/queries.ts'
import { getDefinitionSource, listDefinitionVersions } from '../../../../../lib/definition-source.ts'
import styles from '../sections.module.css'
export const dynamic = 'force-dynamic'
const kinds: Record<string, string> = {
  text: 'Short text',
  richtext: 'Formatted text',
  image: 'Picture',
  link: 'Link',
  repeat: 'Items',
  embed: 'Video or embedded content',
  document: 'Document',
}
export default async function SectionDetail({ params }: { params: Promise<{ siteId: string; definitionId: string }> }) {
  const session = await currentSession()
  if (!session) notFound()
  const { siteId, definitionId } = await params
  const userId = session.principal.userId
  const site = await getSite(userId, siteId)
  if (!site) notFound()
  const [library, source, versions, rights, role] = await Promise.all([
    listSectionLibrary(userId, siteId),
    getDefinitionSource(userId, siteId, definitionId),
    listDefinitionVersions(userId, siteId, definitionId),
    authoringRights(userId, siteId),
    roleLabel(userId),
  ])
  const entry = library.find(item => item.section_def_id === definitionId)
  if (!entry || !source) notFound()
  const base = `/sites/${siteId}/sections/${definitionId}`
  const canEdit =
    rights.global ||
    (entry.scope === 'site' && rights.site && source.kind === 'structured' && source.placement === 'page')
  return (
    <AppShell email={session.email} role={role} groups={navigationFor(site, session.principal)}>
      <main id="main" className="wrap">
        <PageHeader
          title={entry.name}
          crumbs={[
            { label: 'All sites', href: '/' },
            { label: site.name, href: `/sites/${siteId}` },
            { label: 'Sections', href: `/sites/${siteId}/sections` },
            { label: entry.name },
          ]}
          lede={String(
            entry.slots[0]?.constraints?.corePurpose ?? 'Preview this section before choosing it for a page.',
          )}
          sub={
            <span>
              {entry.scope === 'global' ? 'Core' : 'This site'} · {entry.category} · Version {entry.version}
            </span>
          }
          actions={
            <>
              {canEdit && (
                <Link className="btn navy" href={`${base}/edit`}>
                  Edit section
                </Link>
              )}
              <SectionFavourite
                siteId={siteId}
                definitionId={definitionId}
                name={entry.name}
                initial={entry.is_favourite}
              />
            </>
          }
        />
        <div className={styles.detail}>
          <section className={styles.panel} aria-label="Section preview">
            <h2>Preview</h2>
            <SectionLivePreview siteId={siteId} definitionId={definitionId} name={entry.name} />
          </section>
          <div className={styles.panel}>
            <h2>Editable fields</h2>
            {source.slots.length ? (
              <ul className={styles.fields}>
                {source.slots.map(slot => (
                  <li key={slot.id}>
                    <strong>{slot.label}</strong>
                    <span className={styles.kind}>{kinds[slot.kind] ?? 'Content'}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p>This section has no editable fields.</p>
            )}
            <h2>
              Used on {entry.used_on_pages} {entry.used_on_pages === 1 ? 'page' : 'pages'}
            </h2>
            <p>Counts include current drafts and live pages you can access. Older history is excluded.</p>
            <Link href={`${base}/usage`}>View pages using this section</Link>
            {rights.site && entry.placement === 'page' && (
              <>
                <Link className="btn secondary" href={`${base}/update`}>
                  Update pages that use it
                </Link>
                <p>Review each page before updating its saved draft. Live pages stay unchanged until published.</p>
              </>
            )}
            <h2>Versions</h2>
            <ol className={styles.fields} aria-label="Section versions">
              {versions.map(version => (
                <li key={version.version}>
                  <strong>
                    Version {version.version}
                    {version.version === entry.version ? ' · Latest' : ''}
                  </strong>
                  <time dateTime={new Date(version.createdAt).toISOString()}>
                    {new Date(version.createdAt).toLocaleDateString('en-US', {
                      timeZone: 'UTC',
                      year: 'numeric',
                      month: 'short',
                      day: 'numeric',
                    })}
                  </time>
                  <p>{version.changelog || 'No change notes.'}</p>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </main>
    </AppShell>
  )
}
