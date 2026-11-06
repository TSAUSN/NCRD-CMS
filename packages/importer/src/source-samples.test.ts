import { describe, expect, it } from 'vitest'
import { sourceSampleValues } from '@cms/schema'
import { withSourceSamples } from './source-samples.ts'

describe('starting content for an imported definition', () => {
  const slots = [
    { id: 'title', kind: 'text' as const, label: 'Hero title', constraints: {} },
    { id: 'lede', kind: 'richtext' as const, label: 'Hero lede', constraints: { inline: true } },
    { id: 'photo', kind: 'image' as const, label: 'Hero photo', constraints: {} },
    { id: 'more', kind: 'link' as const, label: 'More · destination', constraints: { destinationOnly: true } },
    { id: 'empty', kind: 'text' as const, label: 'Empty', constraints: {} },
  ]
  const values = {
    title: 'Echelon Symposium',
    lede: 'Lead <em>well</em>',
    more: { url: '/#agenda' },
    empty: '  ',
    photo: {
      src: '/media/9cb8478b-1790-4826-a79f-946ad9d46805/original',
      alt: 'Hall',
      decorative: false,
      media_id: '9cb8478b-1790-4826-a79f-946ad9d46805',
      variant: 'original',
    },
  }

  it('keeps each field’s source value as its sample, alongside its other constraints', () => {
    const sampled = withSourceSamples(slots, values)
    expect(sampled.map(slot => slot.constraints)).toEqual([
      { sourceSample: 'Echelon Symposium' },
      { inline: true, sourceSample: 'Lead <em>well</em>' },
      { sourceSample: { src: '/media/9cb8478b-1790-4826-a79f-946ad9d46805/original', alt: 'Hall', decorative: false } },
      { destinationOnly: true, sourceSample: { url: '/#agenda', label: '' } },
      {},
    ])
    // Exactly what an inserted section and a library card read back.
    expect(sourceSampleValues(sampled)).toEqual({
      title: 'Echelon Symposium',
      lede: 'Lead <em>well</em>',
      more: { url: '/#agenda', label: '' },
      photo: { src: '/media/9cb8478b-1790-4826-a79f-946ad9d46805/original', alt: 'Hall', decorative: false },
    })
    // The slots passed in are not changed.
    expect(slots[0]!.constraints).toEqual({})
  })
})
