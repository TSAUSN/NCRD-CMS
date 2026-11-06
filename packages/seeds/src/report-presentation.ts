/** Shared report bands and disclosure styles, adapted from the approved local report.css.
 * Preview host overrides, external font imports and source comments are excluded. */
export const REPORT_SECTION_CSS = [
  ' .sawso-report{--ar-red:#ed1c2b;--ar-red-text:#ed1c2b;--ar-navy:#34465f;--ar-ink:#111;--ar-grey:#eff1f0;--ar-blue:#dfedf0;--ar-footer:#2a313f;--ar-line:#d3d9dc;color:var(--ar-ink);background:#fff;font-family:var(--font-body,Arial,sans-serif);font-size:17px;line-height:1.6;font-weight:300;text-align:left;overflow-wrap:break-word;width:100%;isolation:isolate}',
  ' .sawso-report *,.sawso-report *::before,.sawso-report *::after{box-sizing:border-box}',
  ' .sawso-report .ar-container{width:100%;max-width:1170px;padding:0;margin:0 auto}',
  ' .sawso-report .ar-band{padding:80px max(24px,calc((100% - 1170px)/2))}',
  ' .sawso-report .ar-grey{background:var(--ar-grey)}',
  ' .sawso-report .ar-blue{background:var(--ar-blue)}',
  ' .sawso-report .ar-dark{background:var(--ar-navy);color:#fff}',
  ' .sawso-report .ar-dark .ar-eyebrow{color:#fff}',
  ' .sawso-report .ar-section-title{margin-bottom:40px}',
  ' .sawso-report .ar-small{font-size:13px;line-height:1.6;color:#52606b}',
  ' .sawso-report .ar-dark .ar-small{color:#e0e6ee}',
  ' .sawso-report .ar-lead{font-size:20px;line-height:1.6;font-weight:300}',
  ' .sawso-report .ar-dark .ar-metric{border-color:#fff}',
  ' .sawso-report .ar-dark .ar-regions h3{color:#fff}',
  ' .sawso-report .ar-financial-grid{display:grid;grid-template-columns:minmax(0,600fr) minmax(0,506fr);gap:64px;margin:40px 0 32px}',
  ' .sawso-report .ar-financial-grid h3{margin-bottom:24px}',
  ' .sawso-report .ar-expense{margin-bottom:22px}',
  ' .sawso-report .ar-expense-label{display:flex;justify-content:space-between;gap:24px;font-size:13px;line-height:1.5;margin-bottom:8px}',
  ' .sawso-report .ar-expense-label strong{font-weight:600;white-space:nowrap}',
  ' .sawso-report .ar-track{height:9px;background:#fff}',
  ' .sawso-report .ar-fill{display:block;height:9px;background:var(--ar-navy)}',
  ' .sawso-report .ar-dark .ar-track{background:var(--ar-footer)}',
  ' .sawso-report .ar-dark .ar-fill{background:var(--ar-blue)}',
  ' .sawso-report .ar-expense:first-child .ar-fill{background:var(--ar-red)}',
  ' .sawso-report .ar-statement{width:100%;border-collapse:collapse;font-size:13px;line-height:1.6;margin-bottom:36px}',
  ' .sawso-report .ar-statement caption{text-align:left;color:inherit;font-family:var(--font-heading,Georgia,serif);font-size:24px;line-height:1.3;margin:0 0 20px;padding:0}',
  ' .sawso-report .ar-statement th,.sawso-report .ar-statement td{padding:12px 0;border-bottom:1px solid var(--ar-line);vertical-align:top;color:inherit;background:none}',
  ' .sawso-report .ar-statement th{text-align:left;font-weight:300;padding-right:24px}',
  ' .sawso-report .ar-statement td{text-align:right;font-weight:600;white-space:nowrap}',
  ' .sawso-report .ar-statement .ar-total th,.sawso-report .ar-statement .ar-total td{font-weight:700}',
  ' .sawso-report .ar-dark .ar-statement th,.sawso-report .ar-dark .ar-statement td{border-color:#748299}',
  ' .sawso-report .ar-letters{display:grid;grid-template-columns:1fr 1fr;gap:32px;margin-top:40px}',
  ' .sawso-report .ar-letter{background:var(--ar-grey);padding:24px}',
  ' .sawso-report .ar-letter h3{margin-bottom:12px}',
  ' .sawso-report .ar-letter .ar-eyebrow{margin-bottom:20px}',
  ' @media(max-width:1000px){.sawso-report .ar-financial-grid{gap:36px}',
  '}',
  ' @media(max-width:760px){.sawso-report .ar-band{padding:48px 24px}',
  '.sawso-report .ar-financial-grid,.sawso-report .ar-letters{grid-template-columns:1fr;gap:32px}',
  '.sawso-report .ar-section-title{margin-bottom:32px}',
  '.sawso-report .ar-statement caption{font-size:22px}',
  '.sawso-report .ar-statement th{padding-right:15px}',
  '.sawso-report .ar-expense-label{gap:16px}',
  '}',
  ' .sawso-report{container-type:inline-size;container-name:ar-report}',
  ' @container ar-report (max-width:1000px){.sawso-report .ar-financial-grid{gap:36px}',
  '}',
  ' @container ar-report (max-width:760px){.sawso-report .ar-band{padding:48px 24px}',
  '.sawso-report .ar-financial-grid,.sawso-report .ar-letters{grid-template-columns:1fr;gap:32px}',
  '.sawso-report .ar-section-title{margin-bottom:32px}',
  '.sawso-report .ar-statement caption{font-size:22px}',
  '.sawso-report .ar-statement th{padding-right:15px}',
  '.sawso-report .ar-expense-label{gap:16px}',
  '}',
  ' .sawso-report .ar-section-title{margin-bottom:32px}',
  ' .sawso-report .ar-source{margin-top:28px}',
  ' .sawso-report .ar-letters{align-items:start;margin:0}',
  ' .sawso-report .ar-letter{padding:32px}',
  ' .sawso-report .ar-leader-photo{width:190px;height:190px;object-fit:contain;object-position:bottom;background:#fff;margin-bottom:28px}',
  ' .sawso-report .ar-letter h3{font-size:25px}',
  ' .sawso-report .ar-letter .ar-role{font-size:14px;line-height:1.5;color:#52606b;margin:12px 0 24px}',
  ' .sawso-report .ar-read-more{margin-top:22px;border-top:1px solid var(--ar-line);padding-top:20px}',
  ' .sawso-report .ar-read-more summary{cursor:pointer;color:var(--ar-red);font-size:15px;font-weight:700;padding:4px 0}',
  ' .sawso-report .ar-read-more[open] summary{margin-bottom:22px}',
  ' .sawso-report .ar-letter p{font-size:16px;line-height:1.65}',
  ' .sawso-report .ar-financial-clean{background:#fff;color:#111}',
  ' .sawso-report .ar-financial-clean h2{margin-bottom:12px}',
  ' .sawso-report .ar-financial-clean .ar-financial-grid{grid-template-columns:1.2fr 1fr;gap:64px;align-items:start}',
  ' .sawso-report .ar-financial-clean .ar-expense{margin-bottom:28px}',
  ' .sawso-report .ar-financial-clean .ar-track{background:#edf0f1}',
  ' .sawso-report .ar-financial-clean .ar-expense:nth-child(odd) .ar-fill{background:var(--ar-red)}',
  ' .sawso-report .ar-financial-clean .ar-expense:nth-child(even) .ar-fill{background:var(--ar-navy)}',
  ' .sawso-report .ar-statement .ar-group th{font-weight:700;padding-top:28px;color:var(--ar-navy);font-size:14px;letter-spacing:.5px}',
  ' .sawso-report .ar-statement caption{font-size:23px}',
  ' .sawso-report .ar-statement th,.sawso-report .ar-statement td{font-size:15px;padding:13px 0}',
  ' .sawso-report .ar-statement th{padding-right:28px}',
  ' .sawso-report .ar-revenue{background:#f5f7f5;padding:28px;margin-bottom:44px}',
  ' .sawso-report .ar-revenue h3{margin-bottom:24px}',
  ' .sawso-report .ar-revenue-row{display:flex;gap:24px;align-items:center;justify-content:center}',
  ' .sawso-report .ar-donut{flex:0 0 116px;width:116px;height:116px;border-radius:50%;background:conic-gradient(var(--ar-red) 0 75.3178%,var(--ar-navy) 75.3178% 100%);position:relative}',
  " .sawso-report .ar-donut:after{content:'';position:absolute;inset:24px;border-radius:50%;background:#f5f7f5}",
  ' .sawso-report .ar-revenue-values{font-size:14px}',
  ' .sawso-report .ar-revenue-values strong{display:block;font-size:23px;line-height:1.4}',
  ' .sawso-report .ar-revenue-values p+p{margin-top:18px}',
  ' .sawso-report .ar-activity-table{max-width:960px;margin:28px auto 0}',
  ' @media(max-width:760px){.sawso-report .ar-financial-clean .ar-financial-grid{grid-template-columns:1fr;gap:32px}',
  '.sawso-report .ar-letter{padding:24px}',
  '.sawso-report .ar-leader-photo{width:160px;height:160px}',
  '.sawso-report .ar-financial-clean .ar-financial-grid{margin-top:32px}',
  '.sawso-report .ar-statement th,.sawso-report .ar-statement td{font-size:13px}',
  '.sawso-report .ar-statement th{padding-right:16px}',
  '.sawso-report .ar-statement caption{font-size:21px}',
  '.sawso-report .ar-revenue{padding:24px 18px}',
  '.sawso-report .ar-revenue-row{gap:18px}',
  '.sawso-report .ar-donut{flex-basis:96px;width:96px;height:96px}',
  '.sawso-report .ar-revenue-values strong{font-size:19px}',
  '}',
  ' @container ar-report (max-width:760px){.sawso-report .ar-financial-clean .ar-financial-grid{grid-template-columns:1fr;gap:32px}',
  '.sawso-report .ar-letter{padding:24px}',
  '.sawso-report .ar-leader-photo{width:160px;height:160px}',
  '.sawso-report .ar-financial-clean .ar-financial-grid{margin-top:32px}',
  '.sawso-report .ar-statement th,.sawso-report .ar-statement td{font-size:13px}',
  '.sawso-report .ar-statement th{padding-right:16px}',
  '.sawso-report .ar-statement caption{font-size:21px}',
  '.sawso-report .ar-revenue{padding:24px 18px}',
  '.sawso-report .ar-revenue-row{gap:18px}',
  '.sawso-report .ar-donut{flex-basis:96px;width:96px;height:96px}',
  '.sawso-report .ar-revenue-values strong{font-size:19px}',
  '}',
  ' .sawso-report{--ar-paper:#f6f7f5;--ar-blue:#edf3f4;--ar-line:#dce3e3;font-size:16px;line-height:1.58;--ar-motif:url("/cms-reports/report-globe-1.svg")}',
  ' .sawso-report .ar-container{max-width:1120px}',
  ' .sawso-report .ar-band{padding:44px max(28px,calc((100% - 1120px)/2));position:relative;isolation:isolate;border-top:1px solid #e6eaea}',
  ' .sawso-report .ar-section-title{margin-bottom:24px}',
  ' .sawso-report .ar-source{margin-top:18px;font-size:11px;line-height:1.5;color:#637079}',
  ' .sawso-report .ar-lead{font-size:17px;line-height:1.55}',
  " .sawso-report .ar-report-letters:before{content:'';position:absolute;inset:0;z-index:-1;background-image:var(--ar-motif);background-size:570px;background-position:right -230px top -180px;background-repeat:no-repeat;opacity:.08;pointer-events:none}",
  ' .sawso-report .ar-dark .ar-source{color:#d5dee8}',
  ' .sawso-report .ar-report-letters{background:var(--ar-paper)}',
  ' .sawso-report .ar-letters{gap:24px;align-items:start}',
  ' .sawso-report .ar-letter{padding:24px;border:1px solid var(--ar-line);background:#fff;border-radius:7px;box-shadow:0 7px 22px #34465f06}',
  ' .sawso-report .ar-letter-head{display:grid;grid-template-columns:82px 1fr;gap:20px;align-items:center;margin-bottom:20px}',
  ' .sawso-report .ar-leader-photo{width:82px;height:90px;margin:0;border-radius:4px;background:var(--ar-paper)}',
  ' .sawso-report .ar-letter h3{font-size:19px;line-height:1.3;margin:0}',
  ' .sawso-report .ar-letter .ar-role{font-size:11px;line-height:1.45;margin:9px 0 0;color:#596670}',
  ' .sawso-report .ar-letter p{font-size:14px;line-height:1.6}',
  ' .sawso-report .ar-read-more{margin-top:18px;padding-top:16px}',
  ' .sawso-report .ar-read-more summary{display:list-item;list-style-position:inside;cursor:pointer;width:fit-content;color:#34465f;font-size:13px;font-weight:700;padding:10px 14px;border:1px solid #b9c5ce;border-radius:5px;background:#fff;line-height:1.3;min-height:38px}',
  ' .sawso-report .ar-read-more summary:hover{border-color:var(--ar-red);color:var(--ar-red)}',
  ' .sawso-report .ar-read-more[open] summary{margin-bottom:18px}',
  ' .sawso-report .ar-financial-clean .ar-financial-grid{grid-template-columns:1.25fr 1fr;gap:40px;margin:26px 0 20px}',
  ' .sawso-report .ar-financial-clean .ar-expense{margin-bottom:17px}',
  ' .sawso-report .ar-expense-label{font-size:12px;margin-bottom:6px;line-height:1.4}',
  ' .sawso-report .ar-track,.sawso-report .ar-fill{height:7px}',
  ' .sawso-report .ar-financial-clean h3{font-size:19px;margin-bottom:20px}',
  ' .sawso-report .ar-revenue{padding:18px 20px;margin-bottom:22px;border-radius:6px}',
  ' .sawso-report .ar-revenue h3{font-size:18px;margin-bottom:16px}',
  ' .sawso-report .ar-revenue-row{justify-content:flex-start;gap:22px}',
  ' .sawso-report .ar-donut{width:78px;height:78px;flex-basis:78px}',
  ' .sawso-report .ar-donut:after{inset:16px}',
  ' .sawso-report .ar-revenue-values{font-size:12px;line-height:1.4}',
  ' .sawso-report .ar-revenue-values strong{font-size:18px;line-height:1.3}',
  ' .sawso-report .ar-revenue-values p+p{margin-top:10px}',
  ' .sawso-report .ar-statement{margin-bottom:0}',
  ' .sawso-report .ar-statement caption{font-size:17px;line-height:1.35;margin-bottom:12px}',
  ' .sawso-report .ar-statement th,.sawso-report .ar-statement td{font-size:12px;line-height:1.45;padding:9px 0}',
  ' .sawso-report .ar-statement .ar-group th{font-size:11px;padding-top:16px}',
  ' .sawso-report .ar-financial-disclosure{border:1px solid var(--ar-line);border-radius:6px;padding:0 20px;margin-top:18px;background:#fff}',
  ' .sawso-report .ar-financial-disclosure>summary{padding:14px 0;cursor:pointer;font-size:14px;font-weight:700;color:var(--ar-navy)}',
  ' .sawso-report .ar-activity-table{max-width:none;margin:16px 0 24px}',
  ' @media(max-width:760px){.sawso-report{font-size:15px}',
  '.sawso-report .ar-band{padding:32px 22px}',
  '.sawso-report .ar-section-title{margin-bottom:22px}',
  '.sawso-report .ar-letters,.sawso-report .ar-financial-clean .ar-financial-grid{grid-template-columns:1fr;gap:24px}',
  '.sawso-report .ar-letter{padding:20px}',
  '.sawso-report .ar-letter-head{grid-template-columns:65px 1fr;gap:16px}',
  '.sawso-report .ar-leader-photo{width:65px;height:78px}',
  '.sawso-report .ar-letter h3{font-size:16px}',
  '.sawso-report .ar-letter .ar-role{font-size:10px}',
  '.sawso-report .ar-letter p{font-size:14px}',
  '.sawso-report .ar-financial-clean .ar-financial-grid{margin-top:22px;gap:24px}',
  '.sawso-report .ar-financial-clean .ar-expense{margin-bottom:15px}',
  '.sawso-report .ar-expense-label{font-size:11px;gap:14px}',
  '.sawso-report .ar-revenue{padding:17px}',
  '.sawso-report .ar-revenue-values strong{font-size:17px}',
  '.sawso-report .ar-statement caption{font-size:16px}',
  '.sawso-report .ar-statement th,.sawso-report .ar-statement td{font-size:11px;padding:8px 0}',
  '.sawso-report .ar-financial-disclosure{padding:0 14px}',
  '.sawso-report .ar-financial-disclosure>summary{font-size:12px}',
  '}',
  ' @container ar-report (max-width:760px){.sawso-report{font-size:15px}',
  '.sawso-report .ar-band{padding:32px 22px}',
  '.sawso-report .ar-section-title{margin-bottom:22px}',
  '.sawso-report .ar-letters,.sawso-report .ar-financial-clean .ar-financial-grid{grid-template-columns:1fr;gap:24px}',
  '.sawso-report .ar-letter{padding:20px}',
  '.sawso-report .ar-letter-head{grid-template-columns:65px 1fr;gap:16px}',
  '.sawso-report .ar-leader-photo{width:65px;height:78px}',
  '.sawso-report .ar-letter h3{font-size:16px}',
  '.sawso-report .ar-letter .ar-role{font-size:10px}',
  '.sawso-report .ar-letter p{font-size:14px}',
  '.sawso-report .ar-financial-clean .ar-financial-grid{margin-top:22px;gap:24px}',
  '.sawso-report .ar-financial-clean .ar-expense{margin-bottom:15px}',
  '.sawso-report .ar-expense-label{font-size:11px;gap:14px}',
  '.sawso-report .ar-revenue{padding:17px}',
  '.sawso-report .ar-revenue-values strong{font-size:17px}',
  '.sawso-report .ar-statement caption{font-size:16px}',
  '.sawso-report .ar-statement th,.sawso-report .ar-statement td{font-size:11px;padding:8px 0}',
  '.sawso-report .ar-financial-disclosure{padding:0 14px}',
  '.sawso-report .ar-financial-disclosure>summary{font-size:12px}',
  '}',
  ' .sawso-report.ar-direction-4{font-size:17px;line-height:1.72}',
  ' .sawso-report.ar-direction-4 .ar-band{padding-top:76px;padding-bottom:76px}',
  ' .sawso-report.ar-direction-4 .ar-section-title{margin-bottom:42px}',
  ' .sawso-report.ar-direction-4 .ar-source{margin-top:34px}',
  ' .sawso-report.ar-direction-4 .ar-letters{gap:32px}',
  ' .sawso-report.ar-direction-4 .ar-letter{padding:30px}',
  ' .sawso-report.ar-direction-4 .ar-letter p{font-size:16px;line-height:1.72}',
  ' .sawso-report.ar-direction-4 .ar-letter-head{margin-bottom:28px}',
  ' .sawso-report.ar-direction-4 .ar-financial-clean .ar-financial-grid{gap:64px;margin-top:38px;margin-bottom:34px}',
  ' .sawso-report.ar-direction-4 .ar-expense-label{font-size:13px}',
  ' .sawso-report.ar-direction-4 .ar-financial-clean .ar-expense{margin-bottom:23px}',
  ' .sawso-report.ar-direction-4 .ar-statement th,.sawso-report.ar-direction-4 .ar-statement td{padding:13px 0}',
  ' @media(max-width:760px){ .sawso-report.ar-direction-4{font-size:16px;line-height:1.7}',
  ' .sawso-report.ar-direction-4 .ar-band{padding-top:50px;padding-bottom:50px}',
  ' .sawso-report.ar-direction-4 .ar-section-title{margin-bottom:30px}',
  ' .sawso-report.ar-direction-4 .ar-letters{gap:28px}',
  ' .sawso-report.ar-direction-4 .ar-letter{padding:24px}',
  ' .sawso-report.ar-direction-4 .ar-letter p{font-size:15px}',
  ' .sawso-report.ar-direction-4 .ar-financial-clean .ar-financial-grid{gap:32px;margin-top:30px}',
  ' .sawso-report.ar-direction-4 .ar-statement th,.sawso-report.ar-direction-4 .ar-statement td{padding:10px 0}',
  ' }',
  ' @container ar-report (max-width:760px){ .sawso-report.ar-direction-4{font-size:16px;line-height:1.7}',
  ' .sawso-report.ar-direction-4 .ar-band{padding-top:50px;padding-bottom:50px}',
  ' .sawso-report.ar-direction-4 .ar-section-title{margin-bottom:30px}',
  ' .sawso-report.ar-direction-4 .ar-letters{gap:28px}',
  ' .sawso-report.ar-direction-4 .ar-letter{padding:24px}',
  ' .sawso-report.ar-direction-4 .ar-letter p{font-size:15px}',
  ' .sawso-report.ar-direction-4 .ar-financial-clean .ar-financial-grid{gap:32px;margin-top:30px}',
  ' .sawso-report.ar-direction-4 .ar-statement th,.sawso-report.ar-direction-4 .ar-statement td{padding:10px 0}',
  ' }',
  ' .sawso-report.ar-direction-4 .ar-letters{align-items:stretch}',
  ' .sawso-report.ar-direction-4 .ar-letter{display:flex;flex-direction:column;min-width:0}',
  ' .sawso-report.ar-direction-4 .ar-letter-head{display:grid;grid-template-columns:82px minmax(0,1fr);gap:18px 22px;align-items:center;margin-bottom:24px}',
  ' .sawso-report.ar-direction-4 .ar-letter-head>div{display:contents}',
  ' .sawso-report.ar-direction-4 .ar-letter-head h3{grid-column:1 / -1;grid-row:1;font-size:clamp(18px,1.6cqw,19px);line-height:1.4;margin:0;white-space:normal;overflow-wrap:normal}',
  ' .sawso-report.ar-direction-4 .ar-letter-head>.ar-leader-photo{grid-column:1;grid-row:2;width:82px;height:96px;margin:0;object-fit:contain}',
  ' .sawso-report.ar-direction-4 .ar-letter-head .ar-role{grid-column:2;grid-row:2;margin:0}',
  ' .sawso-report.ar-direction-4 .ar-letter>.ar-read-more{margin-top:auto;padding-top:22px}',
  ' .sawso-report.ar-direction-4 .ar-letters:has(.ar-read-more[open]) .ar-letter>.ar-read-more{margin-top:0}',
  ' .sawso-report.ar-direction-4 .ar-letter>p{margin-bottom:24px}',
  ' @media(max-width:1000px){ .sawso-report.ar-direction-4 .ar-letters{grid-template-columns:1fr}',
  ' .sawso-report.ar-direction-4 .ar-letter-head h3{font-size:18px}',
  ' }',
  ' @media(max-width:760px){ .sawso-report.ar-direction-4 .ar-letter-head{gap:18px}',
  ' .sawso-report.ar-direction-4 .ar-letter-head h3{font-size:18px;line-height:1.45}',
  ' }',
  ' @container ar-report (max-width:1000px){ .sawso-report.ar-direction-4 .ar-letters{grid-template-columns:1fr}',
  ' .sawso-report.ar-direction-4 .ar-letter-head h3{font-size:18px}',
  ' }',
  ' @container ar-report (max-width:760px){ .sawso-report.ar-direction-4 .ar-letter-head{gap:18px}',
  ' .sawso-report.ar-direction-4 .ar-letter-head h3{font-size:18px;line-height:1.45}',
  ' }',
  '  .sawso-report .ar-leader-photo img{width:100%;height:100%;object-fit:contain}',
  '.sawso-report .ar-role>p{margin:0}',
  '.sawso-report .ar-expense[data-report-expense]{display:block}',
  '.sawso-report .ar-statement tr.ar-total{font-weight:700}',
  '.sawso-report .ar-statement tr.ar-group th{color:var(--ar-navy);font-weight:700;text-transform:uppercase}',
  '.sawso-report .ar-statement tr.ar-group td{display:none}',
  ' .sawso-report :is(h1,h2,h3){font-family:var(--font-heading,Georgia,serif)!important;font-weight:400!important}',
].join('')

