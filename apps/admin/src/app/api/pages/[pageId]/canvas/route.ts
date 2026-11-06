import { currentSession } from '../../../../../lib/session.ts'
import { createCanvasTicketHandler } from '../../../../../lib/canvas-ticket-handler.ts'
import { openCanvasTicket, renewCanvasTicket } from '../../../../../lib/canvas-tickets.ts'
export const dynamic = 'force-dynamic'
const handle = createCanvasTicketHandler({
  trustProxyHeaders: process.env['TRUST_PROXY_HEADERS'] === 'true',
  session: async () => {
    const session = await currentSession()
    return session ? { userId: session.principal.userId } : null
  },
  open: openCanvasTicket,
  renew: renewCanvasTicket,
})
export async function POST(request: Request, context: { params: Promise<{ pageId: string }> }): Promise<Response> {
  return handle(request, (await context.params).pageId)
}
