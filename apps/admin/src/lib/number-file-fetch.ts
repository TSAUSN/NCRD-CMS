import { lookup } from 'node:dns/promises'
import { request } from 'node:https'
import { numberFileUrl } from './data-value-import.ts'
const LIMIT = 1048576
export function publicNumberAddress(address: string): boolean {
  const parts = address.split('.')
  if (parts.length !== 4 || parts.some(part => !/^\d{1,3}$/.test(part) || Number(part) > 255)) return false
  const [a, b, c] = parts.map(Number) as [number, number, number, number]
  return (
    a > 0 &&
    a < 224 &&
    a !== 10 &&
    a !== 127 &&
    !(a === 100 && b >= 64 && b <= 127) &&
    !(a === 169 && b === 254) &&
    !(a === 172 && b >= 16 && b <= 31) &&
    !(a === 192 && (b === 168 || b === 0 || (b === 88 && c === 99))) &&
    !(a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) &&
    !(a === 203 && b === 0 && c === 113)
  )
}
type ReadResult = { status: number; location?: string; contentType: string; body: string }
export type NumberFileTransport = {
  resolve: (host: string) => Promise<string[]>
  read: (url: URL, address: string) => Promise<ReadResult>
}
const transport: NumberFileTransport = {
  resolve: async host => {
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      return await Promise.race([
        lookup(host, { all: true, family: 4 }).then(rows => rows.map(row => row.address)),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error('The file address took too long to resolve. Choose a downloaded file instead.')),
            3000,
          )
        }),
      ])
    } finally {
      clearTimeout(timer)
    }
  },
  read: (url, address) =>
    new Promise((resolve, reject) => {
      const req = request(
        url,
        {
          method: 'GET',
          family: 4,
          agent: false,
          maxHeaderSize: 8192,
          headers: { Accept: 'application/json,text/csv,text/plain;q=0.8' },
          lookup: (_host, _options, done) => done(null, address, 4),
        },
        response => {
          const status = response.statusCode ?? 0
          if (status >= 300 && status < 400) {
            response.destroy()
            resolve({ status, location: response.headers.location, contentType: '', body: '' })
            return
          }
          const chunks: Buffer[] = []
          let size = 0
          response.on('data', (chunk: Buffer) => {
            size += chunk.length
            if (size > LIMIT) {
              response.destroy()
              reject(new Error('Choose a file smaller than 1 MB.'))
            } else chunks.push(chunk)
          })
          response.on('error', reject)
          response.on('end', () =>
            resolve({
              status,
              contentType: String(response.headers['content-type'] ?? ''),
              body: Buffer.concat(chunks).toString('utf8'),
            }),
          )
        },
      )
      const deadline = setTimeout(
        () => req.destroy(new Error('The file took too long to open. Choose a downloaded file instead.')),
        8000,
      )
      req.once('close', () => clearTimeout(deadline))
      req.on('error', reject)
      req.end()
    }),
}
/** Resolve and pin public IPv4 addresses on every hop. Never forwards browser cookies or credentials. */
export async function readNumberFile(address: string, io: NumberFileTransport = transport): Promise<string> {
  let url = numberFileUrl(address)
  for (let hop = 0; hop < 3; hop++) {
    if (url.port && url.port !== '443') throw new Error('Use a public https file on its standard port.')
    const addresses = await io.resolve(url.hostname)
    if (!addresses.length || !addresses.every(publicNumberAddress))
      throw new Error('Use a public file address. Internal network addresses are not available here.')
    const result = await io.read(url, addresses[0]!)
    if (result.status >= 300 && result.status < 400) {
      if (!result.location || hop === 2)
        throw new Error('The file has too many redirects. Choose a downloaded file instead.')
      url = numberFileUrl(new URL(result.location, url).href)
      continue
    }
    if (result.status !== 200)
      throw new Error('The file could not be opened. Check its public address or choose a downloaded file.')
    if (!/^(application\/(json|octet-stream)|text\/(csv|plain))(?:;|$)/i.test(result.contentType))
      throw new Error('Choose a JSON or CSV file, not a web page.')
    if (Buffer.byteLength(result.body) > LIMIT) throw new Error('Choose a file smaller than 1 MB.')
    return result.body
  }
  throw new Error('Choose a downloaded file instead.')
}
