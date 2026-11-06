import { asUser, configuredMediaStore, deliverSiteAsset, type ResolvedSiteAsset } from '@cms/platform'
import { currentSession } from '../../../lib/session.ts'
export const dynamic = 'force-dynamic'
export async function GET(_request: Request, context: { params: Promise<{ assetId: string }> }): Promise<Response> {
  const { assetId } = await context.params
  const session = await currentSession()
  return deliverSiteAsset({
    assetId,
    store: configuredMediaStore(),
    visibility: 'admin',
    resolve: async () =>
      session
        ? asUser(
            { userId: session.principal.userId },
            async client =>
              (await client.query<ResolvedSiteAsset>('SELECT * FROM app.resolve_site_asset($1)', [assetId])).rows[0] ??
              null,
          )
        : null,
  })
}
