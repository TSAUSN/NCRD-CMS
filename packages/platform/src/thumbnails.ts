// The document a section thumbnail is a picture of (SPEC §6.5, D3).
//
// The library page shows "cards with static pre-rendered thumbnails … generated
// on save by the renderer (screenshot job); live themed preview on card focus/
// detail only", so that a library of 78 definitions reaches first paint in under
// a second with no live iframes at rest. This file is the half of that job with
// no browser in it: definition and theme in, one self-contained HTML document
// out. Everything provider-shaped — launching Chromium, storing bytes — lives
// behind the `Screenshotter` and `MediaStore` ports and on the worker's side of
// the call.
//
// THREE PROPERTIES THIS FILE EXISTS TO HOLD
//
// It renders through @cms/renderer and through nothing else. A thumbnail
// generator with its own idea of how a section becomes markup is a second
// renderer. The markup comes from `renderSection`, the stylesheet from `themeCss` and
// `collectCss`, and the refusals from `compiledCssProblems` and
// `structuredSectionProblems`. Nothing here decides what a section looks like.
//
// It renders with preview instrumentation OFF. `renderPage({ preview: true })`
// adds the `data-cms-*` attributes the editor selects on, the selection outline
// stylesheet, and a `<script>`. A thumbnail is a picture of the *published*
// section, so a card would otherwise show the editor's chrome to somebody who is
// not editing — and the outline is a visible box that no reader ever sees.
//
// It is deterministic. The same stored version produces byte-identical HTML,
// which is what makes a content-addressed object key mean anything: two
// thumbnail jobs for one version converge on one object instead of accumulating
// one per delivery. The two places determinism could have leaked are the
// placeholder values (derived below from the declarations alone — no clock, no
// randomness, no counter) and the theme's key order, which `themeCss` walks with
// `Object.entries` and which a jsonb column, a `JSON.parse` and an object
// literal do not agree on. `stableTheme` sorts it before the renderer sees it.
import {
  collectCss,
  compiledCssProblems,
  escapeText,
  renderSection,
  renderSiteFontCss,
  sectionDefinitionKind,
  sectionScopeSelector,
  structuredSectionProblems,
  themeCss,
  upgradeCompiledSection,
  type ManifestSection,
  type SectionDefView,
  type SiteShell,
} from '@cms/renderer'
import {
  CollectionFields,
  sourceSampleValues,
  StructuredDocument,
  structuredFieldNodes,
  structuredRepeatItemFieldNodes,
  type StructuredRepeatFieldNode,
  type SlotDef,
} from '@cms/schema'
import type { ScreenshotViewport } from './ports.ts'

/**
 * Band proportions, not page proportions.
 *
 * 5:2 at 1200 CSS pixels. The width has to be a real desktop width or a
 * three-column feature row arranges itself as one column and the picture is of a
 * layout the section does not have. The *height* is the number that was wrong:
 * at 750 a typical call-to-action band — 180 to 220 pixels of content — occupied
 * a quarter of the frame and the card was three-quarters empty, which is the
 * "extreme zoom-out" every library screen was showing. 480 is close to what a
 * page band actually is, so most captures now fill most of the frame, and the
 * card's own frame is the same 5:2 so nothing has to be cropped to fit it.
 *
 * The scale factor stays at 1 deliberately — a 2x capture is four times the
 * bytes for a picture that renders a few hundred pixels wide in a grid, and D3's
 * acceptance line is about first paint. 1200 into a ~500px card is already more
 * than two device pixels per CSS pixel on a retina display.
 */
export const THUMBNAIL_VIEWPORT: ScreenshotViewport = {
  width: 1280,
  height: 800,
  deviceScaleFactor: 1,
  cropToSection: true,
}

/**
 * The theme a *global* section definition is drawn under.
 *
 * A global definition belongs to no site, so it has no site theme to borrow.
 * Rather than draw the card with every custom property missing and let each
 * definition's stylesheet fall back to whatever it happens to declare, the
 * library has one neutral theme of its own, stated here so it is a decision
 * somebody made rather than an absence.
 *
 * A site-scoped definition passes its own site's tokens instead, and the card
 * then shows what that site will actually publish. That branch is not
 * hypothetical: migration 0029 gave `app.upsert_section_def_version` a scope and
 * a site, so the section creator can make a definition for one site, and this
 * comment used to say that every definition was global because at the time it
 * was written every definition was.
 */