/** Shared report story and country-list variants. Source: approved report.css.
 * Layout choices are template-owned; all story words, photos and numbers remain fields. */
export const REPORT_STORY_CSS = `
.sawso-report :where(h1,h2,h3,p,figure,blockquote,ul,ol){margin:0;padding:0}
.sawso-report h2{font-size:30px;line-height:1.3;color:inherit;letter-spacing:0;font-variant:normal}
.sawso-report h3{font-size:24px;line-height:1.3;color:inherit;letter-spacing:0;font-variant:normal}
.sawso-report.ar-direction-4 p+p{margin-top:20px}
.sawso-report p:empty,.sawso-report h2:empty,.sawso-report h3:empty,.sawso-report .ar-photo-note:empty,.sawso-report .ar-story-body:empty{display:none}
.sawso-report a:focus-visible,.sawso-report summary:focus-visible{outline:3px solid var(--ar-red);outline-offset:5px}
.sawso-report .ar-eyebrow{font-size:12px;line-height:1.4;font-weight:700;letter-spacing:1.4px;text-transform:uppercase;color:var(--ar-red-text);margin:0 0 14px}
.sawso-report .ar-country-grid{display:grid;grid-template-columns:320px minmax(0,1fr);column-gap:58px;row-gap:24px;align-items:start}
.sawso-report .ar-feature-heading{grid-column:2;grid-row:1}
.sawso-report .ar-feature-heading h3{font-size:24px;line-height:1.4}
.sawso-report .ar-story-figure{grid-column:1;grid-row:1 / span 3;min-width:0}
.sawso-report .ar-photo{display:block;max-width:100%;overflow:hidden}
.sawso-report .ar-photo img{display:block;width:100%;height:100%;object-fit:cover}
.sawso-report .ar-story-figure>.ar-photo{height:250px;border-radius:6px}
.sawso-report .ar-story-figure:not(:has(img)){display:none}
.sawso-report .ar-copy{grid-column:2;grid-row:2;min-width:0}
.sawso-report .ar-copy p,.sawso-report .ar-story-body p{font-size:17px;line-height:1.72}
.sawso-report .ar-photo-note{margin-top:26px;font-size:14px;line-height:1.75;color:#637079}
.sawso-report .ar-photo-note p+p{margin-top:18px}
.sawso-report .ar-photo-note blockquote{padding:20px 22px;font-size:19px;line-height:1.6;margin:24px 0;border-left:3px solid var(--ar-red);background:#f6f7f5}
.sawso-report .ar-country-section .ar-section-title{border-left:3px solid var(--ar-red);padding-left:17px;margin-bottom:28px}.sawso-report .ar-stat-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:20px;margin:36px 0;grid-column:1/-1}
.sawso-report .ar-stat-grid:empty{display:none}
.sawso-report .ar-stat{background:var(--ar-red);color:#fff;padding:18px 20px;border-radius:6px;min-width:0}
.sawso-report .ar-stat p{font-size:13px;line-height:1.5;margin:0}
.sawso-report .ar-stat-number{display:block;font-size:34px;line-height:1.12;margin:5px 0 7px;font-weight:600;letter-spacing:-.8px;color:#fff}
.sawso-report .ar-story-body{margin-top:20px}
.sawso-report .ar-program-impact{display:grid;grid-template-columns:300px minmax(0,1fr);gap:48px;margin:34px 0 0;padding:34px 0;border-top:1px solid var(--ar-line);border-bottom:1px solid var(--ar-line)}
.sawso-report .ar-program-impact[hidden],.sawso-report .ar-discover[hidden]{display:none!important}
.sawso-report .ar-program-impact h3{font-size:16px;margin-bottom:12px}
.sawso-report .ar-report-list ul{display:grid;grid-template-columns:1fr 1fr;gap:24px 34px;font-size:15px;line-height:1.5;padding-left:18px;list-style:disc}
.sawso-report .ar-discover{display:flex;align-items:center;justify-content:space-between;padding:28px 30px;margin:44px 0 0;gap:36px;background:#fff;border:1px solid var(--ar-line);border-left:3px solid var(--ar-red);border-radius:0 6px 6px 0}
.sawso-report .ar-discover:not(:has(a:not(:empty))){display:none}
.sawso-report .ar-discover h3{font-size:19px;margin-bottom:8px}
.sawso-report .ar-discover p{font-size:15px;line-height:1.65}
.sawso-report .ar-discover>a{display:inline-flex;flex-shrink:0;background:var(--ar-red);color:#fff;padding:12px 20px;border-radius:5px;text-decoration:none;font-size:14px;font-weight:600}
.sawso-report [data-report-layout=response] .ar-country-grid{grid-template-columns:minmax(0,1.7fr) minmax(0,1fr);align-items:start;row-gap:22px}
.sawso-report [data-report-layout=response] .ar-feature-heading{grid-column:1;grid-row:1}
.sawso-report [data-report-layout=response] .ar-copy{grid-column:1;grid-row:2}
.sawso-report [data-report-layout=response] .ar-story-figure{grid-column:2;grid-row:1 / span 2;align-self:center}
.sawso-report [data-report-layout=response] .ar-story-figure>.ar-photo{height:auto}.sawso-report [data-report-layout=response] .ar-story-figure img{width:auto;height:230px;max-width:100%;object-fit:contain}
.sawso-report [data-report-layout=response] .ar-stat-grid{grid-template-columns:repeat(5,minmax(0,1fr));margin-bottom:18px}
.sawso-report [data-report-layout=response] .ar-stat{padding:20px 17px}
.sawso-report [data-report-layout=response] .ar-stat-number{font-size:29px;margin-top:7px}
.sawso-report [data-report-layout=response] .ar-stat p{font-size:12px}
.sawso-report [data-report-layout=feature] .ar-stat-grid{grid-column:2;grid-row:3;grid-template-columns:1fr;margin:4px 0 0}
.sawso-report [data-report-layout=reading] .ar-country-grid{grid-template-columns:240px minmax(0,1fr);gap:24px 54px}
.sawso-report [data-report-layout=reading] .ar-story-figure>.ar-photo{height:210px}
.sawso-report [data-report-layout=reading] .ar-feature-heading h3{font-size:23px;line-height:1.4;max-width:30ch}
.sawso-report [data-report-layout=text] .ar-country-grid{display:block}
.sawso-report [data-report-layout=text] .ar-story-figure{display:none}
.sawso-report [data-report-layout=text] .ar-feature-heading{margin-bottom:24px}
.sawso-report [data-report-layout=text] .ar-copy{max-width:80ch}
.sawso-report .ar-global-cover{display:grid;grid-template-columns:minmax(0,1fr) 150px;gap:10px 32px;align-items:center;background:none;color:var(--ar-ink)}
.sawso-report .ar-global-cover>.ar-photo{grid-column:2;grid-row:1 / span 2;width:150px;height:102px;border-radius:6px}
.sawso-report .ar-global-cover h2{font-size:26px;line-height:1.3;align-self:end}
.sawso-report .ar-global-cover>p{font-size:16px;line-height:1.55;max-width:760px}
.sawso-report .ar-country-disclosure{border:1px solid #cbd6d8;border-radius:6px;background:#fff;padding:0 20px;margin-top:34px}
.sawso-report .ar-country-disclosure>summary{padding:14px 0;cursor:pointer;font-size:14px;line-height:1.4;font-weight:700;color:var(--ar-navy)}
.sawso-report .ar-country-disclosure .ar-regions{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));margin:18px 0 24px;gap:20px}
.sawso-report .ar-regions h3{font-size:11px;margin-bottom:12px;font-family:var(--font-body,Arial,sans-serif)!important;font-weight:700!important}
.sawso-report .ar-regions ul{font-size:14px;line-height:1.65;list-style:none}
@media(max-width:760px){
 .sawso-report h2{font-size:28px}
 .sawso-report .ar-country-grid,.sawso-report [data-report-layout=response] .ar-country-grid,.sawso-report [data-report-layout=reading] .ar-country-grid{grid-template-columns:minmax(0,1fr);gap:26px}
 .sawso-report .ar-feature-heading,.sawso-report [data-report-layout=response] .ar-feature-heading{grid-column:1;grid-row:1}
 .sawso-report .ar-feature-heading h3{font-size:22px}
 .sawso-report .ar-story-figure,.sawso-report [data-report-layout=response] .ar-story-figure{grid-column:1;grid-row:2}
 .sawso-report .ar-story-figure>.ar-photo,.sawso-report [data-report-layout=response] .ar-story-figure>.ar-photo,.sawso-report [data-report-layout=reading] .ar-story-figure>.ar-photo{height:200px}
 .sawso-report [data-report-layout=response] .ar-story-figure img{height:200px}.sawso-report .ar-copy,.sawso-report [data-report-layout=response] .ar-copy{grid-column:1;grid-row:3}
 .sawso-report .ar-copy p,.sawso-report .ar-story-body p{font-size:16px}
 .sawso-report .ar-stat-grid,.sawso-report [data-report-layout=response] .ar-stat-grid,.sawso-report [data-report-layout=feature] .ar-stat-grid{grid-column:1;grid-row:4;grid-template-columns:1fr;gap:14px;margin:30px 0}
 .sawso-report [data-report-layout=response] .ar-stat{padding:17px 14px}
 .sawso-report .ar-stat-number{font-size:32px}
 .sawso-report .ar-program-impact{grid-template-columns:minmax(0,1fr);gap:26px;padding:28px 0}
 .sawso-report .ar-report-list ul{grid-template-columns:1fr;font-size:14px;gap:20px}
 .sawso-report .ar-discover{display:block;padding:23px;margin-top:34px}
 .sawso-report .ar-discover>a{margin-top:16px}
 .sawso-report .ar-global-cover{grid-template-columns:minmax(0,1fr) 80px;gap:10px 18px}
 .sawso-report .ar-global-cover>.ar-photo{width:80px;height:100px}
 .sawso-report .ar-global-cover h2{font-size:22px;line-height:1.2}
 .sawso-report .ar-global-cover>p{font-size:13px}
 .sawso-report .ar-country-disclosure{padding:0 15px}
 .sawso-report .ar-country-disclosure>summary{font-size:13px}
 .sawso-report .ar-country-disclosure .ar-regions{grid-template-columns:1fr 1fr;gap:22px}
 .sawso-report .ar-regions ul{font-size:12px}
}
@container ar-report (max-width:760px){
 .sawso-report h2{font-size:28px}
 .sawso-report .ar-country-grid,.sawso-report [data-report-layout=response] .ar-country-grid,.sawso-report [data-report-layout=reading] .ar-country-grid{grid-template-columns:minmax(0,1fr);gap:26px}
 .sawso-report .ar-feature-heading,.sawso-report [data-report-layout=response] .ar-feature-heading{grid-column:1;grid-row:1}
 .sawso-report .ar-feature-heading h3{font-size:22px}
 .sawso-report .ar-story-figure,.sawso-report [data-report-layout=response] .ar-story-figure{grid-column:1;grid-row:2}
 .sawso-report .ar-story-figure>.ar-photo,.sawso-report [data-report-layout=response] .ar-story-figure>.ar-photo,.sawso-report [data-report-layout=reading] .ar-story-figure>.ar-photo{height:200px}
 .sawso-report [data-report-layout=response] .ar-story-figure img{height:200px}.sawso-report .ar-copy,.sawso-report [data-report-layout=response] .ar-copy{grid-column:1;grid-row:3}
 .sawso-report .ar-copy p,.sawso-report .ar-story-body p{font-size:16px}
 .sawso-report .ar-stat-grid,.sawso-report [data-report-layout=response] .ar-stat-grid,.sawso-report [data-report-layout=feature] .ar-stat-grid{grid-column:1;grid-row:4;grid-template-columns:1fr;gap:14px;margin:30px 0}
 .sawso-report [data-report-layout=response] .ar-stat{padding:17px 14px}
 .sawso-report .ar-stat-number{font-size:32px}
 .sawso-report .ar-program-impact{grid-template-columns:minmax(0,1fr);gap:26px;padding:28px 0}
 .sawso-report .ar-report-list ul{grid-template-columns:1fr;font-size:14px;gap:20px}
 .sawso-report .ar-discover{display:block;padding:23px;margin-top:34px}
 .sawso-report .ar-discover>a{margin-top:16px}
 .sawso-report .ar-global-cover{grid-template-columns:minmax(0,1fr) 80px;gap:10px 18px}
 .sawso-report .ar-global-cover>.ar-photo{width:80px;height:100px}
 .sawso-report .ar-global-cover h2{font-size:22px;line-height:1.2}
 .sawso-report .ar-global-cover>p{font-size:13px}
 .sawso-report .ar-country-disclosure{padding:0 15px}
 .sawso-report .ar-country-disclosure>summary{font-size:13px}
 .sawso-report .ar-country-disclosure .ar-regions{grid-template-columns:1fr 1fr;gap:22px}
 .sawso-report .ar-regions ul{font-size:12px}
}
`

