import { createHash } from 'node:crypto'
import { ContactMessage } from '@cms/schema'
import { normalizeHost } from '@cms/domain'
type Values = Record<string, string>
export function createContactHandler(deps: {
  host: (headers: Headers) => string | null
  submit: (host: string, path: string, message: Values, key: string) => Promise<void>
  feedback: (
    request: Request,
    host: string,
    path: string,
    context: { contactError: string; contactValues: Values },
    status: number,
  ) => Promise<Response>
}) {
  return async (request: Request): Promise<Response> => {
    const host = deps.host(request.headers)
    let origin: string | null = null
    try {
      origin = normalizeHost(new URL(request.headers.get('origin') ?? '').host)
    } catch {}
    if (!host || origin !== host)
      return new Response('This form must be submitted from its own site.', {
        status: 403,
        headers: { 'cache-control': 'no-store' },
      })
    if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/x-www-form-urlencoded'))
      return new Response('Use the contact form.', { status: 415 })
    const reader = request.body?.getReader()
    let size = 0
    const chunks: Uint8Array[] = []
    if (reader)
      while (true) {
        const chunk = await reader.read()
        if (chunk.done) break
        size += chunk.value.length
        if (size > 65536) {
          await reader.cancel()
          return new Response('The message is too long.', { status: 413 })
        }
        chunks.push(chunk.value)
      }
    const input = new URLSearchParams(Buffer.concat(chunks).toString('utf8')),
      path = input.get('page') ?? '/'
    if (!/^\/(?!\/)[^?#\\\x00-\x20]*$/.test(path) || path.length > 2048)
      return new Response('This page address is invalid.', { status: 400 })
    const values = Object.fromEntries(
      ['first_name', 'last_name', 'email', 'phone', 'comments'].map(key => [key, input.get(key) ?? '']),
    )
    const parsed = ContactMessage.safeParse(values)
    if (!parsed.success)
      return deps.feedback(
        request,
        host,
        path,
        { contactError: 'Complete every required field and use a valid email address.', contactValues: values },
        422,
      )
    if (!input.get('website')) {
      const key = createHash('sha256')
        .update(JSON.stringify([host, path, parsed.data, Math.floor(Date.now() / 60000)]))
        .digest('hex')
      try {
        await deps.submit(host, path, parsed.data, key)
      } catch {
        return deps.feedback(
          request,
          host,
          path,
          { contactError: 'Your message could not be saved. Please try again later.', contactValues: parsed.data },
          503,
        )
      }
    }
    return new Response(null, {
      status: 303,
      headers: { location: path + '?contact=sent#contact', 'cache-control': 'no-store' },
    })
  }
}
