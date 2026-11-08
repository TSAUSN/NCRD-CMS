import { readFileSync } from 'node:fs'
import { SITE_FONT_REGISTRY, type SiteFontKey } from '@cms/schema'
import { importFrozenSiteAsset } from '../../platform/src/site-assets.ts'
import type { MediaStore } from '../../platform/src/ports.ts'
import { canonical, containedFile, digest } from './backup.ts'
import { parseHtml } from './html.ts'
import { scanSlotSites } from '../../renderer/src/context.ts'
import type { ImportClient } from './database.ts'
import type { MigrationBundle } from './migration.ts'

export type ImportedSiteAsset = { url: string; assetId: string }
export type TransferredSiteAssets = {
  assets: Map<string, ImportedSiteAsset>
  fontIds: string[]
  documents: number
  fonts: number
  unresolved: string[]
}

/** Frozen file list and the staged immutable import must agree before storage writes. */
export async function transferSiteAssets(
  client: ImportClient,
  bundle: MigrationBundle,
  runId: string,
  siteId: string,
  sourceSite: string,
  sourceRoot: string,
  store: MediaStore,
): Promise<TransferredSiteAssets> {
  if (!['humanneedsindex', 'echelonsymposium'].includes(sourceSite))
    throw new Error('Unknown source site for asset transfer.')
  const staged = (await client.query('SELECT bundle FROM public.v1_import_runs WHERE id=$1', [runId])).rows[0]?.bundle
  if (
    !staged ||
    staged.manifestSha256 !== bundle.manifestSha256 ||
    canonical(staged.files) !== canonical(bundle.files) ||
    digest(canonical(bundle.files)) !== bundle.manifestSha256
  )
    throw new Error('Asset transfer requires the exact frozen staged source manifest.')
  const repository = sourceSite === 'humanneedsindex' ? 'tsa-humanneedsindex' : 'tsa-echelonsymposium'
  const prefix = `asset/${repository}/public/`
  const assets = new Map<string, ImportedSiteAsset>()
  const fontIds: string[] = []
  const unresolved: string[] = []
  const fontByFile = new Map<string, SiteFontKey>(
    Object.entries(SITE_FONT_REGISTRY).map(([key, font]) => [font.filename, key as SiteFontKey]),
  )
  const files = bundle.files.filter(file => file.path.startsWith(prefix))
  for (const font of Object.values(SITE_FONT_REGISTRY)) {
    if (!files.some(file => file.path === `${prefix}fonts/${font.filename}`))
      unresolved.push(`/fonts/${font.filename}#missing-frozen-source`)
  }
  let documents = 0
  let fonts = 0
  for (const file of files) {
    const localUrl = `/${file.path.slice(prefix.length)}`
    const fontKey = localUrl.startsWith('/fonts/') ? fontByFile.get(localUrl.slice('/fonts/'.length)) : undefined
    const document = localUrl.startsWith('/files/') && /\.pdf$/i.test(localUrl)
    if (!document && !fontKey) {
      if (localUrl.startsWith('/files/') || localUrl.startsWith('/fonts/')) unresolved.push(localUrl)
      continue
    }
    const bytes = readFileSync(containedFile(sourceRoot, file.path.slice('asset/'.length)))
    if (bytes.length !== file.bytes || digest(bytes) !== file.sha256)
      throw new Error('Source asset changed after inventory; regenerate the migration package.')
    const asset = await importFrozenSiteAsset({
      // ImportClient deliberately exposes only query/rows; the platform command
      // consumes that same interface and never depends on a pool or connection.
      client: client as unknown as Parameters<typeof importFrozenSiteAsset>[0]['client'],
      store,
      siteId,
      bytes,
      kind: fontKey ? 'font' : 'document',
      ...(fontKey ? { fontKey } : {}),
      originalName: localUrl.split('/').at(-1)!,
      provenance: { path: file.path, sha256: file.sha256, manifest_sha256: bundle.manifestSha256 },
    })
    assets.set(localUrl, { url: asset.url, assetId: asset.assetId })
    if (fontKey) {
      fonts++
      fontIds.push(asset.assetId)
    } else documents++
  }
  return { assets, fontIds: fontIds.sort(), documents, fonts, unresolved: unresolved.sort() }
}

