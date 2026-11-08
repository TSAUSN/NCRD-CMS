import { repeatItemKeys, repeatItemSlotId, type FieldLike } from './repeat-items.ts'
import { sampleFieldNames, SAMPLE_FIELDS_KEY } from './sample-content.ts'
export const HERO_SLIDE_FIELDS = [
  'title',
  'intro',
  'photo',
  'primary',
  'secondary',
  'enabled',
  'starts_at',
  'ends_at',
] as const
export function isHeroSlides(slot: FieldLike): boolean {
  return slot.kind === 'repeat' && slot.constraints?.heroSlides === true
}
/** Upgrade the former three numbered slides without replacing a single content value. */
export function migrateHeroSlides(values: Record<string, unknown>): Record<string, unknown> {
  if (values.slides && typeof values.slides === 'object' && 'items' in values.slides) return structuredClone(values)
  const next = { ...values }
  const marked = sampleFieldNames(values)
  const mapping = new Map<string, string>()
  const keys: string[] = []
  for (let n = 1; n <= 3; n++) {
    if (!['title', 'intro', 'photo', 'primary', 'secondary'].some(field => Object.hasOwn(values, field + n))) continue
    const key = 'i' + n
    keys.push(key)
    for (const field of ['title', 'intro', 'photo', 'primary', 'secondary']) {
      const old = field + n
      const name = repeatItemSlotId('slides', key, field)
      if (Object.hasOwn(values, old)) {
        next[name] = structuredClone(values[old])
        mapping.set(old, name)
      }
      delete next[old]
    }
    next[repeatItemSlotId('slides', key, 'enabled')] = 'on'
    next[repeatItemSlotId('slides', key, 'starts_at')] = ''
    next[repeatItemSlotId('slides', key, 'ends_at')] = ''
  }
  next.slides = { items: keys }
  const migrated = marked.map(field => mapping.get(field) ?? field)
  if (migrated.length) next[SAMPLE_FIELDS_KEY] = migrated
  else delete next[SAMPLE_FIELDS_KEY]
  return next
}
export const heroSlideTime = (value: unknown): number | null => {
  if (value == null || value === '') return null
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)
  )
    return NaN
  const parts = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/.exec(value)!
  const year = Number(parts[1])
  const month = Number(parts[2])
  const day = Number(parts[3])
  const calendar = new Date(Date.UTC(year, month - 1, day))
  if (
    calendar.getUTCFullYear() !== year ||
    calendar.getUTCMonth() !== month - 1 ||
    calendar.getUTCDate() !== day ||
    Number(parts[4]) > 23 ||
    Number(parts[5]) > 59 ||
    Number(parts[6] ?? 0) > 59
  )
    return NaN
  return Date.parse(value)
}
export function heroSlideDateProblem(values: Record<string, unknown>, repeat: string, key: string): string | null {
  const start = heroSlideTime(values[repeatItemSlotId(repeat, key, 'starts_at')])
  const end = heroSlideTime(values[repeatItemSlotId(repeat, key, 'ends_at')])
  if ((start !== null && !Number.isFinite(start)) || (end !== null && !Number.isFinite(end)))
    return 'Choose a valid start and end date, or leave the dates empty.'
  if (start !== null && end !== null && end <= start) return 'The end must be after the start.'
  return null
}
/** A new image-led slide cannot accidentally publish as an empty placeholder. */
export function heroSlideContentProblem(values: Record<string, unknown>, repeat: string, key: string): string | null {
  if (
    typeof values[repeatItemSlotId(repeat, key, 'title')] !== 'string' ||
    !String(values[repeatItemSlotId(repeat, key, 'title')]).trim()
  )
    return 'Add a title before keeping or publishing this slide.'
  const photo = values[repeatItemSlotId(repeat, key, 'photo')] as {
    src?: unknown
    media_id?: unknown
    alt?: unknown
    decorative?: unknown
  } | null
  if (
    !photo ||
    typeof photo !== 'object' ||
    !((typeof photo.src === 'string' && photo.src.trim()) || (typeof photo.media_id === 'string' && photo.media_id))
  )
    return 'Choose a photo before keeping or publishing this slide.'
  if (photo.decorative !== true && (typeof photo.alt !== 'string' || !photo.alt.trim()))
    return 'Describe the photo, or mark it as decorative.'
  return heroSlideDateProblem(values, repeat, key)
}
export function activeHeroSlideKeys(values: Record<string, unknown>, repeat = 'slides', now = Date.now()): string[] {
  return repeatItemKeys(values[repeat]).filter(key => {
    if (values[repeatItemSlotId(repeat, key, 'enabled')] === 'off' || heroSlideDateProblem(values, repeat, key))
      return false
    const start = heroSlideTime(values[repeatItemSlotId(repeat, key, 'starts_at')])
    const end = heroSlideTime(values[repeatItemSlotId(repeat, key, 'ends_at')])
    return (start === null || start <= now) && (end === null || end > now)
  })
}

