import { configuredMediaStore } from '@cms/platform'
import { createSiteExportHandler } from '../../../../../lib/site-portability-handler.ts'
import { portabilitySession } from '../../../../../lib/site-portability-session.ts'
export const dynamic = 'force-dynamic'
const handle = createSiteExportHandler({ session: portabilitySession, media: () => configuredMediaStore() })
export async function GET(request: Request, context: { params: Promise<{ siteId: string }> }) {
  return handle(request, (await context.params).siteId)
}
