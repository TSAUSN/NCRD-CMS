import { request } from 'node:http'
import { createHash } from 'node:crypto'
import { writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { localAssets } from '../google-bootstrap/verification.mjs'
export const hash = bytes => createHash('sha256').update(bytes).digest('hex')
export function get(port, host, path, cookie) {
  return new Promise((resolve, reject) => {
    const req = request(
      { hostname: '127.0.0.1', port, path, headers: { host: host + ':' + port, ...(cookie ? { cookie } : {}) } },
      response => {
        const chunks = []
        response.on('data', chunk => chunks.push(chunk))
        response.on('end', () => {
          if (response.statusCode !== 200)
            return reject(Error('Golden resource did not return HTTP200; private request details omitted.'))
          resolve({ bytes: Buffer.concat(chunks), headers: response.headers })
        })
      },
    )
    req.setTimeout(30000, () => req.destroy(Error('Golden local resource request timed out.')))
    req.on('error', reject)
    req.end()
  })
}
export function artifact(out, manifest, key, bytes) {
  const relative = key.replace(/[^a-zA-Z0-9._/-]/g, '_')
  mkdirSync(join(out, relative, '..'), { recursive: true, mode: 0o700 })
  writeFileSync(join(out, relative), bytes, { mode: 0o600 })
  manifest[key] = { file: relative, bytes: bytes.length, sha256: hash(bytes) }
}
export async function publicPages(t, out, routes, manifest) {
  const assets = new Map()
  for (const route of routes) {
    const host = route.staging_hostname
    if (!host.endsWith('.staging.localhost')) throw Error('Golden fixture must retain local-only site hosts.')
    const { bytes } = await get(t.ports.site, host, route.path)
    artifact(out, manifest, `public/${route.slug}/${hash(route.path)}.html`, bytes)
    for (const url of localAssets(bytes.toString(), `http://${host}:${t.ports.site}${route.path}`))
      assets.set(url, { host, path: new URL(url).pathname + new URL(url).search })
  }
  for (const [url, value] of assets) {
    const { bytes, headers } = await get(t.ports.site, value.host, value.path)
    artifact(out, manifest, `assets/${value.host}/${hash(value.path)}.bin`, bytes)
    if (headers['content-type']?.includes('text/css'))
      for (const match of bytes.toString().matchAll(/url\(\s*['"]?([^)'"\s]+)['"]?\s*\)/g)) {
        const u = new URL(match[1], url)
        if (u.origin === new URL(url).origin) assets.set(u.href, { host: value.host, path: u.pathname + u.search })
      }
    if (assets.size > 10000) throw Error('Unexpected golden asset growth.')
  }
  return assets.size
}
export async function directPreviews(t, out, routes, cookie, manifest) {
  for (const route of routes)
    for (const kind of ['editing', 'visitor']) {
      const path = '/preview/' + route.draft_version_id + (kind === 'visitor' ? '?visit=1' : '')
      const { bytes } = await get(t.ports.admin, '127.0.0.1', path, cookie)
      artifact(out, manifest, `preview/${route.slug}/${route.page_id}-${kind}.html`, bytes)
    }
}