export const LIBRARY_THEME: SiteShell['theme'] = {
  colors: {
    ink: '#14161a',
    muted: '#5c6370',
    primary: '#2f4a7d',
    surface: '#ffffff',
    'surface-alt': '#eef1f6',
  },
  fonts: { heading: 'Georgia, serif', body: 'system-ui, sans-serif' },
  radius: '0.5rem',
}

/**
 * The `src` a placeholder image field is given.
 *
 * A relative path, because `safeUrl` turns a `data:` URI into `#` and the
 * structured renderer drops an image whose source was refused — so the one form
 * that would embed the bytes is also the one form that cannot survive the URL
 * policy. Nothing ever fetches this path: the capture runs offline, and
 * `THUMBNAIL_CHROME_CSS` below paints over the element so the card shows a block
 * rather than a browser's broken-image glyph.
 */
export const THUMBNAIL_PLACEHOLDER_IMAGE = '/cms-thumbnail-placeholder.png'

/**
 * The only stylesheet this file writes itself, and it describes the *card*
 * rather than the section.
 *
 * `content` on a replaced element swaps its box for the gradient, which is how
 * an image region becomes a plausible grey-blue block with no request leaving
 * the process. Scoped to the thumbnail body class, so nothing here could ever
 * describe a published page even if this string escaped into one.
 */
const THUMBNAIL_CHROME_CSS =
  // The section is centred in the frame rather than pinned to the top of it.
  // A capture is one viewport tall whatever the section's own height is, and
  // most sections are shorter than that: pinned to the top, a short band left
  // white beneath it and every card in the library looked like a rendering that
  // had failed halfway.
  //
  // `safe center` rather than `center`, because the two differ in exactly the
  // case that matters. A section taller than the frame overflows a centred flex
  // container in *both* directions, so the capture loses the top of the section
  // — the headline — as well as the bottom. `safe` falls back to `start` the
  // moment centring would overflow, which keeps the top of a tall section and
  // changes nothing at all for a short one.
  '.cms-thumbnail{overflow:hidden;display:flex;flex-direction:column;' +
  'justify-content:safe center;min-height:100vh;margin:0}' +
  // The section wrapper is a flex child now, so it has to be told to take the
  // width it would otherwise have taken as a block.
  '.cms-thumbnail>*{flex:none;width:100%}' +
  // Only a picture the worker could not embed stands in as a block: an embedded
  // one (a `data:` source) is the section's own photograph.
  '.cms-thumbnail img:not([src^="data:"]){content:linear-gradient(135deg,var(--color-primary,#2f4a7d),' +
  'var(--color-surface-alt,#eef1f6));object-fit:cover;min-width:6rem;min-height:6rem}'

/** Nothing at all, or `renderSection`'s wrapper with nothing inside it. */
const EMPTY_SECTION = /^(|<div\b[^>]*>\s*<\/div>)$/

export type ThumbnailRefusalCode =
  /** The slug cannot become a CSS class, so the stored stylesheet has no scope. */
  | 'thumbnail-definition-has-no-slug'
  /** The renderer refuses this stored version; a picture of it would be a lie. */
  | 'thumbnail-definition-unrenderable'
  /** It renders, and renders to nothing. There is no card to take a picture of. */
  | 'thumbnail-renders-nothing'

/** A stable code for a machine, and one sentence for the person reading a log. */
export type ThumbnailRefusal = { code: ThumbnailRefusalCode; message: string }

export type ThumbnailBuild =
  | { ok: true; html: string; viewport: ScreenshotViewport; refusal: null }
  | { ok: false; html: null; viewport: ScreenshotViewport; refusal: ThumbnailRefusal }

/**
 * A stand-in value for one declared field, chosen from the declaration alone.
 *
 * The rule is one line long and that is the point: **the field's label, or its
 * name when the label is blank**. A label is what the editor already shows
 * beside the box, so a card built from labels reads as the shape of the section
 * with each region named — "Eyebrow", "Headline", "Supporting copy" — which is
 * what somebody scanning a library is actually trying to see. Lorem ipsum would
 * look more like content and say less, and either way it would have to come from
 * somewhere: a word list is a table to maintain, and anything sampled is a
 * different picture every run and therefore a different object key every run.
 *
 * The four types differ only in the shape the renderers demand of a value.
 * `link` needs `{ url, label }` and drops the region when the label is empty;
 * `image` needs `{ src, alt }` and drops it when the source is refused; the two
 * text types take characters. Collection repeats use the schema-consistent
 * sample rows below, without querying or exposing a site's actual records.
 */
