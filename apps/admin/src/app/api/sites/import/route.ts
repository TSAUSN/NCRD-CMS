import { configuredMediaStore } from '@cms/platform'
import { createSiteImportHandler } from '../../../../lib/site-portability-handler.ts'
import { portabilitySession } from '../../../../lib/site-portability-session.ts'
export const dynamic = 'force-dynamic'
export const POST = createSiteImportHandler({ session: portabilitySession, media: () => configuredMediaStore() })
