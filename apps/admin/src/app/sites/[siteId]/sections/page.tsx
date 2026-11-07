import styles from './sections.module.css'
import { SectionLibraryCard } from '../../../../components/section-library-card.tsx'
import Link from 'next/link'
import { sitePreviewContext } from '../../../../lib/preview-context.ts'
import { compareSectionCategories } from '../../../../lib/section-library-order.ts'
import { notFound } from 'next/navigation'
import { currentSession } from '../../../../lib/session.ts'
import { authoringRights, getSite, listSectionLibrary, listSites, roleLabel } from '../../../../lib/queries.ts'
import { PageHeader, siteAreaTabs } from '../../../../components/shell.tsx'
import { AppShell } from '../../../../components/app-shell.tsx'
import { navigationFor } from '../../../../components/nav.ts'
import { SectionThumbnail } from '../../../../components/section-thumbnail.tsx'
import { IconCheck, IconPlus, IconSections } from '../../../../components/icons.tsx'
import { SectionRequestForm } from '../../../../components/section-request.tsx'
import { SectionFavourite } from '../../../../components/section-favourite.tsx'
import { SectionPreviewButton } from '../../../../components/section-live-preview.tsx'
import { LibraryFilters, LibraryResetLink } from './library-filters.tsx'

export const dynamic = 'force-dynamic'

/**
 * The section library as a screen of its own.
 *
 * The overlay inside the editor answers "what can I put on this page right
 * now"; this answers "what does this site have, and what would change if I
 * edited one" — which is why usage counts live here at full size rather than as
 * a number squeezed onto a card. Both read the same query and use the same card
 * component, so they cannot disagree about what the library contains or what it
 * looks like.
 */
