import { asUser } from '@cms/platform'
import { currentSession } from '../../../../../lib/session.ts'
import { readCollectionBindingOptions } from '../../../../../lib/collection-binding-options.ts'

export const dynamic = 'force-dynamic'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const headers = { 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff' }
export async function GET(request: Request, context: { params: Promise<{ siteId: string }> }) {
  const session = await currentSession(),
    { siteId } = await context.params
  const params = new URL(request.url).searchParams,
    definitionId = params.get('definition') ?? ''
  const version = Number(params.get('version')),
    fieldId = params.get('field') ?? ''
  const hidden = () => Response.json({ error: 'Collection choices were not found.' }, { status: 404, headers })
  if (
    !session ||
    !UUID.test(siteId) ||
    !UUID.test(definitionId) ||
    !Number.isSafeInteger(version) ||
    version < 1 ||
    !/^[a-zA-Z][a-zA-Z0-9_-]{0,79}$/.test(fieldId)
  )
    return hidden()
  const options = await asUser({ userId: session.principal.userId }, client =>
    readCollectionBindingOptions(client, siteId, definitionId, version, fieldId),
  )
  return options === null ? hidden() : Response.json({ options }, { headers })
}
