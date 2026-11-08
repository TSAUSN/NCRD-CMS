// A V1 site's real header and footer as authored frame components (ADR 0010).
//
// The source frame is kept element for element. Only three things change, each
// because V2 pages carry no scripts and own their menu:
//   1. every hand-written menu becomes one `navigation` slot, filled from the
//      site's governed Navigation;
//   2. the scripted phone-menu button becomes a <details> disclosure;
//   3. the scripted contact pop-out becomes a <details> disclosure.
// Fixed positioning becomes the frame's sticky option, and a script-filled year
// becomes the year of preparation. Everything else — classes, layout, copy,
// images, links — is the source's, styled by the source's own compiled CSS.
import postcss from 'postcss'
import { compileSection, sectionScopeSelector } from '@cms/renderer'
import type { SlotDef } from '@cms/schema'
import { attribute, parseHtml, type HtmlElement, type HtmlNode } from './html.ts'
import { serializeLegacy } from './legacy-values.ts'
import { referenceCssClosure } from './reference-css-closure.ts'
import { referenceStyles } from './reference-styles.ts'
import { editableReference } from './editable-reference.ts'
import { remapReferenceUrls, type ImportedAsset } from './media-transfer.ts'

/** Stands in for the menu until field extraction has run; never stored. */
const MENU_MARKER = 'cms-frame-menu-marker'
const FRAME_MENU_SLOT: SlotDef = { id: 'site-menu', kind: 'navigation', label: 'Site menu', constraints: {} }

export type FrameSource = { html: string; css: string; issues: string[] }

const el = (tag: string, attributes: Record<string, string>, children: HtmlNode[] = [], line = 0): HtmlElement =>
  ({
    kind: 'element',
    tag,
    line,
    attributes: Object.entries(attributes).map(([name, value]) => ({ name, value })),
    children,
  }) as HtmlElement
