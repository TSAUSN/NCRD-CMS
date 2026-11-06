import { describe, expect, it } from 'vitest'
import { compileSection, SANITIZER_POLICY_VERSION } from './compile.ts'
import { CSS_POLICY_VERSION } from './css.ts'
import { renderSection, type ManifestSection } from './render.ts'

function section(hidden: boolean, hiddenAt: string[] = []): ManifestSection {
  const slots = [{ id: 'heading', kind: 'text' as const, label: 'Heading', constraints: {} }]
  return {
    instance: {
      section_def_id: 'example',
      section_def_version: 1,
      hidden,
      hidden_at: hiddenAt,
      values: { heading: 'Unannounced speaker' },
    },
    def: {
      section_def_id: 'example',
      version: 1,
      slug: 'example',
      slots,
      compiled_ast: compileSection({ sourceHtml: '<h2>{{heading}}</h2>', slots }).ast,
      css: '',
      css_policy_version: CSS_POLICY_VERSION,
      sanitizer_policy_version: SANITIZER_POLICY_VERSION,
    },
  }
}

describe('editing hidden sections without exposing them publicly', () => {
  it('keeps hidden content out of public output even when the reveal option is supplied', () => {
    expect(renderSection(section(true), 0)).toBe('')
    expect(renderSection(section(true), 0, { showHiddenSections: true })).toBe('')
    expect(renderSection(section(true), 0, { preview: true })).toBe('')
  })

  it('reveals editable content only with both editor options and preserves instance indices', () => {
    const html = renderSection(section(true), 4, { preview: true, showHiddenSections: true })
    expect(html).toContain('Hidden from visitors')
    expect(html).toContain('data-cms-section="4"')
    expect(html).toContain('data-cms-slot="heading"')
    expect(html).toContain('Unannounced speaker')
  })

  it('preserves device visibility publicly while letting editors work on hidden device variants', () => {
    const fixture = section(false, ['sm', 'md', 'bogus'])
    const live = renderSection(fixture, 0, { showHiddenSections: true })
    expect(live).toContain('cms-hide-sm cms-hide-md')
    expect(live).not.toContain('cms-hidden-notice')
    expect(live).not.toContain('bogus')
    const editor = renderSection(fixture, 0, { preview: true, showHiddenSections: true })
    expect(editor).toContain('Hidden on phones, tablets')
    expect(editor).not.toContain('cms-hide-sm')
    expect(editor).not.toContain('cms-hide-md')
  })

  it('does not change ordinary visible sections', () => {
    expect(renderSection(section(false), 0, { preview: true, showHiddenSections: true })).toBe(
      renderSection(section(false), 0, { preview: true }),
    )
  })
})

it('can show hidden sections in an explicitly private visitor preview without editor instrumentation', () => {
  const html = renderSection(section(true), 0, {
    visitorPreview: true,
    showHiddenSections: true,
    providerEmbeds: false,
  })
  expect(html).toContain('Unannounced speaker')
  expect(html).not.toContain('data-cms-section')
  expect(html).not.toContain('data-cms-slot')
  expect(html).not.toContain('<script')
  expect(renderSection(section(true), 0, { visitorPreview: true })).toBe('')
})

it('emits safe authored anchors without replacing numbered section scopes or leaking unsafe ids', () => {
  const anchored = section(false)
  anchored.instance.values = { heading: 'Meet the team', __cms_anchor: 'our-team' }
  expect(renderSection(anchored, 4)).toContain(
    '<span class="cms-section-anchor" id="our-team" aria-hidden="true"></span><div id="s4"',
  )
  anchored.instance.values.__cms_anchor = 'cms-main'
  expect(renderSection(anchored, 4)).not.toContain('id="cms-main"')
})

it('keeps earlier safe section names as scroll targets without repeating or exposing unsafe names', () => {
  const anchored = section(false)
  anchored.instance.values = {
    heading: '[Heading]',
    __cms_anchor: 'current-name',
    __cms_anchor_aliases: ['earlier-name', 'earlier-name', 'cms-main', 'bad"name'],
  }
  const html = renderSection(anchored, 2)
  expect(html.match(/id="earlier-name"/g)).toHaveLength(1)
  expect(html).toContain('id="current-name"')
  expect(html).not.toContain('id="cms-main"')
  expect(html).not.toContain('bad"name')
})
