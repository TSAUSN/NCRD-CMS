/** The national template owns the surface, including sections added later.
 * Composed library sections already separate a grey title from white content.
 * Every other section receives a white surface without rewriting its content. */
const COMPOSED = new Set([
  'core-report-page-links',
  'core-report-letters',
  'core-report-financial',
  'core-report-country-story',
  'core-report-regions',
  'core-echelon-directory',
  'core-echelon-events',
  'core-echelon-follow',
  'core-echelon-leadership',
  'core-echelon-board',
  'core-echelon-chapter-contacts',
  'core-echelon-faq',
  'core-echelon-contact',
  'core-echelon-about',
  'core-echelon-who',
  'core-echelon-pillars',
  'core-echelon-hero',
  'core-echelon-jump-links',
  'core-photo-banner',
  'core-feature-slider',
  'core-feature-tiles',
  'core-photo-grid',
  'core-numbered-steps',
  'core-link-band',
  'core-contact-cards',
  'core-reading',
  'core-story-world',
  'core-story-split',
  'core-stories',
  'core-newsroom',
  'core-text-block',
  'core-faq',
])
export function nationalSectionPanel(
  body: string,
  slug: string | undefined,
  values: Record<string, unknown> = {},
): string {
  if (slug === 'core-page-header') {
    // A page title can sit on grey; an introduction still needs a white surface.
    if (!String(values.intro ?? '').trim()) return body
    return body.replace(
      /(<p\b[^>]*class="[^"]*\bcore-intro\b[^"]*"[^>]*>[\s\S]*?<\/p>)/,
      '<div class="national-content-panel">$1</div>',
    )
  }
  return COMPOSED.has(slug ?? '') ? body : `<div class="national-content-panel">${body}</div>`
}
export const NATIONAL_PANEL_CSS = `
#cms-main .national-content-panel{background:white;border-radius:20px;padding:32px;min-width:0;overflow-wrap:break-word}
#cms-main .national-content-panel .core{padding:0;background:transparent}
#cms-main .national-content-panel .container{max-width:none;margin:0;padding:0}
@media(max-width:575px){#cms-main .national-content-panel{padding:20px;border-radius:12px}}
`

/** Generic library layouts also apply to existing native panel-theme snapshots. */
export const CORE_SECTION_LAYOUT_CSS = `
#cms-main .cms-section--core-text-image .row:has(>.col-md-6:first-child):not(:has(>.col-md-6:first-child img))>.col-md-6:first-child{display:none}
#cms-main .cms-section--core-text-image .row:has(>.col-md-6:first-child):not(:has(>.col-md-6:first-child img))>.col-md-6:last-child{width:100%}
#cms-main .cms-section--core-split-hero .row:has(>.col-md-6:last-child):not(:has(>.col-md-6:last-child img))>.col-md-6:last-child{display:none}
#cms-main .cms-section--core-split-hero .row:has(>.col-md-6:last-child):not(:has(>.col-md-6:last-child img))>.col-md-6:first-child{width:100%}
#cms-main .core-logos .core-grid{align-items:stretch;grid-auto-rows:1fr}
#cms-main .core-logos .core-card{height:100%}
@media(min-width:768px){#cms-main :is(.cms-section--core-icon-cards,.cms-section--core-image-link-cards,.cms-section--core-stats,.cms-section--core-team-grid,.cms-section--core-speakers-grid,.cms-section--core-registration-cta) .core-grid:has(>:nth-child(3):last-child){grid-template-columns:repeat(3,minmax(0,1fr))}}
`