function placeholderFor(type: string, label: string, name: string): unknown {
  const text = label.trim() === '' ? name : label.trim()
  switch (type) {
    case 'text':
      return text
    case 'richtext':
      return `<p>${text}</p>`
    case 'link':
    case 'button':
      // '#' survives `safeUrl` unchanged and goes nowhere, which is the correct
      // destination for a link on a picture.
      return { url: '#', label: text }
    case 'image':
      return { src: THUMBNAIL_PLACEHOLDER_IMAGE, alt: text }
    default:
      return undefined
  }
}

/** Synthetic collection data for a library picture, validated by the real renderer. */
function repeatPlaceholder(node: StructuredRepeatFieldNode): unknown {
  const fields = new Map<
    string,
    { key: string; label: string; type: 'text' | 'richtext' | 'image' | 'url'; required: boolean }
  >()
  for (const field of structuredRepeatItemFieldNodes(node)) {
    if (field.type !== 'text' && field.type !== 'richtext' && field.type !== 'image' && field.type !== 'link')
      return undefined
    const type = field.type === 'link' ? 'url' : field.type
    if (fields.has(field.field) && fields.get(field.field)!.type !== type) return undefined
    fields.set(field.field, { key: field.field, label: field.field.replaceAll('_', ' '), type, required: false })
  }
  // A static repeat item still needs a valid resolved collection schema.
  if (fields.size === 0) fields.set('title', { key: 'title', label: 'Title', type: 'text', required: false })
  const schema = CollectionFields.safeParse([...fields.values()])
  if (!schema.success) return undefined
  const schemaId = '00000000-0000-4000-8000-000000000001'
  const values = Object.fromEntries(
    schema.data.map(field => [
      field.key,
      field.type === 'image'
        ? { src: THUMBNAIL_PLACEHOLDER_IMAGE, alt: field.label, decorative: false }
        : field.type === 'url'
          ? 'https://example.test/library-sample'
          : placeholderFor(field.type, field.label, field.key),
    ]),
  )
  return {
    kind: 'collection',
    collectionId: '00000000-0000-4000-8000-000000000002',
    readerKey: 'library_sample',
    publishedSchemaVersionId: schemaId,
    publishedSchemaRevision: '1',
    publishedEntryRevision: '1',
    schemas: [{ id: schemaId, revision: '1', fields: schema.data }],
    entries: [
      { id: '00000000-0000-4000-8000-000000000003', stableKey: 'sample-one', schemaVersionId: schemaId, values },
      { id: '00000000-0000-4000-8000-000000000004', stableKey: 'sample-two', schemaVersionId: schemaId, values },
    ],
  }
}

/**
 * Every field this definition declares, with a stand-in value for each.
 *
 * Read from the declarations rather than from the nodes, for both models: the
 * structured document's `fields` list and the legacy row's `slots` array are the
 * two places a definition says what an editor will be asked for, and they are
 * what the library card is a picture of. A definition whose document cannot be
 * parsed contributes no values and is refused a few lines later anyway.
 *
 * Exported because a placeholder rule that only the screenshot path can see is a
 * rule nobody can test without a browser.
 */
export function thumbnailPlaceholderValues(def: SectionDefView): Record<string, unknown> {
  const metadata = def.slots?.[0]?.constraints
  if (metadata?.coreLibrary === 'r8' && typeof metadata.coreList === 'string' && metadata.coreListSamples)
    return { ...sourceSampleValues(def.slots as readonly SlotDef[]), [metadata.coreList]: metadata.coreListSamples }
  const values: Record<string, unknown> = {}

  if (sectionDefinitionKind(def) === 'structured') {
    const parsed = StructuredDocument.safeParse(def.structured_doc)
    if (!parsed.success) return values
    for (const field of parsed.data.fields) {
      const value = placeholderFor(field.type, field.label, field.name)
      if (value !== undefined) values[field.name] = value
    }
    for (const node of structuredFieldNodes(parsed.data.nodes)) {
      if (node.type !== 'repeat') continue
      const value = repeatPlaceholder(node)
      if (value !== undefined) values[node.field] = value
    }
    return values
  }

  for (const slot of (def.slots ?? []) as readonly SlotDef[]) {
    const value = placeholderFor(slot.kind, slot.label, slot.id)
    if (value !== undefined) values[slot.id] = value
  }
  // A definition that carries its source's own words and pictures as starting
  // content (an imported or organized section) is drawn with them, so its card
  // looks like the section rather than its outline (V1 references 18/19).
  return { ...values, ...sourceSampleValues((def.slots ?? []) as readonly SlotDef[]) }
}