const text = (value: string): HtmlNode => ({ kind: 'text', line: 0, text: value }) as HtmlNode
const marker = (): HtmlElement => el('span', { class: MENU_MARKER })
const classes = (node: HtmlElement) => (attribute(node, 'class') ?? '').split(/\s+/).filter(Boolean)
const setAttribute = (node: HtmlElement, name: string, value: string | null) => {
  node.attributes = node.attributes.filter(attr => attr.name !== name)
  if (value !== null) node.attributes.push({ name, value })
}
function find(nodes: HtmlNode[], test: (node: HtmlElement) => boolean): HtmlElement | undefined {
  for (const node of nodes) {
    if (node.kind === 'text') continue
    if (test(node)) return node
    const inner = find(node.children, test)
    if (inner) return inner
  }
  return undefined
}
function remove(nodes: HtmlNode[], target: HtmlElement): boolean {
  const index = nodes.indexOf(target)
  if (index >= 0) {
    nodes.splice(index, 1)
    return true
  }
  return nodes.some(node => node.kind !== 'text' && remove(node.children, target))
}
function region(source: string, tag: 'header' | 'footer'): HtmlElement {
  const markup = new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?<\\/${tag}\\s*>`, 'i').exec(source)?.[0]
  const parsed = markup ? parseHtml(markup) : null
  const root = parsed?.ok
    ? parsed.nodes.find((node): node is HtmlElement => node.kind !== 'text' && node.tag === tag)
    : undefined
  if (!root) throw new Error(`source ${tag} could not be read`)
  return root
}

/** The source root's own classes survive on a wrapper; positioning does not. */
function wrapper(root: HtmlElement, frameClass: string): HtmlElement {
  const kept = classes(root).filter(
    name => !/^(fixed|sticky|top-0|left-0|right-0|bottom-0|z-\d+|transition-shadow|duration-\d+)$/.test(name),
  )
  // v1-reference-root carries the source's document-root tokens and body
  // rules, exactly as for migrated page sections (reference-styles.ts). It is
  // its own element: the source body's background must not beat the frame's.
  return el('div', { class: `v1-reference-root ${frameClass}` }, [el('div', { class: kept.join(' ') }, root.children)])
}

export function sourceHeaderFrame(indexHtml: string): FrameSource {
  const root = region(indexHtml, 'header')
  frameAnchors(root, indexHtml)
  if (classes(root).includes('site-header') && find(root.children, node => classes(node).includes('desktop-nav'))) {
    return echelonHeaderFrame(root)
  }
  const issues = new Set<string>(['frame-fixed-position-rendered-sticky'])
  const toggle = find(
    root.children,
    node => node.tag === 'button' && attribute(node, 'aria-controls') === 'mobile-menu',
  )
  const mobile = find(root.children, node => node.tag === 'nav' && attribute(node, 'id') === 'mobile-menu')
  const desktop = find(root.children, node => node.tag === 'nav' && attribute(node, 'id') !== 'mobile-menu')
  if (!toggle || !mobile || !desktop) throw new Error('source header menu could not be identified')

  // The desktop row keeps its container and alignment; its hand-written links
  // become the site's menu.
  const row = desktop.children.find((node): node is HtmlElement => node.kind !== 'text') ?? desktop
  row.children = [marker()]
  setAttribute(desktop, 'aria-label', attribute(desktop, 'aria-label') ?? 'Main navigation')

  // The phone menu: the button's icon becomes the summary; the dropdown panel
  // keeps its classes, drops the script's `hidden`, and shows the same menu.
  const panelClasses = classes(mobile).filter(name => name !== 'hidden' && name !== 'sm:hidden')
  const summary = el(
    'summary',
    {
      class: [...classes(toggle), 'hni-menu-toggle'].join(' '),
      'aria-label': attribute(toggle, 'aria-label') ?? 'Menu',
    },
    toggle.children,
  )
  const details = el('details', { class: 'hni-mobile-menu sm:hidden' }, [
    summary,
    el('nav', { class: panelClasses.join(' '), 'aria-label': 'Mobile navigation' }, [marker()]),
  ])
  remove(root.children, mobile)
  const parent = find(root.children, node => node.children.includes(toggle))
  if (!parent) throw new Error('source header menu button has no container')
  parent.children.splice(parent.children.indexOf(toggle), 1, details)
  issues.add('frame-mobile-menu-scriptless-disclosure')
  issues.add('frame-menu-from-site-navigation')

  const css = [
    // The source menu style, applied to the governed menu's own markup.
    '.hni-frame .cms-nav-list{display:flex;align-items:center;gap:2.5rem;list-style:none;margin:0;padding:0}',
    '.hni-frame .cms-nav-list a{position:relative;display:inline-flex;align-items:center;padding:.25rem 0;font-family:var(--font-body);font-size:.8125rem;font-weight:600;color:var(--color-sa-dark);text-transform:uppercase;letter-spacing:.08em;white-space:nowrap;transition:color .2s ease;text-decoration:none}',
    ".hni-frame .cms-nav-list a::after{content:'';position:absolute;left:0;right:0;bottom:-3px;height:2px;background-color:var(--color-primary);transform:scaleX(0);transform-origin:left;transition:transform .28s cubic-bezier(.4,0,.2,1)}",
    '.hni-frame .cms-nav-list a:hover,.hni-frame .cms-nav-list a[aria-current=page]{color:var(--color-primary)}',
    '.hni-frame .cms-nav-list a:hover::after,.hni-frame .cms-nav-list a[aria-current=page]::after{transform:scaleX(1)}',
    // Authored frames do not carry the preset's .cms-site-nav class. Their
    // nested menus need their own focus/hover and phone rules.
    ...nestedMenuStyles('.hni-frame', '.hni-mobile-menu'),
    // Phone disclosure: the summary replaces the button; the panel drops below the bar.
    '.hni-frame .hni-mobile-menu>summary{list-style:none;cursor:pointer}',
    '.hni-frame .hni-mobile-menu>summary::-webkit-details-marker{display:none}',
    '.hni-frame .hni-mobile-menu>nav{position:absolute;left:0;right:0;top:100%}',
    '.hni-frame .hni-mobile-menu .cms-nav-list{display:block}',
    '.hni-frame .hni-mobile-menu .cms-nav-list a{display:block;padding:.625rem 0;font-size:.875rem;text-transform:none;letter-spacing:0}',
    '.hni-frame .hni-mobile-menu .cms-nav-list a::after{display:none}',
    '.hni-frame{position:relative}',
  ].join('\n')
  return { html: serializeLegacy([wrapper(root, 'hni-frame')]), css, issues: [...issues].sort() }
}

/** The governed list replaces native anchors, without changing each site's
 * visual layout. Child links remain reachable by keyboard and on phones. */
function nestedMenuStyles(frame: string, mobile: string): string[] {
  return [
    `${frame} .cms-nav-item{position:relative}`,
    `${frame} .cms-nav-submenu{display:none;position:absolute;left:0;top:100%;min-width:12rem;gap:0;padding:.5rem 1rem;background:#fff;box-shadow:0 4px 12px #0002;z-index:1}`,
    `${frame} .cms-nav-item:hover>.cms-nav-submenu,${frame} .cms-nav-item:focus-within>.cms-nav-submenu{display:block}`,
    `${frame} .cms-nav-submenu .cms-nav-submenu{left:100%;top:0}`,
    `${frame} ${mobile} .cms-nav-submenu{display:block;position:static;min-width:0;margin-left:1rem;padding:0;box-shadow:none;background:transparent}`,
  ]
}

