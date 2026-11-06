import { readFileSync } from 'node:fs'
import { processMediaBytes, sniffImageFormat } from '../../../apps/worker/src/media.ts'
import type { MediaStore } from '../../platform/src/ports.ts'
import { containedFile, digest } from './backup.ts'
import { attribute, parseHtml, type HtmlNode } from './html.ts'
import { serializeLegacy } from './legacy-values.ts'
import type { ImportClient } from './database.ts'
import type { MigrationBundle } from './migration.ts'

export type ImportedAsset = { url: string; mediaId: string }
export type TransferredMedia = { assets: Map<string, ImportedAsset>; images: number; unresolved: string[] }

export function migrationMediaId(runId: string, siteId: string, sourcePath: string): string {
  const hash = digest(`${runId}:${siteId}:${sourcePath}`)
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`
}

/** Read only inventoried files, verify frozen source hashes, and reuse the
 * product's bounded decoder/metadata stripper/responsive image processor.
 * Storage keys are immutable. Rollback may leave unreferenced objects, which a
 * retry reuses; it never leaves referenced partial images or deletes a receipt. */
export async function transferSiteImages(
  client: ImportClient,
  bundle: MigrationBundle,
  runId: string,
  siteId: string,
  sourceSite: string,
  sourceRoot: string,
  store: MediaStore,
): Promise<TransferredMedia> {
  const repository = sourceSite === 'humanneedsindex' ? 'tsa-humanneedsindex' : 'tsa-echelonsymposium'
  const prefix = `asset/${repository}/public/`
  const assets = new Map<string, ImportedAsset>()
  const unresolved: string[] = []
  const authoredAlt = new Map<string, string>()
  const collectAlt = (nodes: HtmlNode[]) => {
    for (const node of nodes) {
      if (node.kind === 'text') continue
      const alt = node.tag === 'img' ? attribute(node, 'alt') : undefined
      if (alt !== undefined) {
        const urls = [
          attribute(node, 'src') ?? '',
          ...(attribute(node, 'srcset') ?? '').split(',').map(item => item.trim().split(/\s+/)[0] ?? ''),
        ]
        for (const url of urls)
          if (url.startsWith('/')) {
            const name = url.split(/[?#]/)[0]!
            if (!authoredAlt.has(name) || (!authoredAlt.get(name) && alt)) authoredAlt.set(name, alt)
          }
      }
      collectAlt(node.children)
    }
  }
  for (const reference of bundle.references.filter(reference => reference.sourceSite === sourceSite)) {
    for (const section of reference.sections) {
      const parsed = parseHtml(section.sourceHtml)
      if (parsed.ok) collectAlt(parsed.nodes)
    }
  }
  // Site-frame logos also have authored accessibility intent in the frozen
  // native HTML, even when they live outside the page's <main> sections.
  for (const record of bundle.records.filter(
    record => record.kind === 'site-source' && record.sourceSite === sourceSite && record.key.endsWith('.html'),
  )) {
    const payload = record.payload
    if (!payload || typeof payload !== 'object' || Array.isArray(payload) || typeof payload.text !== 'string') continue
    const parsed = parseHtml([...payload.text.matchAll(/<img\b[^>]*>/gi)].map(match => match[0]).join(''))
    if (parsed.ok) collectAlt(parsed.nodes)
  }
  const allowed = (await client.query('SELECT app.is_super_admin() AS allowed')).rows[0]?.allowed
  if (!allowed) throw new Error('only a super admin can import media')
  for (const file of bundle.files.filter(file => file.path.startsWith(prefix))) {
    const localUrl = `/${file.path.slice(prefix.length)}`
    if (!/\.(?:png|jpe?g|webp)$/i.test(localUrl)) {
      unresolved.push(localUrl)
      continue
    }
    // The Media contract requires an explicit accessible description or
    // decorative intent. A filename is not an invented image description.
    if (!authoredAlt.has(localUrl)) {
      unresolved.push(`${localUrl}#missing-authored-alt-intent`)
      continue
    }
    const bytes = readFileSync(containedFile(sourceRoot, file.path.slice('asset/'.length)))
    if (bytes.length !== file.bytes || digest(bytes) !== file.sha256)
      throw new Error('source media changed after inventory; regenerate the migration package')
    const format = sniffImageFormat(bytes)
    if (!format) throw new Error('an inventoried image is not a supported image')
    const id = migrationMediaId(runId, siteId, file.path)
    const processed = await processMediaBytes(
      {
        intentId: id,
        siteId,
        uploadObjectKey: file.path,
        finalKeyPrefix: `v1-imports/${runId}/${siteId}/${id}/`,
        declaredMime: `image/${format}`,
        declaredBytes: bytes.length,
      },
      bytes,
    )
    for (const object of [processed.original, ...processed.variants]) {
      await store.put(object.objectKey, object.data, object.mimeType)
      const stored = await store.get(object.objectKey)
      if (!stored || digest(Buffer.from(stored)) !== object.sha256)
        throw new Error('stored migration image failed its checksum verification')
    }
    const { data: _originalData, ...originalMetadata } = processed.original
    const altText = authoredAlt.get(localUrl)!
    const original = { ...originalMetadata, altText, decorative: altText === '' }
    const variants = processed.variants.map(({ data: _data, ...variant }) => variant)
    await client.query('SELECT app.import_v1_inspected_media($1,$2,$3,$4,$5,$6,$7)', [
      runId,
      siteId,
      file.path,
      file.sha256,
      id,
      JSON.stringify(original),
      JSON.stringify(variants),
    ])
    assets.set(localUrl, { url: `/media/${id}/original`, mediaId: id })
  }
  return { assets, images: assets.size, unresolved }
}

