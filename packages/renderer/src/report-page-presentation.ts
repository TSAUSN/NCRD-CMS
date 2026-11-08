import { reportFoundationCss } from './report-presentation/foundation.ts'
import { reportContentBandsCss } from './report-presentation/content-bands.ts'
import { reportPageLayoutCss } from './report-presentation/page-layout.ts'
import { reportNarrativeLayoutCss } from './report-presentation/narrative-layout.ts'
import { reportNativeSectionsCss } from './report-presentation/native-sections.ts'

// Small report text uses its own ink token; bands and controls keep the approved red.
export const REPORT_TEXT_CSS = '#cms-main .sawso-report,#cms-main.cms-report-page{--ar-red-text:#dc1c2b}'

/** Compose the report skin in cascade order. Native sections take precedence over shared layouts. */
export const REPORT_PAGE_CSS =
  reportFoundationCss + reportContentBandsCss + reportPageLayoutCss + reportNarrativeLayoutCss + reportNativeSectionsCss
