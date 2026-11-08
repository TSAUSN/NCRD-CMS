import type { ManifestSection } from './render.ts'
export const isReportIndexRow = (slug: string | undefined, values: Record<string, unknown>) =>
  slug === 'core-text-image' && values.__cms_report_links === true
export function reportIndexValues(slug: string | undefined, values: Record<string, unknown>): Record<string, unknown> {
  if (!isReportIndexRow(slug, values)) return values
  const link = (field: string, label: string) => {
    const value = values[field]
    const current =
      value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
    const url = typeof current.url === 'string' ? current.url.trim() : ''
    return { ...current, url: /^(?:https?:\/\/|\/(?!\/))/i.test(url) ? url : '', label }
  }
  return { ...values, report_page: link('report_page', 'View page'), report_pdf: link('report_pdf', 'View PDF') }
}
export const isReportIndexPage = (sections: readonly ManifestSection[]) =>
  sections.length > 1 &&
  sections[0]?.def.slug === 'core-page-header' &&
  sections.slice(1).every(row => isReportIndexRow(row.def.slug, row.instance.values ?? {}))
export const REPORT_INDEX_CSS = `
#cms-main.cms-report-index-page{max-width:1120px;margin:0 auto;padding:24px}
#cms-main.cms-report-index-page .cms-report-index-card{max-width:900px;margin:auto;background:white;border-radius:16px;padding:28px}
#cms-main.cms-report-index-page .cms-section{padding:0;margin:0;background:transparent;box-shadow:none;border:0;border-radius:0}
#cms-main.cms-report-index-page .core{padding:0;background:transparent}
#cms-main.cms-report-index-page .container{padding:0;margin:0;max-width:none}
#cms-main.cms-report-index-page .cms-section--core-page-header h1{text-align:center;font-size:26px;line-height:1.3;margin:0 0 14px}
#cms-main.cms-report-index-page .core-intro:empty{display:none}
#cms-main .cms-report-index-row .row{display:contents;margin:0}
#cms-main .cms-report-index-row .row>div{display:contents}
#cms-main .cms-report-index-row img,#cms-main .cms-report-index-row .core-text-image-body{display:none}
#cms-main .cms-report-index-row .core>.container{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:12px 0;border-bottom:1px solid #e6e8ec}
#cms-main .cms-report-index-row h2{font:600 14px/1.5 var(--font-body)!important;margin:0}
#cms-main .cms-report-index-row .core-report-actions{display:flex;align-items:center;flex-wrap:wrap;gap:8px;margin:0;flex:none}
#cms-main .cms-report-index-row .core-report-actions a{display:inline-flex;align-items:center;justify-content:center;height:28px;min-height:28px;padding:0 9px;border:1px solid #dde1e7;border-radius:7px;background:white;color:#0f1729;font:500 12px/1 var(--font-body);text-decoration:none}
#cms-main .cms-report-index-row .core-report-page a{background:#ef3e42;border:0;color:white}
#cms-main .cms-report-index-row [hidden]{display:none!important}
#cms-main .cms-report-index-row a:focus-visible{outline:3px solid #0d234f;outline-offset:3px}
@media(max-width:575px){#cms-main.cms-report-index-page{padding:20px}#cms-main.cms-report-index-page .cms-report-index-card{padding:20px;border-radius:12px}#cms-main .cms-report-index-row .core>.container{align-items:flex-start;flex-direction:column;gap:10px}#cms-main .cms-report-index-row .core-report-actions{max-width:100%}}
`
