import { NATIONAL_PANEL_CSS } from './national-panels.ts'
import { NATIONAL_PRESENTATION_CSS } from './national-presentation.ts'
/** Bounded native-site presentation. No authored CSS or imported design enters here. */
export function panelPresentationCss(value: unknown): string {
  if (!value || typeof value !== 'object') return ''
  const panel = value as { kind?: unknown; canvas?: unknown; headings?: unknown; layout?: unknown }
  if (panel.kind !== 'panels' || typeof panel.canvas !== 'string' || !/^#[a-f0-9]{6}$/i.test(panel.canvas)) return ''
  if (panel.layout === 'national')
    return (
      NATIONAL_PRESENTATION_CSS +
      NATIONAL_PANEL_CSS +
      (panel.headings === 'small-caps'
        ? ''
        : '#cms-main h1,#cms-main h2,#cms-main .core-reading h3{font-variant:normal}')
    )
  return (
    (panel.headings === 'small-caps'
      ? '#cms-main h1,#cms-main h2{font-variant:small-caps}#cms-main h3{font-family:var(--font-body);font-variant:normal}'
      : '') +
    `:root{--site-canvas:${panel.canvas};--site-panel-shadow:0 .125rem .5rem color-mix(in srgb,var(--color-ink) 10%,transparent);--site-panel-width:64rem;--site-panel-gap:1rem}` +
    'body{background:var(--site-canvas);padding:1.25rem;box-sizing:border-box}' +
    '#cms-main{display:grid;gap:var(--site-panel-gap);max-width:var(--site-panel-width);margin:var(--site-panel-gap) auto}' +
    '#cms-main>.cms-section{min-width:0;border-radius:var(--radius);box-shadow:var(--site-panel-shadow)}' +
    '#cms-main>.cms-section>section,#cms-main>.cms-section>article{border-radius:var(--radius)}' +
    '.cms-site-header,.cms-global-header,.cms-site-footer,.cms-global-footer{max-width:var(--site-panel-width);margin-inline:auto;border-radius:var(--button-radius);box-shadow:var(--site-panel-shadow);box-sizing:border-box}' +
    '#cms-main .core-card{border-color:color-mix(in srgb,var(--color-ink) 14%,transparent);border-top:.25rem solid var(--color-accent);box-shadow:var(--site-panel-shadow)}' +
    '#cms-main .core .cms-material-symbols{background:var(--color-primary);color:var(--color-primaryContrast);border-radius:50%;padding:.6rem}' +
    '.cms-button{padding:.75rem 1.25rem;font-size:.875rem;line-height:1.5}' +
    '@media(max-width:767px){body{padding:.75rem}#cms-main{--site-panel-gap:.75rem}#cms-main .core{padding:1.5rem 1rem}}'
  )
}