/** Source report jump-bar spacing; native details supplies the phone behavior. */
export const REPORT_LINKS_CSS = `
.sawso-report{container-type:inline-size;container-name:ar-report;font-family:var(--font-body,Arial,sans-serif);background:white;color:#34465f;box-sizing:border-box}
.sawso-report *{box-sizing:border-box}
.sawso-report .ar-jump{display:flex;align-items:center;flex-wrap:wrap;justify-content:center;text-align:center;gap:16px 25px;padding:27px max(28px,calc((100% - 1120px)/2));border-bottom:1px solid #dce3e3;font-size:14px;line-height:1.4;font-weight:600;background:white}
.sawso-report .ar-jump a{color:inherit;text-decoration:none;padding:3px 0;border-bottom:2px solid transparent;white-space:nowrap}
.sawso-report .ar-jump a:hover{border-color:#ed1c2b;color:#ed1c2b}
.sawso-report a:focus-visible,.sawso-report summary:focus-visible{outline:3px solid #ed1c2b;outline-offset:5px}
.sawso-report .ar-mobile-jump{display:none}
@media(max-width:760px){.sawso-report .ar-jump{display:none}.sawso-report .ar-mobile-jump{display:block;background:white;border-bottom:1px solid #dce3e3;padding:0 22px}.sawso-report .ar-mobile-jump>summary{padding:16px 0;cursor:pointer;font-size:13px;line-height:1.4;font-weight:700}.sawso-report .ar-mobile-jump nav{display:grid;gap:0;padding:0 0 12px;max-height:55svh;overflow:auto}.sawso-report .ar-mobile-jump a{font-size:13px;line-height:1.4;color:#34465f;padding:11px 0;border-top:1px solid #edf0f0;text-decoration:none}}
@container ar-report (max-width:760px){.sawso-report .ar-jump{display:none}.sawso-report .ar-mobile-jump{display:block;background:white;border-bottom:1px solid #dce3e3;padding:0 22px}.sawso-report .ar-mobile-jump>summary{padding:16px 0;cursor:pointer;font-size:13px;line-height:1.4;font-weight:700}.sawso-report .ar-mobile-jump nav{display:grid;gap:0;padding:0 0 12px;max-height:55svh;overflow:auto}.sawso-report .ar-mobile-jump a{font-size:13px;line-height:1.4;color:#34465f;padding:11px 0;border-top:1px solid #edf0f0;text-decoration:none}}
`
