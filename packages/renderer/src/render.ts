import { nativeDisclosureCss } from './native-disclosure-css.ts'
import { withoutUnavailablePictures } from './unavailable-pictures.ts'
import postcss from 'postcss'
import { renderedFeatures } from './feature-markers.ts'
import { reportIndexValues, isReportIndexPage, isReportIndexRow, REPORT_INDEX_CSS } from './report-index.ts'
import { reportTemplateMarkup, isReportTemplatePage, renderReportBands, reportPhoto } from './report-template.ts'
import { REPORT_PAGE_CSS, REPORT_TEXT_CSS } from './report-page-presentation.ts'
import { reportPart, nationalTileLayout } from '@cms/schema'
import { reportLinksMarkup } from './report-links.ts'
import { reportPageLinkValues } from '@cms/schema'
import { reportStoryMarkup } from './report-story.ts'
import { reportFinancialMarkup } from './report-financial.ts'
import { withoutSamplePictures } from './sample-pictures.ts'
import { renderEchelonSocialMarks } from './echelon-social-marks.ts'
import { chapterJumpValues, isReviewedChapterComposition, resolveDataValueFields, dataValueBindings } from '@cms/schema'
import { isEchelonTemplatePage, ECHELON_PAGE_CSS } from './echelon-page.ts'
import { ECHELON_DIRECTORY_CSS } from './echelon-directory-presentation.ts'
import { ECHELON_BODY_CSS, ECHELON_STORY_CARDS_CSS, ECHELON_SECTION_LINK_CSS } from './echelon-body-presentation.ts'
import { ECHELON_PRESENTATION_CSS } from './echelon-presentation.ts'
import {
  siteSocialAccounts,
  siteSocialSectionValues,
  siteSocialGroup,
  usesSiteSocialAccounts,
  SITE_SOCIAL_LABELS,
  SitePublicSettings,
} from '@cms/schema'
import { storySplitValues, renderStorySplit, STORY_SPLIT_CSS } from './story-split.ts'
import { storyWorldValues, renderStoryWorld, STORY_WORLD_CSS, type StoryWidgetContext } from './story-world.ts'
import { inheritFooterLogo } from './frame-logo.ts'
import { renderHeroSlides, HERO_SLIDES_CSS } from './hero-slides.ts'
import { isHeroSlides } from '@cms/schema'
import { adobeKitLink } from './adobe-fonts.ts'
import { nationalSectionPanel, CORE_SECTION_LAYOUT_CSS } from './national-panels.ts'
import {
  renderCollectionTemplate,
  markCollectionTemplateParents,
  collectionTemplateMarker,
  type CollectionTemplateMark,
} from './collection-template.ts'
import { newsroomValues, type NewsroomQuery } from './newsroom.ts'
import { withStoryFeedDates, withStoryVisibility, isStoryFeedSlot } from './story-feed-dates.ts'
import { renderStoryGrid, STORY_GRID_CSS } from './story-grid.ts'
import { renderStoryAuthor, renderStoryArchive, renderStoryDetail } from './story-archive.ts'
import { panelPresentationCss } from './panel-presentation.ts'
import { localBrandFontCss } from './local-brand-fonts.ts'
import { renderSiteWidget, SITE_WIDGET_CSS, type SiteWidgetContext } from './site-widgets.ts'
import { renderSiteFiles } from './site-files.ts'
import { renderOriginalNavigation } from './original-navigation.ts'
import {
  originalLayout,
  originalDefinition,
  originalRoot,
  originalTemplateHeader,
  documentAttributes,
  themeCssWithinSections,
} from './original-layout.ts'
// The one rendering path (SPEC §3). apps/site and apps/admin both import this,
// so preview and live output come from the same code by construction — the
// byte-identity problem v1 solved with file-sync scripts is solved here by the
// module system.
//
// Preview adds selection instrumentation. Its optional hidden-content view is
// an explicitly labelled editing aid; ordinary preview and public rendering
// still honor the same visibility rules.
import {
  imageFocusPosition,
  FooterConfig,
  HeaderConfig,
  siteWidget,
  isDrawingSlot,
  isIconSlot,
  MATERIAL_ICON_PRESENTATION,
  isSourceDrawing,
  repeatItemKeys,
  sampleFieldNames,
  trackedLinkUrl,
  SOURCE_DRAWINGS,
  repeatItemSlotId,
  repeatItemSpec,
  collectionTemplateSpec,
  type FooterConfigV1 as FooterConfigView,
  type FooterConfigV2,
  type GlobalElementLink as GlobalLinkView,
  type HeaderConfigV1 as HeaderConfigView,
  type HeaderConfigV2,
  type SlotDef,
  type SectionAppearance,
  type SiteOriginalLayout,
} from '@cms/schema'
import {
  upgradeCompiledSection,
  sectionScopeSelector,
  isTypedAttributeBinding,
  repeatRanges,
  type AstNode,
  type CompiledSection,
} from './compile.ts'
import { renderCmsIcon, renderMaterialIcon } from './icons.ts'
import { resolveCanonical, type CanonicalDecision } from './canonical.ts'
import { isKnownContext, scanSlotSites } from './context.ts'
import { escapeAttribute, escapeText, safeUrl, safeUrlAttribute } from './escape.ts'
import { presentRichText } from './richtext.ts'
import { isGovernedEmbedKind, renderGovernedEmbed } from './governed-embeds.ts'
import { narrowCompiledCss, scopeCss, validateCompiledCss, CSS_POLICY_VERSION } from './css.ts'
import { renderStructuredBody, sectionDefinitionKind, resolvedCollection } from './structured.ts'
import { renderSiteFontCss, type ManifestFont } from './site-fonts.ts'
import { fixedRuntimeTag } from './fixed-runtime-files.ts'
import { PROVIDER_FRAME_CSS } from './provider-embed.ts'
import { validSectionAnchor, sectionAnchorNames } from '@cms/schema'
import { PREVIEW_RUNTIME, PREVIEW_STYLES } from './preview-runtime.ts'
import { sectionAppearanceCss } from './section-appearance.ts'
import { buttonAppearanceClasses, buttonAppearanceCss } from './button-appearance.ts'
import { applyRegistrationAvailability } from './registration.ts'

const REVIEWED_ORIGINAL_NAVIGATION = Symbol('reviewed original navigation')

export type SectionInstanceView = {
  section_def_id: string
  section_def_version: number
  values?: Record<string, unknown>
  hidden?: boolean
  hidden_at?: readonly string[]
  label?: string
  /** This instance's own stylesheet, authored. Scoped to the block at render. */
  custom_css?: string
  appearance?: SectionAppearance
  /**
   * Markup an author pasted in place of this section's own body.
   *
   * The escape hatch SPEC §6.4 keeps and gates: writing anything here makes
   * `app.content_carries_trusted_code` mark the whole page version, and the
   * trigger on `pages.published_version_id` refuses to publish a marked version
   * that no super admin has approved. Both of those are the database's, so this
   * renderer emits the markup verbatim — which is what "raw" means and what the
   * approval is an approval *of*.
   */
  raw_html?: string
}

export type SectionDefView = {
  section_def_id: string
  version: number
  slug?: string
  compiled_ast: CompiledSection
  /** Compiled, scoped CSS. Never the authored form. */
  css?: string
  /**
   * Which CSS policy produced `css`.
   *
   * Carried into the renderer rather than left in the database, because the
   * renderer is what decides whether to emit the stylesheet and cannot make
   * that decision from a column it never sees.
   */
  css_policy_version?: number | null
  sanitizer_policy_version?: number | null
  slots?: readonly SlotDef[]
  /**
   * Which model this definition is written in: `legacy` interpolation or
   * `structured` (ADR 0007). Absent means legacy, which is what migration 0019's
   * `NOT NULL DEFAULT 'legacy'` says about every row that predates the column.
   */
  definition_kind?: string | null
  /** The typed node document, for a structured definition. */
  structured_doc?: unknown
  structured_schema_version?: number | null
}

export type ManifestSection = { instance: SectionInstanceView; def: SectionDefView }

export type RenderManifest = {
  page: { id: string; version_id: string; title: string; path: string }
  meta: {
    title?: string
    description?: string
    canonical?: string
    social_image?: string
    noindex?: boolean
  }
  sections: ManifestSection[]
  /** Hash of resolved collection dependencies; changes without republishing the page. */
  dependency_revision?: string
  /** Published/private page-version asset usage, resolved by the same manifest builder. */
  fonts?: ManifestFont[]
}

export type NavigationNode = {
  label: string
  target: { type: 'page'; page_id: string } | { type: 'url'; url: string }
  visible: boolean
  children?: NavigationNode[]
  dropdownGroup?: boolean
}

export type SiteShell = {
  settings?: unknown
  chapter_directory?: unknown
  site: { id: string; name: string; slug: string; kind?: string; chaptersEnabled?: boolean }
  theme: {
    colors?: Record<string, string>
    fonts?: { heading?: string; body?: string; adobeKit?: { id: 'euh2hvn'; enabled: boolean; domains: string[] } }
    radius?: string
    spacing?: 'compact' | 'comfortable' | 'spacious'
    presentation?: {
      kind: 'panels'
      canvas: string
      headings?: 'small-caps'
      layout?: 'national'
      referenceContrast?: 'sawso-2026-10-29'
      template?: { id: 'national'; version: number; mayChangeColours: boolean }
    }
    buttons?: {
      style?: 'solid' | 'outline' | 'text'
      color?: 'primary' | 'accent'
      radius?: string
      weight?: 'regular' | 'bold'
      hover?: 'none' | 'darken' | 'lift' | 'invert' | 'underline'
      speed?: 'fast' | 'normal' | 'slow'
    }
  }
  navigation: NavigationNode[]
  header?: unknown
  footer?: unknown
  /**
   * The compiled definition an authored header or footer pins (ADR 0010), in
   * the same shape a page manifest carries. Attached by the shell projection
   * and by private draft preview; absent for preset frames.
   */
  header_component?: SectionDefView | null
  footer_component?: SectionDefView | null
  site_files?: unknown
  canonical_host: string | null
  staging_host: string | null
}

export type RenderOptions = {
  reportLinkSections?: readonly { hidden?: boolean; values?: Record<string, unknown> }[]
  siteSettings?: unknown
  /** Internal, validated root-reviewed pins passed by renderPage. */
  originalLayout?: SiteOriginalLayout
  /** Explicitly enabled only on an isolated script canvas; private evidence stays inert. */
  siteFiles?: boolean
  /** Closed system widgets also load externally in an isolated visitor view. */
  externalRuntimes?: boolean

  /** Authenticated visitor preview; no editor instrumentation or runtime. */
  visitorPreview?: boolean
  /** Catalogue preview: emit only the section, without a site frame. */
  sectionOnly?: boolean
  /** Hide site frames while retaining the site’s real section typography/skin. */
  siteFrame?: boolean
  /** Adds the editor's selection instrumentation. Never true for public output. */
  preview?: boolean
  /** Isolated canvases load the same runtime from a code-owned external file. */
  previewRuntime?: boolean
  /** Show hidden content for editing. Ignored unless this is an editor or authenticated visitor preview. */
  showHiddenSections?: boolean
  /** Scriptless administrative evidence keeps third-party content inert. */
  providerEmbeds?: boolean
  /**
   * Applies the semantic hooks owned by the site theme. `renderPage` enables
   * this for real preview and public documents; a bare `renderSection` keeps
   * the definition's historical bytes, which is required by importer parity
   * and by section thumbnails that provide their own presentation context.
   */
  siteThemeHooks?: boolean
  /** Enforced only by the national page shell, never by imported sites. */
  /** Complete report columns require the cover-selected report presentation. */
  annualReportTemplate?: boolean
  nationalPanels?: boolean
  /** Actual serving hostname, distinct from the canonical address. */
  servingHost?: string
  /**
   * The origin serving this response, e.g. `https://demo.staging.example`.
   *
   * A fallback, not an override: `shell.canonical_host` is the site's *verified*
   * address and wins whenever there is one. It used to be the other way round,
   * which meant a staging render — and a render served on a secondary live
   * alias — published a canonical link naming the host it happened to arrive
   * on, so a site with a live domain still told search engines that its pages
   * lived on a `noindex` staging hostname that is meant to be turned off.
   */
  canonicalBase?: string
  /**
   * The site menu, already rendered, for `navigation` slots. `renderPage`
   * supplies it only while rendering the site frame; a page section's
   * navigation slot therefore renders nothing.
   */
  siteNavigation?: string
  storyWidgets?: StoryWidgetContext
  newsroom?: NewsroomQuery
  siteWidgets?: SiteWidgetContext
  /** Closed original-menu output, supplied only to a reviewed frame pin. */
  [REVIEWED_ORIGINAL_NAVIGATION]?: string
}

const BREAKPOINT_MAX_WIDTH: Record<string, string> = { sm: '767px', md: '1023px', lg: '99999px' }

