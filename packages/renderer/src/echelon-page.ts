import type { ManifestSection } from './render.ts'
/** An explicit composed template opts in. Individual library sections and brought-in sites do not. */
export function isEchelonTemplatePage(sections: readonly ManifestSection[]): boolean {
  return (
    sections[0]?.def.slug === 'core-echelon-hero' &&
    ['chapter', 'national'].includes(String(sections[0]?.instance.values?.__cms_echelon_template))
  )
}
export const ECHELON_PAGE_CSS = `
#cms-main.cms-echelon-page{box-sizing:border-box;max-width:1320px;width:calc(100% - 40px);margin:32px auto 64px;padding:32px 96px 40px;background:white;border-radius:24px;isolation:isolate;color:#002056;font:400 16px/1.5 var(--font-body)}
#cms-main.cms-echelon-page>.cms-section{margin:0;background:transparent;border-radius:0;box-shadow:none;border:0}
#cms-main.cms-echelon-page .echelon-template{border-radius:0}
#cms-main.cms-echelon-page h1,#cms-main.cms-echelon-page h2,#cms-main.cms-echelon-page h3{font-variant:normal;text-transform:none}
#cms-main.cms-echelon-page .echelon-opener{margin-bottom:14px}
#cms-main.cms-echelon-page .echelon-opener h1{font-size:clamp(32px,3.1vw,46px);line-height:1.2;letter-spacing:-.015em}
#cms-main.cms-echelon-page .echelon-opener h2{font-size:clamp(23px,2.15vw,30px);line-height:1.2;letter-spacing:0}
@media(min-width:992px) and (max-width:1199px){#cms-main.cms-echelon-page{max-width:960px}}
@media(max-width:991px){#cms-main.cms-echelon-page{width:calc(100% - 32px);padding:24px 32px}}
@media(max-width:767px){#cms-main.cms-echelon-page{width:calc(100% - 16px);margin:16px auto 32px;padding:12px;border-radius:16px}#cms-main.cms-echelon-page .echelon-opener h1{font-size:34px}#cms-main.cms-echelon-page .echelon-opener h2{font-size:25px}}
`