/** Echelon uses a direct-anchor desktop nav, a div phone panel, and a 900px
 * breakpoint. It must not inherit HNI's nested row or Tailwind assumptions. */
function echelonHeaderFrame(root: HtmlElement): FrameSource {
  const desktop = find(root.children, node => node.tag === 'nav' && classes(node).includes('desktop-nav'))
  const toggle = find(
    root.children,
    node => node.tag === 'button' && attribute(node, 'aria-controls') === 'mobile-menu',
  )
  const mobile = find(root.children, node => node.tag === 'div' && attribute(node, 'id') === 'mobile-menu')
  if (!desktop || !toggle || !mobile) throw new Error('source Echelon header menu could not be identified')
  // The first child here is an anchor, not HNI's layout div. Replace the
  // contents of the nav itself so the governed list never nests in a link.
  desktop.children = [marker()]
  const mobileCtas = mobile.children.filter(
    node => node.kind === 'element' && attribute(node, 'data-registration-cta') !== undefined,
  )
  const summary = el('summary', { class: classes(toggle).join(' '), 'aria-label': 'Menu' }, toggle.children)
  mobile.tag = 'nav'
  setAttribute(mobile, 'id', null)
  setAttribute(mobile, 'hidden', null)
  setAttribute(mobile, 'aria-label', 'Mobile navigation')
  mobile.children = [marker(), ...mobileCtas]
  remove(root.children, mobile)
  const parent = find([root], node => node.children.includes(toggle))
  if (!parent) throw new Error('source Echelon header menu button has no container')
  parent.children.splice(
    parent.children.indexOf(toggle),
    1,
    el('details', { class: 'echelon-mobile-menu' }, [summary, mobile]),
  )
  const css = [
    // Echelon positions its frame in CSS, rather than with utility classes.
    // The outer governed header owns sticky positioning and normal-flow size.
    '.echelon-frame>.site-header{position:relative;top:auto;left:auto;right:auto;z-index:auto}',
    '.echelon-frame .desktop-nav>.cms-nav-list{display:flex;align-items:center;gap:inherit}',
    '.echelon-frame .cms-nav-list{list-style:none;margin:0;padding:0}',
    '.echelon-frame .desktop-nav a[aria-current=page]::after{transform:scaleX(1)}',
    '.echelon-frame .echelon-mobile-menu{display:none;justify-self:end}',
    '.echelon-frame .echelon-mobile-menu>summary{list-style:none;cursor:pointer}',
    '.echelon-frame .echelon-mobile-menu>summary::-webkit-details-marker{display:none}',
    '.echelon-frame .mobile-menu a{display:block}',
    ...nestedMenuStyles('.echelon-frame', '.echelon-mobile-menu'),
    '@media(max-width:900px){.echelon-frame .echelon-mobile-menu{display:block}}',
  ].join('\n')
  return {
    html: serializeLegacy([wrapper(root, 'echelon-frame')]),
    css,
    issues: [
      'frame-fixed-position-rendered-sticky',
      'frame-menu-from-site-navigation',
      'frame-mobile-menu-scriptless-disclosure',
      'frame-registration-runtime-state-preserved',
    ],
  }
}

