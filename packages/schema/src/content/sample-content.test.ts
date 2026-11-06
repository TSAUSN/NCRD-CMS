import { expect, it } from 'vitest'
import {
  boundSampleFieldNames,
  markSampleValues,
  clearSampleField,
  sampleFieldNames,
  SAMPLE_FIELDS_KEY,
} from './sample-content.ts'
it('persists sample names without treating the marker as content', () => {
  const values = markSampleValues({ heading: 'Hello', body: 'A story' })
  expect(sampleFieldNames(JSON.parse(JSON.stringify(values)))).toEqual(['heading', 'body'])
  expect(sampleFieldNames(clearSampleField(values, 'heading'))).toEqual(['body'])
  expect(clearSampleField(clearSampleField(values, 'heading'), 'body')).toEqual({ heading: 'Hello', body: 'A story' })
})
it('ignores malformed markers and unknown field names', () => {
  expect(
    sampleFieldNames({
      [SAMPLE_FIELDS_KEY]: [null, {}, 'missing', 'heading', 'heading', SAMPLE_FIELDS_KEY],
      heading: 'Hello',
    }),
  ).toEqual(['heading'])
  expect(sampleFieldNames({ [SAMPLE_FIELDS_KEY]: 'heading' })).toEqual([])
})

it('reports declared sample photos and text inside real list envelopes', () => {
  const slots = [{ id: 'stories', constraints: { sampleFlags: { photo: 'photo_is_sample', body: 'body_is_sample' } } }],
    values = {
      stories: {
        kind: 'collection',
        entries: [{ values: { title: '[Story title]', photo_is_sample: true, body_is_sample: true } }],
      },
    }
  expect(boundSampleFieldNames(values, slots)).toEqual(['Lead photo: [Story title]', 'Story text: [Story title]'])
  values.stories.entries[0]!.values.photo_is_sample = false
  values.stories.entries[0]!.values.body_is_sample = false
  expect(boundSampleFieldNames(values, slots)).toEqual([])
  expect(boundSampleFieldNames(values, [{ id: 'stories' }])).toEqual([])
})
