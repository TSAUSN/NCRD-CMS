/** Map approved local Media into section defaults; never fetch or borrow another site's images. */
export type EchelonImage = { src: string; alt: string; decorative: boolean; focal: { x: number; y: number } }
export type EchelonMediaValues = Record<string, EchelonImage>
export const ECHELON_MEDIA_KEYS = {
  logo: '29da4661-6650-4e92-9acb-e7cad910f457',
  photo: 'c68f1b9f-f643-4474-8f3b-6a092d209dac',
  portrait: '0ade5055-083b-4fb1-84af-9fef21c5ec3a',
  photo_two: 'c68f1b9f-f643-4474-8f3b-6a092d209dac',
  photo_three: 'd7f83b1f-3cc5-43d1-9e5d-eb6c3b86db45',
  story_one: 'd7ce8468-b3b0-46ab-b972-5a3fa76a2cbc',
  story_two: '0fe94d80-2cd2-4306-a0cc-e80080f82dcf',
  story_three: '0ade5055-083b-4fb1-84af-9fef21c5ec3a',
  council: '6358d5a0-2f42-4b65-a357-c22f19b10398',
  portrait_one: '35c79a2f-0704-4ef3-96f4-2def53591d2f',
  portrait_two: '13bc5cd7-5594-4abd-99b9-a8b166b28bbc',
  portrait_three: 'ffc14c3f-e372-47bf-b8d0-d36cc9c3feb6',
  portrait_four: '0d5da98a-b281-4073-827c-aac994602e13',
} as const
/** Empty values stay empty, especially unnamed board portraits. Only sample pictures change. */
export function withEchelonMedia(
  values: Record<string, unknown>,
  media: EchelonMediaValues,
  slug = '',
): Record<string, unknown> {
  const next = structuredClone(values)
  for (const [key, value] of Object.entries(next)) {
    if (
      !value ||
      typeof value !== 'object' ||
      Array.isArray(value) ||
      typeof (value as { src?: unknown }).src !== 'string' ||
      !(value as { src: string }).src.startsWith('/cms-samples/')
    )
      continue
    let role =
      key === 'logo'
        ? 'logo'
        : key === 'portrait'
          ? 'portrait'
          : key === 'photo_two'
            ? 'photo_two'
            : key === 'photo_three'
              ? 'photo_three'
              : 'photo'
    if (slug === 'core-echelon-leadership') {
      const match = key.match(/^cards__i([1-4])__portrait$/)
      role = match
        ? ['portrait_one', 'portrait_two', 'portrait_three', 'portrait_four'][Number(match[1]) - 1]!
        : 'council'
    }
    if (slug === 'core-echelon-stories') {
      const match = key.match(/^cards__i([1-3])__photo$/)
      if (match) role = ['story_one', 'story_two', 'story_three'][Number(match[1]) - 1]!
    }
    next[key] = media[ECHELON_MEDIA_KEYS[role as keyof typeof ECHELON_MEDIA_KEYS]] ?? ''
  }
  return next
}
export function echelonChapterPhotos(media: EchelonMediaValues) {
  const chosen = Object.fromEntries(
    (['logo', 'photo', 'portrait', 'photo_two', 'photo_three'] as const).map(key => [
      key,
      media[ECHELON_MEDIA_KEYS[key]],
    ]),
  )
  return Object.values(chosen).every(Boolean)
    ? (chosen as Record<'logo' | 'photo' | 'portrait' | 'photo_two' | 'photo_three', EchelonImage>)
    : null
}
