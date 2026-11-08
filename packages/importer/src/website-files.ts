import { createHash, randomUUID } from 'node:crypto'
import { resolve, sep, extname, join, dirname, basename, relative } from 'node:path'
import { realpathSync, statSync, readFileSync } from 'node:fs'
import { type SiteArchive, SITE_FONT_REGISTRY } from '@cms/schema'
import sharp from 'sharp'
import { processMediaBytes, sniffImageFormat } from '../../../apps/worker/src/media.ts'

export const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.svg', '.avif'])
export const sha256 = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex')

export const PAGE_EXTENSIONS = new Set(['.html', '.htm'])
const RESOURCE_EXTENSIONS = new Set([
  ...PAGE_EXTENSIONS,
  '.php',
  '.css',
  '.js',
  '.json',
  ...IMAGE_EXT,
  '.ico',
  '.woff',
  '.woff2',
  '.ttf',
  '.otf',
  '.eot',
  '.pdf',
])
/** Check lexical and real boundaries before reading an explicitly referenced
 * file. Keep the lexical path: CSS URLs resolve relative to the linked address,
 * even when its bytes come from an in-folder symlink. */
export function localWebsiteFile(
  path: string,
  roots: readonly string[],
  extensions: ReadonlySet<string>,
): string | null {
  try {
    const lexical = resolve(path)
    const inside = (candidate: string) => roots.some(root => candidate.startsWith(root + sep))
    if (!inside(lexical) || !extensions.has(extname(lexical).toLowerCase())) return null
    const canonical = realpathSync(lexical)
    if (extname(canonical).toLowerCase() !== extname(lexical).toLowerCase()) return null
    if (!inside(canonical) || !extensions.has(extname(canonical).toLowerCase()) || !statSync(canonical).isFile())
      return null
    return lexical
  } catch {
    return null
  }
}

export type Asset = { mediaId: string; url: string }
export class SiteFiles {
  readonly images = new Map<string, Asset>() // absolute path → media
  readonly documents = new Map<string, Asset>() // absolute path → asset
  readonly fonts = new Map<string, Asset>() // absolute path → asset
  readonly media: SiteArchive['content']['media'] = []
  readonly variants: SiteArchive['content']['media_variants'] = []
  readonly assets: NonNullable<SiteArchive['content']['site_assets']> = []
  readonly objects: SiteArchive['objects'] = []
  readonly converted: string[] = []
  readonly missing = new Set<string>()
  readonly remote = new Set<string>()
  readonly droppedFonts = new Set<string>()
  readonly unreadable = new Set<string>()
  /** Pages of this site that are linked to but were not imported. */
  readonly unimported = new Set<string>()
  readonly registeredFonts = new Set<string>()
  private readonly pending: { path: string; alt: string }[] = []

  readonly root: string
  readonly publicDir: string
  readonly created: string
  /** Hosts that are this site itself: a full address on one of them is a local file. */
  readonly domains: Set<string>
  constructor(root: string, publicDir: string, created: string, domains: string[] = []) {
    this.root = root
    this.publicDir = publicDir
    this.created = created
    this.domains = new Set(domains.map(host => host.toLowerCase().replace(/^www\./, '')))
  }

