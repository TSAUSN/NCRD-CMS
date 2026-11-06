import { expect, it } from 'vitest'
import { carrySampleMarkers } from './sample-carry.ts'
it('preserves only retained examples, including mapped and newly introduced examples', () => {
  expect(
    carrySampleMarkers(
      { title: 'Example', removed: 'Old', __cms_sample_fields: ['title', 'removed'] },
      { title: 'Example', photo: 'New', body: 'Real' },
      {},
      ['photo'],
    ),
  ).toEqual({ title: 'Example', photo: 'New', body: 'Real', __cms_sample_fields: ['title', 'photo'] })
  expect(carrySampleMarkers({ title: 'Real' }, { renamed: 'Real' }, { renamed: 'title' })).toEqual({ renamed: 'Real' })
})