/**
 * Render one value into the sink its slot actually lands in.
 *
 * The context comes from the compiler, which walked the template with an HTML
 * tokenizer (context.ts). Nothing here re-derives it: a renderer that decides
 * for itself where a value is going is a renderer that can disagree with the
 * thing that validated the template.
 *
 * Every branch fails closed. A context this function does not recognise, a slot
 * kind that cannot go where it was put, an AST that arrived without a context
 * at all — each renders nothing rather than falling through to "escape it as
 * text and hope", which is what version 1 did and how a value in `href` became
 * a live `javascript:` URL.
 */
function renderSlot(
  node: Extract<AstNode, { kind: 'slot' }>,
  values: Record<string, unknown>,
  options: RenderOptions,
  slot?: SlotDef,
): string {
  const widget = siteWidget(slot)
  if (widget)
    return node.context === 'element-text'
      ? renderSiteWidget(
          widget,
          widget === 'contact-form' && slot?.constraints.echelonContact === true
            ? { ...options.siteWidgets, contactStyle: 'echelon' }
            : widget === 'chapter-directory' && slot?.constraints.echelonDirectory === true
              ? { ...options.siteWidgets, chapterDirectoryStyle: 'echelon' }
              : options.siteWidgets,
        )
      : ''
  // A site menu is never a stored value (ADR 0010), so it is decided before
  // the value is even read, and only between tags.
  if (node.slotKind === 'navigation') {
    return node.context === 'element-text'
      ? slot?.constraints?.['menuStyle'] === 'bt2027-bootstrap5'
        ? (options[REVIEWED_ORIGINAL_NAVIGATION] ?? options.siteNavigation ?? '')
        : (options.siteNavigation ?? '')
      : ''
  }
  const raw = values[node.slotId]
  if (raw === undefined || raw === null) {
    // An empty governed embed still tells the editor, in preview, what to
    // paste (a library section is inserted with no link); visitors see nothing.
    return (node.slotKind === 'link' || node.slotKind === 'button') &&
      node.context === 'element-text' &&
      isGovernedEmbedKind(slot?.constraints?.['embed'])
      ? renderSlot(node, { [node.slotId]: { url: '' } }, options, slot)
      : ''
  }

  // The context reaching this function has already been re-derived from the
  // node list by bindContexts, so it is the tokenizer's answer rather than the
  // stored row's claim. This check is the last one in the chain and stays
  // anyway: an unrecognised context has no escaper, and "no escaper" must mean
  // "no output", never "fall through to the text one".
  const context = node.context
  if (!isKnownContext(context)) return ''

  if (context !== 'element-text') {
    // Typed fields contribute only their fixed scalar for the named sink.
    // The surrounding img/a markup remains definition-owned, including SVG
    // children and layout attributes. Media hydration has already supplied src.
    if (isTypedAttributeBinding(node.slotKind, context, node.attribute)) {
      const value = typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
      if (node.slotKind === 'image') {
        if (node.attribute === 'src') return escapeAttribute(safeUrl(String(value['src'] ?? '')))
        const decorative = value['decorative'] === true || String(value['alt'] ?? '') === ''
        if (node.attribute === 'role') return decorative ? 'presentation' : ''
        return escapeAttribute(decorative ? '' : String(value['alt'] ?? ''))
      }
      return escapeAttribute(safeUrl(String(value['url'] ?? '')))
    }
    // All remaining attribute sinks accept plain text only.
    if (node.slotKind !== 'text') return ''
    const value = String(raw)
    switch (context) {
      case 'quoted-attribute':
        return escapeAttribute(value)
      case 'url-attribute':
        // The URL policy first, then attribute escaping. Doing only the second
        // produced a correctly-quoted javascript: URL.
        //
        // Which URL policy depends on the attribute, because `srcset` and
        // `ping` hold lists. The attribute name here is the tokenizer's, put
        // back by bindContexts on every render, not the stored row's claim.
        return escapeAttribute(safeUrlAttribute(node.attribute, value))
      case 'style-attribute':
        // A style attribute is a declaration list, not a string. It goes
        // through the same CSS policy as a stylesheet, wrapped in a throwaway
        // rule so the parser sees something well-formed.
        return escapeAttribute(inlineStyle(value))
      default:
        // event-attribute, srcdoc-attribute, unquoted-attribute,
        // attribute-name, tag-name, comment, raw-text, unknown.
        return ''
    }
  }

  switch (node.slotKind) {
    case 'text': {
      if (
        slot?.constraints?.presentation === 'cms-date-long-v1' &&
        typeof raw === 'string' &&
        /^\d{4}-\d{2}-\d{2}$/.test(raw)
      ) {
        const date = new Date(raw + 'T00:00:00Z')
        if (Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === raw)
          return escapeText(
            new Intl.DateTimeFormat('en-US', {
              month: 'long',
              day: 'numeric',
              year: 'numeric',
              timeZone: 'UTC',
            }).format(date),
          )
      }
      if (
        slot?.constraints?.presentation === 'cms-date-calendar-v1' &&
        typeof raw === 'string' &&
        /^\d{4}-\d{2}-\d{2}$/.test(raw)
      ) {
        const date = new Date(raw + 'T00:00:00Z')
        if (Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === raw)
          return (
            '<time datetime="' +
            raw +
            '"><span>' +
            new Intl.DateTimeFormat('en-US', { month: 'short', timeZone: 'UTC' }).format(date).toUpperCase() +
            '</span><strong>' +
            raw.slice(8) +
            '</strong></time>'
          )
      }
      const source =
        values.__cms_data_sources && typeof values.__cms_data_sources === 'object'
          ? (values.__cms_data_sources as Record<string, unknown>)[node.slotId]
          : null
      return (
        escapeText(String(raw)) +
        (typeof source === 'string' ? '<small class="cms-data-source">' + escapeText(source) + '</small>' : '')
      )
    }
    case 'richtext':
      // A definition may fix its blocks' and marks' classes and style (an
      // imported source's styled paragraphs and emphasis), and an inline field
      // holds only words and marks; the value itself stays canonical.
      return presentRichText(String(raw), slot?.constraints)
    case 'link':
    case 'button': {
      const value =
        typeof raw === 'object' ? (raw as Record<string, unknown>) : { url: String(raw), label: String(raw) }
      // A governed embed field: the pasted link becomes a video, map or form
      // from an allowlisted provider, or nothing (governed-embeds.ts).
      const embed = slot?.constraints?.['embed']
      if (isGovernedEmbedKind(embed)) {
        const text = (key: string) =>
          typeof slot?.constraints?.[key] === 'string' ? (slot.constraints[key] as string) : undefined
        const title = text('embedTitle'),
          empty = text('embedHelp'),
          frameClass = text('embedFrameClass'),
          placeholderClass = text('embedPlaceholderClass')
        return renderGovernedEmbed(embed, value['url'], title ?? String(value['label'] ?? ''), {
          ...(options.preview ? { preview: true } : {}),
          ...(options.providerEmbeds === false ? { providerEmbeds: false } : {}),
          ...(empty !== undefined ? { empty } : {}),
          ...(frameClass !== undefined ? { frameClass } : {}),
          ...(placeholderClass !== undefined ? { placeholderClass } : {}),
        })
      }
      const url = safeUrl(trackedLinkUrl(safeUrl(String(value['url'] ?? '')), value['trackingCode']))
      const label = escapeText(String(value['label'] ?? ''))
      // An editor's per-link choices (SPEC §6.4): a new tab, which always gets
      // `noopener` so the page it opens cannot reach back, and `nofollow`.
      const newTab = value['newTab'] === true
      const tokens = [
        value['nofollow'] === true ? 'nofollow' : '',
        /^https?:/i.test(url) || newTab ? 'noopener' : '',
      ].filter(Boolean)
      const rel = (tokens.length ? ` rel="${tokens.join(' ')}"` : '') + (newTab ? ' target="_blank"' : '')
      const customButton = buttonAppearanceClasses(value['buttonAppearance'])
      const appearance = customButton
        ? ` class="${customButton}"`
        : node.slotKind === 'button' && options.siteThemeHooks === true
          ? ' class="cms-button"'
          : ''
      return `<a${appearance} href="${escapeAttribute(url)}"${rel}>${label}</a>`
    }
    case 'image': {
      const value = typeof raw === 'object' ? (raw as Record<string, unknown>) : { src: String(raw) }
      const src = safeUrl(String(value['src'] ?? ''))
      const alt = String(value['alt'] ?? '')
      // An image is described or explicitly decorative; there is no third case.
      const decorative = value['decorative'] === true || alt === ''
      const attributes = decorative ? 'alt="" role="presentation"' : `alt="${escapeAttribute(alt)}"`
      const focus = imageFocusPosition(value['focal'])
      return `<img src="${escapeAttribute(src)}" ${attributes}${focus ? ` style="object-position:${focus}"` : ''}>`
    }
    case 'repeat':
      // Collections bind here in M4; rendering nothing is correct until then,
      // and the readiness policy is what notices an empty required region.
      return ''
    default:
      return ''
  }
}

/**
 * A `style="..."` value, run through the stylesheet policy.
 *
 * Treating it as ordinary escaped text let `background:url(//evil.test/x)` ship
 * — correctly quoted, and still a request to somebody else's server on every
 * page view. Wrapping it in a throwaway rule reuses the one CSS policy rather
 * than growing a second, weaker one for inline styles.
 */
function inlineStyle(value: string): string {
  // Wrapped in a throwaway rule under a real class scope. A bare `a` was used
  // before, which stopped working the moment scopes became parsed tokens rather
  // than strings — a tag is not a scope, and a scope that is not a class or an
  // id is not one this policy can confine anything to.
  const { css, blocking } = scopeCss(`${INLINE_STYLE_SCOPE.slice(1)}{${value}}`, INLINE_STYLE_SCOPE)
  if (blocking.length > 0) return ''
  // Read the declarations from the parsed rule: a brace inside a quoted value
  // such as content:"}" must not end the list early.
  const rule = postcss.parse(css).first
  if (!rule || rule.type !== 'rule') return ''
  return rule.nodes
    .filter(node => node.type === 'decl')
    .map(node => node.toString())
    .join(';')
}

/** The scope an inline `style="…"` value is checked under. Never emitted. */
const INLINE_STYLE_SCOPE = '.cms-inline-style'

/** Sections that list the site's stories and need the story feed data. */
const STORY_FEED_SLUGS = new Set(['core-stories', 'core-newsroom', 'core-story-world', 'core-story-split'])

const compiledCssCache = new Map<string, readonly string[]>()
const MAX_COMPILED_CSS_CACHE_ENTRIES = 64
const MAX_COMPILED_CSS_CACHE_CHARACTERS = 1_000_000
let compiledCssCacheCharacters = 0

/**
 * Is this definition's compiled CSS one this renderer will emit?
 *
 * A row can claim any policy version it likes, so the version is checked *and*
 * the artifact is validated. A section whose stylesheet is refused does not
 * render at all: showing its markup without its styling is a different page
 * from the one anyone approved, and a silent one.
 */
export function compiledCssProblems(def: SectionDefView): string[] {
  if (!def.css) return []
  if (def.css_policy_version !== CSS_POLICY_VERSION) {
    return [
      `compiled CSS is at policy version ${def.css_policy_version ?? 'unknown'}, ` +
        `but this renderer emits version ${CSS_POLICY_VERSION}`,
    ]
  }
  const scope = sectionScopeSelector(def.slug)
  // No scope, no stylesheet. A definition whose slug cannot become a class name
  // has nothing to confine its CSS to, and emitting it unconfined is the
  // failure this whole check exists to prevent.
  if (scope === null) return [`slug ${JSON.stringify(def.slug)} cannot be a section scope`]
  // Exact artifacts may be shared across versions or sites. Never key this
  // check by a database identity: its bytes, scope and policy remain authoritative.
  const key = scope + '\0' + def.css
  const existing = compiledCssCache.get(key)
  if (existing) return [...existing]
  const problems = validateCompiledCss(def.css, scope)
  const size = key.length + problems.reduce((total, problem) => total + problem.length, 0)
  if (size <= MAX_COMPILED_CSS_CACHE_CHARACTERS) {
    while (
      compiledCssCache.size >= MAX_COMPILED_CSS_CACHE_ENTRIES ||
      compiledCssCacheCharacters + size > MAX_COMPILED_CSS_CACHE_CHARACTERS
    ) {
      const oldest = compiledCssCache.keys().next().value!
      const oldProblems = compiledCssCache.get(oldest)!
      compiledCssCacheCharacters -= oldest.length + oldProblems.reduce((total, problem) => total + problem.length, 0)
      compiledCssCache.delete(oldest)
    }
    compiledCssCache.set(key, Object.freeze([...problems]))
    compiledCssCacheCharacters += size
  }
  return problems
}

