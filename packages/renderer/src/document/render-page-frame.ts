import { siteSocialAccounts, SITE_SOCIAL_LABELS, type FooterConfigV2 } from '@cms/schema'
import { escapeAttribute } from '../escape.ts'
import { inheritFooterLogo } from '../frame-logo.ts'
import { renderOriginalNavigation } from '../original-navigation.ts'
import { type originalLayout, originalTemplateHeader } from '../original-layout.ts'
import { REVIEWED_ORIGINAL_NAVIGATION, type RenderManifest, type SiteShell, type RenderOptions } from '../types.ts'
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
} from '../frame/site-frame.ts'

export function renderPageFrame({
  page,
  shell,
  pageOptions,
  original,
  navigationPaths,
}: {
  page: RenderManifest['page']
  shell: SiteShell
  pageOptions: RenderOptions
  original: ReturnType<typeof originalLayout>
  navigationPaths: Record<string, string>
}) {
  // A missing or invalid configuration still renders the baseline header and footer.
  const headerConfig = parsedHeaderConfig(shell.header)
  const footerConfig = parsedFooterConfig(shell.footer)
  const siteNavigation = renderNavigation(
    shell.navigation ?? [],
    pageId => navigationPaths[pageId] ?? null,
    0,
    page.path,
    pageOptions.preview === true,
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
          page.path,
          pageOptions.preview === true,
        )
      : undefined,
  }
  const markFrame = pageOptions.preview === true
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
    original && !original.layout.pages.some(candidate => candidate.pageId.toLowerCase() === page.id.toLowerCase()),
  )
  const templateHeader =
    newOriginalPage && authoredHeader !== null && original?.page.header !== false && !pageOptions.sectionOnly
      ? originalTemplateHeader(renderedHeader)
      : null
  if (templateHeader) renderedHeader = templateHeader.html
  const frameCss = frameComponentCss([
    authoredHeader === null ? null : (shell.header_component ?? null),
    authoredFooter === null ? null : (shell.footer_component ?? null),
  ])

  const footerSocialCss =
    accounts?.some(row => row.inFooter && row.url) && (authoredFooter !== null || presetFooter === null)
      ? '.cms-frame--footer .cms-global-footer-social ul{display:flex;flex-wrap:wrap;justify-content:center;gap:1rem;list-style:none;padding:0}.cms-frame--footer .cms-global-footer-social a{display:inline-flex;min-height:2.75rem;align-items:center;color:inherit;text-underline-offset:.2em}.cms-frame--footer .cms-global-footer-social a:focus-visible{outline:2px solid currentColor;outline-offset:2px}'
      : ''
  return { renderedHeader, renderedFooter, frameCss, templateHeader, presetHeader, presetFooter, footerSocialCss }
}
