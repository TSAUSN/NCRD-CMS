/** BT2027 offline marketing pages. No network, crawling or backend reads:
 * rendered marketing HTML and explicitly referenced public files only. */
import { createHash, randomUUID } from 'node:crypto'
import { readFileSync, realpathSync, statSync } from 'node:fs'
import { basename, extname, resolve, sep } from 'node:path'
import { parse, serializeOuter, type DefaultTreeAdapterMap } from 'parse5'
import { compileSection, sectionScopeSelector } from '@cms/renderer'
import {
  DEFAULT_THEME_TOKENS,
  DEFAULT_HEADER_CONFIG_V1,
  DEFAULT_FOOTER_CONFIG_V1,
  parseSiteArchive,
  type SiteArchive,
  type SiteFileBundle,
  type SiteFileKind,
  type SlotDef,
} from '@cms/schema'

type Node = DefaultTreeAdapterMap['node']
type Element = DefaultTreeAdapterMap['element']
type Receipt = { source: string; final: string; file: string; hash: string; bytes: number; type: string }
const hash = (bytes: string | Uint8Array) => createHash('sha256').update(bytes).digest('hex')
const attr = (node: Element, name: string) => node.attrs.find(a => a.name === name)?.value
function* walk(node: Node): Generator<Element> {
  if ('tagName' in node) yield node
  for (const child of 'childNodes' in node ? node.childNodes : []) yield* walk(child)
}
const text = (node: Node): string =>
  'value' in node ? node.value : 'childNodes' in node ? node.childNodes.map(text).join('') : ''
const extensions = /\.(?:css|js|png|jpe?g|gif|webp|svg|woff2?|ttf|otf)$/i
const kindOf = (name: string): SiteFileKind =>
  /\.css$/i.test(name)
    ? 'stylesheet'
    : /\.js$/i.test(name)
      ? 'script'
      : /\.(?:woff2?|ttf|otf)$/i.test(name)
        ? 'font'
        : 'image'
export const BT_NO_SCRIPT_CSS =
  '@media(scripting:none){.animate-on-scroll{opacity:1;transform:none}.sched-panel{display:block}}'

export type BetterTogetherPage =
  | 'index.php'
  | 'exhibitors.php'
  | 'hotel-information.php'
  | 'kansas-city.php'
  | 'sponsorship.php'
  | 'registration-FAQs.php'
  | 'privacy-policy.php'
  | 'manifesto.html'
  | 'workshops.html'