/** Presentation choices are definition-owned and bounded; unknown input uses defaults. */
export function heroSlidePresentation(values: Record<string, unknown>, repeat: string, key: string) {
  const field = (id: string) => values[repeatItemSlotId(repeat, key, id)]
  const choose = <T extends string>(id: string, allowed: readonly T[], fallback: T): T =>
    allowed.includes(field(id) as T) ? (field(id) as T) : fallback
  const visible = (id: string) => {
    const link = field(id) as { label?: unknown; url?: unknown } | null
    return (
      field(id + '_visible') === 'on' ||
      (field(id + '_visible') !== 'off' &&
        Boolean(link && String(link.label ?? '').trim() && String(link.url ?? '').trim()))
    )
  }
  const phone = field('phone_photo') as { src?: unknown; media_id?: unknown } | null
  return {
    position: choose('position', ['left', 'center', 'right'] as const, 'left'),
    shade: choose('shade', ['blue', 'black', 'white', 'none'] as const, 'blue'),
    phone: field('phone_photo_enabled') === 'on' && Boolean(phone && (phone.src || phone.media_id)),
    main: visible('primary'),
    second: visible('secondary'),
    mainColor: choose('primary_color', ['red', 'white', 'outline'] as const, 'red'),
    secondColor: choose('secondary_color', ['red', 'white', 'outline'] as const, 'white'),
  }
}
export function heroSlideParityProblem(
  values: Record<string, unknown>,
  repeat: string,
  key: string,
  publishedIntro?: unknown,
): string | null {
  const field = (id: string) => values[repeatItemSlotId(repeat, key, id)]
  if (String(field('title') ?? '').length > 100) return 'Keep the slide title to 100 characters.'
  if (String(field('intro') ?? '').length > 200 && field('intro') !== publishedIntro)
    return 'Keep the slide introduction to 200 characters.'
  const presentation = heroSlidePresentation(values, repeat, key)
  for (const [id, label, visible] of [
    ['primary', 'main', presentation.main],
    ['secondary', 'second', presentation.second],
  ] as const) {
    const link = field(id) as { label?: unknown; url?: unknown } | null
    if (!visible) continue
    if (!link || !String(link.label ?? '').trim() || !String(link.url ?? '').trim())
      return 'Add the ' + label + ' button text and destination,or switch it off.'
    if (String(link.label ?? '').length > 20) return 'Keep the ' + label + ' button text to 20 characters.'
  }
  if (field('phone_photo_enabled') === 'on') {
    const photo = field('phone_photo') as {
      src?: unknown
      media_id?: unknown
      alt?: unknown
      decorative?: unknown
    } | null
    if (!photo || !(photo.src || photo.media_id))
      return 'Choose a phone photo, or switch off the different picture on phones.'
    if (photo.decorative !== true && !(typeof photo.alt === 'string' && photo.alt.trim()))
      return 'Describe the phone photo, or mark it as decorative.'
  }
  return null
}
