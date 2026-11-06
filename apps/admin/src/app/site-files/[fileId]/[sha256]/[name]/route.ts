import { asUser, configuredMediaStore, deliverReviewedSiteFile, type ResolvedSiteFile } from '@cms/platform'
import { currentSession } from '../../../../../lib/session.ts'
export const dynamic = 'force-dynamic'
export async function GET(
  _request: Request,
  context: { params: Promise<{ fileId: string; sha256: string; name: string }> },
): Promise<Response> {
  const { fileId, sha256, name } = await context.params
  const session = await currentSession()
  return deliverReviewedSiteFile({
    fileId,
    sha256,
    name,
    store: configuredMediaStore(),
    visibility: 'admin',
    resolve: async () =>
      session
        ? asUser(
            { userId: session.principal.userId },
            async client =>
              (await client.query<ResolvedSiteFile>('SELECT * FROM app.resolve_site_file($1)', [fileId])).rows[0] ??
              null,
          )
        : null,
  })
}
