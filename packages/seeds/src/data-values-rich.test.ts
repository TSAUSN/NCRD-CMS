import { it, expect } from 'vitest'
import { renderPage, CSS_POLICY_VERSION, SANITIZER_POLICY_VERSION } from '@cms/renderer'
import { CORE_LIBRARY, compileCoreSection } from './core-library.ts'
it('renders bound rich formatting safely and sends canvas selection to saved-number controls', () => {
  const entry = CORE_LIBRARY.find(row => row.definition.slug === 'core-text-image')!,
    compiled = compileCoreSection(entry),
    id = '00000000-0000-4000-8000-000000000001',
    values = {
      heading: '[Impact]',
      body: '[Fallback]',
      photo: '',
      __cms_data_values: {
        body: {
          format: 'richtext',
          parts: [
            { text: '<p>[Across] <strong>' },
            { valueId: id },
            { text: '</strong></p><p>[Next paragraph]</p><script>bad()</script>' },
          ],
        },
      },
    },
    manifest = {
      page: { id: 'page', version_id: 'version', title: '[Impact]', path: '/' },
      meta: {},
      sections: [
        {
          def: {
            section_def_id: 'def',
            version: 1,
            slug: 'core-text-image',
            slots: compiled.slots,
            compiled_ast: compiled.compiledAst,
            css: compiled.compiledCss,
            css_policy_version: CSS_POLICY_VERSION,
            sanitizer_policy_version: SANITIZER_POLICY_VERSION,
          },
          instance: { section_def_id: 'def', section_def_version: 1, values },
        },
      ],
    },
    shell = {
      site: { id: 'site', name: '[Site]', slug: 'site' },
      theme: {},
      navigation: [],
      canonical_host: null,
      staging_host: null,
      settings: {
        dataValues: [
          {
            id,
            label: 'Projects',
            value: '<img src=x onerror=bad>152',
            unit: '',
            source: '[Report, p. 4]',
            sourcePageId: null,
            asOf: '2025',
            status: 'matches-report',
            showSource: false,
          },
        ],
      },
    }
  const html = renderPage({ manifest, shell, isStaging: true }).html
  expect(html).toContain('<p>[Across] <strong>&lt;img src=x onerror=bad&gt;152</strong></p><p>[Next paragraph]</p>')
  expect(html).not.toContain('<script>bad()')
  expect(html).not.toContain('<img src=x')
  const preview = renderPage({ manifest, shell, isStaging: true, options: { preview: true } }).html
  expect(preview).toContain('data-cms-slot="body" data-cms-kind="saved-number"')
  expect(preview).not.toContain('data-cms-slot="body" data-cms-kind="richtext"')
})
