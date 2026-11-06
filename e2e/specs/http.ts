import { E2E_PORTS } from '../test-ports.ts'
// A raw HTTP client for the public-contract specs.
//
// Node's `fetch` treats `Host` as a forbidden header and silently drops it, so
// a request meant for one tenant arrives claiming the loopback address — which
// is a 404 for the *wrong reason* and would have made these specs pass while
// proving nothing. Writing the request line by hand also lets a spec send a
// deliberately malformed Host, which no well-behaved client library will do.
import { connect } from 'node:net'

export type RawResponse = {
  status: number
  headers: Record<string, string>
  body: string
}

export function rawRequest(options: {
  host: string
  path: string
  port?: number
  method?: string
  extraHeaders?: Record<string, string>
}): Promise<RawResponse> {
  const port = options.port ?? E2E_PORTS.site
  const method = options.method ?? 'GET'

  return new Promise((resolve, reject) => {
    const socket = connect({ host: '127.0.0.1', port })
    const chunks: Buffer[] = []

    socket.setTimeout(15_000, () => {
      socket.destroy()
      reject(new Error(`timed out requesting ${options.path} as ${options.host}`))
    })
    socket.on('error', reject)
    socket.on('data', (chunk: Buffer) => chunks.push(chunk))
    socket.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8')
      const split = raw.indexOf('\r\n\r\n')
      const head = raw.slice(0, split === -1 ? raw.length : split)
      const rest = split === -1 ? '' : raw.slice(split + 4)

      const lines = head.split('\r\n')
      const status = Number(lines[0]?.split(' ')[1] ?? 0)
      const headers: Record<string, string> = {}
      for (const line of lines.slice(1)) {
        const at = line.indexOf(':')
        if (at > 0) headers[line.slice(0, at).trim().toLowerCase()] = line.slice(at + 1).trim()
      }

      resolve({
        status,
        headers,
        body: headers['transfer-encoding'] === 'chunked' ? dechunk(rest) : rest,
      })
    })

    const extra = Object.entries(options.extraHeaders ?? {})
      .map(([key, value]) => `${key}: ${value}\r\n`)
      .join('')

    socket.write(
      `${method} ${options.path} HTTP/1.1\r\n` + `Host: ${options.host}\r\n` + extra + 'Connection: close\r\n' + '\r\n',
    )
  })
}

function dechunk(body: string): string {
  let out = ''
  let cursor = 0
  while (cursor < body.length) {
    const lineEnd = body.indexOf('\r\n', cursor)
    if (lineEnd === -1) break
    const size = parseInt(body.slice(cursor, lineEnd).trim(), 16)
    if (!Number.isFinite(size) || size === 0) break
    out += body.slice(lineEnd + 2, lineEnd + 2 + size)
    cursor = lineEnd + 2 + size + 2
  }
  return out
}