export function sourceFooterFrame(indexHtml: string, year: number): FrameSource {
  const issues = new Set<string>(['frame-copyright-year-fixed-at-preparation'])
  const root = region(indexHtml, 'footer')
  frameAnchors(root, indexHtml)
  const trigger = find(root.children, node => attribute(node, 'id') === 'contact-trigger')
  if (trigger) {
    const button = find(trigger.children, node => node.tag === 'button')
    const popup = find(trigger.children, node => attribute(node, 'id') === 'contact-popup')
    if (!button || !popup) throw new Error('source contact pop-out could not be identified')
    const summary = el(
      'summary',
      {
        class: [...classes(button), 'hni-contact-toggle'].join(' '),
        'aria-label': attribute(button, 'aria-label') ?? 'Contact information',
      },
      button.children,
    )
    setAttribute(popup, 'id', null)
    setAttribute(
      popup,
      'class',
      classes(popup)
        .filter(name => name !== 'hidden')
        .join(' '),
    )
    trigger.tag = 'details'
    setAttribute(trigger, 'id', null)
    setAttribute(trigger, 'class', [...classes(trigger), 'hni-contact'].join(' '))
    trigger.children = [summary, popup]
    // Name the contact links so the editor does not show them as bare anchors.
    const label = (node: HtmlElement) => {
      for (const child of node.children) {
        if (child.kind === 'text') continue
        const href = attribute(child, 'href') ?? ''
        if (child.tag === 'a' && !attribute(child, 'data-cms-label')) {
          if (href.startsWith('tel:')) child.attributes.push({ name: 'data-cms-label', value: 'Contact phone' })
          else if (href.startsWith('mailto:')) child.attributes.push({ name: 'data-cms-label', value: 'Contact email' })
        }
        label(child)
      }
    }
    label(popup)
    issues.add('frame-contact-popout-scriptless-disclosure')
  }
  // A script used to write the year into the copyright line.
  const year_ = find(root.children, node => attribute(node, 'id') === 'footer-year')
  if (year_) {
    const owner = find(root.children, node => node.children.includes(year_))!
    owner.children.splice(owner.children.indexOf(year_), 1, text(String(year)))
  }
  const css = [
    '.hni-frame .hni-contact>summary{list-style:none;cursor:pointer}',
    '.hni-frame .hni-contact>summary::-webkit-details-marker{display:none}',
    // V1 anchors the panel to the right edge of its trigger, which sits at the
    // left of a phone screen, so half the panel opened off-screen (FID-07).
    // Below Tailwind's sm breakpoint it opens from the trigger's left edge.
    '@media(max-width:639px){.hni-frame .hni-contact>summary+div{left:0;right:auto}}',
  ].join('\n')
  return {
    html: serializeLegacy([wrapper(root, classes(root).includes('site-footer') ? 'echelon-frame' : 'hni-frame')]),
    css,
    issues: [...issues].sort(),
  }
}

/** Shared frames appear on secondary pages too. Their source-home fragments
 * need explicit home paths; Echelon's old home link names its actual hero. */
