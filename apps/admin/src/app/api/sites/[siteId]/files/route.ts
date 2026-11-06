import { asUser, configuredMediaStore, registerReviewedSiteFile } from '@cms/platform'
import { currentSession } from '../../../../../lib/session.ts'
import { createSiteFileUploadHandler } from '../../../../../lib/site-file-upload-handler.ts'
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
const handle = createSiteFileUploadHandler({
  trustProxyHeaders: process.env['TRUST_PROXY_HEADERS'] === 'true',
  currentSession: async () => {
    const session = await currentSession()
    return session ? { userId: session.principal.userId, isSuperAdmin: session.principal.isSuperAdmin } : null
  },
  upload: (userId, siteId, kind, name, source, bytes) =>
    asUser({ userId }, client =>
      registerReviewedSiteFile({ client, store: configuredMediaStore(), siteId, kind, name, source, bytes }),
    ),
})
export async function POST(request: Request, context: { params: Promise<{ siteId: string }> }) {
  return handle(request, (await context.params).siteId)
}
