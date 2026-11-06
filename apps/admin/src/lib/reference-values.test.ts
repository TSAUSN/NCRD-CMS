import { describe, expect, it } from 'vitest'
import { referenceValues } from './reference-values.ts'

// What the V1 importer stores beside an imported section's fields.
const FONT = { asset_id: '58c8cac6-b0be-4e6b-ab86-7590154c2e86' }
const PHOTO = { media_id: '7a9932e3-ca0f-4f48-a8d8-1899d11882e6', variant: 'original' }

describe('reference values beside a section’s fields', () => {
  it('keeps media and site-asset references that no field owns, as copies', () => {
    const values = { heading: 'Echelon', 'v1-media-0': PHOTO, 'v1-asset-0': FONT }
    const kept = referenceValues(values, [{ id: 'heading' }])
    expect(kept).toEqual({ 'v1-media-0': PHOTO, 'v1-asset-0': FONT })
    expect(kept['v1-asset-0']).not.toBe(FONT)
  })

  it('leaves field values to the field mapping, even when one looks like a reference', () => {
    expect(referenceValues({ photo: PHOTO, 'v1-asset-0': FONT }, [{ id: 'photo' }, { id: 'v1-asset-0' }])).toEqual({})
  })

  it('keeps nothing that is more than a reference', () => {
    expect(
      referenceValues(
        {
          text: 'words',
          list: [FONT],
          image: { ...PHOTO, alt: 'A room' },
          extra: { asset_id: FONT.asset_id, label: 'x' },
          numeric: { media_id: 7 },
          empty: {},
          nothing: null,
        },
        [],
      ),
    ).toEqual({})
  })
})