/**
 * The markup inside one section's wrapper, chosen by the definition's own
 * discriminator, or null when this renderer will not emit any.
 *
 * The dispatch is on what the row says it is, never on what it looks like. A
 * structured row carries an empty compiled AST and a legacy row carries no
 * structured document, so "whichever artifact is present" would work today and
 * would keep working right up until a partially-written row made it choose the
 * wrong one — and the wrong choice renders a section that is silently missing
 * its content rather than one that visibly fails.
 */
function renderSectionBody(
  def: SectionDefView,
  values: Record<string, unknown>,
  options: RenderOptions,
): string | null {
  const kind = sectionDefinitionKind(def)
  if (kind === null) return null
  if (kind === 'structured')
    return renderStructuredBody(def, values, {
      ...options,
      ...(def.slots?.[0]?.constraints?.coreLibrary === 'r8' && def.slots[0].constraints?.coreList === 'program'
        ? { groupRepeatsBy: { program: 'date' }, filterRepeatsBy: { program: 'category' } }
        : {}),
    })

  // The renderer independently checks the AST it was handed. The authoring
  // command will not store a definition with blocking problems, but "the other
  // layer would have caught it" is not a property this layer can verify — and
  // the AST arrives from a database row that a migration, a restore, or a hand
  // edit could have produced. An AST below the current policy version is
  // re-classified from its own nodes rather than reinterpreted in place, and
  // one that cannot be classified safely renders nothing at all.
  const upgraded = upgradeCompiledSection(def.compiled_ast)
  if (upgraded.blocking.length > 0) return null

  const marks: CollectionTemplateMark[] = []
  const expanded = expandRepeats(
    upgraded.ast.nodes,
    def.slots ?? [],
    values,
    options.preview === true,
    marks,
    (nodes, slots, item) =>
      renderSectionBody({ ...def, compiled_ast: { ...upgraded.ast, nodes }, slots }, item, {
        ...options,
        preview: false,
      }),
  )
  const nodes = options.preview ? instrumentTypedAttributes(expanded.nodes) : expanded.nodes
  const hosts = options.preview ? richTextHosts(nodes) : new Map<number, string>()
  const html = nodes
    .map((node, index) => {
      if (node.kind === 'html') {
        const hosted = hosts.get(index + 1)
        return hosted === undefined
          ? node.value
          : node.value.replace(/(\s*\/?)>$/, ` data-cms-slot="${escapeAttribute(hosted)}" data-cms-kind="richtext"$1>`)
      }
      const slot = expanded.fields.get(node.slotId)
      const textHere = node.context === 'element-text' && node.slotKind === 'text' && slot !== undefined
      // A code-owned symbol or one of V1's own drawings, by name; never stored markup.
      const drawing = textHere && isDrawingSlot(slot)
      const icon = drawing || (textHere && isIconSlot(slot))
      const date =
        textHere && ['cms-date-long-v1', 'cms-date-calendar-v1'].includes(String(slot.constraints?.presentation))
      const value = values[node.slotId]
      const rendered = drawing
        ? isSourceDrawing(value)
          ? SOURCE_DRAWINGS[value].svg
          : ''
        : icon
          ? slot?.constraints?.presentation === MATERIAL_ICON_PRESENTATION
            ? renderMaterialIcon(value)
            : renderCmsIcon(value)
          : renderSlot(node, values, options, slot)
      // The editor needs a node it can select, outline, and type into. Public
      // output gets no wrapper at all, so the published markup stays exactly
      // what the section author wrote.
      //
      // A wrapper only makes sense between tags. Wrapping an attribute-position
      // slot emitted a literal `<span …>` inside a quoted value, which is not a
      // node the editor can select — it is a broken attribute, and in preview
      // only, which is the worst place for the two paths to diverge.
      if (!options.preview || node.context !== 'element-text' || hosts.has(index)) return rendered
      // A dedicated inert element avoids styling editor markup as authored
      // content (for example Echelon's `.hero h1 span` subtitle selector).
      return (
        `<cms-slot data-cms-slot="${escapeAttribute(node.slotId)}"` +
        ` data-cms-kind="${icon ? 'icon' : date ? 'date' : escapeAttribute(node.slotKind)}">${rendered}</cms-slot>`
      )
    })
    .join('')
  return markCollectionTemplateParents(html, marks)
}

/**
 * Draw each repeat's item markup once per item, in the item order the value
 * holds (LIB-02). An item field's node takes its composed id
 * (`cards__i2__title`), so the value it reads and the field the editor selects
 * are that item's own. The markers themselves render nothing. In a preview, a
 * list with no items says so where its items would be.
 */
function expandRepeats(
  nodes: readonly AstNode[],
  slots: readonly SlotDef[],
  values: Record<string, unknown>,
  preview: boolean,
  marks: CollectionTemplateMark[],
  renderItem: (nodes: AstNode[], slots: SlotDef[], values: Record<string, unknown>) => string | null,
): { nodes: AstNode[]; fields: Map<string, SlotDef> } {
  const fields = new Map<string, SlotDef>(slots.map(slot => [slot.id, slot]))
  const ranges = repeatRanges(nodes)
  if (ranges.size === 0) return { nodes: [...nodes], fields }
  const out: AstNode[] = []
  for (let at = 0; at < nodes.length; at += 1) {
    const node = nodes[at]!
    if (node.kind !== 'slot' || node.marker !== 'start') {
      out.push(node)
      continue
    }
    const end = ranges.get(node.slotId)?.[1] ?? at
    const body = nodes.slice(at + 1, end)
    at = end
    const owner = slots.find(slot => slot.id === node.slotId)
    const collectionSpec = owner ? collectionTemplateSpec(owner) : null
    if (collectionSpec) {
      const rendered = renderCollectionTemplate({
        raw: values[node.slotId],
        field: node.slotId,
        fields: collectionSpec.fields,
        preview,
        render: item => renderItem([...body], collectionSpec.fields, item),
      })
      if (rendered) {
        if (preview)
          marks.push({ field: node.slotId, readerKey: rendered.readerKey, collectionId: rendered.collectionId })
        out.push({ kind: 'html', value: (preview ? collectionTemplateMarker(node.slotId) : '') + rendered.html })
      }
      continue
    }
    const spec = owner ? repeatItemSpec(owner) : null
    if (!spec) continue
    const keys = repeatItemKeys(values[node.slotId], spec.max)
    const board = owner?.constraints?.boardCards === true
    const disclose = board && values.__cms_board_display === 'first-eight' && keys.length > 8
    if (board && keys.length) out.push({ kind: 'html', value: '<div class="core-grid">' })
    if (keys.length === 0 && preview) {
      out.push({
        kind: 'html',
        value:
          `<cms-slot data-cms-slot="${escapeAttribute(node.slotId)}" data-cms-kind="repeat" class="cms-repeat-empty">` +
          `This list is empty. Add ${/^[aeiou]/i.test(spec.unit) ? 'an' : 'a'} ${escapeText(spec.unit.toLowerCase())} from the panel.</cms-slot>`,
      })
    }
    keys.forEach((key, index) => {
      if (disclose && index === 8)
        out.push({
          kind: 'html',
          value: `</div><details class="core-board-more"><summary>Show all ${keys.length} board members</summary><div class="core-grid">`,
        })
      for (const part of body) {
        if (part.kind === 'html') {
          out.push(part)
          continue
        }
        const field = spec.fields.find(candidate => candidate.id === part.slotId)
        if (!field) continue
        const id = repeatItemSlotId(node.slotId, key, field.id)
        fields.set(id, { ...field, id, label: `${spec.unit} ${index + 1} · ${field.label}` })
        out.push({ ...part, slotId: id })
      }
    })
    if (board && keys.length) out.push({ kind: 'html', value: '</div>' + (disclose ? '</details>' : '') })
  }
  return { nodes: out, fields }
}

// Elements a block editor can be mounted in, as the importer groups them.
const RICHTEXT_HOSTS = new Set([
  'div',
  'section',
  'article',
  'aside',
  'main',
  'header',
  'footer',
  'nav',
  'blockquote',
  'li',
  'dd',
  'td',
  'th',
  'figure',
  'figcaption',
  'details',
])

/**
 * Rich-text fields that are the whole content of their element, keyed by the
 * slot's node index. In preview such a field is marked on that element instead
 * of being wrapped: a wrapper would sit between the element and its paragraphs,
 * so the section's own child rules (`.space-y-4 > * + *`, say) stopped matching
 * and the canvas showed different spacing from the published page.
 */
function richTextHosts(nodes: readonly AstNode[]): Map<number, string> {
  const hosts = new Map<number, string>()
  for (const [index, node] of nodes.entries()) {
    if (node.kind !== 'slot' || node.slotKind !== 'richtext' || node.context !== 'element-text') continue
    const before = nodes[index - 1],
      after = nodes[index + 1]
    if (before?.kind !== 'html' || after?.kind !== 'html') continue
    const opening = /<([a-zA-Z][a-zA-Z0-9-]*)((?:\s[^<>]*)?)>$/.exec(before.value)
    const tag = opening?.[1]?.toLowerCase()
    if (
      !opening ||
      !tag ||
      !RICHTEXT_HOSTS.has(tag) ||
      opening[2]!.includes('data-cms-') ||
      !after.value.toLowerCase().startsWith(`</${tag}>`)
    )
      continue
    hosts.set(index, node.slotId)
  }
  return hosts
}

/** Attach editor selection to the original element, never inside its URL. */
function instrumentTypedAttributes(nodes: readonly AstNode[]): AstNode[] {
  const template = nodes.map(node => (node.kind === 'html' ? node.value : `{{${node.slotId}}}`)).join('')
  const slots = nodes.filter((node): node is Extract<AstNode, { kind: 'slot' }> => node.kind === 'slot')
  const additions = new Map<number, string>()
  for (const [index, site] of scanSlotSites(template).entries()) {
    const node = slots[index]
    if (
      !node ||
      site.elementStart === undefined ||
      !isTypedAttributeBinding(node.slotKind, site.context, site.attribute)
    )
      continue
    const tag = /^<[a-zA-Z][a-zA-Z0-9:-]*/.exec(template.slice(site.elementStart))?.[0]
    if (!tag) continue
    const at = site.elementStart + tag.length
    if (!additions.has(at))
      additions.set(
        at,
        ` data-cms-slot="${escapeAttribute(node.slotId)}" data-cms-kind="${escapeAttribute(node.slotKind)}"`,
      )
  }
  let offset = 0
  return nodes.map(node => {
    if (node.kind !== 'html') {
      offset += node.slotId.length + 4
      return node
    }
    const start = offset
    offset += node.value.length
    let value = node.value
    for (const [at, addition] of [...additions].sort((a, b) => b[0] - a[0])) {
      if (at >= start && at < offset) value = value.slice(0, at - start) + addition + value.slice(at - start)
    }
    return { kind: 'html', value }
  })
}

