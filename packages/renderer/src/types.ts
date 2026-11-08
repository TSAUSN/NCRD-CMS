import { type StoryWidgetContext } from './story-world.ts'
import { type NewsroomQuery } from './newsroom.ts'
import { type SiteWidgetContext } from './site-widgets.ts'
import { type SlotDef, type SectionAppearance, type SiteOriginalLayout } from '@cms/schema'
import { type CompiledSection } from './compile.ts'
import { type ManifestFont } from './site-fonts.ts'

export const REVIEWED_ORIGINAL_NAVIGATION = Symbol('reviewed original navigation')

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
