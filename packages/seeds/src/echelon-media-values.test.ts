import { it, expect } from 'vitest'
import { withEchelonMedia, echelonChapterPhotos, ECHELON_MEDIA_KEYS } from './echelon-media-values.ts'
const picture = (id: string) => ({
    src: '/media/' + id + '/original',
    alt: '[Described Echelon photo]',
    decorative: false,
    focal: { x: 0.6, y: 0.46 },
  }),
  media = Object.fromEntries(Object.values(ECHELON_MEDIA_KEYS).map(key => [key, picture(key)])),
  sample = { src: '/cms-samples/r8-landscape.png', alt: '[Sample]', decorative: false }
it('keeps original objects, focus and descriptions, uses the right council portraits, and leaves unnamed board faces empty', () => {
  const values = {
      photo: sample,
      cards__i1__portrait: sample,
      cards__i4__portrait: sample,
      cards__i1__photo: '',
      heading: '[Authored words]',
    },
    before = JSON.stringify(values),
    next = withEchelonMedia(values, media, 'core-echelon-leadership')
  expect(next.photo).toEqual(media[ECHELON_MEDIA_KEYS.council])
  expect(next.cards__i1__portrait).toEqual(media[ECHELON_MEDIA_KEYS.portrait_one])
  expect(next.cards__i4__portrait).toEqual(media[ECHELON_MEDIA_KEYS.portrait_four])
  expect(next.cards__i1__photo).toBe('')
  expect(next.heading).toBe('[Authored words]')
  expect(JSON.stringify(values)).toBe(before)
})
it('removes unchosen generic images instead of silently substituting a sample or another site photo', () => {
  const owned = picture('existing'),
    values = { photo: sample, other: owned, blank: '' }
  expect(withEchelonMedia(values, {})).toEqual({ photo: '', other: owned, blank: '' })
  expect(echelonChapterPhotos({})).toBeNull()
  expect(echelonChapterPhotos(media)?.portrait.focal).toEqual({ x: 0.6, y: 0.46 })
})