export function renderSection(section: ManifestSection, index: number, options: RenderOptions = {}): string {
  const { instance, def } = section
  const revealHidden =
    (options.preview === true || options.visitorPreview === true) && options.showHiddenSections === true
  if (instance.hidden && !revealHidden) return ''

  let values = siteSocialSectionValues(
    resolveDataValueFields(
      withStoryFeedDates(withStoryVisibility(instance.values ?? {}), def.slots, def.slug),
      options.siteSettings,
      def.slots ?? [],
    ),
    def.slots ?? [],
    def.slug,
    options.siteSettings,
  )
  values = reportIndexValues(def.slug, values)
  if (def.slug === 'core-report-page-links' && options.reportLinkSections) {
    values = { ...values, ...reportPageLinkValues(options.reportLinkSections) }
    if (!options.preview && repeatItemKeys(values.links).length === 0) return ''
  }
  const sharedSocial = usesSiteSocialAccounts(instance.values ?? {}, def.slots ?? [], def.slug)
  if (
    sharedSocial &&
    !options.preview &&
    def.slug !== 'core-echelon-jump-links' &&
    repeatItemKeys(values[siteSocialGroup(def.slots ?? [])]).length === 0
  )
    return ''
  if (def.slug === 'core-stories' && Object.hasOwn(values, 'newsroom')) values = { ...values, more: values.newsroom }
  const world =
    def.slug === 'core-story-world'
      ? storyWorldValues(values, index, {
          ...options.storyWidgets,
          editing: options.preview === true || options.visitorPreview === true,
        })
      : null
  if (world) values = world.values
  const split =
    def.slug === 'core-story-split'
      ? storySplitValues(
          values,
          index,
          { ...options.storyWidgets, editing: options.preview === true || options.visitorPreview === true },
          options.newsroom,
        )
      : null
  if (split) values = split.values
  if (def.slug === 'core-newsroom')
    values = newsroomValues(values, options.newsroom, def.slots?.find(slot => slot.id === 'stories')?.constraints ?? {})
  if (!options.preview && ['board', 'photos', 'events', 'social'].includes(String(values.__cms_chapter_part))) {
    const repeats = (def.slots ?? []).filter(slot => repeatItemSpec(slot))
    if (repeats.length && repeats.every(slot => repeatItemKeys(values[slot.id], 48).length === 0)) return ''
  }
  if (
    !options.preview &&
    def.slug === 'core-story-detail' &&
    (values.story as { kind?: string; readerKey?: string; entries?: unknown[] } | undefined)?.kind === 'collection' &&
    (values.story as { readerKey?: string }).readerKey === 'stories' &&
    Array.isArray((values.story as { entries?: unknown[] }).entries) &&
    !(values.story as { entries: unknown[] }).entries.length
  )
    return ''
  if (
    !options.preview &&
    def.slug === 'core-stories' &&
    values.empty_mode === 'hide' &&
    (values.stories as { kind?: string; entries?: unknown[] } | undefined)?.kind === 'collection' &&
    !(values.stories as { entries: unknown[] }).entries.length
  )
    return ''
  // Sample cards use immutable definition examples; publication readiness requires explicit consent.
  // Real list resolution still happens in Postgres before this renderer runs.
  const metadata = def.slots?.[0]?.constraints
  const list = metadata?.coreList
  if (metadata?.coreLibrary === 'r8' && typeof list === 'string' && sampleFieldNames(values).includes(list)) {
    const bound = values[list] as { kind?: string; entries?: unknown[] } | undefined
    if (
      !(
        bound?.kind === 'collection' &&
        ((bound as { readerKey?: string }).readerKey === 'stories' ||
          (def.slots ?? []).some(slot => slot.id === list && isStoryFeedSlot(slot, def.slug)))
      ) &&
      (options.preview || bound?.kind === 'collection') &&
      !bound?.entries?.length &&
      metadata?.coreListSamples
    )
      values = { ...values, [list]: metadata.coreListSamples }
  }
  // The raw-HTML escape hatch replaces this instance's body, and nothing else:
  // the wrapper, its id, its section classes and its breakpoint classes all
  // stay, so custom CSS still lands on the same block and hide-on-mobile still
  // works on a section somebody took over. Replacing the whole wrapper would
  // quietly turn those three controls off at the moment an author was least
  // expecting it.
  //
  // Emitted verbatim, exactly as a definition's own `html` nodes are. That is
  // not this function deciding to trust it: `app.content_carries_trusted_code`
  // marks any version carrying it, and the publication trigger refuses a marked
  // version with no super-admin approval. A renderer that sanitized it instead
  // would be a third opinion about markup somebody was asked to approve, and
  // approving markup that then ships as something else is worse than either.
  const raw = (instance.raw_html ?? '').trim()
  const original =
    originalDefinition(options.originalLayout, def.section_def_id, def.version) &&
    !def.css?.trim() &&
    !raw &&
    !instance.custom_css?.trim() &&
    !instance.appearance
  let body =
    raw !== ''
      ? raw
      : renderSectionBody(def, values, {
          ...options,
          ...(original ? { siteThemeHooks: false } : {}),
          siteWidgets: { ...options.siteWidgets, widgetKey: 's' + index },
        })
  if (body === null) return ''
  const hero = (def.slots ?? []).find(isHeroSlides)
  if (!raw && hero) {
    body = renderHeroSlides(body, index, hero, values, options.preview === true)
    if (!body) return ''
  }
  // A browser embedded on Home has an h2; its full Newsroom page supplies h1.
  if (raw === '' && def.slug === 'core-newsroom' && !String(values.page_heading ?? '').trim())
    body = body.replace(/<h1 class="core-newsroom-page-heading">[\s\S]*?<\/h1>/, '')
  // The stylesheet is checked for both models, from the same columns. A section
  // whose CSS is refused does not render at all: showing its markup without its
  // styling is a different page from the one anyone approved, and a silent one.
  if (compiledCssProblems(def).length > 0) return ''

  if (!raw && options.preview && usesSiteSocialAccounts(instance.values ?? {}, def.slots ?? [], def.slug))
    body = body
      .replace(new RegExp('\\sdata-cms-slot="' + siteSocialGroup(def.slots ?? []) + '(?:__[^"]*)?"', 'g'), '')
      .replace(/\scontenteditable="true"/g, '')
  // Bound text selects its number controls; it cannot accept an inline edit that resolution would ignore.
  if (!raw && options.preview) {
    const bindings = dataValueBindings(values)
    body = body.replace(/data-cms-slot="([^"]+)" data-cms-kind="(?:text|richtext)"/g, (attributes, key: string) =>
      Object.hasOwn(bindings, key) ? `data-cms-slot="${key}" data-cms-kind="saved-number" tabindex="0"` : attributes,
    )
  }
  if (!raw && def.slug === 'core-feature-tiles')
    body = body.replace(
      'class="national-tiles"',
      'class="national-tiles" data-national-tile-layout="' +
        nationalTileLayout(values, resolvedCollection(values.cards)?.entries.length) +
        '"',
    )
  if (!raw) body = renderEchelonSocialMarks(body, def.slug)
  if (!raw)
    body = reportTemplateMarkup(
      reportLinksMarkup(body, def.slug),
      def.slug,
      values,
      options.annualReportTemplate === true,
    )
  if (!raw)
    body = reportStoryMarkup(
      reportFinancialMarkup(body, def.slug, values),
      def.slug,
      values,
      options.annualReportTemplate === true,
    )
  if (!raw && def.slug === 'core-story-detail') body = renderStoryDetail(renderStoryAuthor(body, values.story))
  if (!raw && world) body = renderStoryWorld(body, index, world)
  if (!raw && split) body = renderStorySplit(body, index, split)
  if (!raw && def.slug === 'core-stories' && Object.hasOwn(values, 'newsroom'))
    body = renderStoryArchive(body, values.newsroom)
  if (!raw && STORY_FEED_SLUGS.has(def.slug ?? '') && (def.slots ?? []).some(slot => isStoryFeedSlot(slot, def.slug)))
    body = renderStoryGrid(body)
  const report = reportPart(def.slug, values)
  if (options.nationalPanels && !report) body = nationalSectionPanel(body, def.slug, values)
  const blockId = `s${index}`
  const classes = ['cms-section', `cms-section--${escapeAttribute(def.slug ?? 'section')}`]
  if (report)
    classes.push(
      'cms-report-part--' + report,
      ...(!reportPhoto(values.photo) ? ['cms-report-no-photo'] : []),
      ...(!String(values.heading ?? '').trim() ? ['cms-report-no-heading'] : []),
      ...(!String(values.source ?? '').trim() ? ['cms-report-no-source'] : []),
    )
  if (def.slug === 'core-text-image' && values.__cms_report_links === true) classes.push('cms-report-index-row')
  // A breakpoint name, not free text. Escaping made the quotes safe and left
  // the spaces, so one array element `sm cms-section--other x` added three
  // class names of the author's choosing to the section wrapper — enough to
  // borrow another definition's styles. There are three breakpoints and the
  // stylesheet only has rules for those three, so anything else is not a
  // breakpoint and belongs in no class name.
  const hiddenAt = (instance.hidden_at ?? []).filter(breakpoint => Object.hasOwn(BREAKPOINT_MAX_WIDTH, breakpoint))
  for (const breakpoint of hiddenAt) {
    if (!revealHidden) classes.push(`cms-hide-${breakpoint}`)
  }

  // Preview-only instrumentation. Public output carries none of it (SPEC §8).
  const instrumentation = options.preview
    ? ` data-cms-section="${escapeAttribute(String(index))}"` +
      `${instance.hidden ? ' data-cms-hidden' : ''}${hiddenAt.length ? ` data-cms-hidden-at="${hiddenAt.join(' ')}"` : ''}` +
      ` data-cms-def="${escapeAttribute(def.section_def_id)}"` +
      ` data-cms-label="${escapeAttribute(instance.label || def.slug || '')}"`
    : ''

  const devices: Record<string, string> = { sm: 'phones', md: 'tablets', lg: 'desktops' }
  const hiddenNotice =
    revealHidden && (instance.hidden || hiddenAt.length > 0)
      ? `<div class="cms-hidden-notice">${instance.hidden ? 'Hidden from visitors' : `Hidden on ${hiddenAt.map(device => devices[device]).join(', ')}`} · Shown here for editing</div>`
      : ''
  const anchor = (
    original ? [instance.values?.__cms_anchor].filter(validSectionAnchor) : sectionAnchorNames(instance.values)
  )
    .map(name => `<span class="cms-section-anchor" id="${escapeAttribute(name)}" aria-hidden="true"></span>`)
    .join('')
  if (original) {
    const original = originalRoot(
      body,
      instrumentation,
      classes.filter(name => name.startsWith('cms-hide-')),
    )
    if (original !== null) return anchor + hiddenNotice + original
  }
  return `${anchor}${hiddenNotice}<div id="${blockId}" class="${classes.join(' ')}"${instrumentation}>${body}</div>`
}

export function collectCss(sections: readonly ManifestSection[]): string {
  const parts: string[] = []
  const seenDefs = new Set<string>()
  const stylesByScope = new Map<string, Set<string>>()
  const indicesByDefinition = new Map<string, number[]>()
  sections.forEach((section, index) => {
    const scope = sectionScopeSelector(section.def.slug ?? '')
    const key = `${section.def.section_def_id}@${section.def.version}`
    const indices = indicesByDefinition.get(key) ?? []
    indices.push(index)
    indicesByDefinition.set(key, indices)
    if (!scope) return
    const styles = stylesByScope.get(scope) ?? new Set<string>()
    styles.add(section.def.css ?? '')
    stylesByScope.set(scope, styles)
  })

  sections.forEach((section, index) => {
    const key = `${section.def.section_def_id}@${section.def.version}`
    if (section.def.css && !seenDefs.has(key)) {
      seenDefs.add(key)
      // Validated here too, not just where the markup is decided. collectCss
      // used to push stored CSS into the page untouched, which meant a row
      // claiming the current policy version got its selectors onto every page
      // that used the section.
      if (compiledCssProblems(section.def).length === 0) {
        const scope = sectionScopeSelector(section.def.slug ?? '')!
        const css =
          (stylesByScope.get(scope)?.size ?? 0) > 1
            ? narrowCompiledCss(section.def.css, scope, indicesByDefinition.get(key)!)
            : section.def.css
        if (css === null) throw new Error('The styles for mixed section versions could not be isolated')
        parts.push(nativeDisclosureCss(css))
      }
    }
    if (!section.instance.raw_html?.trim() && !section.instance.custom_css?.trim()) {
      parts.push(sectionAppearanceCss(section.def, section.instance.appearance, index))
    }
    // Per-block custom CSS is scoped to that block's id, so one section's
    // escape hatch can never restyle another (SPEC §6.4).
    if (section.instance.custom_css) {
      // Refused whole when the policy blocks any of it, for the same reason a
      // definition's stylesheet is: a section shown with half its styling is a
      // different section from the one somebody wrote, and the half that
      // survived is whichever half happened to parse. `checkCustomCss` in the
      // admin runs this same call so the author is told which rule it was
      // rather than watching their styling not arrive.
      const scoped = scopeCss(section.instance.custom_css, `#s${index}`)
      if (scoped.blocking.length === 0) parts.push(scoped.css)
    }
  })

  if (
    sections.some(
      ({ def, instance }) =>
        !instance.raw_html?.trim() &&
        STORY_FEED_SLUGS.has(def.slug ?? '') &&
        (def.slots ?? []).some(slot => isStoryFeedSlot(slot, def.slug)),
    )
  )
    parts.push(STORY_GRID_CSS)

  if (
    sections.some(
      ({ def, instance }) =>
        !instance.raw_html?.trim() && ['core-story-world', 'core-story-split'].includes(def.slug ?? ''),
    )
  )
    parts.push(STORY_WORLD_CSS)
  if (sections.some(({ def, instance }) => !instance.raw_html?.trim() && def.slug === 'core-story-split'))
    parts.push(STORY_SPLIT_CSS)

  // Breakpoint visibility is a bounded, declared control — not free
  // per-viewport layout (SPEC §6.4, D5).
  parts.push(`@media (max-width:${BREAKPOINT_MAX_WIDTH['sm']}){.cms-hide-sm{display:none !important}}`)
  parts.push(
    `@media (min-width:768px) and (max-width:${BREAKPOINT_MAX_WIDTH['md']}){.cms-hide-md{display:none !important}}`,
  )
  parts.push(`@media (min-width:1024px){.cms-hide-lg{display:none !important}}`)
  return parts.join('')
}