  /** A local file an address names, or null for remote, data or missing ones. */
  resolve(address: string, fromFile: string): string | null {
    let value = address.trim().split(/[?#]/)[0] ?? ''
    const own = /^(?:https?:)?\/\/([^/:]+)(?::\d+)?(\/.*)?$/i.exec(value)
    if (own && this.domains.has(own[1]!.toLowerCase().replace(/^www\./, ''))) value = own[2] || '/'
    if (!value || /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(value)) return null
    const decoded = (() => {
      try {
        return decodeURIComponent(value)
      } catch {
        return value
      }
    })()
    const absolute = decoded.startsWith('/') ? join(this.publicDir, decoded) : resolve(dirname(fromFile), decoded)
    if (/[\u0000-\u001f\u007f\\]/.test(decoded)) return null
    return localWebsiteFile(absolute, [this.root, this.publicDir], RESOURCE_EXTENSIONS)
  }

  /** Reserve a media identity for an image now; bytes are processed later. */
  image(path: string, alt = ''): Asset {
    const known = this.images.get(path)
    if (known) return known
    const mediaId = randomUUID()
    const asset = { mediaId, url: `/media/${mediaId}/original` }
    this.images.set(path, asset)
    this.pending.push({ path, alt })
    return asset
  }

  document(path: string): Asset {
    const known = this.documents.get(path)
    if (known) return known
    const bytes = readFileSync(path)
    const id = randomUUID()
    const hash = sha256(bytes)
    this.assets.push({
      id,
      kind: 'document',
      mime_type: 'application/pdf',
      bytes: bytes.byteLength,
      content_hash: hash,
      original_name: basename(path).slice(0, 255),
      font_key: null,
      provenance: {
        path: relative(this.root, path).slice(0, 1000) || basename(path),
        sha256: hash,
        manifest_sha256: hash,
      },
      created_at: this.created,
    })
    this.objects.push({ media_id: id, kind: 'asset', sha256: hash, base64: bytes.toString('base64') })
    const asset = { mediaId: id, url: `/assets/${id}` }
    this.documents.set(path, asset)
    return asset
  }

  /** A font the governed registry knows, by its exact bytes; otherwise null. */
  font(path: string): Asset | null {
    const known = this.fonts.get(path)
    if (known) return known
    const bytes = readFileSync(path)
    const hash = sha256(bytes)
    const entry = Object.entries(SITE_FONT_REGISTRY).find(([, font]) => font.sha256 === hash)
    if (!entry) return null
    const [key, font] = entry
    const id = randomUUID()
    this.assets.push({
      id,
      kind: 'font',
      mime_type: font.mimeType,
      bytes: bytes.byteLength,
      content_hash: hash,
      original_name: basename(path).slice(0, 255),
      font_key: key as keyof typeof SITE_FONT_REGISTRY,
      provenance: {
        path: relative(this.root, path).slice(0, 1000) || basename(path),
        sha256: hash,
        manifest_sha256: hash,
      },
      created_at: this.created,
    })
    this.objects.push({ media_id: id, kind: 'asset', sha256: hash, base64: bytes.toString('base64') })
    const asset = { mediaId: id, url: `/assets/${id}` }
    this.fonts.set(path, asset)
    this.registeredFonts.add(font.family)
    return asset
  }

  /** Inspect every reserved image the way an upload is inspected. */
  async processImages(): Promise<void> {
    for (const { path, alt } of this.pending) {
      const asset = this.images.get(path)!
      let bytes: Uint8Array = readFileSync(path)
      let mime = mimeFor(bytes)
      if (!mime) {
        // GIF, SVG and AVIF files become PNG: uploads accept JPEG, PNG and WebP.
        try {
          bytes = new Uint8Array(await sharp(bytes, { density: 144 }).png().toBuffer())
          mime = 'image/png'
          this.converted.push(relative(this.root, path))
        } catch {
          this.missing.add(relative(this.root, path))
          continue
        }
      }
      const processed = await processMediaBytes(
        {
          intentId: asset.mediaId,
          siteId: asset.mediaId,
          uploadObjectKey: path,
          finalKeyPrefix: `imports/${asset.mediaId}/`,
          declaredBytes: bytes.byteLength,
          declaredMime: mime,
        } as never,
        bytes,
      )
      const original = processed.original
      this.media.push({
        id: asset.mediaId,
        width: original.width,
        height: original.height,
        bytes: original.bytes,
        mime_type: original.mimeType as 'image/jpeg' | 'image/png' | 'image/webp',
        content_hash: original.sha256,
        original_name: basename(path).slice(0, 255),
        alt_text: alt.slice(0, 1000),
        decorative: alt === '',
        focal: null,
        status: 'ready',
        deleted_at: null,
        folder: 'Imported',
        attribution: '',
        source: relative(this.root, path).slice(0, 1000),
        tags: [],
        created_at: this.created,
      })
      this.objects.push({
        media_id: asset.mediaId,
        kind: 'original',
        sha256: original.sha256,
        base64: Buffer.from(original.data).toString('base64'),
      })
      for (const variant of processed.variants) {
        this.variants.push({
          id: randomUUID(),
          media_id: asset.mediaId,
          kind: variant.kind as 'thumbnail' | 'card' | 'wide',
          width: variant.width,
          height: variant.height,
          bytes: variant.bytes,
          mime_type: 'image/webp',
          content_hash: variant.sha256,
        })
        this.objects.push({
          media_id: asset.mediaId,
          kind: variant.kind as 'thumbnail' | 'card' | 'wide',
          sha256: variant.sha256,
          base64: Buffer.from(variant.data).toString('base64'),
        })
      }
    }
  }
}

function mimeFor(bytes: Uint8Array): 'image/jpeg' | 'image/png' | 'image/webp' | null {
  const format = sniffImageFormat(bytes)
  return format === 'jpeg' ? 'image/jpeg' : format === 'png' ? 'image/png' : format === 'webp' ? 'image/webp' : null
}
