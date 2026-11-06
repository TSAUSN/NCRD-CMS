import { expect, it } from 'vitest'
import { compileSection } from './compile.ts'
import { renderSection } from './render.ts'
import { renderStructuredField } from './structured.ts'
const image = { src: '/cms-samples/r8-landscape.png', alt: 'Geometric sample', decorative: false }
function legacy(value: unknown, source = '<section>{{photo}}</section>') {
  const slots = [{ id: 'photo', label: 'Photo', kind: 'image' as const, constraints: {} }]
  const compiled = compileSection({ sourceHtml: source, slots, sourceCss: '', scopeSelector: '.cms-section--focus' })
  return renderSection(
    {
      def: { section_def_id: 'focus', version: 1, slug: 'focus', compiled_ast: compiled.ast, slots },
      instance: { section_def_id: 'focus', section_def_version: 1, values: { photo: value } },
    },
    0,
  )
}
it('adds only an explicit numeric focus to native legacy and structured images, preserving absent and automatic output', () => {
  expect(legacy(image)).toContain('<img src="/cms-samples/r8-landscape.png" alt="Geometric sample">')
  expect(legacy({ ...image, focal: null })).toBe(legacy(image))
  expect(legacy({ ...image, focal: { x: 0.75, y: 0.2 } })).toContain('style="object-position:75% 20%"')
  const node = {
    type: 'image' as const,
    field: 'photo',
    staticAttributes: { width: 400, height: 300, class: ['photo'] },
  }
  expect(renderStructuredField(node, { photo: image })).toBe(
    '<img src="/cms-samples/r8-landscape.png" alt="Geometric sample" class="photo" width="400" height="300">',
  )
  expect(renderStructuredField(node, { photo: { ...image, focal: { x: 0, y: 1 } } })).toContain(
    'width="400" height="300" style="object-position:0% 100%"',
  )
  expect(renderStructuredField(node, { photo: { ...image, decorative: true, focal: { x: 0.5, y: 0.5 } } })).toContain(
    'alt="" role="presentation" class="photo" width="400" height="300" style="object-position:50% 50%"',
  )
})
it('refuses malformed focus without changing trusted original attributes or introducing arbitrary CSS', () => {
  for (const focal of [
    { x: '0; background:url(https://evil.test)', y: 0 },
    { x: 2, y: 0 },
    { x: null, y: 0.5 },
    { x: 0.5, y: Infinity },
    [],
  ]) {
    expect(legacy({ ...image, focal })).toBe(legacy(image))
    expect(renderStructuredField({ type: 'image', field: 'photo' }, { photo: { ...image, focal } })).toBe(
      renderStructuredField({ type: 'image', field: 'photo' }, { photo: image }),
    )
  }
  const source = '<img class="swiper-slide photo" data-original="yes" src="{{photo}}" alt="{{photo}}">'
  expect(legacy(image, source)).toBe(legacy({ ...image, focal: { x: 0.2, y: 0.8 } }, source))
})