/** A font stack: family names, quotes, commas, spaces. No syntax, no scheme. */
const FONT_STACK = /^[a-z0-9 _,'"-]+$/i

export function themeCss(theme: SiteShell['theme'], materialSymbols = false, variablesOnly = false): string {
  const declarations: string[] = []
  for (const [name, value] of Object.entries(theme.colors ?? {})) {
    if (/^[a-z0-9-]+$/i.test(name) && /^[#a-z0-9(),.%\s-]+$/i.test(value)) {
      declarations.push(`--color-${name}:${value}`)
    }
  }
  // Device-native or self-hosted stacks only, and an allowlist rather than a
  // URL test — the sibling colour and radius sinks above and below both use
  // one, and this was the single theme value that did not.
  //
  // `!/https?:/i` refused a CDN fetch and nothing else. Everything here is
  // spliced into the page's one `<style>` element, so a font value of
  // `a</style><meta http-equiv="refresh" content="0;url=//evil.test">` ended
  // that element early and put attacker markup in every page's `<head>`. Meta
  // refresh is not covered by any CSP directive, which made it a working
  // site-wide navigation hijack. The allowlist subsumes the URL test: a URL
  // needs `:` and `/`, and neither is in it.
  const heading = theme.fonts?.heading
  const body = theme.fonts?.body
  if (heading && FONT_STACK.test(heading)) declarations.push(`--font-heading:${heading}`)
  if (body && FONT_STACK.test(body)) declarations.push(`--font-body:${body}`)
  if (theme.radius && /^[\d.]+(rem|px|em)$/.test(theme.radius)) declarations.push(`--radius:${theme.radius}`)

  const spacing = theme.spacing === 'compact' ? '.82' : theme.spacing === 'spacious' ? '1.18' : '1'
  declarations.push(`--spacing-scale:${spacing}`)
  const button = theme.buttons ?? {}
  const buttonColor = button.color === 'accent' ? 'accent' : 'primary'
  const buttonContrast = buttonColor === 'accent' ? 'accentContrast' : 'primaryContrast'
  const buttonRadius =
    button.radius && /^[\d.]+(rem|px|em)$/.test(button.radius) ? button.radius : 'var(--radius,.25rem)'
  const buttonSpeed = button.speed === 'fast' ? '100ms' : button.speed === 'slow' ? '300ms' : '180ms'
  declarations.push(`--button-bg:var(--color-${buttonColor},#003087)`)
  declarations.push(`--button-ink:var(--color-${buttonContrast},#fff)`)
  declarations.push(`--button-radius:${buttonRadius}`)
  declarations.push(`--button-speed:${buttonSpeed}`)
  for (const [name, source] of Object.entries({
    brand: 'color-primary',
    accent: 'color-accent',
    dark: 'color-ink',
    light: 'color-surfaceAlt',
    'font-heading': 'font-heading',
    'font-body': 'font-body',
    radius: 'radius',
    'space-scale': 'spacing-scale',
    'button-bg': 'button-bg',
    'button-ink': 'button-ink',
    'button-radius': 'button-radius',
  }))
    declarations.push(`--site-${name}:var(--${source})`)

  if (variablesOnly) return ':root{' + declarations.join(';') + '}'

  const buttonBase =
    button.style === 'outline'
      ? 'background:transparent;color:var(--button-bg);border-color:var(--button-bg)'
      : button.style === 'text'
        ? 'background:transparent;color:var(--button-bg);border-color:transparent;padding-inline:.25rem'
        : 'background:var(--button-bg);color:var(--button-ink);border-color:var(--button-bg)'
  const buttonHover =
    button.hover === 'lift'
      ? 'transform:translateY(-2px);box-shadow:0 .45rem 1rem rgba(17,24,39,.18)'
      : button.hover === 'invert'
        ? 'background:var(--button-ink);color:var(--button-bg)'
        : button.hover === 'underline'
          ? 'text-decoration:underline;text-underline-offset:.2em'
          : button.hover === 'none'
            ? ''
            : 'filter:brightness(.86)'

  return (
    (heading?.includes("'Open Sans'") || body?.includes("'Open Sans'")
      ? "@font-face{font-family:'Open Sans';src:url('/cms-samples/fonts/open-sans-latin-300-normal.woff2') format('woff2');font-weight:300;font-style:normal;font-display:swap}@font-face{font-family:'Open Sans';src:url('/cms-samples/fonts/open-sans-latin-400-normal.woff2') format('woff2');font-weight:400;font-style:normal;font-display:swap}@font-face{font-family:'Open Sans';src:url('/cms-samples/fonts/open-sans-latin-700-normal.woff2') format('woff2');font-weight:700;font-style:normal;font-display:swap}"
      : '') +
    (heading?.includes("'Source Serif 4'") || body?.includes("'Source Serif 4'")
      ? "@font-face{font-family:'Source Serif 4';src:url('/cms-samples/fonts/source-serif-4-latin-400-normal.woff2') format('woff2');font-weight:400;font-style:normal;font-display:swap}@font-face{font-family:'Source Serif 4';src:url('/cms-samples/fonts/source-serif-4-latin-700-normal.woff2') format('woff2');font-weight:700;font-style:normal;font-display:swap}"
      : '') +
    (heading?.includes("'Creato Display'") || body?.includes("'Creato Display'") ? localBrandFontCss() : '') +
    (materialSymbols
      ? "@font-face{font-family:'Material Symbols Outlined';src:url('/cms-samples/fonts/material-symbols-outlined-latin-400-normal.woff2') format('woff2');font-weight:400;font-style:normal;font-display:swap}.cms-material-symbols{font-family:'Material Symbols Outlined';font-weight:400;font-style:normal;font-size:2rem;line-height:1;letter-spacing:normal;text-transform:none;display:inline-block;white-space:nowrap;direction:ltr;font-feature-settings:'liga';-webkit-font-smoothing:antialiased}"
      : '') +
    `:root{${declarations.join(';')};--nav-chevron-size:.375rem;--nav-chevron-stroke:.125rem}` +
    'body{margin:0;font-family:var(--font-body,system-ui,sans-serif);' +
    'background:var(--color-surface,#fff);color:var(--color-ink,#111)}' +
    // V2's own sections take the theme's heading font. Content imported from
    // V1 (a `v1-` definition, or inside a reference root) does not: V1 had no
    // such rule, so its headings either name their font or inherit the body's
    // (HNI's footer column headings are Proxima Nova, not Trajan). `:where`
    // keeps the specificity of a plain element selector.
    `${['h1', 'h2', 'h3'].map(tag => `${tag}:not(:where(.v1-reference-root,[class*="cms-section--v1-"]) *)`).join(',')}` +
    '{font-family:var(--font-heading,inherit)}' +
    PROVIDER_FRAME_CSS +
    // A functional, intentionally quiet site shell. Section CSS owns page
    // content; these rules make the shared header/navigation honest even
    // before a site has authored a global header. They use the governed theme
    // tokens and never depend on JavaScript: nested menus open on pointer hover
    // and keyboard focus, then become an ordinary stacked list on small screens.
    '.cms-site-header{position:relative;z-index:50;border-top:4px solid var(--color-primary,#003087);' +
    'border-bottom:1px solid color-mix(in srgb,var(--color-ink,#111) 14%,transparent);' +
    'background:var(--color-surface,#fff);color:var(--color-ink,#111)}' +
    '.cms-site-header-inner{box-sizing:border-box;max-width:76rem;margin:0 auto;padding:.85rem 1.5rem;' +
    'display:flex;align-items:center;justify-content:space-between;gap:1.5rem}' +
    '.cms-site-brand{color:inherit;text-decoration:none;font-family:var(--font-heading,inherit);' +
    'font-size:1.05rem;font-weight:700;line-height:1.2}' +
    '.cms-nav-group>details>summary{cursor:pointer;list-style:none;display:flex;align-items:center;gap:.4rem;padding:10px 14px;border-radius:8px}.cms-nav-group>details,.cms-nav-group>details>summary{color:inherit}.cms-nav-group>details>summary:after{content:"";flex:none;width:var(--nav-chevron-size);height:var(--nav-chevron-size);border:solid currentColor;border-width:0 var(--nav-chevron-stroke) var(--nav-chevron-stroke) 0;transform:rotate(45deg)}.cms-nav-group>details>summary::-webkit-details-marker{display:none}.cms-nav-group>details>summary::marker{content:""}.cms-nav-group>details[open]>.cms-nav-submenu{display:block}' +
    // Native details keep click/keyboard behavior; desktop hover also reveals
    // their closed content, including browsers that hide ::details-content.
    '@media(hover:hover){.cms-desktop-nav .cms-nav-group>details:hover>.cms-nav-submenu,.national-desktop-nav .cms-nav-group>details:hover>.cms-nav-submenu{display:block}.cms-desktop-nav .cms-nav-group>details:hover::details-content,.national-desktop-nav .cms-nav-group>details:hover::details-content{content-visibility:visible}}' +
    '.cms-site-nav .cms-nav-list{list-style:none;margin:0;padding:0;display:flex;align-items:center;gap:.2rem}' +
    '.cms-site-nav .cms-nav-item{position:relative}' +
    '.cms-site-nav a{display:block;padding:.55rem .7rem;border-radius:var(--radius,.25rem);' +
    'color:inherit;text-decoration:none;font-size:.875rem;font-weight:600;line-height:1.25}' +
    '.cms-site-nav a:hover,.cms-site-nav a:focus-visible{background:color-mix(in srgb,var(--color-primary,#003087) 10%,transparent);outline:none}' +
    '.cms-site-nav a:focus-visible{box-shadow:0 0 0 2px var(--color-primary,#003087)}' +
    '.cms-site-nav .cms-nav-submenu{display:none;position:absolute;left:0;top:100%;min-width:13rem;padding:.35rem;' +
    'border:1px solid color-mix(in srgb,var(--color-ink,#111) 16%,transparent);border-radius:var(--radius,.25rem);' +
    'background:var(--color-surface,#fff);box-shadow:0 .75rem 2rem rgba(17,24,39,.14)}' +
    '.cms-site-nav .cms-nav-item:hover>.cms-nav-submenu,.cms-site-nav .cms-nav-item:focus-within>.cms-nav-submenu{display:grid}' +
    '.cms-site-footer{padding:1.25rem 1.5rem;border-top:1px solid color-mix(in srgb,var(--color-ink,#111) 12%,transparent);' +
    'background:var(--color-surface,#fff);color:var(--color-ink,#111)}' +
    '.cms-site-footer p{max-width:76rem;margin:0 auto;font-size:.8rem;opacity:.72}' +
    '.cms-button{box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;gap:.4rem;' +
    'padding:calc(.62rem * var(--spacing-scale,1)) calc(1rem * var(--spacing-scale,1));' +
    `border:2px solid;border-radius:var(--button-radius);font-weight:${button.weight === 'regular' ? '600' : '750'};` +
    `text-decoration:none;transition:transform var(--button-speed),box-shadow var(--button-speed),filter var(--button-speed),background var(--button-speed),color var(--button-speed);${buttonBase}}` +
    `.cms-button:hover,.cms-button:focus-visible{${buttonHover}}` +
    '.cms-button:focus-visible{outline:3px solid color-mix(in srgb,var(--button-bg) 34%,transparent);outline-offset:3px}' +
    '@media(prefers-reduced-motion:reduce){.cms-button{transition:none}.cms-button:hover{transform:none}}' +
    '.cms-section-anchor{display:block;block-size:0;scroll-margin-block-start:5rem}.cms-phone-menu{display:none}.cms-site-brand{min-width:0;overflow-wrap:anywhere}' +
    '@media(max-width:767px){.cms-site-header-inner>.cms-desktop-nav{display:none}.cms-phone-menu{display:block;width:100%}.cms-phone-menu>summary{display:flex;align-items:center;justify-content:space-between;list-style:none;box-sizing:border-box;min-height:2.5rem;cursor:pointer;padding:.5rem .75rem;border:1px solid currentColor;border-radius:var(--radius);font-weight:600}.cms-phone-menu>summary::-webkit-details-marker{display:none}.cms-phone-menu>summary::marker{content:""}.cms-phone-menu>summary:after{content:"";flex:none;width:var(--nav-chevron-size);height:var(--nav-chevron-size);border:solid currentColor;border-width:0 var(--nav-chevron-stroke) var(--nav-chevron-stroke) 0;transform:rotate(45deg)}.cms-phone-menu>summary:focus-visible{outline:2px solid currentColor;outline-offset:2px}.cms-site-header-inner{align-items:flex-start;flex-direction:column;gap:.45rem;padding:.75rem 1rem}' +
    '.cms-site-nav{width:100%;overflow-x:auto}.cms-site-nav .cms-nav-list{align-items:stretch;flex-direction:column}' +
    '.cms-site-nav .cms-nav-submenu{display:grid;position:static;min-width:0;margin-left:.75rem;border:0;border-left:2px solid var(--color-primary,#003087);' +
    'border-radius:0;box-shadow:none}.cms-site-nav a{padding:.48rem .55rem}}' +
    // The skip link, hidden until it is focused.
    //
    // The markup for it has always been emitted and nothing ever styled it, so
    // every page — published as well as previewed — opened with the words "Skip
    // to content" sitting above its own header. It was most obvious inside the
    // editor's canvas, where it read as part of the editor rather than as part
    // of the page, but it was on the live site too.
    //
    // Moved off-screen rather than `display:none`d, because a link that is not
    // laid out is not in the tab order either, and a skip link that cannot be
    // reached by Tab is the one kind of skip link that is worse than none. It
    // comes back at the top-left corner on focus, over everything, in the site's
    // own colours (WCAG 2.4.1).
    '.cms-skip{position:absolute;left:-10000px;top:auto;width:1px;height:1px;overflow:hidden}' +
    '.cms-skip:focus{position:fixed;left:.5rem;top:.5rem;width:auto;height:auto;z-index:1000;' +
    'background:var(--color-surface,#fff);color:var(--color-ink,#111);padding:.5rem 1rem;' +
    'border:2px solid currentColor;border-radius:var(--radius,.25rem)}' +
    panelPresentationCss(theme.presentation)
  )
}

export function renderNavigation(
  nav: readonly NavigationNode[],
  pathForPage: (pageId: string) => string | null,
  depth = 0,
  currentPath?: string,
  instrumentMenu = false,
  path = '',
): string {
  const items = nav
    .map((node, index) => {
      if (!node.visible) return ''
      const itemPath = path ? path + '.' + index : String(index)
      const href = node.target.type === 'url' ? safeUrl(node.target.url) : pathForPage(node.target.page_id)
      // A nav entry whose page is no longer published is dropped rather than
      // rendered as a dead link (SPEC §6.7).
      if (!href && !node.dropdownGroup) return ''
      const children = node.children?.length
        ? renderNavigation(node.children, pathForPage, depth + 1, currentPath, instrumentMenu, itemPath)
        : ''
      if (node.dropdownGroup)
        return children
          ? `<li class="cms-nav-item cms-nav-item-parent cms-nav-group"><details><summary${instrumentMenu ? ` data-cms-menu-path="${itemPath}"` : ''}>${escapeText(node.label)}</summary>${children}</details></li>`
          : ''
      // A page target naming this page is the current location. In-page
      // anchors and external URLs never are, so styling can rely on it.
      const current =
        currentPath !== undefined && node.target.type === 'page' && href === currentPath ? ' aria-current="page"' : ''
      return (
        `<li class="cms-nav-item${children ? ' cms-nav-item-parent' : ''}">` +
        `<a href="${escapeAttribute(href!)}"${current}${instrumentMenu ? ` data-cms-menu-path="${itemPath}"` : ''}>${escapeText(node.label)}</a>${children}</li>`
      )
    })
    .filter(Boolean)
    .join('')
  return items ? `<ul class="cms-nav-list${depth > 0 ? ' cms-nav-submenu' : ''}">${items}</ul>` : ''
}

function parsedHeaderConfig(value: unknown): HeaderConfig | null {
  const parsed = HeaderConfig.safeParse(value)
  return parsed.success ? parsed.data : null
}

function parsedFooterConfig(value: unknown): FooterConfig | null {
  const parsed = FooterConfig.safeParse(value)
  return parsed.success ? parsed.data : null
}

/**
 * An authored header or footer (ADR 0010), or null when this renderer will not
 * emit it: the shell carries no definition, a different one than the config
 * pins, or one whose markup or stylesheet fails the same checks a page
 * section's would. Null falls back to the baseline frame rather than showing a
 * frame nobody published.
 */
function renderFrameComponent(
  tag: 'header' | 'footer',
  config: HeaderConfigV2 | FooterConfigV2,
  def: SectionDefView | null | undefined,
  options: RenderOptions,
  markFrame: boolean,
): string | null {
  if (!config.enabled) return ''
  if (
    !def ||
    def.section_def_id !== config.component.section_def_id ||
    def.version !== config.component.section_def_version
  )
    return null
  if (sectionScopeSelector(def.slug) === null || compiledCssProblems(def).length > 0) return null
  const original =
    originalDefinition(options.originalLayout, def.section_def_id, def.version) &&
    !def.css?.trim() &&
    (!('sticky' in config) || !config.sticky)
  const body = renderSectionBody(
    def,
    config.component.values,
    original ? { ...options, siteThemeHooks: false } : { ...options, [REVIEWED_ORIGINAL_NAVIGATION]: undefined },
  )
  if (body === null) return null
  if (original) {
    const original = originalRoot(body, markFrame ? ' data-cms-frame="' + tag + '"' : '')
    if (original !== null) return original
  }
  const sticky = 'sticky' in config && config.sticky
  // Not `cms-site-header`: that class carries the baseline and preset frame's
  // own border and spacing, and an authored frame is styled by its definition.
  const classes = [
    'cms-frame',
    `cms-frame--${tag}`,
    `cms-section--${escapeAttribute(def.slug ?? '')}`,
    ...(sticky ? ['cms-frame--sticky'] : []),
  ].join(' ')
  // The canvas labels the frame as site-wide rather than as page content. Its
  // fields carry no click-to-edit instrumentation: a page never edits them.
  const instrumentation = markFrame ? ` data-cms-frame="${tag}"` : ''
  return `<${tag} class="${classes}"${instrumentation}>${body}</${tag}>`
}

function frameComponentCss(defs: readonly (SectionDefView | null)[]): string {
  // Preset-framed pages keep their exact historical bytes.
  if (defs.every(def => def === null)) return ''
  const seen = new Set<string>()
  let css = '.cms-frame--sticky{position:sticky;top:0;z-index:50}'
  for (const def of defs) {
    if (!def?.css || seen.has(`${def.section_def_id}@${def.version}`)) continue
    seen.add(`${def.section_def_id}@${def.version}`)
    if (compiledCssProblems(def).length === 0) css += def.css
  }
  return css
}

/**
 * Resolve a global-element link without trusting the read model that supplied
 * it. Page targets only exist while their published page has a path in this
 * exact manifest; URL targets cross the same scheme/authority boundary as
 * every section and navigation link.
 */
function globalLinkHref(link: GlobalLinkView, navigationPaths: Readonly<Record<string, string>>): string | null {
  if (link.target.type === 'page') return navigationPaths[link.target.page_id] ?? null
  const href = safeUrl(link.target.url)
  return href === '#' && link.target.url.trim() !== '#' ? null : href
}

function renderGlobalLink(
  link: GlobalLinkView,
  navigationPaths: Readonly<Record<string, string>>,
  className?: string,
): string {
  const href = globalLinkHref(link, navigationPaths)
  if (href === null) return ''
  const classes = className ? ` class="${escapeAttribute(className)}"` : ''
  return `<a${classes} href="${escapeAttribute(href)}">${escapeText(link.label)}</a>`
}

function mediaVariantUrl(mediaId: string, variant: 'wide' | 'thumbnail'): string {
  return `/media/${encodeURIComponent(mediaId)}/${variant}`
}

function renderHeaderBrand(config: HeaderConfigView, fallbackSiteName: string): string {
  const { logoMediaId, compactLogoMediaId } = config.brand
  const siteName = config.brand.siteName || fallbackSiteName
  const hasLogo = logoMediaId !== null || compactLogoMediaId !== null
  // A name cannot disappear with the logo. When no usable logo exists the
  // configured name becomes visible even if showName was false; when a logo is
  // the only visible brand, its alt and the link's label carry that name.
  const showName = config.brand.showName || !hasLogo
  const logoAlt = showName ? '' : config.brand.logoDescription?.trim() || siteName
  let logo = ''

  if (logoMediaId !== null) {
    const image =
      `<img class="cms-site-logo cms-site-logo-full" ` +
      `src="${escapeAttribute(mediaVariantUrl(logoMediaId, 'wide'))}" ` +
      `width="240" height="72" alt="${escapeAttribute(logoAlt)}">`
    logo =
      compactLogoMediaId === null
        ? image
        : `<picture><source media="(max-width:767px)" ` +
          `srcset="${escapeAttribute(mediaVariantUrl(compactLogoMediaId, 'thumbnail'))}">${image}</picture>`
  } else if (compactLogoMediaId !== null) {
    logo =
      `<img class="cms-site-logo cms-site-logo-compact" ` +
      `src="${escapeAttribute(mediaVariantUrl(compactLogoMediaId, 'thumbnail'))}" ` +
      `width="64" height="64" alt="${escapeAttribute(logoAlt)}">`
  }

  const name = showName ? `<span class="cms-site-brand-name">${escapeText(siteName)}</span>` : ''
  return `<a class="cms-site-brand cms-global-brand" href="/" aria-label="${escapeAttribute(showName ? siteName : logoAlt)}">${logo}${name}</a>`
}

function renderConfiguredHeader(
  config: HeaderConfigView,
  fallbackSiteName: string,
  navigation: readonly NavigationNode[],
  navigationPaths: Readonly<Record<string, string>>,
  instrumentMenu = false,
): string {
  if (!config.enabled) return ''
  const nav = renderNavigation(navigation, pageId => navigationPaths[pageId] ?? null, 0, undefined, instrumentMenu)
  const utilityItems = config.utilityLinks
    .map(link => renderGlobalLink(link, navigationPaths))
    .filter(Boolean)
    .map(link => `<li>${link}</li>`)
    .join('')
  const utility = utilityItems
    ? `<nav class="cms-global-utility" aria-label="Utility"><ul>${utilityItems}</ul></nav>`
    : ''
  const cta =
    config.cta === null ? '' : renderGlobalLink(config.cta, navigationPaths, 'cms-button cms-global-header-cta')
  const actions = utility || cta ? `<div class="cms-global-header-actions">${utility}${cta}</div>` : ''
  // A named partner beside the brand, as HNI's “In partnership with …”; its
  // address goes through the same link rules as every other header link.
  const partner = config.partner
    ? `<p class="cms-global-header-partner"><span>${escapeText(config.partner.label)}</span> ` +
      (config.partner.url === null
        ? `<strong>${escapeText(config.partner.name)}</strong>`
        : renderGlobalLink(
            { label: config.partner.name, target: { type: 'url', url: config.partner.url } },
            navigationPaths,
          ) || `<strong>${escapeText(config.partner.name)}</strong>`) +
      '</p>'
    : ''
  const classes = [
    'cms-site-header',
    'cms-global-header',
    `cms-global-header--${config.preset}`,
    `cms-surface--${config.surface}`,
    ...(config.sticky ? ['cms-global-header--sticky'] : []),
  ].join(' ')

  return (
    `<header class="${classes}"><div class="cms-site-header-inner cms-global-header-inner">` +
    `${renderHeaderBrand(config, fallbackSiteName)}${partner}${actions}` +
    (nav ? responsiveNavigation(nav) : '') +
    `</div></header>`
  )
}

function renderBaselineHeader(
  siteName: string,
  navigation: readonly NavigationNode[],
  navigationPaths: Readonly<Record<string, string>>,
  instrumentMenu = false,
): string {
  const nav = renderNavigation(navigation, pageId => navigationPaths[pageId] ?? null, 0, undefined, instrumentMenu)
  return nav
    ? `<header class="cms-site-header"><div class="cms-site-header-inner">` +
        `<a class="cms-site-brand" href="/">${escapeText(siteName)}</a>` +
        responsiveNavigation(nav) +
        `</div></header>`
    : ''
}

/** Native disclosure works on phones even when scripts are unavailable. */
function responsiveNavigation(nav: string): string {
  return (
    `<nav class="cms-site-nav cms-desktop-nav" aria-label="Main">${nav}</nav>` +
    `<details class="cms-phone-menu"><summary>Menu</summary><nav class="cms-site-nav" aria-label="Main on phone">${nav}</nav></details>`
  )
}

const SOCIAL_LABELS: Readonly<Record<FooterConfigView['social'][number]['service'], string>> = {
  facebook: 'Facebook',
  instagram: 'Instagram',
  youtube: 'YouTube',
  linkedin: 'LinkedIn',
  x: 'X',
  tiktok: 'TikTok',
}

function renderConfiguredFooter(
  config: FooterConfigView,
  fallbackSiteName: string,
  navigationPaths: Readonly<Record<string, string>>,
): string {
  if (!config.enabled) return ''
  const siteName = config.brand.siteName || fallbackSiteName
  const brand =
    `<div class="cms-global-footer-brand"><p class="cms-global-footer-name">${escapeText(siteName)}</p>` +
    (config.brand.blurb ? `<p class="cms-global-footer-blurb">${escapeText(config.brand.blurb)}</p>` : '') +
    (config.brand.showFoundation ? '<p class="cms-global-footer-foundation">The Salvation Army</p>' : '') +
    '</div>'
  const groups = config.groups
    .map(group => {
      const links = group.links.map(link => renderGlobalLink(link, navigationPaths)).filter(Boolean)
      if (links.length === 0) return ''
      return (
        `<nav class="cms-global-footer-group" aria-label="${escapeAttribute(group.heading)}">` +
        `<h2>${escapeText(group.heading)}</h2><ul>${links.map(link => `<li>${link}</li>`).join('')}</ul></nav>`
      )
    })
    .filter(Boolean)
    .join('')
  const contact =
    config.contact === null
      ? ''
      : (() => {
          const heading = config.contact.heading ?? ''
          const address = config.contact.address ?? ''
          const phone = config.contact.phone ?? ''
          const email = config.contact.email ?? ''
          const phoneHref = phone ? safeUrl(`tel:${phone}`) : '#'
          const emailHref = email ? safeUrl(`mailto:${email}`) : '#'
          return (
            `<section class="cms-global-footer-contact">` +
            (heading ? `<h2>${escapeText(heading)}</h2>` : '') +
            (address ? `<address>${escapeText(address)}</address>` : '') +
            (phone && phoneHref !== '#' ? `<a href="${escapeAttribute(phoneHref)}">${escapeText(phone)}</a>` : '') +
            (email && emailHref !== '#' ? `<a href="${escapeAttribute(emailHref)}">${escapeText(email)}</a>` : '') +
            '</section>'
          )
        })()
  const socialLinks = config.social
    .map(({ service, url }) => {
      const href = safeUrl(url)
      return href === '#' ? '' : `<li><a href="${escapeAttribute(href)}">${SOCIAL_LABELS[service]}</a></li>`
    })
    .filter(Boolean)
    .join('')
  const social = socialLinks
    ? `<nav class="cms-global-footer-social" aria-label="Social media"><ul>${socialLinks}</ul></nav>`
    : ''
  const legalLinks = [config.legal.privacy, config.legal.accessibility, config.legal.terms]
    .filter((link): link is GlobalLinkView => link !== null)
    .map(link => renderGlobalLink(link, navigationPaths))
    .filter(Boolean)
  const legal =
    `<div class="cms-global-footer-legal"><p>${escapeText(config.legal.copyright)}</p>` +
    (legalLinks.length
      ? `<nav aria-label="Legal"><ul>${legalLinks.map(link => `<li>${link}</li>`).join('')}</ul></nav>`
      : '') +
    '</div>'

  return (
    `<footer class="cms-site-footer cms-global-footer cms-global-footer--${config.preset}">` +
    `<div class="cms-global-footer-inner"><div class="cms-global-footer-grid">${brand}${groups}${contact}</div>` +
    `${social}${legal}</div></footer>`
  )
}

function renderBaselineFooter(siteName: string): string {
  return `<footer class="cms-site-footer"><p>${escapeText(siteName)}</p></footer>`
}

const HEADER_PARTNER_CSS =
  '.cms-global-header-partner{margin:0 0 0 auto;display:flex;align-items:center;gap:.45rem;font-size:.8rem}' +
  '.cms-global-header-partner span{opacity:.8}.cms-global-header-partner a{color:inherit;font-weight:700;text-underline-offset:.2em}' +
  '.cms-global-header-partner a:focus-visible{outline:2px solid currentColor;outline-offset:3px}' +
  '.cms-global-header--centered .cms-global-header-partner{margin:0;flex-basis:100%;justify-content:center}' +
  '@media(max-width:767px){.cms-global-header-partner{display:none}}'

function globalElementsCss(header: HeaderConfigView | null, footer: FooterConfigView | null): string {
  if (header?.enabled !== true && footer?.enabled !== true) return ''
  return (
    (header?.enabled === true && header.partner ? HEADER_PARTNER_CSS : '') +
    ('.cms-global-header.cms-surface--page{background:var(--color-surface,#fff);color:var(--color-ink,#111)}' +
      '.cms-global-header.cms-surface--soft{background:var(--color-surfaceAlt,#f4f6f8);color:var(--color-ink,#111)}' +
      '.cms-global-header.cms-surface--primary{background:var(--color-primary,#003087);color:var(--color-primaryContrast,#fff)}' +
      '.cms-global-header.cms-surface--accent{background:var(--color-accent,#d22630);color:var(--color-accentContrast,#fff)}' +
      '.cms-global-header.cms-surface--transparent{background:transparent;color:var(--color-ink,#111)}' +
      '.cms-global-header--sticky{position:sticky;top:0}' +
      '.cms-global-header-inner{flex-wrap:wrap}.cms-global-brand{display:inline-flex;align-items:center;gap:.75rem;min-width:0}' +
      '.cms-global-brand picture{display:contents}.cms-site-logo{display:block;max-width:min(15rem,42vw);height:auto;max-height:4.5rem;object-fit:contain}' +
      '.cms-site-logo-compact{width:3rem;height:3rem}.cms-site-brand-name{min-width:0}' +
      '.cms-global-header-actions{display:flex;align-items:center;justify-content:flex-end;gap:.75rem}' +
      '.cms-global-utility ul{display:flex;align-items:center;gap:.8rem;list-style:none;margin:0;padding:0}' +
      '.cms-global-utility a{color:inherit;font-size:.8rem;font-weight:600;text-underline-offset:.2em}' +
      '.cms-global-utility a:focus-visible{outline:2px solid currentColor;outline-offset:3px}' +
      '.cms-global-header .cms-site-nav a:hover,.cms-global-header .cms-site-nav a:focus-visible{background:color-mix(in srgb,currentColor 12%,transparent)}' +
      '.cms-global-header .cms-site-nav a:focus-visible{box-shadow:0 0 0 2px currentColor}' +
      '.cms-global-header .cms-nav-submenu{color:var(--color-ink,#111)}' +
      '.cms-global-header-cta{font-size:.875rem;white-space:nowrap}' +
      '.cms-global-header--centered .cms-global-header-inner{justify-content:center;text-align:center}' +
      '.cms-global-header--centered .cms-global-brand{flex-basis:100%;justify-content:center}' +
      '.cms-global-header--centered .cms-site-nav{order:3}' +
      '.cms-global-header--compact .cms-site-header-inner{padding-block:.45rem}' +
      '.cms-global-header--compact .cms-site-logo{max-height:2.5rem}.cms-global-header--compact .cms-site-brand-name{font-size:.95rem}' +
      '.cms-global-header--minimal{border-top:0}.cms-global-header--minimal .cms-site-header-inner{max-width:none}' +
      '.cms-global-footer{padding:2.5rem 1.5rem}.cms-global-footer-inner{max-width:76rem;margin:0 auto}' +
      '.cms-global-footer-grid{display:grid;grid-template-columns:minmax(12rem,1.4fr) repeat(3,minmax(9rem,1fr));gap:2rem}' +
      '.cms-global-footer p{max-width:none}.cms-global-footer-name{font-family:var(--font-heading,inherit);font-size:1rem!important;font-weight:750;opacity:1!important}' +
      '.cms-global-footer-blurb{margin-top:.65rem!important;max-width:30rem!important;line-height:1.55;opacity:.8!important}' +
      '.cms-global-footer-foundation{margin-top:1rem!important;font-size:.7rem!important;font-weight:750;letter-spacing:.08em;text-transform:uppercase}' +
      '.cms-global-footer h2{margin:0 0 .7rem;font-size:.78rem;text-transform:uppercase;letter-spacing:.06em}' +
      '.cms-global-footer ul{list-style:none;margin:0;padding:0;display:grid;gap:.5rem}' +
      '.cms-global-footer a{color:inherit;text-underline-offset:.2em}.cms-global-footer a:focus-visible{outline:2px solid currentColor;outline-offset:3px}' +
      '.cms-global-footer-contact{display:grid;align-content:start;gap:.5rem}.cms-global-footer-contact address{white-space:pre-line;font-style:normal;line-height:1.5}' +
      '.cms-global-footer-social{margin-top:2rem}.cms-global-footer-social ul{display:flex;flex-wrap:wrap;gap:1rem}' +
      '.cms-global-footer-legal{display:flex;justify-content:space-between;align-items:flex-start;gap:1.5rem;margin-top:2rem;padding-top:1.25rem;' +
      'border-top:1px solid color-mix(in srgb,currentColor 14%,transparent)}' +
      '.cms-global-footer-legal nav ul{display:flex;flex-wrap:wrap;gap:1rem}' +
      '.cms-global-footer--simple .cms-global-footer-grid{grid-template-columns:minmax(12rem,1fr) repeat(3,minmax(8rem,auto))}' +
      '.cms-global-footer--contact .cms-global-footer-grid{grid-template-columns:minmax(12rem,1.4fr) repeat(2,minmax(10rem,1fr))}' +
      '@media(max-width:767px){.cms-global-header-inner{align-items:stretch}.cms-global-brand{align-self:flex-start}' +
      '.cms-global-header-actions{align-items:flex-start;flex-direction:column;order:2}.cms-global-utility ul{flex-wrap:wrap}' +
      '.cms-global-header .cms-site-nav{order:3}.cms-site-logo{max-width:min(12rem,70vw);max-height:3.25rem}' +
      '.cms-global-footer{padding:2rem 1rem}.cms-global-footer-grid{grid-template-columns:1fr;gap:1.5rem}' +
      '.cms-global-footer-legal{align-items:flex-start;flex-direction:column}.cms-global-footer-legal nav ul{flex-direction:column}}' +
      '@media(prefers-reduced-motion:reduce){.cms-global-header--sticky{scroll-behavior:auto}}')
  )
}

export type PageDocument = {
  html: string
  title: string
  noindex: boolean
  /**
   * How the canonical link in `html` was arrived at, including the reason an
   * authored value was refused.
   *
   * Returned rather than kept private because a refusal that only the renderer
   * knows about is a refusal nobody can act on: the author sees their canonical
   * quietly not take effect and has nothing to fix. SPEC §6.8 lists "invalid
   * canonical host" among the blocking readiness rules, and this is the value
   * that rule reads — the rendered HTML cannot supply it, because by then the
   * refused value is gone and the site's own address is in its place.
   */
  canonical: CanonicalDecision
}

/**
 * A complete HTML document with no client JavaScript required for its content,
 * navigation, metadata, or primary interaction (SPEC §6.8, D10).
 */
/** Social crawlers require an absolute image URL; staging uses the live canonical origin. */
function socialImageUrl(value: string | undefined, canonical: string): string {
  const address = value?.trim()
  if (!address || safeUrl(address) === '#') return ''
  try {
    const base = canonical ? new URL(canonical).origin : undefined
    const image = new URL(address, base)
    if (image.protocol !== 'https:' || image.username || image.password) return ''
    return image.href
  } catch {
    return ''
  }
}

export function renderPage(input: {
  manifest: RenderManifest
  shell: SiteShell
  isStaging: boolean
  navigationPaths?: Record<string, string>
  options?: RenderOptions
}): PageDocument {
  const { manifest, shell, isStaging } = input
  const options = input.options ?? {}

  const original = originalLayout(shell.site_files, manifest.page.id),
    parsedSettings = !original ? SitePublicSettings.safeParse(shell.settings) : null,
    siteSettings = parsedSettings?.success ? parsedSettings.data : undefined
  const title = manifest.meta.title?.trim() || manifest.page.title
  const description = manifest.meta.description?.trim() || siteSettings?.general?.description || ''
  // Canonical and og:url name *which document this is*, so they get their own
  // policy rather than the general URL one (canonical.ts). `safeUrl` answers a
  // question about schemes and passes any absolute https URL, which is not the
  // question a canonical link asks: `https://evil.test/x` is well-formed, and
  // publishing it asks every search engine to credit another host with this
  // page. The verified `canonical_host` wins over the origin actually serving
  // the response, which is what makes a staging page name its live address
  // instead of the staging one it is about to stop having.
  const canonicalDecision = resolveCanonical({
    authored: manifest.meta.canonical,
    verifiedHost: shell.canonical_host,
    servingBase: options.canonicalBase,
    path: manifest.page.path,
  })
  const canonical = canonicalDecision.url
  const sharingImage = socialImageUrl(manifest.meta.social_image, canonical)

  // A staging host never asks to be indexed, whatever the page says (SPEC §6.10).
  const noindex = isStaging || manifest.meta.noindex === true

  // Theme hooks are a page-shell concern. Keeping them out of a standalone
  // section render preserves the importer's byte-exact V1 comparison while
  // every real preview and public page still receives governed button styling.
  const reportRows =
    !original &&
    !options.sectionOnly &&
    manifest.sections.some(row => isReportIndexRow(row.def.slug, row.instance.values ?? {}))
  const reportIndex = !original && !options.sectionOnly && isReportIndexPage(manifest.sections)
  const reportPage = !original && !options.sectionOnly && isReportTemplatePage(manifest.sections)
  const pageOptions = {
    ...options,
    annualReportTemplate: reportPage,
    reportLinkSections: manifest.sections.map(section => section.instance),
    originalLayout: original?.layout,
    siteSettings: original ? undefined : shell.settings,
    nationalPanels:
      !original && !reportIndex && !options.sectionOnly && shell.theme?.presentation?.layout === 'national',
    siteThemeHooks: true,
    storyWidgets: {
      ...options.storyWidgets,
      pagePath: manifest.page.path,
      path: options.storyWidgets?.path ?? manifest.page.path,
    },
    siteWidgets: {
      ...options.siteWidgets,
      chapters: shell.chapter_directory ?? options.siteWidgets?.chapters,
      pagePath: manifest.page.path,
    },
  }
  const chapterPage = isReviewedChapterComposition(manifest.sections.map(section => section.instance))
  const chapterLinks = chapterPage ? chapterJumpValues(manifest.sections.map(section => section.instance)) : null
  const renderedSections = manifest.sections.map((section, index) =>
    renderSection(
      chapterLinks && section.def.slug === 'core-echelon-jump-links'
        ? { ...section, instance: { ...section.instance, values: chapterLinks } }
        : section,
      index,
      pageOptions,
    ),
  )
  const body = reportPage
    ? renderReportBands(manifest.sections, renderedSections)
    : reportIndex
      ? '<div class="cms-report-index-card">' + renderedSections.join('') + '</div>'
      : renderedSections.join('')
  const navigationPaths = input.navigationPaths ?? {}
  // The public renderer does not trust a JSON column's asserted shape. A valid
  // v1 config opts into the governed global element; absent, legacy, or corrupt
  // content keeps the exact baseline shell that existed before global elements
  // rather than hiding a site's navigation or footer because a draft was bad.
  const headerConfig = parsedHeaderConfig(shell.header)
  const footerConfig = parsedFooterConfig(shell.footer)
  const siteNavigation = renderNavigation(
    shell.navigation ?? [],
    pageId => navigationPaths[pageId] ?? null,
    0,
    manifest.page.path,
    options.preview === true,
  )
  const frameOptions = {
    ...pageOptions,
    preview: false,
    showHiddenSections: false,
    siteNavigation,
    [REVIEWED_ORIGINAL_NAVIGATION]: original
      ? renderOriginalNavigation(
          shell.navigation ?? [],
          id => navigationPaths[id] ?? null,
          manifest.page.path,
          options.preview === true,
        )
      : undefined,
  }
  const markFrame = options.preview === true
  const authoredHeader =
    headerConfig?.schemaVersion === 2
      ? renderFrameComponent('header', headerConfig, shell.header_component, frameOptions, markFrame)
      : null
  const footerWithLogo =
    footerConfig?.schemaVersion === 2 && shell.footer_component
      ? inheritFooterLogo(footerConfig, shell.footer_component.slots ?? [], headerConfig, shell.header_component?.slots)
      : footerConfig
  const authoredFooter =
    footerConfig?.schemaVersion === 2
      ? renderFrameComponent(
          'footer',
          footerWithLogo as FooterConfigV2,
          shell.footer_component,
          frameOptions,
          markFrame,
        )
      : null
  const presetHeader = headerConfig?.schemaVersion === 1 ? headerConfig : null
  const accounts = !original ? siteSocialAccounts(shell.settings) : undefined
  const presetFooter =
    footerConfig?.schemaVersion === 1
      ? accounts
        ? {
            ...footerConfig,
            social: accounts.filter(row => row.inFooter && row.url).map(({ service, url }) => ({ service, url })),
          }
        : footerConfig
      : null
  let renderedHeader =
    authoredHeader ??
    (presetHeader === null
      ? renderBaselineHeader(shell.site?.name ?? '', shell.navigation ?? [], navigationPaths, markFrame)
      : renderConfiguredHeader(
          presetHeader,
          shell.site?.name ?? '',
          shell.navigation ?? [],
          navigationPaths,
          markFrame,
        ))
  let renderedFooter =
    authoredFooter ??
    (presetFooter === null
      ? renderBaselineFooter(shell.site?.name ?? '')
      : renderConfiguredFooter(presetFooter, shell.site?.name ?? '', navigationPaths))
  if (accounts && (authoredFooter !== null || presetFooter === null) && footerConfig?.enabled !== false) {
    const links = accounts
      .filter(row => row.inFooter && row.url)
      .map(row => '<li><a href="' + escapeAttribute(row.url) + '">' + SITE_SOCIAL_LABELS[row.service] + '</a></li>')
      .join('')
    if (links)
      renderedFooter = renderedFooter.replace(
        /<\/footer>$/,
        () => '<nav class="cms-global-footer-social" aria-label="Social media"><ul>' + links + '</ul></nav></footer>',
      )
  }
  if (markFrame) {
    if (authoredHeader === null) renderedHeader = renderedHeader.replace('<header ', '<header data-cms-frame="header" ')
    if (authoredFooter === null) renderedFooter = renderedFooter.replace('<footer ', '<footer data-cms-frame="footer" ')
  }
  const newOriginalPage = Boolean(
    original && !original.layout.pages.some(page => page.pageId.toLowerCase() === manifest.page.id.toLowerCase()),
  )
  const templateHeader =
    newOriginalPage && authoredHeader !== null && original?.page.header !== false && !options.sectionOnly
      ? originalTemplateHeader(renderedHeader)
      : null
  if (templateHeader) renderedHeader = templateHeader.html
  const frameCss = frameComponentCss([
    authoredHeader === null ? null : (shell.header_component ?? null),
    authoredFooter === null ? null : (shell.footer_component ?? null),
  ])

  const siteFiles = options.sectionOnly
    ? { head: '', bodyStart: '', bodyEnd: '' }
    : renderSiteFiles(
        shell.site_files,
        manifest.page.id,
        options.siteFiles ?? (!options.preview && options.providerEmbeds !== false),
      )
  const wrapperIndices = manifest.sections.flatMap((section, index) => {
    const { def, instance } = section
    return originalDefinition(original?.layout, def.section_def_id, def.version) &&
      !def.css?.trim() &&
      !instance.raw_html?.trim() &&
      !instance.custom_css?.trim() &&
      !instance.appearance
      ? []
      : [index]
  })
  const features = renderedFeatures(body)
  const pageTheme = options.sectionOnly ? { ...shell.theme, presentation: undefined } : (shell.theme ?? {})
  const ownedTheme = original
    ? themeCss(pageTheme, features.materialIcons, true) +
      themeCssWithinSections(themeCss(pageTheme, features.materialIcons), wrapperIndices)
    : themeCss(pageTheme, features.materialIcons)
  const ownedAppearance = original
    ? themeCssWithinSections(buttonAppearanceCss(shell.theme?.colors), wrapperIndices)
    : buttonAppearanceCss(shell.theme?.colors)
  const externalRuntimes =
    options.externalRuntimes === true || ('scriptHashes' in siteFiles && siteFiles.scriptHashes.length > 0)
  const enhance = !options.preview || externalRuntimes
  const echelonPage = !original && !options.sectionOnly && isEchelonTemplatePage(manifest.sections)
  const head =
    [
      '<meta charset="utf-8">',
      !original
        ? adobeKitLink(shell.theme, options.servingHost ?? (isStaging ? shell.staging_host : shell.canonical_host))
        : '',
      '<meta name="viewport" content="width=device-width,initial-scale=1">',
      `<title>${escapeText(title)}</title>`,
      description ? `<meta name="description" content="${escapeAttribute(description)}">` : '',
      ...(siteSettings?.search?.verification ?? []).map(
        tag => `<meta name="${escapeAttribute(tag.name)}" content="${escapeAttribute(tag.content)}">`,
      ),
      siteSettings?.search?.hints
        ? `<meta name="keywords" content="${escapeAttribute(siteSettings.search.hints)}">`
        : '',
      canonical ? `<link rel="canonical" href="${escapeAttribute(canonical)}">` : '',
      noindex ? '<meta name="robots" content="noindex,nofollow">' : '<meta name="robots" content="index,follow">',
      `<meta property="og:title" content="${escapeAttribute(title)}">`,
      description ? `<meta property="og:description" content="${escapeAttribute(description)}">` : '',
      canonical ? `<meta property="og:url" content="${escapeAttribute(canonical)}">` : '',
      '<meta property="og:type" content="website">',
      sharingImage ? `<meta property="og:image" content="${escapeAttribute(sharingImage)}">` : '',
      `<style>${renderSiteFontCss(manifest.fonts)}${ownedTheme}${globalElementsCss(presetHeader, presetFooter)}${frameCss}${templateHeader?.css ?? ''}${collectCss(manifest.sections)}${!original ? CORE_SECTION_LAYOUT_CSS : ''}` +
        `${accounts?.some(row => row.inFooter && row.url) && (authoredFooter !== null || presetFooter === null) ? '.cms-frame--footer .cms-global-footer-social ul{display:flex;flex-wrap:wrap;justify-content:center;gap:1rem;list-style:none;padding:0}.cms-frame--footer .cms-global-footer-social a{display:inline-flex;min-height:2.75rem;align-items:center;color:inherit;text-underline-offset:.2em}.cms-frame--footer .cms-global-footer-social a:focus-visible{outline:2px solid currentColor;outline-offset:2px}' : ''}${ownedAppearance}${!original && features.dataSource ? '.cms-data-source{display:block;font-size:.75rem;font-family:var(--font-body);font-weight:400;line-height:1.5;margin-top:.5rem}' : ''}${!original && features.echelonStyles ? ECHELON_PRESENTATION_CSS : ''}${!original && features.echelonTemplate ? ECHELON_BODY_CSS + ECHELON_STORY_CARDS_CSS + ECHELON_SECTION_LINK_CSS : ''}${features.chapterDirectory ? ECHELON_DIRECTORY_CSS : ''}${echelonPage ? ECHELON_PAGE_CSS : ''}${reportPage ? REPORT_PAGE_CSS : ''}${!original && features.reportText ? REPORT_TEXT_CSS : ''}${reportRows ? REPORT_INDEX_CSS : ''}${features.heroSlides ? HERO_SLIDES_CSS : ''}${features.siteWidget ? SITE_WIDGET_CSS : ''}${options.preview ? PREVIEW_STYLES : ''}</style>`,
    ]
      .filter(Boolean)
      .join('') + siteFiles.head

  // V1's event-readiness rule, applied to the whole page (header, sections and
  // footer) the same way for previews and the public site (registration.ts).
  const framedBody = original
    ? body
    : '<main id="cms-main"' +
      (reportPage
        ? ' class="cms-report-page sawso-report ar-direction-4"'
        : reportIndex
          ? ' class="cms-report-index-page"'
          : echelonPage
            ? ' class="cms-echelon-page"'
            : '') +
      '>' +
      body +
      '</main>'
  const framedPage = applyRegistrationAvailability(
    (options.siteFrame === false || options.sectionOnly || original?.page.header === false ? '' : renderedHeader) +
      framedBody +
      (options.siteFrame === false || options.sectionOnly || original?.page.footer === false ? '' : renderedFooter),
  )
  const page = withoutUnavailablePictures(
    !original && (shell.site.chaptersEnabled === true || echelonPage) ? withoutSamplePictures(framedPage) : framedPage,
    shell.site_files,
    manifest.page.path,
  )
  const html =
    (original?.page.quirks === true ? '' : '<!doctype html>') +
    '<html' +
    documentAttributes(original ? original.page.html : { lang: siteSettings?.general?.language ?? 'en' }) +
    '><head>' +
    head +
    '</head><body' +
    documentAttributes(original?.page.body ?? {}) +
    '>' +
    siteFiles.bodyStart +
    (options.siteFrame === false || options.sectionOnly || original
      ? ''
      : `<a class="cms-skip" href="#cms-main">Skip to content</a>`) +
    page +
    // Ordinary public pages carry no scripts. Governed provider components
    // opt into one fixed fullscreen handler and a marked FAQ search into one
    // fixed filter; preview keeps its separate hash, and scriptless evidence
    // renders carry neither.
    (options.preview && options.previewRuntime !== false ? `<script>${PREVIEW_RUNTIME}</script>` : '') +
    (enhance && options.providerEmbeds !== false && renderedFeatures(page).nationalNavigation
      ? fixedRuntimeTag('navigation', true)
      : '') +
    (enhance && !options.preview && options.providerEmbeds !== false && features.chapterDirectory
      ? fixedRuntimeTag('chapters', externalRuntimes)
      : '') +
    (enhance && !options.preview && options.providerEmbeds !== false && features.storyWidgets
      ? fixedRuntimeTag('stories', externalRuntimes)
      : '') +
    (enhance && options.providerEmbeds !== false && features.heroSlides
      ? fixedRuntimeTag('hero', externalRuntimes)
      : '') +
    (enhance && features.providerFullscreen ? fixedRuntimeTag('embed', externalRuntimes) : '') +
    (enhance && options.providerEmbeds !== false && features.faqFilter
      ? fixedRuntimeTag('faq', externalRuntimes)
      : '') +
    (enhance && options.providerEmbeds !== false && features.scheduleFilter
      ? fixedRuntimeTag('schedule', externalRuntimes)
      : '') +
    siteFiles.bodyEnd +
    `</body></html>`

  return { html, title, noindex, canonical: canonicalDecision }
}
