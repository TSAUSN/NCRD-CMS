import { request } from 'node:http'
import { createHash } from 'node:crypto'
import { writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { localAssets } from '../google-bootstrap/verification.mjs'
export const hash = bytes => createHash('sha256').update(bytes).digest('hex')
export function get(port, host, path, cookie, { method = 'GET', status = 200, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const req = request(
      {
        hostname: '127.0.0.1',
        port,
        path,
        method,
        headers: { ...headers, host: host + ':' + port, ...(cookie ? { cookie } : {}) },
      },
      response => {
        const chunks = []
        response.on('data', chunk => chunks.push(chunk))
        response.on('end', () => {
          if (response.statusCode !== status)
            return reject(
              Error(`Expected HTTP ${status}; got ${response.statusCode}. Private request details omitted.`),
            )
          resolve({ bytes: Buffer.concat(chunks), headers: response.headers, status: response.statusCode })
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
const contractHeaders = ['cache-control', 'etag', 'content-security-policy', 'vary', 'location']

function saveResponse(out, manifest, key, response) {
  artifact(out, manifest, key, response.bytes)
  const headers = Object.fromEntries(contractHeaders.map(name => [name, response.headers[name] ?? null]))
  artifact(
    out,
    manifest,
    key + '.http.json',
    Buffer.from(JSON.stringify({ status: response.status, headers }, null, 2) + '\n'),
  )
}

export async function publicPages(t, out, { routes, nonStaging }, manifest) {
  const assets = new Map()
  for (const route of routes) {
    const host = route.staging_hostname
    if (!host.endsWith('.staging.localhost')) throw Error('Golden fixture must retain local-only site hosts.')
    const response = await get(t.ports.site, host, route.path)
    saveResponse(out, manifest, `public/${route.slug}/${hash(route.path)}.html`, response)
    for (const url of localAssets(response.bytes.toString(), `http://${host}:${t.ports.site}${route.path}`))
      assets.set(url, { host, path: new URL(url).pathname + new URL(url).search })
  }
  for (const [url, value] of assets) {
    const response = await get(t.ports.site, value.host, value.path)
    saveResponse(out, manifest, `assets/${value.host}/${hash(value.path)}.bin`, response)
    const { bytes, headers } = response
    if (headers['content-type']?.includes('text/css'))
      for (const match of bytes.toString().matchAll(/url\(\s*['"]?([^)'"\s]+)['"]?\s*\)/g)) {
        const u = new URL(match[1], url)
        if (u.origin === new URL(url).origin) assets.set(u.href, { host: value.host, path: u.pathname + u.search })
      }
    if (assets.size > 10000) throw Error('Unexpected golden asset growth.')
  }
  const home = routes.find(route => route.path === '/')
  if (!home) throw Error('The fixture needs a published home page for HTTP probes.')
  const newsroom = routes.find(route => route.path === '/newsroom') ?? home
  const media = [...assets.values()].find(asset => asset.path.startsWith('/media/'))
  if (!media) throw Error('The fixture needs a published media URL for HTTP probes.')
  const probe = async (key, host, path, options) => {
    try {
      saveResponse(out, manifest, 'http-probes/' + key, await get(t.ports.site, host, path, undefined, options))
    } catch (error) {
      throw Error(key + ': ' + error.message, { cause: error })
    }
  }
  for (const [key, { host, path }] of [
    ['page', { host: home.staging_hostname, path: home.path }],
    ['media', media],
  ]) {
    const { headers } = await get(t.ports.site, host, path)
    if (!headers.etag) throw Error('HTTP probe ' + key + ' needs an ETag.')
    await probe(key + '-not-modified', host, path, { status: 304, headers: { 'if-none-match': headers.etag } })
    await probe(key + '-head', host, path, { method: 'HEAD' })
  }
  await probe('not-found', home.staging_hostname, '/missing-golden-route', { status: 404 })
  await probe('redirect', home.staging_hostname, '/index.html?golden=1&golden=2', { status: 308 })
  await probe('query', newsroom.staging_hostname, newsroom.path + '?q=education&page=2')
  if (nonStaging) await probe('non-staging', nonStaging.host, nonStaging.path)
  else await probe('unknown-host', 'unassigned.example.test', home.path, { status: 404 })
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
