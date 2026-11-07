import { measurePerfRender } from '@cms/platform/perf-trace'
import { SiteFileProjection } from '@cms/schema'
import { PREVIEW_FONT_STYLES, PREVIEW_FONT_FILES, PREVIEW_FONT_IMAGES } from '../../../lib/preview-font-policy.ts'
import { storyWidgetQuery } from '@cms/renderer'
// The editing canvas. Same-origin on purpose: the admin renders
// the draft with its own renderer instead of embedding the public deployment,
// which is what makes click-to-edit reachable by ordinary browser automation
// in M2 — v1's cross-origin canvas was untestable.
//
// It is also a draft surface, so it is behind the session and never cacheable.
import {
  scriptlessPreviewCsp,
  previewStyleSource,
  previewRequestOrigin,
  SCRIPTLESS_RENDER_OPTIONS,
} from '../../../lib/scriptless-preview.ts'
import { notFound } from 'next/navigation'
import { previewScriptHash, renderPage } from '@cms/renderer'
import { currentSession } from '../../../lib/session.ts'
import { asUser } from '@cms/platform'
import { buildPreview } from '../../../lib/queries.ts'
import { sectionInsertionPreview } from '../../../lib/section-insertion-preview.ts'

export const dynamic = 'force-dynamic'

export async function GET(request: Request, context: { params: Promise<{ versionId: string }> }): Promise<Response> {
  const session = await currentSession()
  if (!session) notFound()
  const { versionId } = await context.params
  const params = new URL(request.url).searchParams
  const requestedReadOnly = params.get('readonly') === '1'
  const visitorPreview = params.get('visit') === '1'

  // RLS decides whether this version belongs to a site the session can see;
  // a version on another tenant simply is not here.
  const version = await asUser(
    { userId: session.principal.userId },
    async client =>
      (
        await client.query<{
          site_id: string
          site_status: string
          initial_release_required: boolean
          original_design: boolean
        }>(
          "SELECT v.site_id,s.status AS site_status,s.initial_release_required,EXISTS(SELECT 1 FROM site_file_heads h JOIN site_file_versions f ON f.id=h.draft_version_id WHERE h.site_id=s.id AND f.bundle ? 'original') AS original_design FROM page_versions v JOIN sites s ON s.id=v.site_id WHERE v.id = $1",
          [versionId],
        )
      ).rows[0] ?? null,
  )
  if (!version) notFound()
  const readOnly = requestedReadOnly || visitorPreview || version.site_status === 'archived'
  const origin = previewRequestOrigin(request)

  // Ordinary history always uses published appearance, even when a newer
  // draft exists. The archived-page screen explicitly requests saved branding
  // only for a private site whose first release never happened.
  const siteDrafts =
    visitorPreview && version.site_status !== 'archived'
      ? params.get('site') === 'draft'
      : readOnly
        ? version.site_status === 'archived' && version.initial_release_required && params.get('site') === 'draft'
        : params.has('site')
          ? params.get('site') === 'draft'
          : undefined
  const preview = await buildPreview(
    session.principal.userId,
    versionId,
    version.site_id,
    siteDrafts,
    !readOnly || (visitorPreview && params.get('lists') === 'draft'),
  )
  if (!preview) notFound()
  // Only review/History reads use the submitted Story evidence. Editing and
  // explicit draft visitor previews continue to show the current working Story.
  if (requestedReadOnly) {
    const evidence = await asUser(
      { userId: session.principal.userId },
      async client =>
        (
          await client.query<{ manifest: typeof preview.manifest | null }>(
            'SELECT app.story_review_manifest($1) AS manifest',
            [versionId],
          )
        ).rows[0]?.manifest,
    )
    if (evidence) preview.manifest = evidence
  }

  if (params.has('insert')) {
    if (readOnly) notFound()
    const manifest = await asUser({ userId: session.principal.userId }, client =>
      sectionInsertionPreview(
        client,
        preview.manifest,
        version.site_id,
        params.get('insert') ?? '',
        Number(params.get('definitionVersion')),
        Number(params.get('at')),
      ),
    )
    if (!manifest) notFound()
    preview.manifest = manifest
  }

  // Home deliberately labels designs requiring reviewed site files rather than
  // fetching their authored aliases from Admin's unrelated root address.
  const files = SiteFileProjection.safeParse(preview.shell.site_files)
  if (
    requestedReadOnly &&
    params.get('thumbnail') === '1' &&
    (version.original_design || (files.success && files.data.bundle.files.length))
  ) {
    const label =
      version.original_design || (files.success && files.data.bundle.original)
        ? 'Original design'
        : 'Reviewed site files'
    return new Response(
      `<!doctype html><html><head><meta property="og:type" content="website"></head><body data-cms-preview-placeholder="site-files">${label}</body></html>`,
      {
        headers: {
          'content-type': 'text/html; charset=utf-8',
          'cache-control': 'no-store, private',
          'x-robots-tag': 'noindex, nofollow',
          'content-security-policy': scriptlessPreviewCsp(origin),
          'x-content-type-options': 'nosniff',
        },
      },
    )
  }

  const storyWidgets = {
    path: new URL(request.url).pathname,
    query: storyWidgetQuery(params),
    fixedQuery: Object.fromEntries(
      ['visit', 'site', 'lists', 'readonly', 'hidden'].flatMap(key =>
        params.has(key) ? [[key, params.get(key)!]] : [],
      ),
    ),
  }

  const { html } = measurePerfRender(() =>
    renderPage({
      manifest: preview.manifest,
      shell: preview.shell,
      navigationPaths: preview.navigationPaths,
      // A preview is never a public surface, so it never asks to be indexed.
      isStaging: true,
      // History is evidence, not an editor canvas. It uses the canonical render
      // without selection wrappers or the message bridge, while the ordinary
      // preview keeps the instrumentation click-to-edit needs.
      options:
        visitorPreview && version.site_status !== 'archived'
          ? {
              ...SCRIPTLESS_RENDER_OPTIONS,
              visitorPreview: true,
              storyWidgets,
              showHiddenSections: params.get('hidden') === '1',
            }
          : readOnly
            ? { ...SCRIPTLESS_RENDER_OPTIONS, storyWidgets }
            : { preview: true, showHiddenSections: params.get('hidden') === '1' },
    }),
  )

  return new Response(html, {
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store, private',
      'x-robots-tag': 'noindex, nofollow',
      // The canvas is embedded by the admin and nobody else. The one inline
      // script the editor needs is allowed by hash, so no other inline script
      // can run in this document — including one a stored value smuggled in.
      'content-security-policy': readOnly
        ? scriptlessPreviewCsp(origin)
        : [
            "default-src 'none'",
            `script-src '${previewScriptHash()}'`,
            `img-src 'self' data: ${PREVIEW_FONT_IMAGES}`,
            `style-src 'unsafe-inline' ${PREVIEW_FONT_STYLES} ${previewStyleSource(origin)}`,
            `font-src 'self' ${PREVIEW_FONT_FILES}`,
            "frame-ancestors 'self'",
            "base-uri 'none'",
            "form-action 'none'",
          ].join('; '),
      'x-content-type-options': 'nosniff',
    },
  })
}
