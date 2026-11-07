import { reportStoryMarkup } from '../report-story.ts'
import { reportFinancialMarkup } from '../report-financial.ts'
import type { SectionBodyBehavior } from './types.ts'

export const reportContent: SectionBodyBehavior = (body, { def, values, options }) => {
  body = reportStoryMarkup(
      reportFinancialMarkup(body, def.slug, values),
      def.slug,
      values,
      options.annualReportTemplate === true,
    )
  return body
}
