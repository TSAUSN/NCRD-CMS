import {
  chapterAllowsSection,
  isReviewedChapterComposition,
  echelonNationalAllowsSection,
  isReviewedNationalComposition,
} from '@cms/schema'
import { notFound } from 'next/navigation'
import { canvasSiteHostname } from '../../../lib/canvas-frame-policy.ts'
import { currentSession } from '../../../lib/session.ts'
import { publicSiteOrigin } from '../../../lib/public-site-url.ts'
import { listPageSectionVersions } from '../../../lib/queries.ts'
import {
  getDraft,
  getPage,
  getSite,
  getPublishedThemeColors,
  getDraftThemeColors,
  isSuperAdmin,
  listLinkTargets,
  listMediaAssets,
  listSectionLibrary,
  getSiteImagePreviews,
} from '../../../lib/queries.ts'
import { runReadiness } from '../../actions/page-publish.ts'
import { listPageReviewSubmissions } from '../../../lib/review-queries.ts'
import { PageEditor } from './editor.tsx'
import { ArchivedPagePreview } from './archived-page-preview.tsx'
import { roleLabel } from '../../../lib/queries.ts'
import { sitePreviewContext } from '../../../lib/preview-context.ts'
import { pageRoleOf, type EditorMetadata } from '@cms/domain'

export const dynamic = 'force-dynamic'

