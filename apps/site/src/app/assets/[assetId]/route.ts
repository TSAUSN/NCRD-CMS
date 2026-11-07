import { SiteNativeTarget } from '@cms/schema'
import { asPublic, configuredMediaStore, deliverSiteAsset, type ResolvedSiteAsset } from '@cms/platform'
import { resolveHost, resolveRequestHost } from '../../../lib/routing.ts'
export const dynamic = 'force-dynamic'
export async function GET(request: Request, context: { params: Promise<{ assetId: string }> }): Promise<Response> {
  const { assetId } = await context.params
  const host = resolveRequestHost(request.headers)
  const raw = host
    ? await asPublic(
        async client =>
          (
            await client.query<{ target: unknown }>('SELECT public_api.resolve_site_native_path($1,$2) AS target', [
              host,
              `/assets/${assetId}`,
            ])
          ).rows[0]?.target,
      )
    : null
  const mapping = SiteNativeTarget.safeParse(raw)
  if (raw != null && (!mapping.success || mapping.data.kind !== 'asset'))
    return new Response(null, {
      status: 404,
      headers: { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' },
    })
  const target = mapping.success && mapping.data.kind === 'asset' ? mapping.data.assetId : assetId
  return deliverSiteAsset({
    assetId: target,
    store: configuredMediaStore(),
    visibility: 'public',
    request,
    resolve: async () =>
      host && (await resolveHost(host))
        ? asPublic(
            async client =>
              (
                await client.query<ResolvedSiteAsset>('SELECT * FROM public_api.resolve_site_asset($1,$2)', [
                  host,
                  target,
                ])
              ).rows[0] ?? null,
          )
        : null,
  })
}
