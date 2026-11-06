import 'server-only'
import { asPublic, configuredMediaStore, deliverReviewedSiteFileAtPath, type ResolvedSiteFile } from '@cms/platform'
import { SiteFilePath } from '@cms/schema'
/** Only exact currently approved own-site mappings are considered here. A miss
 * leaves page routing unchanged, including neutral unknown-host behavior. */
export async function serveReviewedPath(request: Request, host: string, path: string): Promise<Response | null> {
  if (!SiteFilePath.safeParse(path).success) return null
  const file = await asPublic(
    async client =>
      (await client.query<ResolvedSiteFile>('SELECT * FROM public_api.resolve_site_file_path($1,$2)', [host, path]))
        .rows[0] ?? null,
  )
  if (!file) return null
  const response = await deliverReviewedSiteFileAtPath({
    path,
    store: configuredMediaStore(),
    visibility: 'public',
    resolve: async () => file,
  })
  return request.method === 'HEAD'
    ? new Response(null, { status: response.status, headers: response.headers })
    : response
}
