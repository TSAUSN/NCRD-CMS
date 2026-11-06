import { expect, it } from 'vitest'
import { sourceSampleValues, sectionStartingValues } from './source-samples.ts'
import type { SlotDef } from './sections.ts'
const slot = (id: string, kind: SlotDef['kind'], sourceSample: unknown): SlotDef => ({
  id,
  kind,
  label: id,
  constraints: { sourceSample },
})
it('copies supported sample values without hidden metadata or binding data', () => {
  const image = { src: '/media/id/large', alt: 'Photo', decorative: false, private: 'not copied' }
  const result = sourceSampleValues([
    slot('heading', 'text', 'Original heading'),
    slot('image', 'image', image),
    slot('items', 'repeat', { collection_id: 'private' }),
    slot('action', 'link', { url: '/', label: 'Home', private: 'not copied' }),
  ])
  expect(result).toEqual({
    heading: 'Original heading',
    image: { src: '/media/id/large', alt: 'Photo', decorative: false },
    action: { url: '/', label: 'Home' },
  })
  expect(result.image).not.toBe(image)
})
it('does not reinterpret a sample when the author changes its field kind', () => {
  expect(
    sourceSampleValues([
      slot('body', 'image', 'Old text'),
      slot('link', 'text', { url: '/', label: 'Home' }),
      slot('huge', 'text', 'x'.repeat(100001)),
    ]),
  ).toEqual({})
})

it('gives older library fields visible starting content without changing stored sample parsing', () => {
  const fields = [
    slot('heading', 'text', undefined),
    slot('body', 'richtext', undefined),
    slot('image', 'image', undefined),
    slot('action', 'button', undefined),
  ]
  expect(sourceSampleValues(fields)).toEqual({})
  expect(sectionStartingValues(fields)).toEqual({
    heading: 'A shared purpose. A stronger community.',
    body: '<p>Every community has people ready to make a difference. Share the story behind your work and invite people to take the next step.</p>',
    image: {
      src: '/cms-samples/r8-landscape.png',
      alt: 'Original illustration of a welcoming community building',
      decorative: false,
    },
    action: { url: '/', label: 'Find out more' },
  })
})

it('retains supported boolean link settings while excluding arbitrary link metadata', () => {
  expect(
    sourceSampleValues([
      slot('council', 'link', {
        url: '/council',
        label: 'Council',
        newTab: true,
        nofollow: false,
        private: 'excluded',
      }),
      slot('action', 'button', { url: '/', label: 'Home', newTab: 'true', nofollow: 1 }),
    ]),
  ).toEqual({
    council: { url: '/council', label: 'Council', newTab: true, nofollow: false },
    action: { url: '/', label: 'Home' },
  })
})
