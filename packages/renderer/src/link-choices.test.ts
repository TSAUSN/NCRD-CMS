import { describe, expect, it } from 'vitest'
import { compileSection } from './compile.ts'
import { renderSection } from './render.ts'
import { renderStructuredField } from './structured.ts'

// An editor's per-link choices (SPEC §6.4, V1 reference 08): open in a new tab
// and nofollow. A new tab always carries noopener; absent choices change
// nothing, so existing links stay byte-identical.
function legacy(value: unknown) {
  const slots = [{ id: 'action', label: 'Action', kind: 'link' as const, constraints: {} }]
  const compiled = compileSection({
    sourceHtml: '<p>{{action}}</p>',
    sourceCss: '',
    slots,
    scopeSelector: '.cms-section--choices',
  })
  return renderSection(
    {
      def: { section_def_id: 'choices', version: 1, slug: 'choices', compiled_ast: compiled.ast, slots },
      instance: { section_def_id: 'choices', section_def_version: 1, values: { action: value } },
    } as Parameters<typeof renderSection>[0],
    0,
  )
}

describe('per-link choices', () => {
  it('opens a whole link field in a new tab and marks it nofollow only when chosen', () => {
    expect(legacy({ url: '/help', label: 'Help' })).toContain('<p><a href="/help">Help</a></p>')
    expect(legacy({ url: 'https://example.org/x', label: 'Out' })).toContain(
      '<a href="https://example.org/x" rel="noopener">Out</a>',
    )
    expect(legacy({ url: '/guide.pdf', label: 'Guide', newTab: true })).toContain(
      '<a href="/guide.pdf" rel="noopener" target="_blank">Guide</a>',
    )
    expect(legacy({ url: '/partner', label: 'Partner', nofollow: true })).toContain(
      '<a href="/partner" rel="nofollow">Partner</a>',
    )
    expect(legacy({ url: 'https://example.org', label: 'Both', newTab: true, nofollow: true })).toContain(
      '<a href="https://example.org" rel="nofollow noopener" target="_blank">Both</a>',
    )
    // Only a real true counts.
    expect(legacy({ url: '/help', label: 'Help', newTab: 'true', nofollow: 1 })).toContain('<a href="/help">Help</a>')
  })

  it('adds the choices to a structured link, while a target its definition declares wins', () => {
    const link = { type: 'link', field: 'action' } as const
    expect(renderStructuredField(link, { action: { label: 'Help', url: '/help' } })).toBe('<a href="/help">Help</a>')
    expect(
      renderStructuredField(link, { action: { label: 'Guide', url: '/guide.pdf', newTab: true, nofollow: true } }),
    ).toBe('<a href="/guide.pdf" rel="nofollow noopener" target="_blank">Guide</a>')
    expect(
      renderStructuredField(
        { ...link, staticAttributes: { target: '_self', rel: ['author'] } },
        { action: { label: 'Me', url: '/me', newTab: true, nofollow: true } },
      ),
    ).toBe('<a href="/me" rel="author nofollow" target="_self">Me</a>')
  })
})
