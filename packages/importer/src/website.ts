// Import an existing website into the CMS (ADR 0011: tag, then import).
//
// Input is a folder holding a site's built pages, stylesheets and assets. The
// output is a content archive (`cms-site-content`, the same format "Import an
// existing site" already accepts), so a site created this way goes through the
// tested import command: new IDs, recompilation under current policy, a private
// draft site. Nothing here writes to a database.
//
// Each page is split into the shared header and footer (which become the site's
// authored header and footer components) and its sections (which become
// site-scoped section definitions). A section keeps its own HTML and the parts
// of the site's CSS that can apply to it, so it looks as it did. Editable fields
// come from explicit tags when the HTML carries them — V1's vocabulary:
// `data-cms-editable="text|richtext|image|link|skip"`, `data-cms-id`,
// `data-cms-section` — and otherwise from the same proposals "Organize into
// blocks" makes in the section creator.
//
// What a published CMS page may not contain is removed and reported, never
// silently dropped: scripts, forms, frames, event handlers and fonts that are
// not in the governed registry.
import { createHash, randomUUID } from 'node:crypto'
import { readdirSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { basename, dirname, extname, join, relative, resolve, sep } from 'node:path'
import {
  defaultTreeAdapter,
  html,
  parse,
  parseFragment,
  serialize,
  serializeOuter,
  type DefaultTreeAdapterMap,
} from 'parse5'
import postcss from 'postcss'
import sharp from 'sharp'
import {
  DEFAULT_FOOTER_CONFIG_V1,
  DEFAULT_HEADER_CONFIG_V1,
  DEFAULT_THEME_TOKENS,
  SITE_ARCHIVE_FORMAT,
  SITE_ARCHIVE_VERSION,
  SITE_FONT_REGISTRY,
  parseSiteArchive,
  type NavTree,
  type SiteArchive,
  type SlotDef,
} from '@cms/schema'
import { compileSection, sectionScopeSelector } from '@cms/renderer'
import { organizeSource } from '@cms/renderer/source-organizer'
import { processMediaBytes, sniffImageFormat } from '../../../apps/worker/src/media.ts'
import { cssClosure, type StyleInventory } from './reference-css-closure.ts'

type Node = DefaultTreeAdapterMap['node']
type Element = DefaultTreeAdapterMap['element']
type ParentNode = DefaultTreeAdapterMap['parentNode']

export type WebsiteImportOptions = {
  /** Folder holding the site's pages and assets. */
  root: string
  name: string
  /** The new site's short address in the CMS. */
  slug: string
  kind?: 'resource' | 'event' | 'general'
  /** Pages to import, relative to the root. Default: every .html file in the root. */
  pages?: string[]
  /** Stylesheets a bundler injects at run time, relative to the root. */
  css?: string[]
  /** Folder that root-relative addresses ("/images/a.png") resolve against. Default: the root. */
  publicDir?: string
  /** The site's own domain names, so full addresses on them resolve to its files. */
  domains?: string[]
  now?: Date
}

export type SectionReport = {
  page: string
  label: string
  fields: number
  mode: 'tagged' | 'proposed' | 'static'
  reused: boolean
  problems: string[]
}
export type WebsiteImportReport = {
  site: { name: string; slug: string }
  pages: { file: string; path: string; title: string; sections: number }[]
  sections: SectionReport[]
  header: string
  footer: string
  media: { images: number; converted: string[]; missing: string[]; remote: string[] }
  documents: number
  fonts: { registered: string[]; dropped: string[] }
  removed: Record<string, number>
  notes: string[]
}
export type WebsiteImport = { archive: SiteArchive; report: WebsiteImportReport }

const ROOT_CLASS = 'cms-site-root'
/** A section version's CSS limit (the archive and the compiler enforce the same). */
const MAX_SECTION_CSS = 262_144
const MENU_MARKER = 'cms-import-menu-slot'
const REMOVE = new Set([
  'script',
  'noscript',
  'template',
  'link',
  'meta',
  'base',
  'iframe',
  'object',
  'embed',
  'video',
  'audio',
  'canvas',
  'form',
  'input',
  'select',
  'textarea',
  'dialog',
])
const KEEP_AS_TEXT = new Set(['button', 'label'])
const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.svg', '.avif'])
const sha256 = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex')

const PAGE_EXTENSIONS = new Set(['.html', '.htm'])
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
function localWebsiteFile(path: string, roots: readonly string[], extensions: ReadonlySet<string>): string | null {
  try {
    const lexical = resolve(path),
      inside = (candidate: string) => roots.some(root => candidate.startsWith(root + sep))
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

// ------------------------------------------------------------------ tree --

const isElement = (node: Node): node is Element => 'tagName' in node
const attr = (node: Element, name: string) => node.attrs.find(a => a.name === name)?.value
function setAttr(node: Element, name: string, value: string | null) {
  node.attrs = node.attrs.filter(a => a.name !== name)
  if (value !== null) node.attrs.push({ name, value })
}
const children = (node: Node): Node[] => ('childNodes' in node ? (node as ParentNode).childNodes : []) as Node[]
function* walk(node: Node): Generator<Element> {
  for (const child of children(node)) {
    if (!isElement(child)) continue
    yield child
    yield* walk(child)
  }
}
const find = (node: Node, test: (el: Element) => boolean) => {
  for (const el of walk(node)) if (test(el)) return el
  return undefined
}
const textOf = (node: Node): string =>
  'value' in node && (node as { nodeName: string }).nodeName === '#text'
    ? (node as { value: string }).value
    : children(node).map(textOf).join('')
/** The words a visitor sees: not the contents of styles, scripts or templates. */
const visibleText = (node: Node): string =>
  'value' in node && (node as { nodeName: string }).nodeName === '#text'
    ? (node as { value: string }).value
    : isElement(node) && ['style', 'script', 'template', 'noscript'].includes(node.tagName)
      ? ''
      : children(node).map(visibleText).join('')
function remove(node: Node) {
  const parent = (node as { parentNode?: ParentNode | null }).parentNode
  if (!parent) return
  parent.childNodes = parent.childNodes.filter(child => child !== node)
}
function insideAny(node: Element, tags: string[]): boolean {
  let parent = node.parentNode as Element | null
  while (parent && isElement(parent as Node)) {
    if (tags.includes(parent.tagName)) return true
    parent = parent.parentNode as Element | null
  }
  return false
}
const fragment = (html: string) => parseFragment(html)
function replaceChildrenWithText(node: Element, text: string) {
  const replacement = fragment(text).childNodes as Node[]
  for (const child of replacement) (child as { parentNode: ParentNode }).parentNode = node as unknown as ParentNode
  node.childNodes = replacement as Element['childNodes']
}

// ------------------------------------------------------------------- site --

type Asset = { mediaId: string; url: string }
class SiteFiles {
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
    const id = randomUUID(),
      hash = sha256(bytes)
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

// -------------------------------------------------------------------- CSS --

/** The site's stylesheet, made fit for section CSS: document roots become the
 * section wrapper, local images and registered fonts become CMS addresses, and
 * what section CSS cannot load is left out and reported. */
export function siteStylesheet(css: string, file: string, files: SiteFiles, removed: Record<string, number>): string {
  let root: postcss.Root
  try {
    root = postcss.parse(css)
  } catch {
    const salvaged = salvageCss(css)
    if (!salvaged) {
      removed['unreadable stylesheet'] = (removed['unreadable stylesheet'] ?? 0) + 1
      files.unreadable.add(relative(files.root, file) || basename(file))
      return ''
    }
    removed['broken CSS rule'] = (removed['broken CSS rule'] ?? 0) + salvaged.dropped
    root = salvaged.root
  }
  root.walkAtRules('import', at => {
    const target = /url\(\s*['"]?([^'")]+)['"]?\s*\)|['"]([^'"]+)['"]/.exec(at.params)
    const path = target ? files.resolve(target[1] ?? target[2] ?? '', file) : null
    if (path && extname(path) === '.css')
      at.replaceWith(postcss.parse(siteStylesheet(readFileSync(path, 'utf8'), path, files, removed)).nodes)
    else {
      files.remote.add(at.params.slice(0, 120))
      at.remove()
    }
  })
  root.walkAtRules(at => {
    // Section CSS has no animations, print rules or document-level at-rules;
    // they are left out here once rather than refused section by section.
    if (/^(?:-[a-z]+-)?keyframes$/i.test(at.name)) {
      removed['animation (@keyframes)'] = (removed['animation (@keyframes)'] ?? 0) + 1
      at.remove()
      return
    }
    if (
      [
        'page',
        'charset',
        'namespace',
        'viewport',
        '-ms-viewport',
        'document',
        '-moz-document',
        'counter-style',
        'property',
      ].includes(at.name.toLowerCase())
    ) {
      removed[`@${at.name} rule`] = (removed[`@${at.name} rule`] ?? 0) + 1
      at.remove()
      return
    }
    if (at.name === 'layer') {
      if (at.nodes) at.replaceWith(...at.nodes.map(node => node.clone()))
      else at.remove()
    } else if (at.name === 'theme') {
      const rule = postcss.rule({ selector: `.${ROOT_CLASS}` })
      for (const node of at.nodes ?? []) if (node.type === 'decl') rule.append(node.clone())
      at.replaceWith(rule)
    } else if (
      at.name === 'supports' &&
      /-webkit-hyphens:\s*none/.test(at.params) &&
      /margin-trim/.test(at.params) &&
      at.nodes
    ) {
      at.replaceWith(...at.nodes.map(node => node.clone()))
    } else if (at.name === 'font-face') {
      const src = at.nodes?.find((node): node is postcss.Declaration => node.type === 'decl' && node.prop === 'src')
      const family = (
        at.nodes?.find((node): node is postcss.Declaration => node.type === 'decl' && node.prop === 'font-family')
          ?.value ?? ''
      ).replace(/['"]/g, '')
      let kept: Asset | null = null
      for (const match of src?.value.matchAll(/url\(\s*['"]?([^'")]+)['"]?\s*\)/g) ?? []) {
        const path = files.resolve(match[1]!, file)
        if (path) {
          kept = files.font(path)
          if (kept) break
        }
      }
      if (kept && src)
        src.value = src.value.replace(
          /url\([^)]*\)(\s*format\([^)]*\))?(\s*,\s*url\([^)]*\)(\s*format\([^)]*\))?)*/,
          `url("${kept.url}")`,
        )
      else {
        files.droppedFonts.add(family || 'unnamed')
        at.remove()
      }
    }
  })
  root.walkDecls(decl => {
    if (!/url\(/i.test(decl.value)) return
    let dropped = false
    decl.value = decl.value.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi, (whole, _quote: string, address: string) => {
      if (/^data:/i.test(address) || address.startsWith('#')) return whole
      if (address.startsWith('/media/') || address.startsWith('/assets/')) return whole
      const path = files.resolve(address, file)
      if (path && IMAGE_EXT.has(extname(path).toLowerCase())) return `url("${files.image(path).url}")`
      files.remote.add(address.slice(0, 160))
      dropped = true
      return whole
    })
    if (dropped) {
      decl.remove()
      removed['remote CSS image'] = (removed['remote CSS image'] ?? 0) + 1
    }
  })
  root.walkRules(rule => {
    // The page's document roots are each section's wrapper.
    rule.selector = rule.selector
      .replace(/(^|[\s>+~,(])(?:html|body|:root|:host)(?=$|[\s>+~,.#:[)])/g, `$1.${ROOT_CLASS}`)
      .replace(new RegExp(`\\.${ROOT_CLASS}\\s+\\.${ROOT_CLASS}`, 'g'), `.${ROOT_CLASS}`)
  })
  return root.toString()
}

/** Real stylesheets break (a stray brace, HTML pasted into a <style>). Keep
 * every top-level rule or block that reads on its own and drop the rest,
 * rather than losing the whole sheet. */
function salvageCss(css: string): { root: postcss.Root; dropped: number } | null {
  const root = postcss.root()
  const text = css.replace(/<!--|-->/g, '')
  let depth = 0,
    start = 0,
    dropped = 0,
    kept = 0
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]
    if (char === '{') depth += 1
    else if (char === '}') {
      depth -= 1
      if (depth <= 0) {
        const chunk = text.slice(start, index + 1)
        try {
          root.append(postcss.parse(chunk).nodes)
          kept += 1
        } catch {
          dropped += 1
        }
        depth = 0
        start = index + 1
      }
    }
  }
  return kept ? { root, dropped } : null
}

// ------------------------------------------------------------------ pages --

type PageSource = {
  file: string
  path: string
  title: string
  description: string
  document: Node
  header?: Element
  footer?: Element
  sections: Element[]
  skipped: Record<string, number>
}

function pagePath(file: string, root: string): string {
  const rel = relative(root, file)
    .replace(/\\/g, '/')
    .replace(/\.html?$/i, '')
  const parts = rel.split('/').filter(part => part && part !== 'index')
  return parts
    .map(
      part =>
        part
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-+|-+$/g, '') || 'page',
    )
    .join('/')
}

const SKIP_TOP = new Set(['script', 'noscript', 'style', 'template', 'link', 'meta', 'base'])
const FOOTER_LIKE = /(^|[\s_-])(footer|copyright|site-footer|colophon)([\s_-]|$)/i
const classAndId = (el: Element) => `${attr(el, 'class') ?? ''} ${attr(el, 'id') ?? ''}`
const isFooterLike = (el: Element) =>
  el.tagName === 'footer' || FOOTER_LIKE.test(classAndId(el)) || attr(el, 'role') === 'contentinfo'
/** Nothing a visitor would see: no words and no pictures (a parser-repaired stray <p><strong>). */
const isEmptyBlock = (el: Element) =>
  !visibleText(el).trim() &&
  !find(el, inner => ['img', 'svg', 'picture', 'video', 'iframe', 'canvas'].includes(inner.tagName))
/** A pop-up (Bootstrap modal, dialog) is behaviour, not a section of the page. */
const isPopup = (el: Element) =>
  el.tagName === 'dialog' || attr(el, 'role') === 'dialog' || /(^|\s)modal(\s|$)/.test(attr(el, 'class') ?? '')
const significant = (node: Node): Element[] =>
  children(node).filter((child): child is Element => isElement(child) && !SKIP_TOP.has(child.tagName))

/**
 * The page's top-level blocks: the children of <main> when there is one,
 * otherwise of <body>, looking through wrapper elements that hold everything
 * (`<div id="page">`).
 */
function topLevel(body: Element): { container: Element; blocks: Element[] } {
  const main = find(body, el => el.tagName === 'main')
  if (main) return { container: main, blocks: significant(main) }
  let container = body
  for (let depth = 0; depth < 4; depth += 1) {
    const blocks = significant(container)
    if (blocks.length !== 1 || !['div', 'section', 'article'].includes(blocks[0]!.tagName) || isFooterLike(blocks[0]!))
      break
    container = blocks[0]!
  }
  return { container, blocks: significant(container) }
}

/** Several footer blocks in a row (footer, then a copyright strip) are one site footer. */
function wrapFooter(blocks: Element[]): Element {
  if (blocks.length === 1) return blocks[0]!
  const wrapper = defaultTreeAdapter.createElement('div', html.NS.HTML, [
    { name: 'class', value: 'cms-imported-footer' },
  ]) as Element
  for (const block of blocks) {
    defaultTreeAdapter.detachNode(block)
    defaultTreeAdapter.appendChild(wrapper, block)
  }
  return wrapper
}

function readPage(file: string, root: string): PageSource {
  const document = parse(readFileSync(file, 'utf8'))
  const head = find(document, el => el.tagName === 'head')
  const body = (find(document, el => el.tagName === 'body') ?? document) as Element
  const title = textOf(find(head ?? document, el => el.tagName === 'title') ?? document)
    .trim()
    .slice(0, 200)
  const description =
    attr(
      find(head ?? document, el => el.tagName === 'meta' && attr(el, 'name') === 'description') ??
        ({ attrs: [] } as unknown as Element),
      'content',
    ) ?? ''
  const skipped: Record<string, number> = {}
  const { blocks } = topLevel(body)
  const taggedSections = [...walk(body)].filter(el => attr(el, 'data-cms-section') !== undefined)

  // The site header: a tagged one; else a <header> holding the menu; else a
  // menu bar placed straight in the page (Bootstrap's navbar), in which case a
  // <header> without a menu is the page's hero, an ordinary section; else the
  // first <header>.
  const header =
    find(body, el => attr(el, 'data-cms-frame') === 'header') ??
    blocks.find(
      el =>
        (el.tagName === 'header' || attr(el, 'role') === 'banner') &&
        find(el, inner => inner.tagName === 'nav') !== undefined,
    ) ??
    blocks.find(el => el.tagName === 'nav') ??
    find(body, el => el.tagName === 'nav' && !insideAny(el, ['main', 'article', 'section', 'footer'])) ??
    blocks.find(el => el.tagName === 'header') ??
    find(body, el => el.tagName === 'header' && !insideAny(el, ['main', 'article', 'section']))

  // The site footer: a tagged one; else the run of footer-like blocks the page ends with.
  let footer = find(body, el => attr(el, 'data-cms-frame') === 'footer')
  if (!footer) {
    const content = blocks.filter(el => !isPopup(el))
    let start = content.length
    while (start > 0 && (isFooterLike(content[start - 1]!) || isEmptyBlock(content[start - 1]!))) start -= 1
    const run = content.slice(start).filter(el => !isEmptyBlock(el))
    if (run.some(isFooterLike)) footer = wrapFooter(run)
    else footer = find(body, el => el.tagName === 'footer' && !insideAny(el, ['main', 'article', 'section']))
  }

  const sections = taggedSections.length
    ? taggedSections
    : blocks.filter(el => {
        if (
          el === header ||
          el === footer ||
          (footer && walkContains(footer, el)) ||
          (header && walkContains(el, header))
        )
          return false
        if (isPopup(el)) {
          skipped['pop-up dialog'] = (skipped['pop-up dialog'] ?? 0) + 1
          return false
        }
        if (REMOVE.has(el.tagName)) {
          skipped[el.tagName] = (skipped[el.tagName] ?? 0) + 1
          return false
        }
        // Stray empty elements (an unclosed <p><strong> repaired by the parser) are not sections.
        if (isEmptyBlock(el)) {
          skipped['empty element'] = (skipped['empty element'] ?? 0) + 1
          return false
        }
        return true
      })
  return {
    file,
    path: pagePath(file, root),
    title: title || basename(file),
    description: description.slice(0, 300),
    document,
    header,
    footer,
    sections,
    skipped,
  }
}
function walkContains(node: Element, target: Element): boolean {
  for (const el of walk(node)) if (el === target) return true
  return false
}

/** Strip what published pages cannot carry and point local addresses at CMS copies. */
function cleanTree(
  node: Element,
  page: PageSource,
  files: SiteFiles,
  routes: Map<string, string>,
  removed: Record<string, number>,
  inlineCss: string[],
  frame = false,
) {
  const count = (what: string) => {
    removed[what] = (removed[what] ?? 0) + 1
  }
  // Comments are invisible, and on real sites they often hold whole blocks of
  // retired markup, scripts included, that must not travel with the section.
  const uncomment = (parent: Node) => {
    const kids = children(parent)
    if (kids.some(kid => (kid as { nodeName: string }).nodeName === '#comment')) {
      ;(parent as ParentNode).childNodes = kids.filter(
        kid => (kid as { nodeName: string }).nodeName !== '#comment',
      ) as ParentNode['childNodes']
    }
    for (const kid of children(parent)) if (isElement(kid)) uncomment(kid)
  }
  uncomment(node)
  for (const el of [...walk({ childNodes: [node] } as unknown as Node)]) {
    if (REMOVE.has(el.tagName)) {
      count(el.tagName)
      remove(el)
      continue
    }
    // Style blocks are already part of the page's stylesheet (pageStylesheet).
    if (el.tagName === 'style') {
      remove(el)
      continue
    }
    if (KEEP_AS_TEXT.has(el.tagName)) {
      if (el.tagName === 'button') count('button (kept as text)')
      el.tagName = 'span'
      ;(el as { nodeName: string }).nodeName = 'span'
    }
    for (const a of [...el.attrs]) {
      if (/^on/i.test(a.name)) {
        count('event handler')
        setAttr(el, a.name, null)
      } else if (a.name === 'srcset' || a.name === 'sizes' || (a.name === 'loading' && el.tagName !== 'img'))
        setAttr(el, a.name, null)
      else if (a.name === 'style') {
        const className = `cms-s-${sha256(a.value).slice(0, 8)}`
        inlineCss.push(`.${className}{${a.value}}`)
        setAttr(el, 'style', null)
        setAttr(el, 'class', [attr(el, 'class'), className].filter(Boolean).join(' '))
      }
    }
    if (el.tagName === 'img') {
      const src = attr(el, 'src') ?? ''
      const path = files.resolve(src, page.file)
      if (path) setAttr(el, 'src', files.image(path, attr(el, 'alt') ?? '').url)
      else if (src) files.remote.add(src.slice(0, 160))
      if (attr(el, 'alt') === undefined) setAttr(el, 'alt', '')
    }
    if (el.tagName === 'a') {
      const href = attr(el, 'href') ?? ''
      const path = files.resolve(href, page.file)
      const hash = href.includes('#') ? href.slice(href.indexOf('#')) : ''
      if (frame && href.startsWith('#') && href.length > 1) setAttr(el, 'href', `/${page.path}${href}`)
      else if (path && routes.has(path)) setAttr(el, 'href', `/${routes.get(path)}${hash}`.replace(/^\/(#|$)/, '/$1'))
      else if (path && /\.(?:html?|php)$/i.test(path)) files.unimported.add(relative(files.root, path))
      else if (path && extname(path).toLowerCase() === '.pdf') setAttr(el, 'href', files.document(path).url)
      else if (path && IMAGE_EXT.has(extname(path).toLowerCase())) setAttr(el, 'href', files.image(path).url)
      setAttr(el, 'target', attr(el, 'target') === '_blank' ? '_blank' : null)
    }
  }
}

/** Bootstrap menus become a code-owned, scriptless disclosure and one governed
 * Navigation field. Preserve branding and desktop geometry, not inert toggles. */
function adaptImportedMenu(
  node: Element,
  page: PageSource,
  files: SiteFiles,
  routes: Map<string, string>,
): { css: string; tree: NavTree } | null {
  const hasClass = (el: Element, name: string) => (attr(el, 'class') ?? '').split(/\s+/).includes(name)
  const toggle = find(node, el => el.tagName === 'button' && hasClass(el, 'navbar-toggler'))
  const panel = find(node, el => hasClass(el, 'navbar-collapse'))
  if (!toggle || !panel || !toggle.parentNode) return null
  const tree: NavTree = []
  for (const link of walk(panel)) {
    if (link.tagName !== 'a') continue
    const href = attr(link, 'href') ?? '',
      label = visibleText(link).trim().slice(0, 80)
    if (!label || !href || href === '#') continue
    const local = files.resolve(href, page.file)
    const hash = href.includes('#') ? href.slice(href.indexOf('#')) : ''
    const url = href.startsWith('#')
      ? `/${page.path}${href}`
      : local && routes.has(local)
        ? `/${routes.get(local)}${hash}`
        : href
    if (!url.startsWith('/') && !url.startsWith('https://')) continue
    tree.push({ label, target: { type: 'url', url }, visible: true })
  }
  if (!tree.length) return null
  replaceChildrenWithText(panel, `<span class="${MENU_MARKER}"></span>`)
  setAttr(panel, 'class', 'cms-import-desktop')
  setAttr(panel, 'id', null)
  const disclosure = fragment(
    `<details class="cms-import-menu"><summary aria-label="Menu">Menu</summary><nav aria-label="Mobile navigation"><span class="${MENU_MARKER}"></span></nav></details>`,
  ).childNodes[0]!
  const parent = toggle.parentNode
  parent.childNodes.splice(parent.childNodes.indexOf(toggle), 1, disclosure)
  ;(disclosure as { parentNode: ParentNode }).parentNode = parent
  return { css: importedMenuCss(), tree }
}

/** Shared by imports and versioned corrections to an earlier imported frame. */
export function importedMenuCss(): string {
  return [
    '.navbar{position:relative;top:auto;left:auto;right:auto}',
    '.navbar>.container{display:flex;align-items:center;justify-content:space-between}',
    '.cms-import-desktop{margin-left:auto}',
    '.cms-import-desktop .cms-nav-list{display:flex;align-items:center;gap:1.25rem;list-style:none;margin:0;padding:0}',
    '.cms-import-desktop .cms-nav-list a,.cms-import-menu a{font:inherit;color:inherit;text-decoration:none;font-weight:600}',
    '.cms-import-desktop .cms-nav-item{position:relative}',
    '.cms-import-desktop .cms-nav-submenu{display:none;position:absolute;top:100%;right:0;min-width:12rem;background:#fff;padding:1rem}',
    '.cms-import-desktop .cms-nav-item:hover>.cms-nav-submenu,.cms-import-desktop .cms-nav-item:focus-within>.cms-nav-submenu{display:block}',
    '.cms-import-menu{display:none;margin-left:auto}',
    '.cms-import-menu>summary{list-style:none;cursor:pointer;border:1px solid currentColor;border-radius:.5rem;padding:.5rem .75rem;font-weight:600}',
    '.cms-import-menu>summary::-webkit-details-marker{display:none}',
    '.cms-import-menu>nav{position:absolute;left:0;right:0;top:100%;background:#fff;color:#142238;padding:1rem;box-shadow:0 8px 16px #0002;z-index:10}',
    '.cms-import-menu .cms-nav-list{display:block;list-style:none;margin:0;padding:0}',
    '.cms-import-menu a{display:block;padding:.75rem .5rem}',
    '@media(max-width:991px){.cms-import-desktop{display:none}.cms-import-menu{display:block}}',
  ].join('\n')
}

// ---------------------------------------------------------------- fields --

const FIELD_KINDS = new Set(['text', 'richtext', 'image', 'link'])
const slugPart = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)

/** Fields from explicit tags: only what the HTML names becomes editable. */
function taggedFields(node: Element): { fields: SlotDef[]; samples: Record<string, unknown> } | null {
  const tagged = [...walk({ childNodes: [node] } as unknown as Node)].filter(el =>
    FIELD_KINDS.has(attr(el, 'data-cms-editable') ?? ''),
  )
  if (!tagged.length) return null
  const fields: SlotDef[] = [],
    samples: Record<string, unknown> = {},
    used = new Set<string>()
  const idFor = (el: Element, kind: string) => {
    const base =
      slugPart(attr(el, 'data-cms-id') ?? attr(el, 'id') ?? `${kind}-${fields.length + 1}`) ||
      `${kind}-${fields.length + 1}`
    let id = /^[a-z]/.test(base) ? base : `field-${base}`,
      n = 2
    while (used.has(id)) id = `${base}-${n++}`
    used.add(id)
    return id
  }
  const label = (id: string) => id.replace(/-/g, ' ').replace(/^./, c => c.toUpperCase())
  for (const el of tagged) {
    const kind = attr(el, 'data-cms-editable')!
    const id = idFor(el, kind)
    if (kind === 'image' && el.tagName === 'img') {
      samples[id] = {
        src: attr(el, 'src') ?? '',
        alt: attr(el, 'alt') ?? '',
        decorative: (attr(el, 'alt') ?? '') === '',
      }
      setAttr(el, 'src', `{{${id}}}`)
      setAttr(el, 'alt', `{{${id}}}`)
      setAttr(el, 'role', `{{${id}}}`)
      fields.push({ id, kind: 'image', label: label(id), constraints: {} })
    } else if (kind === 'link' && el.tagName === 'a') {
      samples[id] = { url: attr(el, 'href') ?? '', label: textOf(el).trim() || 'Link' }
      setAttr(el, 'href', `{{${id}}}`)
      fields.push({ id, kind: 'link', label: label(id), constraints: {} })
    } else if (kind === 'richtext') {
      samples[id] = serialize(el as unknown as ParentNode).trim()
      replaceChildrenWithText(el, `{{${id}}}`)
      fields.push({ id, kind: 'richtext', label: label(id), constraints: {} })
    } else {
      samples[id] = textOf(el).trim()
      replaceChildrenWithText(el, `{{${id}}}`)
      fields.push({ id, kind: 'text', label: label(id), constraints: {} })
    }
  }
  return { fields, samples }
}

/** The tags, classes and IDs a section contains, plus the wrapper it is placed in. */
function styleInventory(node: Element): StyleInventory {
  const found: StyleInventory = {
    tags: new Set(['div']),
    classes: new Set([ROOT_CLASS]),
    ids: new Set(),
    uncertain: false,
  }
  for (const el of [node, ...walk(node)]) {
    found.tags.add(el.tagName)
    for (const name of (attr(el, 'class') ?? '').split(/\s+/)) if (name) found.classes.add(name)
    const id = attr(el, 'id')
    if (id) found.ids.add(id)
  }
  return found
}

/** Keep elements the proposal step would refuse (inline icons) out of its way. */
function shelter(html: string): { html: string; restore: (value: string) => string } {
  const kept: string[] = []
  const sheltered = html.replace(/<svg\b[\s\S]*?<\/svg>/gi, svg => {
    kept.push(svg)
    return `<span data-cms-kept="${kept.length - 1}"></span>`
  })
  return {
    html: sheltered,
    restore: value =>
      value.replace(/<span data-cms-kept="(\d+)"><\/span>/g, (_m, index: string) => kept[Number(index)] ?? ''),
  }
}

// ------------------------------------------------------------------- run --

export async function importWebsite(options: WebsiteImportOptions): Promise<WebsiteImport> {
  const root = realpathSync(resolve(options.root))
  const publicDir = realpathSync(resolve(options.publicDir ?? options.root))
  const created = (options.now ?? new Date()).toISOString()
  const pageFiles = (
    options.pages ??
    readdirSync(root)
      .filter(file => /\.html?$/i.test(file))
      .sort((a, b) => (a === 'index.html' ? -1 : b === 'index.html' ? 1 : a.localeCompare(b)))
  ).map(file => {
    const page = localWebsiteFile(resolve(root, file), [root], PAGE_EXTENSIONS)
    if (!page) throw new Error('Choose HTML pages inside the website folder.')
    return page
  })
  if (!pageFiles.length) throw new Error('No pages to import: the folder has no .html files.')
  const declared = options.domains ?? []
  const files = new SiteFiles(root, publicDir, created, declared)
  const removed: Record<string, number> = {}
  const notes: string[] = []
  const pages = pageFiles.map(file => readPage(file, root))
  for (const page of pages)
    for (const [what, count] of Object.entries(page.skipped)) removed[what] = (removed[what] ?? 0) + count
  const paths = new Set<string>()
  for (const page of pages) {
    let path = page.path,
      n = 2
    while (paths.has(path)) path = `${page.path}-${n++}`
    page.path = path
    paths.add(path)
  }
  const routes = new Map(pages.map(page => [page.file, page.path]))
  // A page that names its own address (canonical link, sharing URL) names the site's domain.
  for (const page of pages)
    for (const el of walk(page.document)) {
      const named =
        el.tagName === 'link' && /\bcanonical\b/i.test(attr(el, 'rel') ?? '')
          ? attr(el, 'href')
          : el.tagName === 'meta' && attr(el, 'property') === 'og:url'
            ? attr(el, 'content')
            : undefined
      const host = named ? /^https?:\/\/([^/:]+)/i.exec(named)?.[1] : undefined
      if (host) files.domains.add(host.toLowerCase().replace(/^www\./, ''))
    }

  // Each page's stylesheet, in document order: its linked local sheets, any a
  // bundler injects, and every <style> block — in the head or anywhere in the
  // body, since a style block in the body still styles the whole page.
  const first = pages[0]!
  const sheets = new Map<string, string>()
  const remoteSheets = new Set<string>()
  function pageStylesheet(page: PageSource): string {
    const parts: string[] = []
    for (const el of walk(page.document)) {
      if (el.tagName === 'link' && /\bstylesheet\b/i.test(attr(el, 'rel') ?? '')) {
        const href = attr(el, 'href') ?? ''
        const path = files.resolve(href, page.file)
        if (path) {
          if (!sheets.has(path)) sheets.set(path, siteStylesheet(readFileSync(path, 'utf8'), path, files, removed))
          parts.push(sheets.get(path)!)
        } else if (!remoteSheets.has(href)) {
          remoteSheets.add(href)
          files.remote.add(href.slice(0, 160))
          removed['remote stylesheet'] = (removed['remote stylesheet'] ?? 0) + 1
        }
      } else if (el.tagName === 'style') {
        parts.push(siteStylesheet(textOf(el), page.file, files, removed))
      }
    }
    for (const extra of options.css ?? []) {
      const path = localWebsiteFile(resolve(root, extra), [root, publicDir], new Set(['.css']))
      if (!path) throw new Error('Choose stylesheets inside the website or public assets folder.')
      if (!sheets.has(path)) sheets.set(path, siteStylesheet(readFileSync(path, 'utf8'), path, files, removed))
      parts.push(sheets.get(path)!)
    }
    return parts.join('\n')
  }

  const definitions: SiteArchive['content']['section_defs'] = []
  const versions: SiteArchive['content']['section_def_versions'] = []
  const byContent = new Map<string, { id: string; slots: SlotDef[] }>()
  const sectionReports: SectionReport[] = []
  const slugs = new Set<string>()
  const siteSlug = slugPart(options.slug).slice(0, 20) || 'site'
  let importedNavigation: NavTree = []

  /** One section, as a definition and the values a page instance starts with. */
  function define(
    node: Element,
    page: PageSource,
    label: string,
    placement: 'page' | 'header' | 'footer',
    siteCss: string,
  ) {
    const inlineCss: string[] = []
    const menu = placement === 'header' ? adaptImportedMenu(node, page, files, routes) : null
    if (menu) {
      importedNavigation = menu.tree
      notes.push(
        'The scripted mobile menu was replaced with an accessible disclosure backed by the site Navigation workspace.',
      )
    }
    cleanTree(node, page, files, routes, removed, inlineCss, placement !== 'page')
    const extraCss = inlineCss.map(css => siteStylesheet(css, page.file, files, removed)).join('\n')
    const report: SectionReport = {
      page: page.path || 'home',
      label,
      fields: 0,
      mode: 'static',
      reused: false,
      problems: [],
    }
    let html: string,
      fields: SlotDef[] = [],
      samples: Record<string, unknown> = {}
    const tagged = taggedFields(node)
    for (const el of [...walk({ childNodes: [node] } as unknown as Node)])
      for (const a of [...el.attrs]) if (a.name.startsWith('data-cms-')) setAttr(el, a.name, null)
    if (tagged) {
      html = serializeOuter(node)
      fields = tagged.fields
      samples = tagged.samples
      report.mode = 'tagged'
    } else {
      const sheltered = shelter(serializeOuter(node))
      const proposal = organizeSource(sheltered.html, '')
      if (proposal.blocking.length) {
        html = sheltered.restore(sheltered.html)
        report.problems.push(...proposal.blocking)
      } else {
        html = sheltered.restore(proposal.sourceHtml)
        fields = proposal.fields
        samples = proposal.samples
        report.mode = fields.length ? 'proposed' : 'static'
      }
    }
    if (menu) {
      html = html.replace(new RegExp(`<span[^>]*class="${MENU_MARKER}"[^>]*>\\s*</span>`, 'g'), '{{site-menu}}')
      fields.push({ id: 'site-menu', kind: 'navigation', label: 'Site menu', constraints: {} })
    }
    const wrapped = `<div class="${ROOT_CLASS}">${html}</div>`
    // Only the rules that can match this section travel with it, read from the
    // tree already parsed rather than from a second, stricter parse that real
    // sites' markup can fail (and that then carried the whole stylesheet).
    let css = cssClosure(styleInventory(node), `${siteCss}\n${extraCss}`).css + (menu ? `\n${menu.css}` : '')
    if (css.length > MAX_SECTION_CSS) {
      report.problems.push('Its styles are larger than a section may carry; the excess was left out.')
      css = css.slice(0, css.lastIndexOf('}', MAX_SECTION_CSS) + 1)
    }
    const key = sha256(`${placement}\0${wrapped}\0${css}\0${JSON.stringify(fields)}`)
    const reuse = byContent.get(key)
    report.fields = fields.length
    if (reuse) {
      report.reused = true
      sectionReports.push(report)
      return { id: reuse.id, values: samples, label }
    }
    let slug = `${siteSlug}-${slugPart(page.path || 'home') || 'page'}-${slugPart(label) || 'section'}`
      .slice(0, 60)
      .replace(/-+$/, '')
    let n = 2
    while (slugs.has(slug)) slug = `${slug.slice(0, 57)}-${n++}`
    slugs.add(slug)
    let compiled = compileSection({
      sourceHtml: wrapped,
      sourceCss: css,
      slots: fields,
      scopeSelector: sectionScopeSelector(slug)!,
    })
    let sourceHtml = wrapped
    if (compiled.blocking.length && fields.length) {
      // Fall back to a fixed section rather than lose it.
      report.problems.push(...compiled.blocking.map(problem => `fields dropped: ${problem}`))
      sourceHtml = `<div class="${ROOT_CLASS}">${shelter(serializeOuter(node)).html.replace(/<span data-cms-kept="\d+"><\/span>/g, '')}</div>`
      fields = []
      samples = {}
      compiled = compileSection({ sourceHtml, sourceCss: css, slots: [], scopeSelector: sectionScopeSelector(slug)! })
      report.mode = 'static'
      report.fields = 0
    }
    if (compiled.blocking.length) {
      report.problems.push(...compiled.blocking)
      sectionReports.push(report)
      return null
    }
    report.problems.push(...compiled.problems.slice(0, 5))
    const id = randomUUID()
    definitions.push({
      id,
      slug,
      name: label.slice(0, 200),
      category: placement === 'page' ? 'Imported' : 'Imported frame',
      status: 'active',
      scope: 'site',
      placement,
    })
    versions.push({
      id: randomUUID(),
      section_def_id: id,
      version: 1,
      source_html: sourceHtml,
      source_css: css,
      slots: fields,
      definition_kind: 'legacy',
      structured_doc: null,
      structured_schema_version: null,
      changelog: `Imported from ${basename(page.file)}`,
      created_at: created,
    })
    byContent.set(key, { id, slots: fields })
    sectionReports.push(report)
    return { id, values: samples, label }
  }

  const siteCss = pageStylesheet(first)
  const archivePages: SiteArchive['content']['pages'] = []
  const pageVersions: SiteArchive['content']['page_versions'] = []
  const pageReports: WebsiteImportReport['pages'] = []
  for (const [index, page] of pages.entries()) {
    const pageCss = page === first ? siteCss : pageStylesheet(page)
    const content = []
    for (const [position, node] of page.sections.entries()) {
      const heading = find(node, el => /^h[1-6]$/.test(el.tagName))
      // A name an editor recognises: the section's own heading, else its first words.
      const words = visibleText(node).replace(/\s+/g, ' ').trim().split(' ').slice(0, 6).join(' ')
      const pictures = [...walk(node)].filter(el => el.tagName === 'img').length
      const label = (
        attr(node, 'data-cms-section') ||
        attr(node, 'aria-label') ||
        (heading ? textOf(heading).trim() : '') ||
        (words ? `${words}…` : '') ||
        attr(node, 'id') ||
        (pictures > 1 ? `${pictures} pictures` : `Section ${position + 1}`)
      )
        .replace(/\s+/g, ' ')
        .slice(0, 60)
      const section = define(node, page, label, 'page', pageCss)
      if (section)
        content.push({
          section_def_id: section.id,
          section_def_version: 1,
          values: section.values,
          hidden: false,
          hidden_at: [],
          label: section.label,
        })
    }
    const pageId = randomUUID(),
      versionId = randomUUID()
    archivePages.push({
      id: pageId,
      revision: 1,
      draft_version_id: versionId,
      published_version_id: null,
      slug: page.path,
      title: page.title.replace(/\s*[|–—-]\s*[^|–—-]+$/, '').trim() || page.title,
      layout_mode: 'sections',
      status: 'draft',
      editor_label: '',
      sort_index: index,
      archived_at: null,
    })
    pageVersions.push({
      id: versionId,
      revision: 1,
      created_at: created,
      page_id: pageId,
      content,
      kind: 'checkpoint',
      meta: { title: page.title, description: page.description, noindex: false },
      note: 'Imported website',
      page_title: archivePages.at(-1)!.title,
      page_slug: page.path,
    })
    pageReports.push({
      file: relative(root, page.file),
      path: `/${page.path}`,
      title: archivePages.at(-1)!.title,
      sections: content.length,
    })
  }

  // The first page's header and footer stand for the site's.
  const frameOf = (kind: 'header' | 'footer') => {
    const node = first[kind]
    if (!node) return null
    const section = define(node, first, kind === 'header' ? 'Site header' : 'Site footer', kind, siteCss)
    return section
      ? {
          schemaVersion: 2 as const,
          enabled: true,
          ...(kind === 'header' ? { sticky: false } : {}),
          component: { section_def_id: section.id, section_def_version: 1, values: section.values },
        }
      : null
  }
  const header = frameOf('header'),
    footer = frameOf('footer')
  if (!header) notes.push('No <header> was found; the site starts with the built-in header.')
  if (!footer) notes.push('No <footer> was found; the site starts with the built-in footer.')

  await files.processImages()
  if (files.droppedFonts.size)
    notes.push(
      'Fonts outside the governed registry are not carried over; the site uses its fallback fonts until a developer registers licensed font files.',
    )
  if (files.remote.size)
    notes.push(
      "Remote stylesheets, images and fonts are not loaded by published pages; download them into the site folder to import them. A full address on the site's own domain is read from the folder when the domain is named (--domain).",
    )
  if (files.unreadable.size)
    notes.push(`These stylesheets could not be read and were left out: ${[...files.unreadable].join(', ')}.`)
  if (files.unimported.size)
    notes.push(
      `Links lead to pages that were not imported: ${[...files.unimported].join(', ')}. Import them too, or publishing will ask about those links.`,
    )
  const headless = pageVersions
    .filter(
      version =>
        !version.content.some(section => {
          const definition = versions.find(row => row.section_def_id === section.section_def_id)
          return /<h1[\s>]/i.test(definition?.source_html ?? '') || JSON.stringify(section.values).includes('<h1')
        }),
    )
    .map(version => `/${version.page_slug}`)
  if (headless.length)
    notes.push(
      `Pages without a main heading (<h1>): ${headless.join(', ')}. Publishing asks for one, for readers and search engines. Change the page's first heading to <h1> in the source before importing, or afterwards in Section library → Edit section; until then an administrator can publish with a recorded reason.`,
    )

  const one = (headId = randomUUID(), versionId = randomUUID()) => ({
    id: headId,
    revision: 1,
    draft_version_id: versionId,
    published_version_id: null,
  })
  const theme = one(),
    settings = one(),
    navigation = one(),
    headerHead = one(),
    footerHead = one()
  // Checked in full by parseSiteArchive below; field values are JSON by construction.
  const content = {
    site: { name: options.name, slug: options.slug, kind: options.kind ?? 'general' },
    pages: archivePages,
    page_versions: pageVersions,
    themes: [theme],
    theme_versions: [
      {
        id: theme.draft_version_id,
        revision: 1,
        created_at: created,
        theme_id: theme.id,
        tokens: DEFAULT_THEME_TOKENS,
      },
    ],
    site_settings: [settings],
    site_setting_versions: [
      {
        id: settings.draft_version_id,
        revision: 1,
        created_at: created,
        site_settings_id: settings.id,
        settings: { name: options.name },
      },
    ],
    navigations: [{ ...navigation, mode: 'manual' }],
    navigation_versions: [
      {
        id: navigation.draft_version_id,
        revision: 1,
        created_at: created,
        navigation_id: navigation.id,
        tree: importedNavigation,
      },
    ],
    global_elements: [
      { ...headerHead, kind: 'header', use_on_live: true },
      { ...footerHead, kind: 'footer', use_on_live: true },
    ],
    global_element_versions: [
      {
        id: headerHead.draft_version_id,
        revision: 1,
        created_at: created,
        global_element_id: headerHead.id,
        content: header ?? {
          ...DEFAULT_HEADER_CONFIG_V1,
          brand: { ...DEFAULT_HEADER_CONFIG_V1.brand, siteName: options.name },
        },
      },
      {
        id: footerHead.draft_version_id,
        revision: 1,
        created_at: created,
        global_element_id: footerHead.id,
        content: footer ?? {
          ...DEFAULT_FOOTER_CONFIG_V1,
          brand: { ...DEFAULT_FOOTER_CONFIG_V1.brand, siteName: options.name },
        },
      },
    ],
    section_defs: definitions,
    section_def_versions: versions,
    collections: [],
    collection_schema_versions: [],
    collection_entries: [],
    collection_entry_versions: [],
    site_assets: files.assets,
    document_metadata: files.assets
      .filter(asset => asset.kind === 'document')
      .map(asset => ({ asset_id: asset.id, category: 'Imported', archived: false })),
    media: files.media,
    media_variants: files.variants,
  } as unknown as SiteArchive['content']
  const archive = parseSiteArchive({
    format: SITE_ARCHIVE_FORMAT,
    version: SITE_ARCHIVE_VERSION,
    exported_at: created,
    content,
    objects: files.objects,
  })
  return {
    archive,
    report: {
      site: { name: options.name, slug: options.slug },
      pages: pageReports,
      sections: sectionReports,
      header: header ? 'imported as the site header' : 'not found',
      footer: footer ? 'imported as the site footer' : 'not found',
      media: {
        images: files.media.length,
        converted: files.converted,
        missing: [...files.missing],
        remote: [...files.remote],
      },
      documents: files.assets.filter(asset => asset.kind === 'document').length,
      fonts: { registered: [...files.registeredFonts], dropped: [...files.droppedFonts] },
      removed,
      notes,
    },
  }
}

/** The report as Markdown, for a person deciding whether the draft is ready. */
export function websiteReportMarkdown(report: WebsiteImportReport): string {
  const lines = [
    `# Import report: ${report.site.name}`,
    '',
    `${report.pages.length} pages, ${report.sections.length} sections, ${report.media.images} images, ${report.documents} documents.`,
    '',
    '## Pages',
    '',
    '| File | Address | Title | Sections |',
    '| --- | --- | --- | --- |',
    ...report.pages.map(page => `| ${page.file} | ${page.path} | ${page.title} | ${page.sections} |`),
    '',
    '## Sections',
    '',
    '| Page | Section | Editable fields | How | Notes |',
    '| --- | --- | --- | --- | --- |',
    ...report.sections.map(
      section =>
        `| ${section.page} | ${section.label} | ${section.fields} | ${section.reused ? 'shared with an earlier page' : section.mode} | ${section.problems.slice(0, 3).join('; ').replace(/\|/g, '/')} |`,
    ),
    '',
    `Header: ${report.header}. Footer: ${report.footer}.`,
    '',
    '## Left out',
    '',
    ...Object.entries(report.removed).map(([what, count]) => `- ${what}: ${count}`),
    ...(report.fonts.dropped.length ? [`- fonts not in the registry: ${report.fonts.dropped.join(', ')}`] : []),
    ...(report.media.missing.length ? [`- images that could not be read: ${report.media.missing.join(', ')}`] : []),
    ...(report.media.remote.length
      ? [
          `- remote files: ${report.media.remote.slice(0, 20).join(', ')}${report.media.remote.length > 20 ? ', …' : ''}`,
        ]
      : []),
    '',
    ...report.notes.map(note => `- ${note}`),
  ]
  return `${lines.join('\n')}\n`
}
