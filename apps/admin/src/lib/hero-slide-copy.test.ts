import { it, expect } from 'vitest'
import { appendCopiedHeroSlide } from './hero-slide-copy.ts'
const slot = {
  id: 'slides',
  kind: 'repeat',
  label: 'Slides',
  constraints: {
    item: {
      unit: 'Slide',
      min: 0,
      max: 2,
      fields: [
        { id: 'title', kind: 'text', label: 'Title' },
        { id: 'enabled', kind: 'text', label: 'On' },
        { id: 'photo', kind: 'image', label: 'Photo' },
      ],
      samples: [{ title: '[Sample]', enabled: 'on' }],
    },
  },
}
it('appends a deep copy switched off, preserves destination words and sample provenance, and refuses capacity', () => {
  const source = {
      slides: { items: ['i1'] },
      slides__i1__title: '[Copy]',
      slides__i1__enabled: 'on',
      slides__i1__photo: { src: '/image', alt: '[Description]' },
      __cms_sample_fields: ['slides__i1__photo'],
      unrelated: 'Keep out',
    },
    target = { heading: '[Destination]', slides: { items: ['i1'] }, slides__i1__title: '[Existing]' },
    copy = appendCopiedHeroSlide(source, slot, 'i1', target, slot)!
  expect(copy.key).toBe('i2')
  expect(copy.values.heading).toBe('[Destination]')
  expect(copy.values.slides__i1__title).toBe('[Existing]')
  expect(copy.values.slides__i2__title).toBe('[Copy]')
  expect(copy.values.slides__i2__enabled).toBe('off')
  expect(copy.values.__cms_sample_fields).toEqual(['slides__i2__photo'])
  expect(copy.values.unrelated).toBeUndefined()
  expect(copy.values.slides__i2__photo).not.toBe(source.slides__i1__photo)
  expect(appendCopiedHeroSlide(source, slot, 'i1', copy.values, slot)).toBeNull()
  expect(appendCopiedHeroSlide(source, slot, 'missing', target, slot)).toBeNull()
  expect(target.slides.items).toEqual(['i1'])
})