export default async function EditPage({
  params,
  searchParams,
}: {
  params: Promise<{ pageId: string }>
  searchParams: Promise<{ section?: string; site?: string; field?: string; settings?: string; focus?: string }>
}) {
  // The session is resolved before anything user-specific renders, so there is
  // no auth flash and no client-side race.
  const session = await currentSession()
  if (!session) notFound()
  const { pageId } = await params
  const requested = await searchParams

  const page = await getPage(session.principal.userId, pageId)
  if (!page) notFound()
  const site = await getSite(session.principal.userId, page.site_id)
  if (!site) notFound()
  if (site.status === 'archived')
    return (
      <ArchivedPagePreview
        pageId={page.id}
        title={page.title}
        versionId={page.draft_version_id ?? page.published_version_id}
        access={session.principal}
        site={site}
        email={session.email}
        role={await roleLabel(session.principal.userId)}
      />
    )

  const [
    draft,
    library,
    linkTargets,
    mediaAssets,
    readiness,
    superAdmin,
    reviews,
    pinnedSections,
    themeColors,
    draftThemeColors,
    liveDraft,
    canvasHostname,
    imagePreviews,
    publishedImagePreviews,
  ] = await Promise.all([
    page.draft_version_id ? getDraft(session.principal.userId, page.draft_version_id) : null,
    listSectionLibrary(session.principal.userId, site.id),
    listLinkTargets(session.principal.userId, site.id),
    listMediaAssets(session.principal.userId, site.id),
    page.draft_version_id && !site.initial_release_required ? runReadiness(page.draft_version_id) : null,
    isSuperAdmin(session.principal.userId),
    listPageReviewSubmissions(session.principal.userId, page.id),
    listPageSectionVersions(session.principal.userId, page.id),
    getPublishedThemeColors(session.principal.userId, site.id),
    getDraftThemeColors(session.principal.userId, site.id),
    page.published_version_id ? getDraft(session.principal.userId, page.published_version_id) : null,
    canvasSiteHostname(session.principal.userId, page.id, 'page'),
    getSiteImagePreviews(session.principal.userId, site.id),
    getSiteImagePreviews(session.principal.userId, site.id, 'published'),
  ])
  const chapterPage =
    page.is_chapter_page === true || (Array.isArray(draft?.content) && isReviewedChapterComposition(draft.content))
  const nationalPage = Array.isArray(draft?.content) && isReviewedNationalComposition(draft.content)
  const openReview = reviews.find(review => review.status === 'open') ?? null
  const latestRejection = reviews.find(review => review.status === 'rejected') ?? null
  const siteRole = session.principal.memberships.get(site.id)
  const pageRole = pageRoleOf(session.principal, site.id, page.id)
  const scopedOnly = !session.principal.isSuperAdmin && !siteRole
  const canPublish = session.principal.isSuperAdmin || pageRole === 'editor' || pageRole === 'site_admin'
  const liveOrigin =
    site.status === 'archived' ? null : publicSiteOrigin(site.primary_hostname || site.staging_hostname)

  return (
    <PageEditor
      key={`${session.principal.userId}:${page.id}`}
      userId={session.principal.userId}
      isolatedCanvasOrigin={canvasHostname ? publicSiteOrigin(canvasHostname) : null}
      visitorPreviewOrigin={site.status === 'archived' ? null : publicSiteOrigin(site.staging_hostname)}
      pageId={page.id}
      siteId={site.id}
      siteName={site.name}
      sitePublicOrigin={liveOrigin}
      originalDesign={site.original_design === true}
      pageScoped={scopedOnly}
      chapterPage={chapterPage}
      lockChapterShared={pageRole === 'contributor'}
      siteHref={`/sites/${site.id}`}
      liveHref={liveOrigin && page.live_path ? `${liveOrigin}${page.live_path}` : null}
      // What the canvas frame prints on its address bar. The site's own hostname
      // and this page's route, with no port and no scheme: it is there to say
      // "this is the page at this address", not to be clicked.
      previewUrl={`${site.staging_hostname ?? site.slug}${page.slug ? `/${page.slug}` : '/'}`}
      metadataContext={{
        verifiedHost: site.primary_hostname,
        servingBase: site.staging_hostname ? `https://${site.staging_hostname}` : undefined,
        path: page.slug ? `/${page.slug}` : '/',
      }}
      title={page.title}
      revision={Number(page.revision)}
      liveSections={(liveDraft?.content as never) ?? []}
      publishedVersionId={page.published_version_id}
      previewVersionId={page.draft_version_id}
      document={{
        sections: (draft?.content as never) ?? [],
        meta: (draft?.meta ?? {}) as EditorMetadata,
      }}
      library={library.filter(
        entry =>
          (entry.placement ?? 'page') === 'page' &&
          (!chapterPage || chapterAllowsSection(entry)) &&
          (!nationalPage || echelonNationalAllowsSection(entry)),
      )}
      pinnedSections={pinnedSections}
      linkTargets={linkTargets}
      mediaAssets={mediaAssets}
      imagePreviews={imagePreviews}
      publishedImagePreviews={publishedImagePreviews}
      themeColors={themeColors}
      draftThemeColors={draftThemeColors}
      trustedCodeApproved={Boolean(draft?.trusted_code_approved_by)}
      canApproveTrustedCode={superAdmin}
      canAdvanced={superAdmin || siteRole === 'site_admin'}
      canPublish={canPublish}
      initialReleaseRequired={site.initial_release_required ?? false}
      openReview={
        openReview && {
          id: openReview.id,
          versionId: openReview.versionId,
        }
      }
      latestReviewFeedback={
        latestRejection && latestRejection.versionId === page.draft_version_id ? latestRejection.decisionNote : null
      }
      initialReadiness={readiness}
      // With no page live yet there is no visitor appearance to show: an older
      // or imported site's published frame is a creation-time placeholder, so
      // open on the site's saved header, footer, navigation and design instead.
      initialSitePreview={
        scopedOnly
          ? 'published'
          : requested.site === undefined && (site.initial_release_required || !site.has_published_pages)
            ? 'draft'
            : sitePreviewContext(requested.site)
      }
      initialField={requested.field}
      initialSettings={requested.settings === '1'}
      initialFocus={requested.focus}
      initialSection={
        requested.section &&
        /^\d+$/.test(requested.section) &&
        Array.isArray(draft?.content) &&
        Number(requested.section) < draft.content.length
          ? Number(requested.section)
          : null
      }
    />
  )
}
