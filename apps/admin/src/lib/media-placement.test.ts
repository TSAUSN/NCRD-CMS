import { describe, expect, it } from 'vitest'
import { matchesMediaPlacement, type MediaAsset } from './media-library.ts'

const id = '003d0878-46d7-4494-a1e6-c34abe94f420'
const asset = {
  id,
  deliveryUrl: `/media/${id}/wide`,
  variants: { original: true, thumbnail: true, card: false, wide: true },
} as MediaAsset

describe('recognizing a governed image placement', () => {
  it('recognizes available variants with and without an explicit media id', () => {
    for (const variant of ['original', 'thumbnail', 'wide']) {
      expect(matchesMediaPlacement(asset, { media_id: id, src: `/media/${id}/${variant}` })).toBe(true)
      expect(matchesMediaPlacement(asset, { src: `/media/${id}/${variant}` })).toBe(true)
    }
  })
  it('does not legitimize a mismatched identity, missing rendition or arbitrary URL', () => {
    for (const src of [
      `/media/${id}/card`,
      `/media/${id}/original?other=1`,
      `https://foreign.test/media/${id}/original`,
      '/media/other/original',
    ]) {
      expect(matchesMediaPlacement(asset, { media_id: id, src })).toBe(false)
    }
    expect(matchesMediaPlacement(asset, { media_id: 'foreign', src: asset.deliveryUrl! })).toBe(false)
    expect(matchesMediaPlacement(asset, {})).toBe(false)
  })
})
