import { it, expect } from 'vitest'
import {
  compileSection,
  sectionScopeSelector,
  renderSection,
  CSS_POLICY_VERSION,
  SANITIZER_POLICY_VERSION,
} from './index.ts'
it('formats declared date text while preserving invalid values as escaped text', () => {
  const slots = [
    { id: 'date', kind: 'text' as const, label: 'Published', constraints: { presentation: 'cms-date-long-v1' } },
  ]
  const compiled = compileSection({
    sourceHtml: '<p>{{date}}</p>',
    sourceCss: '',
    slots,
    scopeSelector: sectionScopeSelector('date-display')!,
  })
  expect(compiled.problems).toEqual([])
  const html = (date: string) =>
    renderSection(
      {
        def: {
          section_def_id: 'date',
          version: 1,
          slug: 'date-display',
          compiled_ast: compiled.ast,
          css: compiled.css,
          slots,
          css_policy_version: CSS_POLICY_VERSION,
          sanitizer_policy_version: SANITIZER_POLICY_VERSION,
        },
        instance: { section_def_id: 'date', section_def_version: 1, values: { date } },
      },
      0,
    )
  expect(html('2026-05-29')).toContain('May 29, 2026')
  expect(html('2026-02-31')).toContain('2026-02-31')
  expect(html('<script>')).toContain('&lt;script&gt;')
})
