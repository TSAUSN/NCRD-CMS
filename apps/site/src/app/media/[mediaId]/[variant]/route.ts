import { configuredMediaStore } from '@cms/platform'
import { createPublicMediaGetHandler } from '../../../../lib/media-delivery-handler.ts'
import { createPostgresPublicMediaDeliveryRepository } from '../../../../lib/media-delivery-repository.ts'
import { resolveHost, resolveRequestHost } from '../../../../lib/routing.ts'

export const dynamic = 'force-dynamic'

const handle = createPublicMediaGetHandler({
  resolveSite: async headers => {
    const host = resolveRequestHost(headers)
    if (!host) return null
    const site = await resolveHost(host)
    return site ? { host, siteId: site.siteId } : null
  },
  repository: createPostgresPublicMediaDeliveryRepository(),
  media: configuredMediaStore(),
})

export async function GET(
  request: Request,
  context: { params: Promise<{ mediaId: string; variant: string }> },
): Promise<Response> {
  const { mediaId, variant } = await context.params
  return handle(request, mediaId, variant)
}