export function importBetterTogetherPage(options: {
  root: string
  html: string
  cache: string
  slug?: string
  page?: BetterTogetherPage
  title?: string
}) {
  const page = options.page ?? 'index.php',
    home = page === 'index.php',
    prefix = home ? 'home' : page.replace(/\.(?:php|html)$/, '').toLowerCase(),
    title = options.title ?? 'Better Together 2027'
  if (
    ![
      'index.php',
      'exhibitors.php',
      'hotel-information.php',
      'kansas-city.php',
      'sponsorship.php',
      'registration-FAQs.php',
      'privacy-policy.php',
      'manifesto.html',
      'workshops.html',
    ].includes(page)
  )
    throw new Error('Choose a BT2027 marketing page.')
  const root = realpathSync(options.root),
    cache = realpathSync(options.cache),
    created = new Date().toISOString(),
    slug = options.slug ?? 'bt2027-r8'
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
  const files: NonNullable<SiteArchive['content']['site_files']> = [],
    objects: SiteArchive['objects'] = [],
    paths: NonNullable<SiteFileBundle['paths']> = [],
    styles: SiteFileBundle['styles'] = [],
    scripts: SiteFileBundle['scripts'] = []
  const loaded = new Map<string, { id: string; path: string }>(),
    omitted = new Set<string>(),
    sourceBase = 'https://bettertogether2027.org/'
  function add(kind: SiteFileKind, name: string, source: string, bytes: Buffer, path: string) {
    const id = randomUUID()
    files.push({ id, kind, name, source, bytes: bytes.length, sha256: hash(bytes), created_at: created })
    objects.push({ media_id: id, kind: 'site-file', sha256: hash(bytes), base64: bytes.toString('base64') })
    paths.push({ path, fileId: id })
    return { id, path }
  }
  function resource(value: string, base = sourceBase): string {
    if (!value || /^(?:data:|#)/i.test(value)) return value
    const url = new URL(value, base),
      key = url.origin + url.pathname + url.search,
      existing = loaded.get(key)
    if (existing) return existing.path + url.hash
    let bytes: Buffer, name: string, path: string, source: string
    if (url.hostname === new URL(sourceBase).hostname) {
      const relative = decodeURIComponent(url.pathname).replace(/^\//, '')
      if (!extensions.test(relative) || !/^(?:css|images|js|fonts)\//.test(relative)) return value
      const lexical = resolve(root, relative),
        real = realpathSync(lexical)
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
    const kind = kindOf(name),
      reserved = { id: randomUUID(), path }
    loaded.set(key, reserved)
    if (kind === 'stylesheet') {
      let css = bytes.toString('utf8')
      css = css.replace(/@import\s+(?:url\(\s*)?["']?([^"'\s);]+)["']?\s*\)?[^;]*;/gi, (_match, href: string) => {
        const imported = resource(href, url.href),
          entry = paths.find(row => row.path === imported),
          object = entry && objects.find(object => object.media_id === entry.fileId)
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
  const doc = parse(options.html),
    elements = [...walk(doc)],
    html = elements.find(n => n.tagName === 'html')!,
    body = elements.find(n => n.tagName === 'body')!,
    pageId = randomUUID()
  // Keep stylesheet cascade order, including styles originally inside the body.
  for (const [index, node] of elements.entries()) {
    if (node.tagName === 'link' && /\bstylesheet\b/.test(attr(node, 'rel') ?? '')) {
      const path = resource(attr(node, 'href') ?? ''),
        file = paths.find(row => row.path === path)
      if (!file) throw new Error('A homepage stylesheet is missing from the offline cache.')
      styles.push({ fileId: file.fileId, pages: [pageId] })
    } else if (node.tagName === 'style') {
      const css = text(node).replace(
        /url\(\s*(["']?)(.*?)\1\s*\)/gi,
        (_match, _quote, href) => 'url("' + resource(href) + '")',
      )
      const file = add(
        'stylesheet',
        prefix + '-inline-' + index + '.css',
        'local:' + page + '#style-' + index,
        Buffer.from(css),
        '/css/' + prefix + '-inline-' + index + '.css',
      )
      styles.push({ fileId: file.id, pages: [pageId] })
    } else if (node.tagName === 'script') {
      const src = attr(node, 'src'),
        code = text(node)
      if (src?.includes('googletagmanager.com') || /\bgtag\(/.test(code)) {
        omitted.add('Analytics is disabled for local comparison.')
        continue
      }
      const position =
        body.childNodes.indexOf(node) >= 0 && body.childNodes.indexOf(node) < 3 ? 'body-start' : 'body-end'
      const scriptPath = src ? resource(src) : null
      const file = src
        ? paths.find(row => row.path === scriptPath)
        : add(
            'script',
            prefix + '-inline-' + index + '.js',
            'local:' + page + '#script-' + index,
            Buffer.from(code),
            '/js/' + prefix + '-inline-' + index + '.js',
          )
      if (!file) throw new Error('A homepage script is missing from the offline cache.')
      scripts.push({ fileId: 'fileId' in file ? file.fileId : file.id, position, loading: 'normal', pages: [pageId] })
    }
  }
  const fallback = add(
    'stylesheet',
    'home-without-javascript.css',
    'cms:BT2027 readable content without JavaScript',
    Buffer.from(BT_NO_SCRIPT_CSS),
    '/css/home-without-javascript.css',
  )
  styles.push({ fileId: fallback.id, pages: [pageId] })
  const definitions: SiteArchive['content']['section_defs'] = [],
    versions: SiteArchive['content']['section_def_versions'] = [],
    content: SiteArchive['content']['page_versions'][number]['content'] = []
  const report: { name: string; text: number; images: number; links: number }[] = []
  function define(node: Element, placement: 'page' | 'header' | 'footer', index: number) {
    const slots: SlotDef[] = [],
      values: Record<string, unknown> = {},
      counts = { text: 0, images: 0, links: 0 }
    // Remove executable/style elements only after their exact bytes are external.
    function clean(parent: Element) {
      parent.childNodes = parent.childNodes.filter(n => !('tagName' in n && ['script', 'style'].includes(n.tagName)))
      for (const child of parent.childNodes) if ('tagName' in child) clean(child)
    }
    clean(node)
    for (const el of walk(node)) {
      if (el.attrs.some(a => /^on/i.test(a.name)))
        throw new Error('Inline event handlers need explicit review before import.')
      for (const a of el.attrs) {
        if (['src', 'poster'].includes(a.name)) a.value = resource(a.value)
        if (a.name === 'href' && !a.value.startsWith('#')) {
          try {
            const url = new URL(a.value, sourceBase),
              name = url.pathname.slice(1).toLowerCase()
            if (
              url.hostname === 'bettertogether2027.org' &&
              [
                'index.php',
                'exhibitors.php',
                'hotel-information.php',
                'kansas-city.php',
                'sponsorship.php',
                'registration-faqs.php',
                'privacy-policy.php',
                'manifesto.html',
                'workshops.html',
              ].includes(name)
            )
              a.value = (name === 'index.php' ? '/' : '/' + name.replace(/\.(?:php|html)$/, '')) + url.search + url.hash
            else if (url.hostname === 'bettertogether2027.org' && name === 'workshop-submissions.html')
              a.value = url.href
          } catch {}
        }
      }
      if (el.tagName === 'img' && attr(el, 'src')) {
        const id = 'picture-' + slots.length,
          src = attr(el, 'src')!,
          alt = attr(el, 'alt') ?? ''
        slots.push({ id, kind: 'image', label: alt || 'Picture', constraints: {} })
        values[id] = { src, alt }
        el.attrs.find(a => a.name === 'src')!.value = '{{' + id + '}}'
        const a = el.attrs.find(a => a.name === 'alt')
        if (a) a.value = '{{' + id + '}}'
        counts.images++
      }
      if (
        /^(?:h[1-6]|p|a|strong|span)$/.test(el.tagName) &&
        el.childNodes.length &&
        el.childNodes.every(n => n.nodeName === '#text') &&
        text(el).trim() &&
        !/^cd-/.test(attr(el, 'id') ?? '')
      ) {
        const value = text(el),
          id = 'text-' + slots.length
        slots.push({ id, kind: 'text', label: value.trim().slice(0, 70), constraints: {} })
        values[id] = value
        el.childNodes = [{ nodeName: '#text', value: '{{' + id + '}}', parentNode: el }]
        counts.text++
      }
    }
    const source = serializeOuter(node),
      id = randomUUID(),
      sectionSlug = 'bt-' + prefix + '-' + index,
      label =
        placement === 'header'
          ? 'Site header'
          : placement === 'footer'
            ? 'Site footer'
            : (attr(node, 'id') ??
                (index === 1
                  ? 'Conference introduction'
                  : text(node)
                      .replace(/\{\{[^}]+\}\}/g, '')
                      .trim()
                      .slice(0, 45))) ||
              'Homepage section ' + index
    const compiled = compileSection({
      sourceHtml: source,
      sourceCss: '',
      slots,
      scopeSelector: sectionScopeSelector(sectionSlug)!,
    })
    if (compiled.blocking.length || compiled.carriesTrustedCode)
      throw new Error(label + ': ' + [...compiled.blocking, ...compiled.problems].join('; '))
    definitions.push({
      id,
      slug: sectionSlug,
      name: label,
      category: 'Better Together',
      status: 'active',
      scope: 'site',
      placement,
    })
    versions.push({
      id: randomUUID(),
      section_def_id: id,
      version: 1,
      source_html: source,
      source_css: '',
      slots,
      definition_kind: 'legacy',
      structured_doc: null,
      structured_schema_version: null,
      changelog: 'Original local BT2027 homepage markup',
      created_at: created,
    })
    report.push({ name: label, ...counts })
    return { section_def_id: id, section_def_version: 1, values }
  }
  let header: ReturnType<typeof define> | undefined, footer: ReturnType<typeof define> | undefined
  for (const [index, node] of body.childNodes
    .filter((node): node is Element => 'tagName' in node && !['script', 'style'].includes(node.tagName))
    .entries()) {
    if (home && node.tagName === 'nav' && !header) header = define(node, 'header', index)
    else if (home && (attr(node, 'class') ?? '').split(' ').includes('footer')) footer = define(node, 'footer', index)
    else content.push({ ...define(node, 'page', index), hidden: false, hidden_at: [], label: definitions.at(-1)!.name })
  }
  const originalTitle =
      (elements.find(node => node.tagName === 'title') ? text(elements.find(node => node.tagName === 'title')!) : title)
        .trim()
        .slice(0, 200) || title,
    description =
      attr(elements.find(node => node.tagName === 'meta' && attr(node, 'name') === 'description') ?? html, 'content') ??
      ''
  const one = () => ({ id: randomUUID(), revision: 1, draft_version_id: randomUUID(), published_version_id: null }),
    pageVersion = randomUUID(),
    theme = one(),
    settings = one(),
    navigation = one(),
    head = one(),
    foot = one(),
    fileVersion = randomUUID()
  const bundle: SiteFileBundle = {
    version: 1,
    files: files.map(file => file.id),
    scripts,
    styles,
    paths,
    original: {
      version: 1,
      definitions: definitions.map(def => ({ section_def_id: def.id, section_def_version: 1 })),
      pages: [
        {
          pageId,
          ...(doc.mode === 'quirks' ? { quirks: true } : {}),
          html: Object.fromEntries(html.attrs.map(a => [a.name, a.value])),
          body: Object.fromEntries(body.attrs.map(a => [a.name, a.value])),
          header: !!header,
          footer: !!footer,
        },
      ],
    },
  }
  const archive = parseSiteArchive({
    format: 'cms-site-content',
    version: 1,
    exported_at: created,
    objects,
    content: {
      site: { name: 'Better Together 2027', slug, kind: 'conference' },
      pages: [
        {
          id: pageId,
          revision: 1,
          draft_version_id: pageVersion,
          published_version_id: null,
          slug: home ? '' : prefix,
          title,
          layout_mode: 'sections',
          status: 'draft',
          editor_label: '',
          sort_index: 0,
          archived_at: null,
        },
      ],
      page_versions: [
        {
          id: pageVersion,
          revision: 1,
          created_at: created,
          page_id: pageId,
          content,
          meta: { title: originalTitle, description, noindex: false },
          kind: 'checkpoint',
          note: 'Original local homepage',
          page_title: title,
          page_slug: home ? '' : prefix,
        },
      ],
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
          settings: { name: 'Better Together 2027' },
        },
      ],
      navigations: [{ ...navigation, mode: 'manual' }],
      navigation_versions: [
        { id: navigation.draft_version_id, revision: 1, created_at: created, navigation_id: navigation.id, tree: [] },
      ],
      global_elements: [
        { ...head, kind: 'header', use_on_live: true },
        { ...foot, kind: 'footer', use_on_live: true },
      ],
      global_element_versions: [
        {
          id: head.draft_version_id,
          revision: 1,
          created_at: created,
          global_element_id: head.id,
          content: header
            ? { schemaVersion: 2, enabled: true, sticky: false, component: header }
            : { ...DEFAULT_HEADER_CONFIG_V1, enabled: false },
        },
        {
          id: foot.draft_version_id,
          revision: 1,
          created_at: created,
          global_element_id: foot.id,
          content: footer
            ? { schemaVersion: 2, enabled: true, component: footer }
            : { ...DEFAULT_FOOTER_CONFIG_V1, enabled: false },
        },
      ],
      section_defs: definitions,
      section_def_versions: versions,
      collections: [],
      collection_schema_versions: [],
      collection_entries: [],
      collection_entry_versions: [],
      media: [],
      media_variants: [],
      site_files: files,
      site_file_versions: [{ id: fileVersion, version: 1, bundle, reviewed_at: created }],
      site_file_heads: [{ revision: 1, draft_version_id: fileVersion, published_version_id: null }],
    },
  })
  return { archive, report, omitted: [...omitted] }
}

/** Backwards-compatible entry for the completed homepage checkpoint. */
export const importBetterTogetherHomepage = importBetterTogetherPage
