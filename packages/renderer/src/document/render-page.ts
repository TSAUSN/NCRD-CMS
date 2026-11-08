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
import { SitePublicSettings } from '@cms/schema'
import { HERO_SLIDES_CSS } from '../hero-slides.ts'
import { adobeKitLink } from '../adobe-fonts.ts'
import { CORE_SECTION_LAYOUT_CSS } from '../national-panels.ts'
import { SITE_WIDGET_CSS } from '../site-widgets.ts'
import { renderSiteFiles } from '../site-files.ts'
import { originalLayout, originalDefinition, documentAttributes, themeCssWithinSections } from '../original-layout.ts'
import { siteWidget } from '@cms/schema'
import { resolveCanonical, type CanonicalDecision } from '../canonical.ts'
import { escapeAttribute, escapeText, safeUrl } from '../escape.ts'
import { renderSiteFontCss } from '../site-fonts.ts'
import { fixedRuntimeTag } from '../fixed-runtime-files.ts'
import { PREVIEW_RUNTIME, PREVIEW_STYLES } from '../preview-runtime.ts'
import { buttonAppearanceCss } from '../button-appearance.ts'
import { applyRegistrationAvailability } from '../registration.ts'
import { type RenderManifest, type SiteShell, type RenderOptions } from '../types.ts'
import { renderSection } from '../section/render-section.ts'
import { collectCss } from '../section/stylesheet.ts'
import { themeCss } from '../theme/theme-css.ts'
import { globalElementsCss } from '../frame/site-frame.ts'
import { renderPageFrame } from './render-page-frame.ts'

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

/** Render the complete public or preview document from the same page and site data. */
export function renderPage(input: {
  manifest: RenderManifest
  shell: SiteShell
  isStaging: boolean
  navigationPaths?: Record<string, string>
  options?: RenderOptions
}): PageDocument {
  const { manifest, shell, isStaging } = input
  const options = input.options ?? {}

  const original = originalLayout(shell.site_files, manifest.page.id)
  const parsedSettings = !original ? SitePublicSettings.safeParse(shell.settings) : null
  const siteSettings = parsedSettings?.success ? parsedSettings.data : undefined
  const title = manifest.meta.title?.trim() || manifest.page.title
  const description = manifest.meta.description?.trim() || siteSettings?.general?.description || ''
  // A verified live host remains canonical even on staging.
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
  const sectionInstances = pageOptions.reportLinkSections
  const chapterPage = isReviewedChapterComposition(sectionInstances)
  const chapterLinks = chapterPage ? chapterJumpValues(sectionInstances) : null
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
  const { renderedHeader, renderedFooter, frameCss, templateHeader, presetHeader, presetFooter, footerSocialCss } =
    renderPageFrame({ page: manifest.page, shell, pageOptions, original, navigationPaths: input.navigationPaths ?? {} })

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
        `${footerSocialCss}${ownedAppearance}${!original && features.dataSource ? '.cms-data-source{display:block;font-size:.75rem;font-family:var(--font-body);font-weight:400;line-height:1.5;margin-top:.5rem}' : ''}${!original && features.echelonStyles ? ECHELON_PRESENTATION_CSS : ''}${!original && features.echelonTemplate ? ECHELON_BODY_CSS + ECHELON_STORY_CARDS_CSS + ECHELON_SECTION_LINK_CSS : ''}${features.chapterDirectory ? ECHELON_DIRECTORY_CSS : ''}${echelonPage ? ECHELON_PAGE_CSS : ''}${reportPage ? REPORT_PAGE_CSS : ''}${!original && features.reportText ? REPORT_TEXT_CSS : ''}${reportRows ? REPORT_INDEX_CSS : ''}${features.heroSlides ? HERO_SLIDES_CSS : ''}${features.siteWidget ? SITE_WIDGET_CSS : ''}${options.preview ? PREVIEW_STYLES : ''}</style>`,
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
