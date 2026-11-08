import { originalDefinition, originalRoot } from '../original-layout.ts'
import {
  FooterConfig,
  HeaderConfig,
  type FooterConfigV1 as FooterConfigView,
  type FooterConfigV2,
  type GlobalElementLink as GlobalLinkView,
  type HeaderConfigV1 as HeaderConfigView,
  type HeaderConfigV2,
} from '@cms/schema'
import { sectionScopeSelector } from '../compile.ts'
import { escapeAttribute, escapeText, safeUrl } from '../escape.ts'
import { REVIEWED_ORIGINAL_NAVIGATION, type SectionDefView, type NavigationNode, type RenderOptions } from '../types.ts'
import { compiledCssProblems } from '../section/stylesheet.ts'
import { renderSectionBody } from '../section/body.ts'

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
      // rendered as a dead link.
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

export function parsedHeaderConfig(value: unknown): HeaderConfig | null {
  const parsed = HeaderConfig.safeParse(value)
  return parsed.success ? parsed.data : null
}

export function parsedFooterConfig(value: unknown): FooterConfig | null {
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
export function renderFrameComponent(
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

export function frameComponentCss(defs: readonly (SectionDefView | null)[]): string {
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

export function renderConfiguredHeader(
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

export function renderBaselineHeader(
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

export function renderConfiguredFooter(
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

export function renderBaselineFooter(siteName: string): string {
  return `<footer class="cms-site-footer"><p>${escapeText(siteName)}</p></footer>`
}

const HEADER_PARTNER_CSS =
  '.cms-global-header-partner{margin:0 0 0 auto;display:flex;align-items:center;gap:.45rem;font-size:.8rem}' +
  '.cms-global-header-partner span{opacity:.8}.cms-global-header-partner a{color:inherit;font-weight:700;text-underline-offset:.2em}' +
  '.cms-global-header-partner a:focus-visible{outline:2px solid currentColor;outline-offset:3px}' +
  '.cms-global-header--centered .cms-global-header-partner{margin:0;flex-basis:100%;justify-content:center}' +
  '@media(max-width:767px){.cms-global-header-partner{display:none}}'

export function globalElementsCss(header: HeaderConfigView | null, footer: FooterConfigView | null): string {
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
