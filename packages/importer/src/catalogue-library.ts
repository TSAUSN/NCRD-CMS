// V1's section library, per site, as faithful V2 site definitions (SPEC §6.14,
// LIB-01). V1 offered each site the shared sections plus that site's own
// (reference 19: Echelon's library), and a section whose markup differs
// between sites is that site's variant (SPEC: separate site-scoped variants by
// default). Each entry keeps V1's markup and styles and exposes its authored
// regions as fields through the same mapping as the page imports, with V1's
// own content as starting content, so the library card and a newly inserted
// section look as they did in V1.
//
// A section is offered only when its mapped form renders back to its source
// exactly; the one tolerated difference is the `role` the image field adds
// (empty, or `presentation` for an image with empty alt text), which changes
// nothing a visitor or assistive technology perceives. Anything that cannot be
// mapped faithfully — forms, embeds, scripts — is refused with its reason, for
// an explicit disposition in the catalogue ledger.
import postcss from 'postcss'
import { compileSection, renderSection, sectionScopeSelector, type GovernedEmbedKind } from '@cms/renderer'
import { sourceSampleValues, type SlotDef } from '@cms/schema'
import { catalogueStyles } from './catalogue-styles.ts'
import { editableReference } from './editable-reference.ts'
import { attribute, parseHtml, type HtmlElement, type HtmlNode } from './html.ts'
import { serializeLegacy } from './legacy-values.ts'
import { adaptRepeats } from './library-repeats.ts'
import { withSourceSamples } from './source-samples.ts'
import type { V1Catalogue } from './source.ts'

export const LIBRARY_SITES = { humanneedsindex: 'hni', echelonsymposium: 'echelon' } as const
export type LibrarySite = keyof typeof LIBRARY_SITES

export type CatalogueLibraryEntry = {
  sourceId: string
  name: string
  category: string
  /** True when this is the site's own variant of a section the sites declare differently. */
  variant: boolean
  html: string
  /** The section's own CSS, after the preset rules its markup uses. */
  css: string
  disposition: 'fields' | 'static' | 'refused'
  reason: string | null
  /** V1's own field names, by block id. */
  labels: ReadonlyMap<string, string>
}