function frameAnchors(root: HtmlElement, document: string) {
  const visit = (node: HtmlElement) => {
    const href = attribute(node, 'href')
    if (node.tag === 'a' && href?.startsWith('#') && href.length > 1) {
      const target =
        href === '#home' && /\bid=["']hero["']/.test(document) && !/\bid=["']home["']/.test(document) ? '#hero' : href
      setAttribute(node, 'href', `/${target}`)
    }
    for (const child of node.children) if (child.kind === 'element') visit(child)
  }
  visit(root)
}

/** The source site's compiled stylesheet, narrowed to one frame, without font
 * files: pages already carry the site's fonts as governed site assets. */
function frameStylesheet(html: string, builtCss: string, extraCss: string): string {
  const withoutFonts = postcss.parse(builtCss)
  withoutFonts.walkAtRules('font-face', rule => {
    rule.remove()
  })
  const styled = referenceStyles(withoutFonts.toString()).css
  return `${referenceCssClosure(html, styled).css}\n${extraCss}`
}

export type FrameComponent = {
  slug: string
  sourceHtml: string
  sourceCss: string
  slots: SlotDef[]
  values: Record<string, unknown>
  compiled: ReturnType<typeof compileSection>
  issues: string[]
}

/** Map media and links, extract editable fields, then place the menu slot. */
export function frameComponent(input: {
  slug: string
  frame: FrameSource
  builtCss: string
  assets: ReadonlyMap<string, ImportedAsset>
  links: ReadonlyMap<string, string>
}): FrameComponent {
  const css = frameStylesheet(input.frame.html, input.builtCss, input.frame.css)
  const mapped = remapReferenceUrls(input.frame.html, css, input.assets, input.links)
  if (mapped.unresolved.length)
    throw new Error(`source frame references untransferred files: ${mapped.unresolved.join(', ')}`)
  const editable = editableReference({ slug: input.slug, html: mapped.html, css: mapped.css })
  const markerTag = new RegExp(`<span class="${MENU_MARKER}"></span>`, 'g')
  const hasMenu = markerTag.test(editable.sourceHtml)
  const sourceHtml = editable.sourceHtml.replace(markerTag, `{{${FRAME_MENU_SLOT.id}}}`)
  const slots = hasMenu ? [...editable.slots, FRAME_MENU_SLOT] : editable.slots
  const compiled = compileSection({
    sourceHtml,
    sourceCss: mapped.css,
    slots,
    scopeSelector: sectionScopeSelector(input.slug)!,
  })
  if (compiled.blocking.length || compiled.problems.some(problem => /slot|declared/.test(problem))) {
    throw new Error(`frame component failed compilation: ${compiled.problems.join('; ')}`)
  }
  return {
    slug: input.slug,
    sourceHtml,
    sourceCss: mapped.css,
    slots,
    values: editable.values,
    compiled,
    issues: [...new Set([...input.frame.issues, ...editable.issues])].sort(),
  }
}

// ------------------------------------------------------------- application --

type FrameClient = { query: (sql: string, values?: unknown[]) => Promise<{ rows: any[] }> }

/**
 * Install a V1 site's frame as its saved (unpublished) header and footer, and
 * take the page-section stand-ins the preset frame needed back out of each
 * working draft. The caller owns the transaction and a super-admin identity.
 * Nothing is published; the site frame and every page keep their live state.
 */
export async function applyFrameComponents(
  client: FrameClient,
  input: {
    runId: string
    siteId: string
    indexHtml: string
    builtCss: string
    year: number
    digest: (value: string) => string
  },
) {
  if (!(await client.query('SELECT app.is_super_admin() AS ok')).rows[0]?.ok)
    throw new Error('frame components need a super-admin operator')
  const media = new Map<string, string>(
    (
      await client.query('SELECT source_path,media_id FROM v1_import_media WHERE run_id=$1 AND site_id=$2', [
        input.runId,
        input.siteId,
      ])
    ).rows.map(row => [`/${String(row.source_path).split('/public/')[1]}`, String(row.media_id)]),
  )
  const assets = new Map([...media].map(([url, mediaId]) => [url, { mediaId, url: `/media/${mediaId}/original` }]))
  const pages = (
    await client.query(
      `SELECT p.id,p.slug,p.revision::text AS revision,p.draft_version_id,v.content,v.meta
    FROM pages p JOIN page_versions v ON v.id=p.draft_version_id WHERE p.site_id=$1 AND p.archived_at IS NULL`,
      [input.siteId],
    )
  ).rows
  const links = new Map<string, string>([['/index.html', '/']])
  for (const page of pages)
    if (page.slug && !String(page.slug).startsWith('source-draft-')) links.set(`/${page.slug}.html`, `/${page.slug}`)

  const installed: Record<
    'header' | 'footer',
    { id: string; version: number; values: Record<string, unknown>; slug: string; issues: string[] }
  > = {} as never
  for (const kind of ['header', 'footer'] as const) {
    const frame =
      kind === 'header' ? sourceHeaderFrame(input.indexHtml) : sourceFooterFrame(input.indexHtml, input.year)
    // Named by what it will render, so a changed converter or source yields a
    // new definition rather than silently reusing an older one.
    const styles = frameStylesheet(frame.html, input.builtCss, frame.css)
    const slug = `v1-frame-${kind}-${input.digest(`${input.siteId}\n${frame.html}\n${styles}`).slice(0, 20)}`
    const component = frameComponent({ slug, frame, builtCss: input.builtCss, assets, links })
    const existing = (
      await client.query(
        `SELECT d.id,max(v.version) AS version FROM section_defs d JOIN section_def_versions v ON v.section_def_id=d.id
      WHERE d.site_id=$1 AND d.slug=$2 GROUP BY d.id`,
        [input.siteId, slug],
      )
    ).rows[0]
    let id = existing?.id as string | undefined,
      version = Number(existing?.version ?? 0)
    if (!id) {
      const saved = (
        await client.query(
          'SELECT section_def_id,version FROM app.upsert_section_def_version($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)',
          [
            slug,
            kind === 'header' ? 'Site header (from V1)' : 'Site footer (from V1)',
            'Site frame',
            component.sourceHtml,
            component.sourceCss,
            component.compiled.css,
            JSON.stringify(component.compiled.ast),
            JSON.stringify(component.slots),
            component.compiled.renderHash,
            component.compiled.ast.policyVersion,
            component.compiled.ast.cssPolicyVersion,
            `The V1 site ${kind}, kept element for element; menus from Navigation, disclosures without scripts.`,
            component.compiled.carriesTrustedCode,
            'legacy',
            null,
            null,
            'site',
            input.siteId,
          ],
        )
      ).rows[0]!
      id = String(saved.section_def_id)
      version = Number(saved.version)
      await client.query('SELECT app.set_section_def_placement($1,$2)', [id, kind])
    }
    installed[kind] = { id, version, values: component.values, slug, issues: component.issues }
  }

  const heads = (
    await client.query(
      `SELECT h.revision::text AS header_revision,f.revision::text AS footer_revision,
      hv.content AS header,fv.content AS footer FROM global_elements h
      JOIN global_element_versions hv ON hv.id=h.draft_version_id
      JOIN global_elements f ON f.site_id=h.site_id AND f.kind='footer'
      JOIN global_element_versions fv ON fv.id=f.draft_version_id
     WHERE h.site_id=$1 AND h.kind='header'`,
      [input.siteId],
    )
  ).rows[0]
  if (!heads) throw new Error('site frame heads are unavailable')
  const pins = (content: any, kind: 'header' | 'footer') =>
    content?.schemaVersion === 2 &&
    content.component?.section_def_id === installed[kind].id &&
    content.component?.section_def_version === installed[kind].version
  let frame: unknown = null
  if (!pins(heads.header, 'header') || !pins(heads.footer, 'footer')) {
    const header = {
      schemaVersion: 2,
      enabled: true,
      sticky: true,
      component: {
        section_def_id: installed.header.id,
        section_def_version: installed.header.version,
        values: installed.header.values,
      },
    }
    const footer = {
      schemaVersion: 2,
      enabled: true,
      component: {
        section_def_id: installed.footer.id,
        section_def_version: installed.footer.version,
        values: installed.footer.values,
      },
    }
    frame = (
      await client.query('SELECT * FROM app.save_global_elements_draft($1,$2,$3,$4,$5)', [
        input.siteId,
        heads.header_revision,
        heads.footer_revision,
        JSON.stringify(header),
        JSON.stringify(footer),
      ])
    ).rows[0]
  }

  // The preset frame's stand-ins: a partner strip and a contact block placed
  // in every working page. The authored frame now carries both.
  const standIns = new Set(
    (
      await client.query(
        `SELECT id FROM section_defs WHERE site_id=$1 AND slug LIKE 'v1-frame-%'
    AND placement='page' AND name IN ('Source partnership','Source contact information')`,
        [input.siteId],
      )
    ).rows.map(row => String(row.id)),
  )
  const cleaned = []
  for (const page of pages) {
    const content = page.content as Record<string, unknown>[]
    const kept = content.filter(section => !standIns.has(String(section['section_def_id'])))
    if (kept.length === content.length || kept.length === 0) continue
    const saved = (
      await client.query('SELECT revision,version_id FROM app.save_page_draft($1,$2,$3,$4,$5,$6)', [
        page.id,
        page.revision,
        JSON.stringify(kept),
        JSON.stringify(page.meta ?? {}),
        'checkpoint',
        `Site frame moved to authored header and footer (${installed.header.slug}, ${installed.footer.slug})`,
      ])
    ).rows[0]!
    cleaned.push({ page_id: page.id, removed: content.length - kept.length, version_id: saved.version_id })
  }
  return {
    header: installed.header,
    footer: installed.footer,
    frameSaved: frame !== null,
    pages: cleaned,
    published: false,
  }
}
