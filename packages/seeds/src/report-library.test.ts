import { expect, it } from 'vitest'
import { renderSection, CSS_POLICY_VERSION, SANITIZER_POLICY_VERSION } from '@cms/renderer'
import { repeatItemSpec } from '@cms/schema'
import { compileCoreSection } from './core-library.ts'
import { REPORT_LIBRARY } from './report-library.ts'
it('provides normal reusable report types with content-only fields,native disclosures and local artwork', () => {
  expect(REPORT_LIBRARY).toHaveLength(5)
  for (const entry of REPORT_LIBRARY) {
    const compiled = compileCoreSection(entry)
    expect(compiled.problems).toEqual([])
    expect(compiled.carriesTrustedCode).toBe(false)
    expect(entry.definition.kind).toBe('legacy')
    expect(compiled.slots[0]?.constraints.annualReport).toBe(true)
    const html = renderSection(
      {
        def: {
          section_def_id: 'report',
          version: 1,
          slug: entry.definition.slug,
          slots: compiled.slots,
          compiled_ast: compiled.compiledAst,
          css: compiled.compiledCss,
          css_policy_version: CSS_POLICY_VERSION,
          sanitizer_policy_version: SANITIZER_POLICY_VERSION,
        },
        instance: { section_def_id: 'report', section_def_version: 1, values: entry.samples },
      },
      0,
    )
    if (entry.definition.slug !== 'core-report-country-story') {
      expect(html).toContain('<details')
      expect(html).toContain('<summary')
    }
    expect(html).not.toContain('<script')
    expect(compiled.compiledCss).not.toContain('data:image')
    expect(compiled.compiledCss).not.toContain('fonts.googleapis')
    if (entry.definition.slug !== 'core-report-page-links')
      expect(compiled.compiledCss).toContain('/cms-reports/report-globe-1.svg')
    for (const field of compiled.slots.filter(slot => slot.kind === 'repeat'))
      expect(repeatItemSpec(field)).not.toBeNull()
  }
})
