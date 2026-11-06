/** Shared report assembly. All copy and Media choices come from the caller. */
import { PageContent, REPORT_PARTS, REPORT_BANDS, type ReportPart, type SectionInstance } from '@cms/schema'
import { CORE_LIBRARY, compileCoreSection } from './core-library.ts'
import type { CorePageDefinition } from './core-templates.ts'
export type ReportSectionInput = {
  part: ReportPart
  band: (typeof REPORT_BANDS)[number]
  values: Record<string, unknown>
}
export function annualReportTemplate(
  definitions: readonly Pick<CorePageDefinition, 'id' | 'version' | 'slug' | 'name'>[],
  parts: readonly ReportSectionInput[],
): SectionInstance[] {
  if (parts[0]?.part !== 'cover' || parts.filter(row => row.part === 'cover').length !== 1)
    throw new Error('A report starts with one cover.')
  return PageContent.parse(
    parts.map(row => {
      const slug = REPORT_PARTS[row.part]
      if (!slug || !REPORT_BANDS.includes(row.band)) throw new Error('Choose a shared report section and band.')
      const def = definitions.find(item => item.slug === slug),
        entry = CORE_LIBRARY.find(item => item.definition.slug === slug)
      if (!def || !entry) throw new Error('Install the shared report sections first.')
      const empty = Object.fromEntries(
        compileCoreSection(entry).slots.map(slot => [
          slot.id,
          slot.kind === 'repeat' ? { items: [] } : ['link', 'button'].includes(slot.kind) ? { url: '', label: '' } : '',
        ]),
      )
      return {
        section_def_id: def.id,
        section_def_version: def.version,
        label: def.name,
        hidden: false,
        hidden_at: [],
        values: {
          ...empty,
          ...row.values,
          __cms_report_template: 'annual',
          __cms_report_part: row.part,
          __cms_report_band: row.band,
        },
      }
    }),
  )
}