/** What a card is drawn with: field names, then a page's values for the
 * definition's own fields, then the definition's samples. A value for a field
 * the definition does not declare is ignored. */
function thumbnailValues(def: SectionDefView, page: Record<string, unknown> | undefined): Record<string, unknown> {
  if (sectionDefinitionKind(def) === 'structured' || !page) return thumbnailPlaceholderValues(def)
  const slots = (def.slots ?? []) as readonly SlotDef[]
  const current = Object.fromEntries(
    slots
      .filter(slot => Object.hasOwn(page, slot.id) && page[slot.id] !== '' && page[slot.id] != null)
      .map(slot => [slot.id, page[slot.id]]),
  )
  return { ...thumbnailPlaceholderValues(def), ...current, ...sourceSampleValues(slots) }
}

/**
 * The theme, with its colour tokens in a fixed order.
 *
 * `themeCss` emits one custom property per `Object.entries` step, so the caller's
 * key order reaches the stylesheet byte for byte. That order is an accident of
 * where the theme came from — jsonb orders keys by length then bytes, a literal
 * keeps source order — and two orders of the same tokens would give one
 * definition two thumbnails with two object keys and no visible difference
 * between them.
 */
function stableTheme(theme: SiteShell['theme'] | null | undefined): SiteShell['theme'] {
  const source = theme ?? LIBRARY_THEME
  const colors = Object.fromEntries(
    Object.entries(source.colors ?? {}).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
  )
  return { ...source, colors }
}

/**
 * Why this renderer will not draw this stored version, in its own words.
 *
 * Asked of the same functions `renderSection` consults, dispatched on the row's
 * own `definition_kind` exactly as `renderSectionBody` dispatches — never on
 * which artifact looks populated. Duplicating the checks would mean a definition
 * this file called fine and the renderer dropped, which shows up as a blank card
 * with no reason attached to it.
 */
function unrenderableReasons(def: SectionDefView): string[] {
  const kind = sectionDefinitionKind(def)
  if (kind === null) {
    return [`its definition_kind is ${JSON.stringify(def.definition_kind)}, which is not a model this renderer reads`]
  }
  const model =
    kind === 'structured' ? structuredSectionProblems(def) : upgradeCompiledSection(def.compiled_ast).blocking
  return [...model, ...compiledCssProblems(def)]
}

/**
 * The document a thumbnail job screenshots, or a refusal naming why there is
 * none.
 *
 * Assembled from `renderSection`, `themeCss` and `collectCss` rather than from
 * `renderPage`, because a page is not what this is a picture of: `renderPage`
 * adds a skip link, a header with the site's navigation, a footer carrying the
 * site's name, and a canonical decision about a URL a section does not have. All
 * four would appear in every card in the library and none of them belongs to the
 * definition. The section still gets the page's own wrapper, index and stylesheet
 * order, so what is inside the card is byte-identical to what a page will show.
 */
