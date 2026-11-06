import { asUser, configuredMediaStore, uploadSiteDocument } from '@cms/platform'
import { currentSession } from '../../../../../lib/session.ts'
import { createDocumentUploadHandler } from '../../../../../lib/document-upload-handler.ts'
import { createDocumentManagementHandlers } from '../../../../../lib/document-management-handler.ts'
import { listDocuments, organizeDocument } from '../../../../../lib/document-repository.ts'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const handle = createDocumentUploadHandler({
  trustProxyHeaders: process.env['TRUST_PROXY_HEADERS'] === 'true',
  currentSession: async () => {
    const session = await currentSession()
    return session ? { userId: session.principal.userId } : null
  },
  upload: (userId, siteId, bytes, originalName) =>
    asUser({ userId }, async client => {
      const document = await uploadSiteDocument({ client, store: configuredMediaStore(), siteId, bytes, originalName })
      const metadata = (
        await client.query<{ archived: boolean }>('SELECT archived FROM site_document_metadata WHERE asset_id=$1', [
          document.id,
        ])
      ).rows[0]
      return { ...document, archived: metadata?.archived ?? false }
    }),
})

const management = createDocumentManagementHandlers({
  currentSession: async () => {
    const session = await currentSession()
    return session ? { userId: session.principal.userId } : null
  },
  list: listDocuments,
  organize: organizeDocument,
})

export async function GET(request: Request, context: { params: Promise<{ siteId: string }> }): Promise<Response> {
  return management.GET(request, (await context.params).siteId)
}
export async function PATCH(request: Request, context: { params: Promise<{ siteId: string }> }): Promise<Response> {
  return management.PATCH(request, (await context.params).siteId)
}

export async function POST(request: Request, context: { params: Promise<{ siteId: string }> }): Promise<Response> {
  return handle(request, (await context.params).siteId)
}
