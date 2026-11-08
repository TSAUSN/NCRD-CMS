/** Convert one approved offline conference page into a private draft archive. */
import { randomUUID } from 'node:crypto'
import { parse, serializeOuter, type DefaultTreeAdapterMap } from 'parse5'
import { compileSection, sectionScopeSelector } from '@cms/renderer'
import type { SiteArchive, SiteFileBundle, SlotDef } from '@cms/schema'
import { assembleBetterTogetherArchive } from './better-together-archive.ts'
import { BETTER_TOGETHER_SOURCE_ORIGIN, readBetterTogetherAssets } from './better-together-assets.ts'
type Node = DefaultTreeAdapterMap['node']
type Element = DefaultTreeAdapterMap['element']
const attr = (node: Element, name: string) => node.attrs.find(a => a.name === name)?.value
function* walk(node: Node): Generator<Element> {
  if ('tagName' in node) yield node
  for (const child of 'childNodes' in node ? node.childNodes : []) yield* walk(child)
}
const text = (node: Node): string =>
  'value' in node ? node.value : 'childNodes' in node ? node.childNodes.map(text).join('') : ''
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

  const created = new Date().toISOString()
  const slug = options.slug ?? 'bt2027-r8'
  const { files, objects, paths, omitted, add, resource, fileIdAtPath } = readBetterTogetherAssets(
    options.root,
    options.cache,
    created,
  )
  const styles: SiteFileBundle['styles'] = []
  const scripts: SiteFileBundle['scripts'] = []
  const sourceBase = BETTER_TOGETHER_SOURCE_ORIGIN
  const doc = parse(options.html),
    elements = [...walk(doc)],
    html = elements.find(n => n.tagName === 'html')!,
    body = elements.find(n => n.tagName === 'body')!,
    pageId = randomUUID()
  // Keep stylesheet cascade order, including styles originally inside the body.
  for (const [index, node] of elements.entries()) {
    if (node.tagName === 'link' && /\bstylesheet\b/.test(attr(node, 'rel') ?? '')) {
      const fileId = fileIdAtPath(resource(attr(node, 'href') ?? ''))
      if (!fileId) throw new Error('A homepage stylesheet is missing from the offline cache.')
      styles.push({ fileId, pages: [pageId] })
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
      const fileId = src
        ? fileIdAtPath(resource(src))
        : add(
            'script',
            prefix + '-inline-' + index + '.js',
            'local:' + page + '#script-' + index,
            Buffer.from(code),
            '/js/' + prefix + '-inline-' + index + '.js',
          ).id
      if (!fileId) throw new Error('A homepage script is missing from the offline cache.')
      scripts.push({ fileId, position, loading: 'normal', pages: [pageId] })
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

  const archive = assembleBetterTogetherArchive({
    created,
    slug,
    pageSlug: home ? '' : prefix,
    pageId,
    title,
    originalTitle,
    description,
    quirks: doc.mode === 'quirks',
    html: Object.fromEntries(html.attrs.map(attribute => [attribute.name, attribute.value])),
    body: Object.fromEntries(body.attrs.map(attribute => [attribute.name, attribute.value])),
    header,
    footer,
    files,
    objects,
    styles,
    scripts,
    paths,
    definitions,
    versions,
    content,
  })
  return { archive, report, omitted: [...omitted] }
}
