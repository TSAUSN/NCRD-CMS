import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { localBrandFont } from '@cms/renderer'
import { normalizeHost } from '@cms/domain'
export async function serveLocalBrandFont(
  request: Request,
  file: string,
  options: { local: boolean; publicHosting?: boolean; read: (name: string) => Promise<Uint8Array> },
): Promise<Response> {
  const host = normalizeHost(request.headers.get('host') ?? '')
  const font = localBrandFont(file)
  const missing = () => new Response('Not found', { status: 404, headers: { 'cache-control': 'no-store' } })
  if (
    !host ||
    !font ||
    !(
      options.publicHosting === true ||
      (options.local && (host === 'localhost' || host === '127.0.0.1' || host.endsWith('.localhost')))
    )
  )
    return missing()
  let data: Uint8Array
  try {
    data = await options.read(font.source)
  } catch {
    return missing()
  }
  if (data.length !== font.bytes || createHash('sha256').update(data).digest('hex') !== font.sha256) return missing()
  return new Response(request.method === 'HEAD' ? null : new Uint8Array(data), {
    headers: {
      'content-type': 'font/woff2',
      'x-content-type-options': 'nosniff',
      'cache-control': 'private, max-age=31536000, immutable',
      etag: '"' + font.sha256 + '"',
    },
  })
}

/** Both Next apps start from their package directory; root invocation is supported too. */
export async function readLocalBrandFont(name: string): Promise<Uint8Array> {
  try {
    return await readFile(resolve(process.cwd(), 'packages/platform/src/assets/creato-display', name))
  } catch {
    return readFile(resolve(process.cwd(), '../../packages/platform/src/assets/creato-display', name))
  }
}