/** Rewrite URL-bearing attributes and stylesheet url() values only. Plain text
 * and unrelated attributes remain source content. A media reference is also
 * stored in page values so normal usage/deletion/public-delivery rules apply. */
export function remapReferenceUrls(
  html: string,
  css: string,
  assets: ReadonlyMap<string, ImportedAsset>,
  links: ReadonlyMap<string, string> = new Map(),
): {
  html: string
  css: string
  mediaIds: string[]
  unresolved: string[]
} {
  const ids = new Set<string>()
  const unresolved = new Set<string>()
  const rewrite = (url: string): string => {
    if (!url.startsWith('/') || url.startsWith('//')) return url
    const match = /^([^?#]+)(.*)$/.exec(url)
    const base = match?.[1] ?? url
    const suffix = match?.[2] ?? ''
    const asset = assets.get(base)
    if (asset) {
      ids.add(asset.mediaId)
      return `${asset.url}${suffix}`
    }
    if (links.has(base)) return `${links.get(base)!}${suffix}`
    if (/^\/(images|files|fonts)\//.test(base) || /\.html$/.test(base)) unresolved.add(base)
    return url
  }
  const parsed = parseHtml(html)
  if (!parsed.ok) throw new Error('reference HTML could not be read before URL remapping')
  const walk = (nodes: typeof parsed.nodes) => {
    for (const node of nodes) {
      if (node.kind === 'text') continue
      for (const attr of node.attributes) {
        if (['src', 'href', 'poster', 'xlink:href'].includes(attr.name)) attr.value = rewrite(attr.value)
        else if (attr.name === 'srcset')
          attr.value = attr.value
            .split(',')
            .map(candidate => {
              const match = /^(\s*)(\S+)(.*)$/.exec(candidate)
              return match ? `${match[1]}${rewrite(match[2]!)}${match[3]}` : candidate
            })
            .join(',')
        else if (attr.name === 'style') attr.value = rewriteCss(attr.value)
      }
      walk(node.children)
    }
  }
  const rewriteCss = (value: string) =>
    value.replace(
      /url\(\s*(['"]?)([^'"()]+)\1\s*\)/gi,
      (_match, _quote: string, url: string) => `url("${rewrite(url.trim())}")`,
    )
  walk(parsed.nodes)
  const rewrittenCss = rewriteCss(css)
  return {
    html: serializeLegacy(parsed.nodes),
    css: rewrittenCss,
    mediaIds: [...ids].sort(),
    unresolved: [...unresolved].sort(),
  }
}
