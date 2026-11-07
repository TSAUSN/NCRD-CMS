import { reportTemplateMarkup } from '../report-template.ts'
import { reportLinksMarkup } from '../report-links.ts'
import type { SectionBodyBehavior } from './types.ts'

export const reportTemplate: SectionBodyBehavior = (body, { def, values, options }) => {
  body = reportTemplateMarkup(
      reportLinksMarkup(body, def.slug),
      def.slug,
      values,
      options.annualReportTemplate === true,
    )
  return body
}
