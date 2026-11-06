import { expect, it } from 'vitest'
import { replaceImageReferences } from './media-replacement-values.ts'
const from = '10000000-0000-4000-8000-000000000001',
  to = '10000000-0000-4000-8000-000000000002'
it('changes governed image placements, markup URLs and logo references without altering unrelated identities or query URLs', () => {
  const before = {
    id: from,
    external: `https://example.test/media/${from}/wide`,
    body: `Identifier ${from}, <img src="/media/${from}/card">`,
    query: `/media/${from}/wide?other=1`,
    photo: { media_id: from, src: `/media/${from}/wide`, alt: 'A placement description', decorative: false },
    logoMediaId: from,
  }
  expect(replaceImageReferences(before, from, to)).toEqual({
    ...before,
    body: `Identifier ${from}, <img src="/media/${to}/wide">`,
    photo: { ...before.photo, variant: 'wide', media_id: to, src: `/media/${to}/wide` },
    logoMediaId: to,
  })
  expect(before.photo.media_id).toBe(from)
})
it('clears only sample markers for changed image fields, preserving unchanged repeated content and unknown values', () => {
  const before = {
    photo: { media_id: from, src: `/media/${from}/wide` },
    name: 'Illustrative heading',
    __cms_sample_fields: ['photo', 'name'],
    cards: [{ photo: { src: `/media/${from}/card`, alt: '' } }],
    empty: null,
  }
  const after = replaceImageReferences(before, from, to) as typeof before
  expect(after.__cms_sample_fields).toEqual(['name'])
  expect(after.cards[0]!.photo.src).toBe(`/media/${to}/wide`)
  expect(after.empty).toBeNull()
})
