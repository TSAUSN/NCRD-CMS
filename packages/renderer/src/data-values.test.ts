import { it, expect } from 'vitest'
import { compileSection, renderPage, type SiteShell } from './index.ts'
import type { SlotDef } from '@cms/schema'
const id = '11111111-1111-4111-8111-111111111111',
  slots: SlotDef[] = [
    {
      id: 'stats',
      kind: 'repeat',
      label: 'Numbers',
      constraints: {
        item: {
          unit: 'Number',
          min: 0,
          max: 4,
          fields: [
            { id: 'value', kind: 'text', label: 'Number', constraints: {} },
            { id: 'label', kind: 'text', label: 'Label', constraints: {} },
          ],
        },
      },
    },
  ],
  compiled = compileSection({
    sourceHtml: '<div>{{#stats}}<p>{{value}}</p><h3>{{label}}</h3>{{/stats}}</div>',
    sourceCss: '',
    slots,
  }),
  manifest = {
    page: { id, version_id: id, title: '[Page]', path: '/' },
    meta: {},
    sections: [
      {
        def: {
          section_def_id: id,
          version: 1,
          definition_kind: 'legacy' as const,
          slots,
          compiled_ast: compiled.ast,
          css: compiled.css,
          sanitizer_policy_version: compiled.ast.policyVersion,
          css_policy_version: compiled.ast.cssPolicyVersion,
        },
        instance: {
          section_def_id: id,
          section_def_version: 1,
          values: {
            stats: { items: ['i1'] },
            stats__i1__value: '120',
            stats__i1__label: '[Local label]',
            __cms_data_values: { stats__i1__value: { parts: [{ valueId: id }] } },
          },
        },
      },
    ],
  },
  shell: SiteShell = {
    site: { id, name: '[Site]', slug: 'site' },
    theme: {},
    navigation: [],
    canonical_host: null,
    staging_host: null,
  }
it('updates repeated stats from the supplied site shell while preserving page labels,source print and authored fallback', () => {
  const settings = {
      dataValues: [
        {
          id,
          label: 'Projects',
          value: '152',
          unit: '',
          source: 'Annual report,p.4',
          sourcePageId: null,
          asOf: 'FY2025',
          status: 'matches-report',
          showSource: true,
        },
      ],
    },
    html = renderPage({ manifest, shell: { ...shell, settings }, isStaging: true }).html
  expect(compiled.blocking).toEqual([])
  expect(html).toContain('152')
  expect(html).toContain('[Local label]')
  expect(html).toContain('<small class="cms-data-source">Annual report,p.4 · FY2025</small>')
  expect(renderPage({ manifest, shell, isStaging: true }).html).toContain('<p>120</p>')
  expect(manifest.sections[0]!.instance.values.stats__i1__value).toBe('120')
})
