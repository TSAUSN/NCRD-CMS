import { panelPresentationCss } from '../panel-presentation.ts'
import { localBrandFontCss } from '../local-brand-fonts.ts'
import { PROVIDER_FRAME_CSS } from '../provider-embed.ts'
import { type SiteShell } from '../types.ts'

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
