import { DomainError } from '@cms/domain'
import { executeLeasedRelease } from '../../../../lib/scheduled-release.ts'

export const dynamic = 'force-dynamic'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export async function POST(request: Request): Promise<Response> {
  // A tiny bounded body, no redirects, query capabilities, cookies or log data.
  if (request.headers.get('content-type')?.split(';')[0]?.trim() !== 'application/json')
    return new Response(null, { status: 415 })
  const reader = request.body?.getReader()
  if (!reader) return new Response(null, { status: 400 })
  let source = ''
  let bytes = 0
  try {
    const decoder = new TextDecoder()
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      bytes += value.byteLength
      if (bytes > 256) {
        await reader.cancel()
        return new Response(null, { status: 413 })
      }
      source += decoder.decode(value, { stream: true })
    }
    const body: unknown = JSON.parse(source)
    if (!body || typeof body !== 'object' || Array.isArray(body)) return new Response(null, { status: 400 })
    const { id, lease } = body as Record<string, unknown>
    if (
      Object.keys(body).length !== 2 ||
      typeof id !== 'string' ||
      typeof lease !== 'string' ||
      !UUID.test(id) ||
      !UUID.test(lease)
    )
      return new Response(null, { status: 400 })
    await executeLeasedRelease(id, lease)
    return Response.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    if (error instanceof SyntaxError) return new Response(null, { status: 400 })
    if (error instanceof DomainError) {
      return Response.json(
        { ok: false, permanent: true, message: error.message },
        { status: 409, headers: { 'Cache-Control': 'no-store' } },
      )
    }
    return Response.json(
      { ok: false, permanent: false, message: 'The scheduled release could not be confirmed.' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    )
  } finally {
    reader.releaseLock()
  }
}