export function buildThumbnailDocument(input: {
  def: SectionDefView
  theme?: SiteShell['theme'] | null
  viewport?: ScreenshotViewport
  /** The site's registered fonts (`{ assetId, fontKey }`), so the card is
   * set in the typefaces the site publishes with. */
  fonts?: unknown
  /** A site layout's values on a page of its site: the card shows the words
   * and pictures that page gives it, where the definition has no samples. */
  values?: Record<string, unknown>
}): ThumbnailBuild {
  const { def } = input
  const viewport = input.viewport ?? THUMBNAIL_VIEWPORT
  const refuse = (code: ThumbnailRefusalCode, message: string): ThumbnailBuild => ({
    ok: false,
    html: null,
    viewport,
    refusal: { code, message },
  })

  // Asked first and separately from the reasons below, because it has its own
  // remedy: every other refusal here is fixed by re-saving the definition, and
  // this one is fixed by renaming it — a published class name changes, which is
  // an editorial decision and not one a thumbnail job may take.
  const slug = def.slug
  if (sectionScopeSelector(slug) === null) {
    return refuse(
      'thumbnail-definition-has-no-slug',
      `slug ${JSON.stringify(slug)} cannot become a section scope, so this definition has ` +
        'no stylesheet a card could be drawn with — rename it from the editor',
    )
  }

  const reasons = unrenderableReasons(def)
  if (reasons.length > 0) {
    return refuse(
      'thumbnail-definition-unrenderable',
      `this definition renders nothing this build will publish, so a thumbnail of it would ` +
        `show something no page will: ${reasons.join('; ')}`,
    )
  }

  const section: ManifestSection = {
    def,
    instance: {
      section_def_id: def.section_def_id,
      section_def_version: def.version,
      values: thumbnailValues(def, input.values),
      hidden: false,
      hidden_at: [],
      label: '',
    },
  }

  // No editing instrumentation or live provider frames in a static library card.
  const body = renderSection(section, 0, { providerEmbeds: false, siteThemeHooks: true })
  // Two different silences, both of which mean there is nothing to photograph.
  // `renderSection` returns the empty string when it drops the section outright,
  // and returns a wrapper with nothing in it when the section is fine and its
  // body rendered to nothing — a structured document with no nodes, every field
  // region declining its value. A page shows the second as an empty region and
  // carries on, but the library should not offer a blank thumbnail.
  if (EMPTY_SECTION.test(body)) {
    return refuse(
      'thumbnail-renders-nothing',
      'this definition renders to an empty section, so there is no card to photograph',
    )
  }

  const css = `${renderSiteFontCss(input.fonts ?? [])}${themeCss(stableTheme(input.theme), body.includes('cms-material-symbols'))}${collectCss([section])}${THUMBNAIL_CHROME_CSS}`
  const html =
    '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
    `<meta name="viewport" content="width=${viewport.width},initial-scale=1">` +
    `<title>${escapeText(slug ?? 'section')}</title>` +
    `<style>${css}</style></head>` +
    `<body class="cms-thumbnail">${body}</body></html>`

  return { ok: true, html, viewport, refusal: null }
}

// ------------------------------------------------------ embedded files --

/** A governed media URL as the renderer emits it. */
const MEDIA_URL =
  /\/media\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/(?:original|wide|card|thumbnail)(?![\w/-])/gi

/** The media a thumbnail document shows, so the worker can fetch just those. */
export function thumbnailMediaIds(html: string): string[] {
  return [...new Set([...html.matchAll(MEDIA_URL)].map(match => match[1]!.toLowerCase()))].sort()
}

export type ThumbnailFile = { mimeType: string; bytes: Uint8Array }
const EMBEDDABLE =
  /^(image\/(png|jpeg|gif|webp|avif|svg\+xml)|font\/(woff2?|otf|ttf)|application\/(font-woff2?|x-font-(ttf|otf)|vnd\.ms-opentype)|application\/octet-stream)$/i

/**
 * Put the section's pictures and the site's fonts into the document as data,
 * so the offline capture draws them. `media` maps a media id to the file to
 * show for any of its renditions; `assets` maps a site-asset id (a font) to its
 * file. A URL with no file stays as it is, and its picture stands in as a block.
 */
export function embedThumbnailFiles(
  html: string,
  files: { media: ReadonlyMap<string, ThumbnailFile>; assets: ReadonlyMap<string, ThumbnailFile> },
): string {
  const data = (file: ThumbnailFile | undefined) =>
    file && EMBEDDABLE.test(file.mimeType)
      ? `data:${file.mimeType.toLowerCase()};base64,${Buffer.from(file.bytes).toString('base64')}`
      : undefined
  return html
    .replace(MEDIA_URL, (url, id: string) => data(files.media.get(id.toLowerCase())) ?? url)
    .replace(
      /\/assets\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?![\w/-])/gi,
      (url, id: string) => data(files.assets.get(id.toLowerCase())) ?? url,
    )
}
