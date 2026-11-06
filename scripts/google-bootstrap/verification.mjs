import { createRequire } from 'node:module'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { operatorConnection } from './database.mjs'
import { assertActiveScope } from './scope.mjs'
import { origin, receipt, kept } from './common.mjs'
const require = createRequire(new URL('../../packages/schema/package.json', import.meta.url)),
  { Client } = require('pg')
const htmlRequire = createRequire(new URL('../../packages/renderer/package.json', import.meta.url)),
  { parse } = htmlRequire('parse5')

export function localAssets(html, address) {
  const urls = new Set(),
    base = new URL(address)
  const add = value => {
    if (!value) return
    try {
      const u = new URL(value, base)
      if (u.origin === base.origin) {
        u.hash = ''
        urls.add(u.href)
      }
    } catch {
      /* malformed references fail the renderer/readiness gates */
    }
  }
  const css = value => {
    for (const m of (value ?? '').matchAll(/url\(\s*['"]?([^)'"\s]+)['"]?\s*\)/g)) add(m[1])
  }
  const visit = node => {
    const a = Object.fromEntries((node.attrs ?? []).map(x => [x.name, x.value]))
    if (['img', 'source', 'video', 'script'].includes(node.tagName))
      for (const k of ['src', 'poster', 'data-src']) add(a[k])
    if (node.tagName === 'link' && /stylesheet|preload|icon/.test(a.rel ?? '')) add(a.href)
    if (['img', 'source'].includes(node.tagName))
      for (const candidate of (a.srcset ?? '').split(',')) add(candidate.trim().split(/\s+/)[0])
    css(a.style)
    if (node.tagName === 'style') for (const child of node.childNodes ?? []) css(child.value)
    for (const child of node.childNodes ?? []) visit(child)
  }
  visit(parse(html))
  return [...urls].sort()
}

async function get(url) {
  const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(30_000) })
  if (!response.ok) throw Error('Verification request failed: ' + response.status + ' ' + new URL(url).pathname)
  return { response, bytes: Buffer.from(await response.arrayBuffer()) }
}

export async function verify(c) {
  assertActiveScope(c)
  const checks = []
  for (const role of ['admin', 'site']) {
    const { bytes } = await get(origin(c, role) + '/health'),
      data = JSON.parse(bytes.toString())
    if (data.version !== c.revision.slice(0, 7)) throw Error('Health version differs from freeze.')
    checks.push({ role, status: 200, version: data.version })
  }
  const denied = await fetch(origin(c, 'worker') + '/run', {
    method: 'POST',
    redirect: 'manual',
    signal: AbortSignal.timeout(30_000),
  })
  if (![401, 403].includes(denied.status)) throw Error('Worker must refuse anonymous invocation.')
  const db = new Client(operatorConnection(c))
  await db.connect()
  let routes, worker
  try {
    await db.query('BEGIN READ ONLY')
    routes = (
      await db.query(
        "SELECT s.slug,s.staging_hostname,r.path FROM published_routes r JOIN sites s ON s.id=r.site_id WHERE s.slug=ANY($1::text[]) AND s.status<>'archived' ORDER BY s.slug,r.path",
        [kept],
      )
    ).rows
    worker = (
      await db.query(
        "SELECT EXISTS(SELECT 1 FROM job_heartbeats WHERE last_seen_at>now()-interval '5 minutes' AND version=$1) AS fresh",
        [c.revision.slice(0, 7)],
      )
    ).rows[0]
    await db.query('COMMIT')
  } finally {
    await db.end()
  }
  if (!Number.isInteger(c.expectedPublicPages) || routes.length !== c.expectedPublicPages)
    throw Error('Published route count differs from the reviewed content inventory.')
  if (!worker.fresh) throw Error('No fresh worker heartbeat for the deployed revision.')
  const assets = new Set(),
    pages = []
  for (const route of routes) {
    if (!route.staging_hostname.startsWith(c.firebaseSitePrefix + '-') || !route.staging_hostname.endsWith('.web.app'))
      throw Error('A kept route still points outside this installation.')
    const address = new URL(route.path, 'https://' + route.staging_hostname)
    if (address.hostname !== route.staging_hostname) throw Error('A published route escapes its owning host.')
    const { response, bytes } = await get(address.href)
    if (!response.headers.get('content-type')?.includes('text/html'))
      throw Error('Public route is not HTML: ' + route.path)
    if (
      !/noindex/i.test(response.headers.get('x-robots-tag') ?? '') &&
      !/<meta[^>]+name=["']robots["'][^>]+content=["'][^"']*noindex/i.test(bytes.toString())
    )
      throw Error('Pre-production route lacks noindex: ' + route.path)
    for (const url of localAssets(bytes.toString(), address.href)) assets.add(url)
    pages.push({ site: route.slug, path: route.path, bytes: bytes.length })
  }
  const verifiedAssets = []
  for (const url of assets) {
    const { bytes, response } = await get(url)
    if (response.headers.get('content-type')?.includes('text/css'))
      for (const match of bytes.toString().matchAll(/url\(\s*['"]?([^)'"\s]+)['"]?\s*\)/g)) {
        const u = new URL(match[1], url)
        if (u.origin === new URL(url).origin) assets.add(u.href)
      }
    if (assets.size > 10000) throw Error('Unexpected asset inventory growth.')
    verifiedAssets.push({
      host: new URL(url).hostname,
      path: new URL(url).pathname,
      bytes: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    })
  }
  if (c.publicAssetOracle) {
    const expected = JSON.parse(readFileSync(c.publicAssetOracle, 'utf8'))
    const hosts = Object.fromEntries(routes.map(row => [row.slug, row.staging_hostname]))
    for (const asset of expected) {
      const actual = verifiedAssets.find(x => x.host === hosts[asset.site] && x.path === asset.path)
      if (!actual || actual.sha256 !== asset.sha256 || actual.bytes !== asset.bytes)
        throw Error('Public asset differs from reviewed bytes: ' + asset.path)
    }
  }
  receipt(c, 'verification', {
    at: new Date().toISOString(),
    checks,
    pages,
    assets: verifiedAssets,
    anonymousWorkerStatus: denied.status,
    freshWorker: true,
    ordinaryBrowserDemo: 'owner must complete docs/handbook/start-here/demo-route.md',
  })
}
