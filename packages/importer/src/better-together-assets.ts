import { createHash, randomUUID } from 'node:crypto'
import { readFileSync, realpathSync, statSync } from 'node:fs'
import { basename, extname, resolve, sep } from 'node:path'
import type { SiteArchive, SiteFileBundle, SiteFileKind } from '@cms/schema'

export const BETTER_TOGETHER_SOURCE_ORIGIN = 'https://bettertogether2027.org/'
type Receipt = { source: string; final: string; file: string; hash: string; bytes: number; type: string }
const hash = (bytes: string | Uint8Array) => createHash('sha256').update(bytes).digest('hex')
const extensions = /\.(?:css|js|png|jpe?g|gif|webp|svg|woff2?|ttf|otf)$/i
const kindOf = (name: string): SiteFileKind =>
  /\.css$/i.test(name)
    ? 'stylesheet'
    : /\.js$/i.test(name)
      ? 'script'
      : /\.(?:woff2?|ttf|otf)$/i.test(name)
        ? 'font'
        : 'image'

export function readBetterTogetherAssets(rootPath: string, cachePath: string, created: string) {
  const root = realpathSync(rootPath)
  const cache = realpathSync(cachePath)
  const sourceBase = BETTER_TOGETHER_SOURCE_ORIGIN
  const receipts = JSON.parse(readFileSync(resolve(cache, 'receipts.json'), 'utf8')) as Receipt[]
  const bySource = new Map(
    receipts.flatMap(
      row =>
        [
          [row.source, row],
          [row.final, row],
        ] as const,
    ),
  )
  const files: NonNullable<SiteArchive['content']['site_files']> = []
  const objects: SiteArchive['objects'] = []
  const paths: NonNullable<SiteFileBundle['paths']> = []
  const loaded = new Map<string, { id: string; path: string }>()
  const omitted = new Set<string>()
  const fileIdsByPath = new Map<string, string>()
  const objectsById = new Map<string, SiteArchive['objects'][number]>()
  function add(kind: SiteFileKind, name: string, source: string, bytes: Buffer, path: string) {
    const id = randomUUID()
    const sha256 = hash(bytes)
    files.push({ id, kind, name, source, bytes: bytes.length, sha256, created_at: created })
    const object = { media_id: id, kind: 'site-file' as const, sha256, base64: bytes.toString('base64') }
    objects.push(object)
    paths.push({ path, fileId: id })
    if (!fileIdsByPath.has(path)) fileIdsByPath.set(path, id)
    objectsById.set(id, object)
    return { id, path }
  }
  function resource(value: string, base = sourceBase): string {
    if (!value || /^(?:data:|#)/i.test(value)) return value
    const url = new URL(value, base)
    const key = url.origin + url.pathname + url.search
    const existing = loaded.get(key)
    if (existing) return existing.path + url.hash
    let bytes: Buffer
    let name: string
    let path: string
    let source: string
    if (url.hostname === new URL(sourceBase).hostname) {
      const relative = decodeURIComponent(url.pathname).replace(/^\//, '')
      if (!extensions.test(relative) || !/^(?:css|images|js|fonts)\//.test(relative)) return value
      const lexical = resolve(root, relative)
      const real = realpathSync(lexical)
      if (
        !lexical.startsWith(root + sep) ||
        !real.startsWith(root + sep) ||
        extname(real) !== extname(lexical) ||
        !statSync(real).isFile()
      )
        throw new Error('A homepage asset escapes the chosen local folder.')
      bytes = readFileSync(real)
      name = basename(relative).replace(/[^A-Za-z0-9._-]/g, '-')
      path = url.pathname
      source = 'local:bettertogether2027.org/' + relative
    } else {
      const receipt = bySource.get(key)
      if (!receipt) {
        omitted.add(key)
        return '/images/unavailable-' + hash(key).slice(0, 16) + '.png'
      }
      if (!/^[a-f0-9]{64}\.bin$/.test(receipt.file)) throw new Error('Invalid offline cache receipt.')
      const cached = realpathSync(resolve(cache, receipt.file))
      if (!cached.startsWith(cache + sep)) throw new Error('An offline cache file escapes the chosen folder.')
      bytes = readFileSync(cached)
      if (hash(bytes) !== receipt.hash || bytes.length !== receipt.bytes)
        throw new Error('Offline cache bytes do not match their receipt.')
      const ext = /css/i.test(receipt.type)
        ? '.css'
        : /javascript/i.test(receipt.type)
          ? '.js'
          : extname(url.pathname) || '.woff2'
      name = 'cached-' + hash(key).slice(0, 16) + ext
      path = '/fonts/' + name
      source = receipt.source
    }
    const kind = kindOf(name)
    const reserved = { id: randomUUID(), path }
    loaded.set(key, reserved)
    if (kind === 'stylesheet') {
      let css = bytes.toString('utf8')
      css = css.replace(/@import\s+(?:url\(\s*)?["']?([^"'\s);]+)["']?\s*\)?[^;]*;/gi, (_match, href: string) => {
        const imported = resource(href, url.href)
        const id = fileIdsByPath.get(imported)
        const object = id ? objectsById.get(id) : undefined
        return object ? Buffer.from(object.base64, 'base64').toString('utf8') : ''
      })
      css = css.replace(/url\(\s*(["']?)(.*?)\1\s*\)/gi, (_match, _quote: string, href: string) => {
        // EOT/SVG font fallbacks are unused by the three supported modern engines.
        if (/\.(?:eot)(?:[?#]|$)/i.test(href)) return 'url(data:application/octet-stream;base64,)'
        return 'url("' + resource(href, url.href).replace(/"/g, '%22') + '")'
      })
      bytes = Buffer.from(css)
    }
    const result = add(kind, name, source, bytes, path)
    loaded.set(key, result)
    return result.path + url.hash
  }

  return { files, objects, paths, omitted, add, resource, fileIdAtPath: (path: string) => fileIdsByPath.get(path) }
}
