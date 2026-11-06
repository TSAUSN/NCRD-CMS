import { describe, expect, it } from 'vitest'
import { compileSection, sectionScopeSelector, type SectionDefView } from '@cms/renderer'
import type { SlotDef } from '@cms/schema'
import { renderDefinitionPreview } from './definition-preview-render.ts'
import type { SitePreview } from './site-preview.ts'

const id = '55555555-5555-4555-8555-555555555555'
const pageId = '22222222-2222-4222-8222-222222222222'
const slots: SlotDef[] = [
  { id: 'heading', kind: 'text', label: 'Sample heading', constraints: {} },
  { id: 'menu', kind: 'navigation', label: 'Menu', constraints: {} },
]
function definition(): SectionDefView & { slots: SlotDef[]; structured_doc: null } {
  const compiled = compileSection({
    sourceHtml: '<div><h2>{{heading}}</h2><nav>{{menu}}</nav></div>',
    sourceCss: 'h2{color:var(--color-primary)}',
    slots,
    scopeSelector: sectionScopeSelector('preview-band')!,
  })
  expect(compiled.blocking).toEqual([])
  return {
    section_def_id: id,
    version: 1,
    slug: 'preview-band',
    compiled_ast: compiled.ast,
    css: compiled.css,
    css_policy_version: compiled.ast.cssPolicyVersion,
    sanitizer_policy_version: compiled.ast.policyVersion,
    slots,
    structured_doc: null,
  }
}
const preview = (): SitePreview => ({
  shell: {
    site: { id: 'test-site', name: 'Brand A', slug: 'brand-a' },
    theme: { colors: { primary: '#0055aa' } },
    navigation: [{ label: 'Saved draft destination', visible: true, target: { type: 'page', page_id: pageId } }],
    canonical_host: null,
    staging_host: null,
  },
  navigationPaths: { [pageId]: '/saved-target' },
})

describe('definition preview uses actual component placement', () => {
  it('keeps a page component in main and preserves site theme tokens', () => {
    const html = renderDefinitionPreview({ definition: definition(), name: 'Example', preview: preview() })
    expect(html).toContain('--color-primary:#0055aa')
    expect(html.slice(html.indexOf('<main'), html.indexOf('</main>'))).toContain('Sample heading')
    expect(html).not.toContain('<script')
    expect(html).not.toContain('<header')
    expect(html).not.toContain('<footer')
    expect(html).not.toContain('Skip to content')
  })
  for (const placement of ['header', 'footer'] as const) {
    it(`renders an authored ${placement} in the frame and fills its real site menu`, () => {
      const context = preview(),
        original = structuredClone(context)
      const html = renderDefinitionPreview({ definition: definition(), name: 'Example', placement, preview: context })
      const start = html.indexOf(`<${placement} class="cms-frame`)
      const frame = html.slice(start, html.indexOf(`</${placement}>`, start))
      expect(start).toBeGreaterThan(-1)
      expect(frame).toContain('Sample heading')
      expect(frame).toContain('<a href="/saved-target">Saved draft destination</a>')
      expect(html.slice(html.indexOf('<main'), html.indexOf('</main>'))).not.toContain('Sample heading')
      expect(context).toEqual(original)
    })
  }
  it('uses the selected brand rather than hard-coded sample branding', () => {
    const context = preview()
    context.shell.theme.colors!.primary = '#884422'
    const html = renderDefinitionPreview({ definition: definition(), name: 'Example', preview: context })
    expect(html).toContain('--color-primary:#884422')
    expect(html).not.toContain('--color-primary:#0055aa')
  })
  it.each(['page', 'header', 'footer'] as const)(
    'includes the selected site registered fonts in a %s preview',
    placement => {
      const context = preview()
      const assetId = '99999999-9999-4999-8999-999999999999'
      context.fonts = [{ assetId, fontKey: 'trajan-regular' }]
      const html = renderDefinitionPreview({ definition: definition(), name: 'Example', placement, preview: context })
      expect(html).toContain(`@font-face{font-family:'Trajan Pro 3';src:url('/assets/${assetId}')`)
    },
  )
})
