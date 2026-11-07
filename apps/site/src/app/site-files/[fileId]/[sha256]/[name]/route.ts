import { serveReviewedPath } from '../../../../../lib/reviewed-path.ts'
import { asPublic, configuredMediaStore, deliverReviewedSiteFile, type ResolvedSiteFile } from '@cms/platform'
import { resolveHost, resolveRequestHost } from '../../../../../lib/routing.ts'
export const dynamic = 'force-dynamic'
export async function GET(
  request: Request,
  context: { params: Promise<{ fileId: string; sha256: string; name: string }> },
): Promise<Response> {
  const { fileId, sha256, name } = await context.params
  const host = resolveRequestHost(request.headers)
  if (host) {
    const mapped = await serveReviewedPath(request, host, new URL(request.url).pathname)
    if (mapped) return mapped
  }
  return deliverReviewedSiteFile({
    fileId,
    sha256,
    name,
    store: configuredMediaStore(),
    visibility: 'public',
    request,
    resolve: async () =>
      host && (await resolveHost(host))
        ? asPublic(
            async client =>
              (
                await client.query<ResolvedSiteFile>('SELECT * FROM public_api.resolve_site_file($1,$2)', [
                  host,
                  fileId,
                ])
              ).rows[0] ?? null,
          )
        : null,
  })
}
