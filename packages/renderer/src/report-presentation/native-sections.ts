/** Map the report layout onto the renderer’s native editable sections and fields. */
export const reportNativeSectionsCss =
  [
    '\n\n#cms-main.cms-report-page.ar-direction-4{--ar-band-space:76px;--ar-inline-space:max(28px,calc((100% - 1120px)/2));--ar-metrics-space:48px;--ar-action-space:28px;--ar-stack-gap:34px;max-width:none;width:100%;padding:0;margin:0;color:#111;background:white;font:300 17px/1.72 var(--font-body);container-type:inline-size;container-name:ar-report}',
    '\n#cms-main.cms-report-page.ar-direction-4 [hidden]{display:none!important}',
    '\n#cms-main.cms-report-page.ar-direction-4 .cms-section{margin:0;border:0;box-shadow:none;border-radius:0;background:transparent}',
    '\n#cms-main.cms-report-page.ar-direction-4 .cms-report-band{padding:var(--ar-band-space) var(--ar-inline-space);position:relative;isolation:isolate}',
    '\n#cms-main.cms-report-page.ar-direction-4 .cms-report-band--metrics{padding-block:var(--ar-metrics-space)}',
    '\n#cms-main.cms-report-page.ar-direction-4 .cms-report-band--cover,#cms-main.cms-report-page.ar-direction-4 .cms-report-band--links,#cms-main.cms-report-page.ar-direction-4 .cms-report-band--closing{padding:0;border:0}',
    '\n#cms-main.cms-report-page.ar-direction-4 .cms-report-band .ar-band{border:0;background:transparent}',
    '\n#cms-main.cms-report-page.ar-direction-4 .cms-report-band .ar-band:not(.ar-closing){padding:0!important}',
    '\n#cms-main.cms-report-page.ar-direction-4 .cms-report-band>.cms-section>.sawso-report{background:transparent;font:inherit}',
    '\n#cms-main.cms-report-page.ar-direction-4 [class*="cms-report-part--"] .core,#cms-main.cms-report-page.ar-direction-4 [class*="cms-report-part--"] .national-block{background:transparent;border-radius:0;color:inherit;font:inherit}',
    '\n#cms-main.cms-report-page.ar-direction-4 [class*="cms-report-part--"] .core:not(.ar-closing),#cms-main.cms-report-page.ar-direction-4 [class*="cms-report-part--"] .national-block{padding:0}',
    '\n#cms-main.cms-report-page.ar-direction-4 [class*="cms-report-part--"] .container{max-width:none;width:100%;padding:0;margin:0}',
    '\n#cms-main.cms-report-page.ar-direction-4 .cms-report-no-heading .ar-section-title,#cms-main.cms-report-page.ar-direction-4 .cms-report-no-heading .national-block-head,#cms-main.cms-report-page.ar-direction-4 .cms-report-no-heading .core>.container>h2,#cms-main.cms-report-page.ar-direction-4 .cms-report-no-source .ar-source{display:none}',
    '\n#cms-main.cms-report-page.ar-direction-4 .cms-report-part--cover .national-hero{border-radius:0;overflow:hidden}',
    '\n#cms-main.cms-report-page.ar-direction-4 .cms-report-part--cover .national-hero:after{display:none}',
    '\n#cms-main.cms-report-page.ar-direction-4 .cms-report-part--cover .national-hero-copy{max-width:1120px;padding:0;width:100%}',
    '\n#cms-main.cms-report-page.ar-direction-4 .cms-report-part--cover .national-report-subheading{display:block}',
    '\n#cms-main.cms-report-page.ar-direction-4 .cms-report-part--cover .national-report-caption{max-width:460px;margin-top:24px;font-size:12px;line-height:1.55}',
    '\n#cms-main.cms-report-page.ar-direction-4 .cms-report-part--cover .national-report-caption p{font:inherit;line-height:inherit}',
    '\n#cms-main.cms-report-page.ar-direction-4 .cms-report-part--cover .national-actions a{background:#ed1c2b;border:1px solid #ed1c2b;color:white;border-radius:4px;padding:12px 22px;font-size:14px;line-height:1.4;font-weight:700;text-decoration:none}',
    '\n#cms-main.cms-report-page.ar-direction-4 .cms-report-part--cover .national-actions a.ar-cover-secondary{background:transparent;border-color:white}',
    "\n#cms-main.cms-report-page.ar-direction-4 .cms-report-part--cover .national-actions a.ar-cover-secondary:after{content:'↗';margin-left:9px}",
    '\n#cms-main.cms-report-page.ar-direction-4 .cms-report-part--mission .core>.container{display:grid;grid-template-columns:1.25fr 1fr;gap:0 68px;align-items:center}',
    '\n#cms-main.cms-report-page.ar-direction-4 .cms-report-part--mission:not(:has(.row>div:first-child img)) .core>.container{grid-template-columns:minmax(0,1fr)}',
    '\n#cms-main.cms-report-page.ar-direction-4 .cms-report-part--mission .row{display:contents}',
    '\n#cms-main.cms-report-page.ar-direction-4 .cms-report-part--mission .row>div{width:auto;max-width:none;padding:0;margin-top:0}',
    '\n#cms-main.cms-report-page.ar-direction-4 .cms-report-part--mission .row>div:first-child{grid-column:2;grid-row:1 / span 2}',
    '\n#cms-main.cms-report-page.ar-direction-4 .cms-report-part--mission .row>div:last-child{grid-column:1;grid-row:1}',
    '\n#cms-main.cms-report-page.ar-direction-4 .cms-report-part--mission img{width:100%;height:370px;object-fit:cover;border-radius:6px}',
    '\n#cms-main.cms-report-page.ar-direction-4 .cms-report-part--mission h2{font-size:23px;margin:0 0 24px}',
    '\n#cms-main.cms-report-page.ar-direction-4 .cms-report-part--mission .core-text-image-body h2{margin:40px 0 24px}',
    '\n#cms-main.cms-report-page.ar-direction-4 .cms-report-part--mission .core-report-actions{grid-column:1;grid-row:2;display:flex;flex-wrap:wrap;gap:14px;margin-top:var(--ar-action-space)}',
    '\n#cms-main.cms-report-page.ar-direction-4 .core-report-actions a{display:inline-flex;align-items:center;min-height:42px;text-decoration:none;background:#ed1c2b;color:white;border:1px solid #ed1c2b;border-radius:5px;padding:11px 21px;font-size:14px;font-weight:700;line-height:1.35}',
    '\n#cms-main.cms-report-page.ar-direction-4 .core-report-actions .core-report-pdf a{background:transparent;border-color:#34465f;color:#34465f}',
    '\n#cms-main.cms-report-page.ar-direction-4 .cms-report-part--vision .national-card,#cms-main.cms-report-page.ar-direction-4 .cms-report-part--vision .national-tile{padding:0;border:0;background:transparent;border-radius:0}',
    '\n#cms-main.cms-report-page.ar-direction-4 .cms-report-part--vision .ar-vision-grid{display:grid;grid-template-columns:1.1fr 1fr;gap:74px;align-items:start}',
    '\n#cms-main.cms-report-page.ar-direction-4 .cms-report-part--vision .national-icon{display:none}',
    '\n#cms-main.cms-report-page.ar-direction-4 .cms-report-part--vision .national-tile:first-child h3{font:400 26px/1.25 var(--font-heading)!important;margin:0 0 42px}',
    '\n#cms-main.cms-report-page.ar-direction-4 .cms-report-part--vision .national-tile:last-child h3{font:400 26px/1.25 var(--font-heading)!important;margin:0 0 42px}',
    '\n#cms-main.cms-report-page.ar-direction-4 .cms-report-part--vision .national-tile p,#cms-main.cms-report-page.ar-direction-4 .cms-report-part--vision li{font-size:17px;line-height:1.72}',
    '\n#cms-main.cms-report-page.ar-direction-4 .cms-report-part--metrics .ar-impact-layout{display:grid;grid-template-columns:minmax(0,1fr) 180px;gap:48px;align-items:center}',
    '\n#cms-main.cms-report-page.ar-direction-4 .cms-report-part--metrics .core-stats-intro-copy p{font-size:18px;line-height:1.6;max-width:760px}',
    '\n#cms-main.cms-report-page.ar-direction-4 .cms-report-part--metrics .core-stats-photo img{width:100%;height:112px;object-fit:cover;border-radius:5px}',
    '\n#cms-main.cms-report-page.ar-direction-4 .cms-report-part--metrics figcaption{margin-top:6px;color:inherit;font-size:10px;line-height:1.5}',
    '\n#cms-main.cms-report-page.ar-direction-4 .cms-report-part--metrics .ar-metrics{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:22px;margin-top:32px}',
    '\n#cms-main.cms-report-page.ar-direction-4 .cms-report-part--metrics .ar-metrics article{padding:22px;background:#ed1c2b;color:white;border-radius:6px;min-height:116px}',
    '\n#cms-main.cms-report-page.ar-direction-4 .cms-report-part--metrics .ar-metrics .ar-stat-number{font:600 34px/1.12 var(--font-body);letter-spacing:-.8px;margin:5px 0 7px;color:white}',
    '\n#cms-main.cms-report-page.ar-direction-4 .cms-report-part--metrics .ar-metrics h3{font:300 12px/1.45 var(--font-body)!important;letter-spacing:0;margin:0;color:white}',
    '\n#cms-main.cms-report-page.ar-direction-4 .cms-report-part--metrics .core-stat-context{display:none}',
    '\n#cms-main.cms-report-page.ar-direction-4 .cms-report-part--letters .ar-report-letters:before{display:none}',
    "\n#cms-main.cms-report-page.ar-direction-4 .cms-report-band--letters:before{content:'';position:absolute;inset:0;z-index:-1;background:url('/cms-reports/report-globe-1.svg') no-repeat right -230px top -180px / 570px;opacity:.08;pointer-events:none}",
    '\n#cms-main.cms-report-page.ar-direction-4 .cms-report-part--country+.cms-report-part--country{margin-top:0}',
    '\n#cms-main.cms-report-page.ar-direction-4 .ar-stats-heading{grid-column:1/-1;font-size:19px;margin:42px 0 0}',
    '\n#cms-main.cms-report-page.ar-direction-4 .ar-after-stats{grid-column:2;background:#f6f7f5;border:1px solid #dce3e3;border-radius:6px;padding:20px 22px;font-size:14px;line-height:1.65}',
    '\n#cms-main.cms-report-page.ar-direction-4 .cms-report-part--fact{margin:42px 0}',
    '\n#cms-main.cms-report-page.ar-direction-4 .cms-report-part--fact .ar-feature-heading h3{font-size:16px;margin-bottom:12px}',
    '\n#cms-main.cms-report-page.ar-direction-4 .cms-report-part--fact .ar-stat-grid{display:block;margin:0;max-width:670px}',
    '\n#cms-main.cms-report-page.ar-direction-4 .cms-report-part--fact .ar-stat{padding:24px 28px}',
    '\n#cms-main.cms-report-page.ar-direction-4 .cms-report-part--give .national-card{background:transparent;padding:0;border-radius:0}',
    '\n#cms-main.cms-report-page.ar-direction-4 .cms-report-part--give .national-block-head{margin:0 0 42px}',
    '\n#cms-main.cms-report-page.ar-direction-4 .cms-report-part--give .national-contact-layout{display:grid;grid-template-columns:.8fr 1.2fr;gap:60px;align-items:start}',
    '\n#cms-main.cms-report-page.ar-direction-4 .cms-report-part--give .national-contact-copy{display:block}',
    '\n#cms-main.cms-report-page.ar-direction-4 .cms-report-part--give .national-contact-photo img{width:100%;height:450px;object-fit:cover;border-radius:6px}',
    '\n#cms-main.cms-report-page.ar-direction-4 .cms-report-part--give .national-contacts{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:36px;text-align:left}',
    '\n#cms-main.cms-report-page.ar-direction-4 .cms-report-part--give .national-tile{background:transparent;padding:0;border-radius:0}',
    '\n#cms-main.cms-report-page.ar-direction-4 .cms-report-part--give h3{font-size:19px;margin:0 0 14px}',
    '\n#cms-main.cms-report-page.ar-direction-4 .cms-report-part--give p,#cms-main.cms-report-page.ar-direction-4 .cms-report-part--give li{font-size:16px;line-height:1.7}',
    '\n#cms-main.cms-report-page.ar-direction-4 .cms-report-part--give .national-contact-extra,#cms-main.cms-report-page.ar-direction-4 .cms-report-part--give .national-contact-questions{margin-top:32px}',
    '\n#cms-main.cms-report-page.ar-direction-4 .cms-report-part--give .national-contact-small{font-size:11px;line-height:1.6;color:#52606b;margin-top:34px}',
    '\n#cms-main.cms-report-page.ar-direction-4 .cms-report-part--give .national-contact-small p{font-size:inherit;line-height:inherit}',
    '\n#cms-main.cms-report-page.ar-direction-4 .cms-report-part--give ul{padding-left:20px}',
    '\n#cms-main.cms-report-page.ar-direction-4 .cms-report-part--directory .core-reading .container>div{background:transparent;padding:0;max-width:none;border-radius:0}',
    '\n#cms-main.cms-report-page.ar-direction-4 .cms-report-part--directory .core-faq-list{display:grid;grid-template-columns:1fr 1fr 1.3fr;gap:28px;align-items:start}',
    '\n#cms-main.cms-report-page.ar-direction-4 .cms-report-part--directory details{margin:0;padding:26px;border:1px solid #dce3e3;border-radius:6px;background:white}',
    '\n#cms-main.cms-report-page.ar-direction-4 .cms-report-part--directory summary{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:12px;font-size:13px;font-weight:700;list-style:none;cursor:pointer;color:var(--ar-navy)}',
    '\n#cms-main.cms-report-page.ar-direction-4 .cms-report-part--directory summary::-webkit-details-marker{display:none}',
    '\n#cms-main.cms-report-page.ar-direction-4 .cms-report-part--directory .core-faq-count{display:grid;place-items:center;width:30px;height:30px;border-radius:50%;background:#f6f7f5;font-size:13px;font-weight:700}',
    '\n#cms-main.cms-report-page.ar-direction-4 .cms-report-part--directory .core-faq-open{width:100%;font-size:12px;font-weight:600;color:var(--ar-red)}',
    '\n#cms-main.cms-report-page.ar-direction-4 .cms-report-part--directory details>div{border-top:1px solid var(--ar-line);margin-top:20px;padding-top:24px;font-size:13px;line-height:1.5}',
    '\n#cms-main.cms-report-page.ar-direction-4 .cms-report-part--directory details p+p{margin-top:0}',
    '\n#cms-main.cms-report-page.ar-direction-4 .cms-report-part--directory details p{font-size:13px;line-height:1.5;padding:0;margin:0 0 18px}',
    '\n#cms-main.cms-report-page.ar-direction-4 .cms-report-part--directory .report-directory-source{font-size:11px;line-height:1.5;color:#52606b;margin-top:34px}',
    '\n\n#cms-main.cms-report-page.ar-direction-4 .cms-report-part--closing .core-report-closing-photo{position:absolute;inset:0;z-index:-2}',
    '\n#cms-main.cms-report-page.ar-direction-4 .cms-report-part--closing .core-report-closing-photo img{width:100%;height:100%;object-fit:inherit}',
    '\n\n\n\n@media(max-width:760px){\n #cms-main.cms-report-page.ar-direction-4{--ar-band-space:50px;--ar-inline-space:22px;--ar-metrics-space:36px}',
    '\n #cms-main.cms-report-page.ar-direction-4 .cms-report-band--cover,#cms-main.cms-report-page.ar-direction-4 .cms-report-band--links,#cms-main.cms-report-page.ar-direction-4 .cms-report-band--closing{padding:0;border:0}',
    '\n #cms-main.cms-report-page.ar-direction-4 .cms-report-part--cover .national-hero{height:auto;min-height:430px;padding:38px 22px}',
    '\n #cms-main.cms-report-page.ar-direction-4 .cms-report-part--cover h1{font-size:43px!important;line-height:1.15}',
    '\n #cms-main.cms-report-page.ar-direction-4 .cms-report-part--cover .national-report-caption{font-size:11px;max-width:290px;margin-top:20px}',
    '\n #cms-main.cms-report-page.ar-direction-4 .cms-report-part--cover .national-actions a{padding:10px 15px;font-size:12px}',
    '\n #cms-main.cms-report-page.ar-direction-4 .cms-report-part--mission .core>.container{grid-template-columns:minmax(0,1fr);gap:30px}',
    '\n #cms-main.cms-report-page.ar-direction-4 .cms-report-part--mission .row>div:first-child{grid-column:1;grid-row:3;margin-top:var(--ar-stack-gap)}',
    '\n #cms-main.cms-report-page.ar-direction-4 .cms-report-part--mission .row>div:last-child{grid-column:1;grid-row:1}',
    '\n #cms-main.cms-report-page.ar-direction-4 .cms-report-part--mission .core-report-actions{grid-column:1;grid-row:2;margin:var(--ar-action-space) 0 0}',
    '\n #cms-main.cms-report-page.ar-direction-4 .cms-report-part--mission img{height:210px}',
    '\n #cms-main.cms-report-page.ar-direction-4 .cms-report-part--vision .ar-vision-grid{grid-template-columns:minmax(0,1fr);gap:40px}',
    '\n #cms-main.cms-report-page.ar-direction-4 .cms-report-part--metrics .ar-impact-layout{grid-template-columns:minmax(0,1fr) 92px;gap:20px;align-items:start}',
    '\n #cms-main.cms-report-page.ar-direction-4 .cms-report-part--metrics .core-stats-photo img{height:106px}',
    '\n #cms-main.cms-report-page.ar-direction-4 .cms-report-part--metrics .core-stats-intro-copy p{font-size:14px;line-height:1.55}',
    '\n #cms-main.cms-report-page.ar-direction-4 .cms-report-part--metrics .ar-metrics{grid-template-columns:1fr 1fr;gap:14px;margin-top:26px}',
    '\n #cms-main.cms-report-page.ar-direction-4 .cms-report-part--metrics .ar-metrics article{padding:17px;min-height:110px}',
    '\n #cms-main.cms-report-page.ar-direction-4 .cms-report-part--country+.cms-report-part--country{margin-top:0}',
    '\n #cms-main.cms-report-page.ar-direction-4 .cms-report-part--give .national-contact-layout{grid-template-columns:minmax(0,1fr);gap:30px}',
    '\n #cms-main.cms-report-page.ar-direction-4 .cms-report-part--give .national-contact-photo img{height:230px;object-position:center 22%}',
    '\n #cms-main.cms-report-page.ar-direction-4 .cms-report-part--give .national-contacts{grid-template-columns:minmax(0,1fr);gap:24px}',
    '\n #cms-main.cms-report-page.ar-direction-4 .cms-report-part--directory .core-faq-list{grid-template-columns:minmax(0,1fr);gap:12px}',
    '\n #cms-main.cms-report-page.ar-direction-4 .cms-report-part--directory details{padding:23px}',
    '\n\n\n}',
    '\n\n@media(max-width:760px){}',
    '\n\n#cms-main.cms-report-page.ar-direction-4 .cms-report-part--cover h1{font-size:54px!important;line-height:1.15;margin:0 0 28px;max-width:540px}',
    '\n#cms-main.cms-report-page.ar-direction-4 .cms-report-part--cover .national-actions a.ar-cover-secondary{background:white;border-color:white;color:#34465f}',
    '\n#cms-main.cms-report-page.ar-direction-4 .cms-report-part--cover .national-report-caption{max-width:480px}',
    '\n#cms-main.cms-report-page.ar-direction-4 .cms-report-part--cover img{object-position:50% 15%}',
    '\n@media(max-width:760px){\n #cms-main.cms-report-page.ar-direction-4 .cms-report-part--cover .national-hero{height:auto;min-height:0;padding:0}',
    '\n #cms-main.cms-report-page.ar-direction-4 .cms-report-part--cover .national-hero-copy{padding:32px 22px;max-width:none;order:1}',
    '\n #cms-main.cms-report-page.ar-direction-4 .cms-report-part--cover h1{font-size:43px!important}',
    '\n #cms-main.cms-report-page.ar-direction-4 .cms-report-part--cover .national-report-caption{max-width:none}',
    '\n #cms-main.cms-report-page.ar-direction-4 .cms-report-part--cover img{position:static;order:2;width:100%;height:auto;aspect-ratio:16/10;object-fit:cover;object-position:50% 20%;z-index:auto}',
    '\n}',
    '\n\n#cms-main.cms-report-page.ar-direction-4 .ar-country-story{border:0;padding-bottom:0}',
    '\n\n#cms-main.cms-report-page.ar-direction-4 .cms-report-part--give .national-contact-layout{grid-template-columns:1.65fr 1fr;gap:60px}',
    '\n#cms-main.cms-report-page.ar-direction-4 .cms-report-part--give .national-contact-copy{grid-column:1;grid-row:1;display:grid;grid-template-columns:1fr 1fr;gap:32px 36px}',
    '\n#cms-main.cms-report-page.ar-direction-4 .cms-report-part--give .national-contacts{grid-column:1;grid-row:1;display:block;margin:0}',
    '\n#cms-main.cms-report-page.ar-direction-4 .cms-report-part--give .national-tile+.national-tile{margin-top:32px}',
    '\n#cms-main.cms-report-page.ar-direction-4 .cms-report-part--give .national-contact-extra{grid-column:2;grid-row:1;margin:0}',
    '\n#cms-main.cms-report-page.ar-direction-4 .cms-report-part--give .national-contact-questions{grid-column:1/-1;grid-row:2;margin:0}',
    '\n#cms-main.cms-report-page.ar-direction-4 .cms-report-part--give .national-contact-photo{grid-column:2;grid-row:1}',
    '\n#cms-main.cms-report-page.ar-direction-4 .cms-report-part--give .national-contact-photo img{height:340px}',
    '\n#cms-main.cms-report-page.ar-direction-4 .cms-report-part--give h3{font:400 17px/1.3 var(--font-heading)!important;margin:0 0 10px}',
    '\n#cms-main.cms-report-page.ar-direction-4 .cms-report-part--closing img{border-radius:0}',
    '\n@media(max-width:760px){\n #cms-main.cms-report-page.ar-direction-4 .cms-report-part--give .national-contact-layout{grid-template-columns:minmax(0,1fr);gap:34px}',
    '\n #cms-main.cms-report-page.ar-direction-4 .cms-report-part--give .national-contact-copy{grid-column:1;grid-row:1;display:block}',
    '\n #cms-main.cms-report-page.ar-direction-4 .cms-report-part--give .national-contact-extra,#cms-main.cms-report-page.ar-direction-4 .cms-report-part--give .national-contact-questions{margin-top:32px}',
    '\n #cms-main.cms-report-page.ar-direction-4 .cms-report-part--give .national-contact-photo{grid-column:1;grid-row:2}',
    '\n #cms-main.cms-report-page.ar-direction-4 .cms-report-part--give .national-contact-photo img{height:230px}',
    '\n #cms-main.cms-report-page.ar-direction-4 .cms-report-part--give p,#cms-main.cms-report-page.ar-direction-4 .cms-report-part--give li{font-size:15px}',
    '\n}',
    '\n#cms-main.cms-report-page.ar-direction-4 .cms-report-part--vision .ar-sector-number{display:inline-block;min-width:20px;margin-right:0}',
    '\n@media(max-width:760px){\n}',
    '\n\n#cms-main.cms-report-page.ar-direction-4 .cms-report-part--mission .core-report-pdf a:after{content:"↓";margin-left:8px}',
    "\n\n#cms-main.cms-report-page .ar-button-external::after{content:'↗'}",
    "\n#cms-main.cms-report-page.ar-direction-4 .cms-report-part--directory .core-faq-open::after{content:' ＋'}",
    "\n\n#cms-main.cms-report-page .cms-report-part--mission .core-report-page a::after{content:'↗';margin-left:9px}",
    '\n#cms-main.cms-report-page .cms-report-part--mission .core-report-page a[href^="#"]::after{content:\'↓\'}',
    '\n\n#cms-main.cms-report-page .ar-leader-photo img{object-position:50% 100%!important}',
    '\n#cms-main.cms-report-page .ar-report-feature:has(>figure[hidden]){grid-template-columns:minmax(0,1fr)}',
    '\n#cms-main.cms-report-page .ar-report-feature:has(>figure[hidden])>.ar-feature-heading,#cms-main.cms-report-page .ar-report-feature:has(>figure[hidden])>.ar-copy{grid-column:1}',
    '\n\n#cms-main.cms-report-page :is(.ar-reading-story,.ar-response-top,.ar-report-feature) .ar-photo img{display:block;width:100%;height:100%;object-fit:inherit}',
    '\n\n#cms-main.cms-report-page.ar-direction-4 .ar-response-story>.ar-story-body{max-width:78ch;margin:38px 0 0}',
    '\n#cms-main.cms-report-page.ar-direction-4 .ar-reading-copy>p,#cms-main.cms-report-page.ar-direction-4 .ar-reading-copy>cms-slot[data-cms-slot=body] p{line-height:1.72}',
    '\n#cms-main.cms-report-page.ar-direction-4 .ar-reading-copy>.ar-photo-note{margin-top:24px;font-size:13px;line-height:1.65;color:inherit}',
    '\n#cms-main.cms-report-page.ar-direction-4 .ar-reading-copy>.ar-photo-note p{font-size:13px;line-height:1.65}',
    '\n#cms-main.cms-report-page.ar-direction-4 .ar-report-feature .ar-stat-grid{grid-template-columns:minmax(0,1fr);margin:28px 0 0}',
    '\n\n#cms-main.cms-report-page.ar-direction-4 .ar-report-feature>.ar-copy>p,#cms-main.cms-report-page.ar-direction-4 .ar-report-feature>.ar-copy>cms-slot[data-cms-slot=body] p{line-height:1.72}',
    '\n#cms-main.cms-report-page.ar-direction-4 .ar-reading-copy>.ar-photo-note p{margin:0}',
    '\n#cms-main.cms-report-page.ar-direction-4 .cms-report-band--disaster>.cms-report-part--country:last-child .ar-reading-story{padding-bottom:0}',
    '\n@media(max-width:760px){#cms-main.cms-report-page.ar-direction-4 .ar-photo-led .ar-photo{height:auto;aspect-ratio:4/3}',
    '}',
    "\n\n/* Native field wrappers use the supplied report's type and disclosure rhythm. */\n#cms-main.cms-report-page.ar-direction-4 .cms-report-part--cover h1{font-variant:normal;line-height:1.15;margin:0}",
    '\n#cms-main.cms-report-page.ar-direction-4 .cms-report-part--cover .national-kicker{font-size:11px;line-height:1.4}',
    '\n#cms-main.cms-report-page.ar-direction-4 .cms-report-part--mission h2{font-variant:normal}',
    '\n#cms-main.cms-report-page.ar-direction-4 .cms-report-part--mission .core-text-image-body p{font-size:17px;line-height:1.72}',
    '\n#cms-main.cms-report-page.ar-direction-4 .cms-report-part--vision .ar-sector-list li{font-size:16px;line-height:1.4}',
    '\n#cms-main.cms-report-page.ar-direction-4 .ar-country-section>.ar-container>.ar-section-title{border-left:3px solid var(--ar-red);padding-left:17px;margin-bottom:28px}',
    '\n#cms-main.cms-report-page.ar-direction-4 .cms-report-part--country:has(.ar-response-story)+.cms-report-part--country{margin-top:60px}',
    '\n#cms-main.cms-report-page.ar-direction-4 .cms-report-part--directory h2{padding:0;margin:0 0 42px;font-variant:normal}',
    '\n@media(max-width:760px){\n #cms-main.cms-report-page.ar-direction-4{font-size:16px;line-height:1.7}',
    '\n #cms-main.cms-report-page.ar-direction-4 .cms-report-part--mission .core>.container{gap:0}',
    '\n #cms-main.cms-report-page.ar-direction-4 .cms-report-part--mission h2{font-size:22px;margin-bottom:20px}',
    '\n #cms-main.cms-report-page.ar-direction-4 .cms-report-part--mission .core-text-image-body h2{margin:36px 0 20px}',
    '\n #cms-main.cms-report-page.ar-direction-4 .cms-report-part--mission .core-text-image-body p{font-size:16px;line-height:1.7}',
    '\n #cms-main.cms-report-page.ar-direction-4 .core-report-actions a{font-size:12px;padding:10px 14px}',
    '\n #cms-main.cms-report-page.ar-direction-4 .cms-report-part--vision .national-tile:is(:first-child,:last-child) h3{font:400 23px/1.25 var(--font-heading)!important;margin-bottom:30px}',
    '\n #cms-main.cms-report-page.ar-direction-4 .cms-report-part--vision .national-tile p,#cms-main.cms-report-page.ar-direction-4 .cms-report-part--vision li{font-size:16px;line-height:1.7}',
    '\n #cms-main.cms-report-page.ar-direction-4 .cms-report-part--vision .ar-sector-list li{font-size:15px;line-height:1.4}',
    '\n #cms-main.cms-report-page.ar-direction-4 .cms-report-part--metrics figcaption{font-size:8px;line-height:1.4}',
    '\n #cms-main.cms-report-page.ar-direction-4 .cms-report-part--metrics .ar-metrics .ar-stat-number{font-size:30px}',
    '\n #cms-main.cms-report-page.ar-direction-4 .cms-report-part--metrics .ar-metrics h3{font-size:11px!important}',
    '\n #cms-main.cms-report-page.ar-direction-4 .ar-reading-copy>p,#cms-main.cms-report-page.ar-direction-4 .ar-reading-copy>cms-slot[data-cms-slot=body] p{line-height:1.7}',
    '\n #cms-main.cms-report-page.ar-direction-4 .cms-report-part--directory h2{margin-bottom:30px}',
    '\n #cms-main.cms-report-page.ar-direction-4 .cms-report-part--directory .core-faq-list{gap:20px}',
    '\n}',
    '\n',
  ].join('') +
  `
/* Giving actions keep the supplied inline button rhythm. */
#cms-main.cms-report-page.ar-direction-4 .cms-report-part--give .national-actions {
 margin-top: 0;
}
#cms-main.cms-report-page.ar-direction-4 .cms-report-part--give .national-actions .cms-button {
 flex: none;
 width: auto;
 font-size: 14px;
 font-weight: 700;
 line-height: 1.35;
 padding: 11px 20px;
}

/* An unselected action cannot become a blank button through report aliases. */
#cms-main.cms-report-page .national-actions a.cms-button:empty {
 display: none !important;
}

/* Optional report photos never leave an empty contact column. */
#cms-main.cms-report-page.ar-direction-4 .national-contact-layout:has(>.national-contact-photo[hidden]) {
 grid-template-columns: minmax(0, 1fr);
}

/* Native sections inherit responsive sizing from the complete report. */
#cms-main.cms-report-page .sawso-report {
 container-name: none;
 container-type: normal;
}

/* Native report fields share the source's prose, quote and giving rhythm. */
#cms-main.cms-report-page.ar-direction-4 {
 --ar-prose-leading: 1.72;
 --ar-phone-prose-leading: 1.7;
 --ar-brief-heading-size: 21px;
 --ar-brief-heading-space: 16px;
 --ar-fact-heading-size: 18px;
 --ar-label-leading: 1.4;
 --ar-quote-size: 19px;
 --ar-quote-leading: 1.6;
 --ar-giving-list-gap: 15px;
 --ar-contact-heading-space: 42px;
 --ar-contact-question-space: 20px;
 --ar-fineprint-leading: 1.5;
 --ar-fineprint-paragraph-space: 20px;
 --ar-fineprint-width: 1000px;
 --ar-fineprint-rule: #b9c9cf;
}
#cms-main.cms-report-page.ar-direction-4 .ar-text-story .ar-brief h3 {
 font-size: var(--ar-brief-heading-size);
 line-height: 1.3;
 margin: 0 0 var(--ar-brief-heading-space);
}
#cms-main.cms-report-page.ar-direction-4 .ar-text-story .ar-brief p {
 line-height: var(--ar-prose-leading);
}
#cms-main.cms-report-page.ar-direction-4 .ar-text-story > .ar-stats-heading {
 font-size: var(--ar-fact-heading-size);
 line-height: 1.3;
 margin: 42px 0 24px;
}
#cms-main.cms-report-page.ar-direction-4 .cms-report-part--fact .ar-feature-heading {
 margin-bottom: 0;
}
#cms-main.cms-report-page.ar-direction-4 .cms-report-part--fact .ar-feature-heading h3 {
 line-height: 1.3;
}
#cms-main.cms-report-page.ar-direction-4 .ar-reading-copy > .ar-eyebrow {
 line-height: var(--ar-label-leading);
}
#cms-main.cms-report-page.ar-direction-4 .ar-photo-note blockquote {
 padding: 20px 22px;
 margin: 24px 0;
 font-size: var(--ar-quote-size);
 line-height: var(--ar-quote-leading);
 border-left-width: 3px;
 border-radius: 0 5px 5px 0;
}
#cms-main.cms-report-page.ar-direction-4 .cms-report-part--country .ar-photo-note blockquote p {
 font: inherit;
 line-height: inherit;
 margin: 0;
}
#cms-main.cms-report-page.ar-direction-4 .cms-report-part--give .national-block-head {
 margin-bottom: var(--ar-contact-heading-space);
}
#cms-main.cms-report-page.ar-direction-4 .cms-report-part--give .national-contact-copy {
 row-gap: 0;
}
#cms-main.cms-report-page.ar-direction-4 .cms-report-part--give .national-contacts > .national-tile + .national-tile h3 {
 margin-bottom: 24px;
}
#cms-main.cms-report-page.ar-direction-4 .cms-report-part--give .national-contact-questions {
 margin-top: var(--ar-contact-question-space);
}
#cms-main.cms-report-page.ar-direction-4 .cms-report-part--give .national-contact-extra li + li {
 margin-top: var(--ar-giving-list-gap);
}
#cms-main.cms-report-page.ar-direction-4 .cms-report-part--give .national-contact-small {
 max-width: var(--ar-fineprint-width);
 border-top: 1px solid var(--ar-fineprint-rule);
 margin-top: 24px;
 padding-top: 20px;
 font-size: 11px;
 line-height: var(--ar-fineprint-leading);
 color: inherit;
}
#cms-main.cms-report-page.ar-direction-4 .cms-report-part--give .national-contact-small p + p {
 margin-top: var(--ar-fineprint-paragraph-space);
}
@media(max-width:760px) {
 #cms-main.cms-report-page.ar-direction-4 {
  --ar-contact-heading-space: 30px;
  --ar-contact-question-space: 50px;
 }
 #cms-main.cms-report-page.ar-direction-4 .cms-report-part--give .national-contact-extra {
  margin-top: 36px;
 }
 #cms-main.cms-report-page.ar-direction-4 .cms-report-part--fact {
  margin: 32px 0;
 }
 #cms-main.cms-report-page.ar-direction-4 .ar-report-feature > .ar-copy > p,
 #cms-main.cms-report-page.ar-direction-4 .ar-report-feature > .ar-copy > cms-slot[data-cms-slot=body] p {
  line-height: var(--ar-phone-prose-leading);
 }
}
`