/** Preserve prose/layout: rewrite only URL-bearing markup attributes and CSS URLs. */
export function remapSiteAssetReferences(html: string, css: string, assets: ReadonlyMap<string, ImportedSiteAsset>) {
  const ids = new Set<string>()
  const unresolved = new Set<string>()
  const rewrite = (value: string) => {
    const match = /^(\/[^?#]*)(.*)$/.exec(value)
    if (!match || value.startsWith('//')) return value
    const asset = assets.get(match[1]!)
    if (asset) {
      ids.add(asset.assetId)
      return asset.url + match[2]
    }
    if (/^\/(files|fonts)\//.test(match[1]!)) unresolved.add(match[1]!)
    return value
  }
  const rewriteCss = (value: string) =>
    value.replace(/url\(\s*(['"]?)([^'"()]+)\1\s*\)/gi, (match, _quote: string, url: string) => {
      const changed = rewrite(url.trim())
      return changed === url.trim() ? match : `url("${changed}")`
    })
  const parsed = parseHtml(html)
  if (!parsed.ok) throw new Error('Asset references could not be parsed safely.')
  // Replace exact value spans only after tokenizer classification. Re-serializing
  // the tree would normalize SVG closing tags and unrelated authored quoting.
  const edits: { start: number; end: number; value: string }[] = []
  for (const match of html.matchAll(/\b(href|src|poster|xlink:href|style)\s*=\s*(["'])([\s\S]*?)\2/gi)) {
    const value = match[3]!
    const start = match.index! + match[0].length - value.length - 1
    const end = start + value.length
    const probe = html.slice(0, start) + '{{cmsAssetProbe}}' + html.slice(end)
    const site = scanSlotSites(probe).find(site => site.index === start)
    const name = match[1]!.toLowerCase()
    if (!site || site.attribute !== name || !['url-attribute', 'style-attribute'].includes(site.context)) continue
    const changed = name === 'style' ? rewriteCss(value) : rewrite(value)
    if (changed !== value) edits.push({ start, end, value: changed })
  }
  let rewrittenHtml = html
  for (const edit of edits.reverse())
    rewrittenHtml = rewrittenHtml.slice(0, edit.start) + edit.value + rewrittenHtml.slice(edit.end)
  const rewrittenCss = rewriteCss(css)
  return { html: rewrittenHtml, css: rewrittenCss, assetIds: [...ids].sort(), unresolved: [...unresolved].sort() }
}

/** Typed field objects retain their shape and all prior values/edits. */
export function remapSiteAssetValues(
  value: unknown,
  assets: ReadonlyMap<string, ImportedSiteAsset>,
): { value: unknown; assetIds: string[] } {
  const ids = new Set<string>()
  const walk = (current: unknown): unknown => {
    if (Array.isArray(current)) return current.map(walk)
    if (current && typeof current === 'object')
      return Object.fromEntries(Object.entries(current).map(([key, child]) => [key, walk(child)]))
    if (typeof current !== 'string') return current
    const match = /^(\/[^?#]*)(.*)$/.exec(current)
    const asset = match ? assets.get(match[1]!) : null
    if (asset) {
      ids.add(asset.assetId)
      return asset.url + match![2]
    }
    if (current.includes('<') && /(?:href|src)\s*=/.test(current)) {
      const result = remapSiteAssetReferences(current, '', assets)
      for (const id of result.assetIds) ids.add(id)
      return result.assetIds.length ? result.html : current
    }
    return current
  }
  return { value: walk(value), assetIds: [...ids].sort() }
}
