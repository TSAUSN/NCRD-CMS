import { withoutUnavailablePictures } from '../unavailable-pictures.ts'
import { renderedFeatures } from '../feature-markers.ts'
import { isReportIndexPage, isReportIndexRow, REPORT_INDEX_CSS } from '../report-index.ts'
import { isReportTemplatePage, renderReportBands } from '../report-template.ts'
import { REPORT_PAGE_CSS, REPORT_TEXT_CSS } from '../report-page-presentation.ts'
import { withoutSamplePictures } from '../sample-pictures.ts'
import { chapterJumpValues, isReviewedChapterComposition } from '@cms/schema'
import { isEchelonTemplatePage, ECHELON_PAGE_CSS } from '../echelon-page.ts'
import { ECHELON_DIRECTORY_CSS } from '../echelon-directory-presentation.ts'
import { ECHELON_BODY_CSS, ECHELON_STORY_CARDS_CSS, ECHELON_SECTION_LINK_CSS } from '../echelon-body-presentation.ts'
import { ECHELON_PRESENTATION_CSS } from '../echelon-presentation.ts'
import { siteSocialAccounts, SITE_SOCIAL_LABELS, SitePublicSettings } from '@cms/schema'
import { inheritFooterLogo } from '../frame-logo.ts'
import { HERO_SLIDES_CSS } from '../hero-slides.ts'
import { adobeKitLink } from '../adobe-fonts.ts'
import { CORE_SECTION_LAYOUT_CSS } from '../national-panels.ts'
import { SITE_WIDGET_CSS } from '../site-widgets.ts'
import { renderSiteFiles } from '../site-files.ts'
import { renderOriginalNavigation } from '../original-navigation.ts'
import {
  originalLayout,
  originalDefinition,
  originalTemplateHeader,
  documentAttributes,
  themeCssWithinSections,
} from '../original-layout.ts'
import { siteWidget, type FooterConfigV2 } from '@cms/schema'
import { resolveCanonical, type CanonicalDecision } from '../canonical.ts'
import { escapeAttribute, escapeText, safeUrl } from '../escape.ts'
import { renderSiteFontCss } from '../site-fonts.ts'
import { fixedRuntimeTag } from '../fixed-runtime-files.ts'
import { PREVIEW_RUNTIME, PREVIEW_STYLES } from '../preview-runtime.ts'
import { buttonAppearanceCss } from '../button-appearance.ts'
import { applyRegistrationAvailability } from '../registration.ts'
import { REVIEWED_ORIGINAL_NAVIGATION, type RenderManifest, type SiteShell, type RenderOptions } from '../types.ts'
import { renderSection } from '../section/render-section.ts'
import { collectCss } from '../section/stylesheet.ts'
import { themeCss } from '../theme/theme-css.ts'
import {
  renderNavigation,
  parsedHeaderConfig,
  parsedFooterConfig,
  renderFrameComponent,
  frameComponentCss,
  renderConfiguredHeader,
  renderBaselineHeader,
  renderConfiguredFooter,
  renderBaselineFooter,
  globalElementsCss,
} from '../frame/site-frame.ts'

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
 * navigation, metadata, or primary interaction.
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

  // A staging host never asks to be indexed, whatever the page says.
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