export default async function SectionLibrary({
  params,
  searchParams,
}: {
  params: Promise<{ siteId: string }>
  searchParams: Promise<{
    saved?: string
    q?: string
    category?: string
    source?: string
    favourites?: string
    previewSite?: string
    site?: string
  }>
}) {
  const session = await currentSession()
  if (!session) notFound()
  const { siteId } = await params
  const requested = await searchParams
  const saved = typeof requested.saved === 'string' ? requested.saved : ''
  const search = typeof requested.q === 'string' ? requested.q.slice(0, 200).trim() : ''
  const categoryFilter = typeof requested.category === 'string' ? requested.category : ''
  const source = requested.source === 'site' || requested.source === 'global' ? requested.source : ''
  const favouritesOnly = requested.favourites === '1'

  const site = await getSite(session.principal.userId, siteId)
  if (!site) notFound()
  const [library, role, rights, sites] = await Promise.all([
    listSectionLibrary(session.principal.userId, site.id),
    roleLabel(session.principal.userId),
    authoringRights(session.principal.userId, siteId),
    listSites(session.principal.userId),
  ])
  const previewContext = sitePreviewContext(requested.site)
  const previewSiteId = sites.some(candidate => candidate.id === requested.previewSite)
    ? requested.previewSite!
    : siteId

  const categoryNames = [...new Set(library.map(entry => entry.category || 'Other'))].sort((a, b) => a.localeCompare(b))
  const shown = library.filter(
    entry =>
      (!categoryFilter || (entry.category || 'Other') === categoryFilter) &&
      (!source || entry.scope === source) &&
      (!favouritesOnly || entry.is_favourite) &&
      (!search ||
        [entry.name, entry.slug, entry.category].some(value =>
          value?.toLocaleLowerCase().includes(search.toLocaleLowerCase()),
        )),
  )
  const byCategory = new Map<string, typeof library>()
  for (const entry of shown) {
    const name = entry.category || 'Other'
    byCategory.set(name, [...(byCategory.get(name) ?? []), entry])
  }
  const categories = [...byCategory.entries()].sort(([a], [b]) => compareSectionCategories(a, b))

  return (
    <AppShell email={session.email} role={role} groups={navigationFor(site, session.principal)}>
      <main id="main" className="wrap">
        <PageHeader
          crumbs={[
            { label: 'Sites', href: '/' },
            { label: site.name, href: `/sites/${site.id}` },
            { label: 'Sections' },
          ]}
          title="Sections"
          tabs={siteAreaTabs(site.id, 'library', 'sections')}
          sub={
            <>
              <span>
                {library.length} {library.length === 1 ? 'section' : 'sections'}
              </span>
              <span aria-hidden="true">·</span>
              <span>
                {categoryNames.length} {categoryNames.length === 1 ? 'category' : 'categories'}
              </span>
            </>
          }
          lede="The building blocks for this site's pages. Changing a section here never changes a page that already uses it."
          actions={
            rights.site || rights.global ? (
              <Link className="btn navy" href={`/sites/${site.id}/sections/new`}>
                <IconPlus size={15} /> Create a section
              </Link>
            ) : undefined
          }
        />

        {library.length > 0 && (
          <>
            <LibraryFilters
              siteId={site.id}
              search={search}
              category={categoryFilter}
              source={source}
              favourites={favouritesOnly}
              previewSite={previewSiteId}
              previewContext={previewContext}
              categories={categoryNames}
              sites={sites.map(candidate => ({ id: candidate.id, name: candidate.name }))}
            >
              <p className="muted library-count" role="status">
                {shown.length === library.length ? '' : `Showing ${shown.length} of ${library.length} sections.`}
                {(search || categoryFilter || source || favouritesOnly) && (
                  <>
                    {' '}
                    <LibraryResetLink
                      href={`/sites/${site.id}/sections${
                        previewSiteId !== siteId || previewContext !== 'published'
                          ? `?${new URLSearchParams({ ...(previewSiteId !== siteId ? { previewSite: previewSiteId } : {}), ...(previewContext !== 'published' ? { site: previewContext } : {}) })}`
                          : ''
                      }`}
                    >
                      Clear filters
                    </LibraryResetLink>
                  </>
                )}
              </p>
            </LibraryFilters>
          </>
        )}

        {saved && (
          <p className="notice notice-ok" role="status">
            <IconCheck size={16} />
            <span className="notice-body">“{saved}” was saved.</span>
          </p>
        )}

        {library.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon">
              <IconSections size={22} />
            </div>
            <h3>No sections yet</h3>
            <p>
              Sections are the building blocks pages are made of. Create your first one and it becomes available to
              every page on this site.
            </p>
            {(rights.site || rights.global) && (
              <div className="actions">
                <Link className="btn" href={`/sites/${site.id}/sections/new`}>
                  <IconPlus size={15} /> Create a section
                </Link>
              </div>
            )}
          </div>
        ) : shown.length === 0 ? (
          <div className="empty-state">
            <h2>No sections match these filters</h2>
            <p>Try another name, category or source.</p>
            <LibraryResetLink className="btn secondary" href={`/sites/${site.id}/sections`}>
              Show all sections
            </LibraryResetLink>
          </div>
        ) : (
          categories.map(([category, entries]) => (
            <section className="cat" key={category}>
              <div className="cat-head">
                <h2>{category}</h2>
                <span className="cat-count">{entries.length}</span>
              </div>
              <div className={`library-grid ${styles.grid}`}>
                {entries.map(entry => (
                  <SectionLibraryCard
                    className="library-card"
                    key={entry.section_def_id}
                    entry={entry}
                    thumbnail={
                      <Link
                        className="section-card-preview"
                        href={`/sites/${siteId}/sections/${entry.section_def_id}`}
                        aria-label={`Details for ${entry.name}`}
                      >
                        <SectionThumbnail entry={entry} element="span" eager />
                      </Link>
                    }
                    favourite={
                      <SectionFavourite
                        siteId={siteId}
                        definitionId={entry.section_def_id}
                        name={entry.name}
                        initial={entry.is_favourite}
                        compact
                      />
                    }
                    usage={
                      <Link
                        className="section-card-meta"
                        href={`/sites/${siteId}/sections/${entry.section_def_id}/usage`}
                        aria-label={`See pages using ${entry.name}`}
                      >
                        Used on {entry.used_on_pages} {entry.used_on_pages === 1 ? 'page' : 'pages'}
                        {entry.used_on_sites > 1 ? ` across ${entry.used_on_sites} accessible sites` : ''}
                      </Link>
                    }
                    actions={
                      <>
                        <SectionPreviewButton
                          siteId={siteId}
                          definitionId={entry.section_def_id}
                          name={entry.name}
                          themeSiteId={previewSiteId}
                          previewContext={previewContext}
                        />
                        <Link
                          className="btn secondary small"
                          href={`/sites/${siteId}/sections/${entry.section_def_id}`}
                        >
                          Details<span className="sr-only"> {entry.name}</span>
                        </Link>
                      </>
                    }
                  />
                ))}
              </div>
            </section>
          ))
        )}
        {site.status !== 'archived' && (
          <div className={styles.request}>
            <SectionRequestForm siteId={site.id} />
          </div>
        )}
      </main>
    </AppShell>
  )
}
