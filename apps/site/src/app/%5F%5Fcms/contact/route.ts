import { asPublic } from '@cms/platform'
import { createContactHandler } from '../../../lib/contact-handler.ts'
import { neutralNotFound, resolveRequestHost, resolveRoute } from '../../../lib/routing.ts'
import { publicPageResponse } from '../../../lib/public-page.ts'
export const dynamic = 'force-dynamic'
export const POST = createContactHandler({
  host: resolveRequestHost,
  submit: async (host, path, message, key) => {
    await asPublic(client =>
      client.query('SELECT public_api.submit_contact($1,$2,$3,$4)', [host, path, JSON.stringify(message), key]),
    )
  },
  feedback: async (request, host, path, context, status) => {
    const route = await resolveRoute(host, path)
    return route ? publicPageResponse(request, route, context, status) : neutralNotFound()
  },
})
