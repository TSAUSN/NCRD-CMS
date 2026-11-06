import { describe, expect, it } from 'vitest'
import type { SlotDef } from '@cms/schema'
import { compileSection, upgradeCompiledSection } from './compile.ts'
import { renderSection, type ManifestSection } from './render.ts'

const slot = (kind: SlotDef['kind']): SlotDef[] => [{ id: 'value', kind, label: 'Value', constraints: {} }]
function section(html: string, kind: SlotDef['kind'], value: unknown): ManifestSection {
  const compiled = compileSection({ sourceHtml: html, slots: slot(kind) })
  return {
    def: {
      section_def_id: 'd',
      version: 1,
      slug: 'd',
      compiled_ast: compiled.ast,
      css: compiled.css,
      slots: slot(kind),
    },
    instance: { section_def_id: 'd', section_def_version: 1, values: { value } },
  }
}
const image = `<figure class="frame"><img width="640" style="object-fit:cover" src="{{value}}" alt='{{value}}' role="{{value}}"></figure>`

describe('fixed typed scalar bindings preserve legacy markup', () => {
  it('retains every surrounding image attribute and one reused picker field', () => {
    const compiled = compileSection({ sourceHtml: image, slots: slot('image') })
    expect(compiled.problems).toEqual([])
    expect(compiled.ast.policyVersion).toBe(5)
    expect(upgradeCompiledSection(compiled.ast).current).toBe(true)
    const html = renderSection(
      section(image, 'image', { src: '/media/a/wide', alt: 'Meal service', decorative: false }),
      0,
    )
    expect(html).toContain(
      `<figure class="frame"><img width="640" style="object-fit:cover" src="/media/a/wide" alt='Meal service' role=""></figure>`,
    )
  })
  it('derives decoration and escapes descriptions in both quote styles', () => {
    const value = { src: 'javascript:alert(1)', alt: `'" onerror="alert(1)`, decorative: false }
    const html = renderSection(section(image, 'image', value), 0)
    expect(html).toContain('src="#"')
    expect(html).toContain("alt='&#39;&quot; onerror=&quot;alert(1)'")
    expect(html).not.toContain('javascript:')
    const decorative = renderSection(section(image, 'image', { ...value, decorative: true }), 0)
    expect(decorative).toContain(`alt='' role="presentation"`)
  })
  it('changes a destination without replacing SVG, text, classes or target', () => {
    const source = `<a class="download" href="{{value}}" target="_blank"><svg viewBox="0 0 24 24"><path d="M0 0h1"/></svg><span>Download</span></a>`
    const html = renderSection(section(source, 'link', { url: '/report?a=1&b=2', label: '<img src=x>' }), 0)
    expect(html).toContain(source.replace('{{value}}', '/report?a=1&amp;b=2'))
    expect(html).not.toContain('<img src=x>')
  })
  it('instruments the original image and anchor only in preview', () => {
    for (const [source, kind, value] of [
      [image, 'image', { src: '/a.png', alt: 'A' }],
      ['<div title="<img>"><a href="{{value}}"><svg><path d="M0 0"/></svg>Link</a></div>', 'link', { url: '/a' }],
    ] as const) {
      const manifest = section(source, kind, value)
      const preview = renderSection(manifest, 0, { preview: true })
      expect(preview).toContain(`<${kind === 'image' ? 'img' : 'a'} data-cms-slot="value" data-cms-kind="${kind}"`)
      expect(preview.match(/data-cms-slot="value"/g)).toHaveLength(1)
      expect(preview).not.toContain('src="<span')
      expect(preview).not.toContain('href="<span')
      expect(renderSection(manifest, 0)).not.toContain('data-cms-slot')
    }
  })
  it.each([
    ['image', '<img srcset="{{value}}">'],
    ['image', '<img style="{{value}}">'],
    ['image', '<img title="{{value}}">'],
    ['image', '<img onerror="{{value}}">'],
    ['image', '<img src={{value}}>'],
    ['link', '<button formaction="{{value}}">Go</button>'],
    ['link', '<svg><a xlink:href="{{value}}">Go</a></svg>'],
    ['link', '<a href={{value}}>Go</a>'],
    ['link', '<script></script><a href="{{value}}">Go</a>'],
  ] as const)('refuses %s in unsupported sink %s', (kind, html) => {
    expect(compileSection({ sourceHtml: html, slots: slot(kind) }).blocking.length).toBeGreaterThan(0)
    expect(renderSection(section(html, kind, { src: '/x', url: '/x', alt: 'x' }), 0)).toBe('')
  })
  it('does not reinterpret old invalid or future AST versions as typed bindings', () => {
    for (const version of [1, 4, 6]) {
      const manifest = section(image, 'image', { src: '/x', alt: 'x' })
      manifest.def.compiled_ast.policyVersion = version
      expect(renderSection(manifest, 0)).toBe('')
    }
    expect(compileSection({ sourceHtml: '<p>{{value}}</p>', slots: slot('text') }).ast.policyVersion).toBe(4)
  })
  it('re-derives the attribute instead of trusting a forged src or role claim', () => {
    const manifest = section('<img onerror="{{value}}">', 'image', { src: 'alert(1)', alt: 'x' })
    manifest.def.compiled_ast.nodes = manifest.def.compiled_ast.nodes.map(node =>
      node.kind === 'slot' ? { ...node, context: 'url-attribute', attribute: 'src' } : node,
    )
    expect(renderSection(manifest, 0)).toBe('')
    const role = section('<img style="{{value}}">', 'image', { alt: '', decorative: true })
    role.def.compiled_ast.nodes = role.def.compiled_ast.nodes.map(node =>
      node.kind === 'slot' ? { ...node, context: 'quoted-attribute', attribute: 'role' } : node,
    )
    expect(renderSection(role, 0)).toBe('')
  })
})