export function librarySlug(site: LibrarySite, sourceId: string): string {
  const slug = `v1-lib-${LIBRARY_SITES[site]}-${sourceId}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  if (slug.length > 64) throw new Error(`library slug for ${sourceId} is longer than a section slug may be`)
  return slug
}

/**
 * The site's brand values a section reads. V1's sections take their colours,
 * fonts and spacing from variables each site declares on its document root
 * (`--color-primary`, `--sa-dark`, `--font-heading` …), which is how V1's
 * library showed every section in the chosen site's brand (reference 19). A
 * section scope cannot reach the document root, so the variables this
 * section uses — and the ones their values use — are declared on the section
 * itself (`&`), from the site's top-level `:root`/`html` rules and `@theme`
 * blocks, later declarations winning as in the cascade.
 */
export function siteBrandVariables(siteCss: string, sectionCss: string): string {
  const declared = new Map<string, string>()
  const root = postcss.parse(siteCss)
  const take = (container: postcss.Container) =>
    container.each(node => {
      if (node.type === 'decl' && node.prop.startsWith('--')) {
        declared.delete(node.prop)
        declared.set(node.prop, node.value)
      }
    })
  root.each(function visit(node): void {
    if (node.type === 'atrule' && (node.name === 'layer' || node.name === 'theme') && node.nodes) {
      if (node.name === 'theme') take(node)
      else node.each(visit)
    } else if (
      node.type === 'rule' &&
      node.selectors.every(selector => [':root', 'html', ':host'].includes(selector.trim()))
    )
      take(node)
  })
  const used = (text: string) => [...text.matchAll(/var\(\s*(--[a-zA-Z0-9_-]+)/g)].map(match => match[1]!)
  const needed = new Set<string>()
  const queue = used(sectionCss)
  while (queue.length) {
    const name = queue.shift()!
    if (needed.has(name) || !declared.has(name)) continue
    needed.add(name)
    queue.push(...used(declared.get(name)!))
  }
  const declarations = [...declared].filter(([name]) => needed.has(name)).map(([name, value]) => `${name}:${value}`)
  return declarations.length ? `&{${declarations.join(';')}}` : ''
}

/** What V1 offered one site, in registry order, each with its disposition.
 * `siteCss` is the site's own stylesheet, for its brand variables. */
export function catalogueLibraryFor(catalogue: V1Catalogue, site: LibrarySite, siteCss = ''): CatalogueLibraryEntry[] {
  const entries: CatalogueLibraryEntry[] = []
  for (const definition of catalogue.definitions) {
    if (definition.sites !== null && !definition.sites.includes(site)) continue
    const own = catalogue.siteVariants.find(variant => variant.id === definition.id && variant.sourceSite === site)
    const source = own ?? definition
    const labels = new Map(
      [...definition.slots, ...source.slots]
        .filter(slot => slot.blockId && slot.label.trim())
        .map(slot => [slot.blockId, slot.label.trim()]),
    )
    let css: string
    try {
      css = catalogueStyles(source.html, source.css, catalogue.presetCss)
      const brand = siteBrandVariables(siteCss, css)
      if (brand) css = `${brand}\n${css}`
    } catch (error) {
      entries.push({
        sourceId: definition.id,
        name: definition.name,
        category: definition.category,
        variant: own !== undefined,
        html: source.html,
        css: source.css,
        disposition: 'refused',
        reason: (error as Error).message,
        labels,
      })
      continue
    }
    const checked = mapLibrarySection(definition.id, librarySlug(site, definition.id), source.html, css, labels)
    entries.push({
      sourceId: definition.id,
      name: definition.name,
      category: definition.category,
      variant: own !== undefined,
      html: source.html,
      css,
      disposition: checked.disposition,
      reason: checked.reason,
      labels,
    })
  }
  return entries
}

export type FaithfulMapping =
  | {
      disposition: 'fields' | 'static'
      reason: null
      mapped: ReturnType<typeof editableReference>
      slots: ReturnType<typeof withSourceSamples>
    }
  | { disposition: 'refused'; reason: string; mapped: null; slots: null }

/** Map one section's markup to fields, and refuse it unless it renders back exactly. */
export function mapFaithfully(
  slug: string,
  html: string,
  css: string,
  labels?: ReadonlyMap<string, string>,
): FaithfulMapping {
  let mapped: ReturnType<typeof editableReference>
  try {
    mapped = editableReference({ slug, html, css, ...(labels ? { labels } : {}) })
  } catch (error) {
    return {
      disposition: 'refused',
      reason: `not passive markup (${(error as Error).message})`,
      mapped: null,
      slots: null,
    }
  }
  const rendered = renderSection(
    {
      def: { section_def_id: slug, version: 1, slug, compiled_ast: mapped.compiled.ast, slots: mapped.slots },
      instance: { section_def_id: slug, section_def_version: 1, values: mapped.values },
    } as Parameters<typeof renderSection>[0],
    0,
  )
    .replace(/^<div[^>]*>/, '')
    .replace(/<\/div>$/, '')
  const parsed = parseHtml(html)
  const source = parsed.ok ? serializeLegacy(parsed.nodes) : html
  // A bare `&` in source text and its escaped spelling are the same character.
  const tolerated = (value: string) =>
    value
      .replace(/ role="(presentation)?"/g, '')
      .replace(/&(?![a-zA-Z][a-zA-Z0-9]*;|#[0-9]+;|#x[0-9a-fA-F]+;)/g, '&amp;')
  if (tolerated(rendered) !== tolerated(source)) {
    return {
      disposition: 'refused',
      reason: 'its mapped fields do not render back to the source exactly',
      mapped: null,
      slots: null,
    }
  }
  // Its styles must all survive the section CSS policy, or it would not look like V1.
  if (mapped.compiled.problems.length) {
    return {
      disposition: 'refused',
      reason: `its styles would lose rules (${[...new Set(mapped.compiled.problems)].join('; ')})`,
      mapped: null,
      slots: null,
    }
  }
  return {
    disposition: mapped.slots.length ? 'fields' : 'static',
    reason: null,
    mapped,
    slots: withSourceSamples(mapped.slots, mapped.values),
  }
}

/** V1's embed sections, by the kind of governed embed each one frames. */
export const LIBRARY_EMBEDS: Record<string, GovernedEmbedKind> = {
  'video-embed-v1': 'video',
  'map-embed-v1': 'map',
  'form-embed-v1': 'form',
}
const EMBED_FIELD = 'v1-embed-src'
const EMBED_TOKEN = '__cms_library_embed__'

/** One library section's mapping: V1's embed sections are adapted to a
 * governed embed field, every other section must map faithfully. */
export function mapLibrarySection(
  sourceId: string,
  slug: string,
  html: string,
  css: string,
  labels?: ReadonlyMap<string, string>,
): FaithfulMapping {
  const kind = LIBRARY_EMBEDS[sourceId]
  if (kind) return adaptEmbedSection(kind, slug, html, css, labels)
  const faithful = mapFaithfully(slug, html, css, labels)
  if (faithful.disposition !== 'fields') return faithful
  // Identical numbered copies become a list an editor can grow and reorder (LIB-02).
  const repeated = adaptRepeats({
    slug,
    html,
    css,
    ...(labels ? { labels } : {}),
    numbered: { sourceHtml: faithful.mapped.sourceHtml, slots: faithful.slots },
  })
  if (!repeated) return faithful
  return {
    disposition: 'fields',
    reason: null,
    slots: repeated.slots,
    mapped: {
      ...faithful.mapped,
      sourceHtml: repeated.sourceHtml,
      compiled: repeated.compiled,
      slots: repeated.slots,
      values: sourceSampleValues(repeated.slots),
    },
  }
}

/**
 * V1 framed whatever address an editor pasted into a hidden link, through a
 * script that checked the provider. V2 renders no scripts and no authored
 * frames, so the section's empty frame becomes a governed embed field
 * (`constraints.embed`): the same pasted link, accepted only from that kind's
 * providers and shown behind a consent card (governed-embeds.ts). V1's frame
 * title names the frame; its instruction text is the editor's hint while the
 * field is empty. The title, caption and everything else map as usual.
 */
function adaptEmbedSection(
  kind: GovernedEmbedKind,
  slug: string,
  html: string,
  css: string,
  labels?: ReadonlyMap<string, string>,
): FaithfulMapping {
  const refuse = (reason: string): FaithfulMapping => ({ disposition: 'refused', reason, mapped: null, slots: null })
  const parsed = parseHtml(html)
  if (!parsed.ok) return refuse('its markup could not be read')
  let frame: HtmlElement | null = null,
    iframe: HtmlElement | null = null,
    help = '',
    placeholderClass = '',
    source: { parent: HtmlNode[]; link: HtmlElement } | null = null
  const walk = (nodes: HtmlNode[]) => {
    for (const node of nodes) {
      if (node.kind !== 'element') continue
      if (node.tag === 'iframe' && attribute(node, 'data-cms-embed-frame') !== undefined) iframe = node
      if (
        node.children.some(
          child =>
            child.kind === 'element' &&
            child.tag === 'iframe' &&
            attribute(child, 'data-cms-embed-frame') !== undefined,
        )
      )
        frame = node
      if (attribute(node, 'data-cms-embed-placeholder') !== undefined) {
        help = node.children
          .filter(child => child.kind === 'text')
          .map(child => child.text)
          .join('')
          .trim()
        placeholderClass = attribute(node, 'class') ?? ''
      }
      for (const child of node.children)
        if (child.kind === 'element' && attribute(child, 'data-cms-embed-src') !== undefined)
          source = { parent: node.children, link: child }
      walk(node.children)
    }
  }
  walk(parsed.nodes)
  if (!frame || !iframe || !source) return refuse('its embed frame or address could not be found')
  const found = source as { parent: HtmlNode[]; link: HtmlElement }
  const title = attribute(iframe, 'title') ?? ''
  const frameClass = attribute(iframe, 'class') ?? ''
  // Marked as an editable text region for the mapping to give it a field; the
  // marker is taken out of the markup again below.
  ;(frame as HtmlElement).children = [{ kind: 'text', line: (frame as HtmlElement).line, text: EMBED_TOKEN }]
  ;(frame as HtmlElement).attributes.push(
    { name: 'data-block-id', value: 'cms-library-embed' },
    { name: 'data-editable', value: 'text' },
  )
  found.parent.splice(found.parent.indexOf(found.link), 1)
  const adapted = serializeLegacy(parsed.nodes)
  const base = mapFaithfully(slug, adapted, css, labels)
  if (base.disposition === 'refused') return base
  // The token is plain text in its own frame, so the mapping made it a text
  // field; that field becomes the embed.
  const tokenField = base.slots.find(slot => base.mapped.values[slot.id] === EMBED_TOKEN)
  if (!tokenField) return refuse('its embed frame could not be given a field')
  const label =
    labels?.get(attribute(found.link, 'data-block-id') ?? '') ?? `${kind[0]!.toUpperCase()}${kind.slice(1)} address`
  // V1's frame and placeholder keep their own classes, so the embed fills the
  // section's frame and its hint sits where V1's did, in V1's style.
  const className = (value: string) => (/^[A-Za-z_][A-Za-z0-9_-]*$/.test(value.trim()) ? value.trim() : null)
  const frameName = className(frameClass),
    placeholderName = className(placeholderClass)
  const embed: SlotDef = {
    id: EMBED_FIELD,
    kind: 'link',
    label,
    constraints: {
      destinationOnly: true,
      embed: kind,
      embedTitle: title,
      embedHelp: help,
      ...(frameName
        ? { embedFrameClass: frameName, ...(placeholderName ? { embedPlaceholderClass: placeholderName } : {}) }
        : {}),
    },
  }
  const sourceHtml = base.mapped.sourceHtml
    .replace(`{{${tokenField.id}}}`, `{{${EMBED_FIELD}}}`)
    .replace(' data-block-id="cms-library-embed" data-editable="text"', '')
  const slots = [...base.slots.filter(slot => slot.id !== tokenField.id), embed]
  const compiled = compileSection({ sourceHtml, sourceCss: css, slots, scopeSelector: sectionScopeSelector(slug)! })
  if (compiled.blocking.length || compiled.problems.length)
    return refuse(`its adapted embed did not compile (${[...compiled.blocking, ...compiled.problems].join('; ')})`)
  const values = { ...base.mapped.values }
  delete values[tokenField.id]
  return { disposition: 'fields', reason: null, mapped: { ...base.mapped, sourceHtml, compiled, slots, values }, slots }
}
