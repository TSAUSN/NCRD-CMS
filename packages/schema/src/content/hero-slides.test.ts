import { it, expect } from 'vitest'
import { migrateHeroSlides, activeHeroSlideKeys, heroSlideDateProblem, heroSlideContentProblem } from './hero-slides.ts'
it('migrates all three exact slide values and sample references without numbered leftovers', () => {
  const old: Record<string, unknown> = { heading: '[Page]', __cms_sample_fields: ['photo2'] }
  for (let n = 1; n <= 3; n++) {
    old['title' + n] = '[Title ' + n + ']'
    old['intro' + n] = '[Description ' + n + ']'
    old['photo' + n] = { media_id: '[Media ' + n + ']', focal: { x: 0.2, y: 0.7 } }
    old['primary' + n] = { label: '[Button ' + n + ']', url: '/story-' + n }
    old['secondary' + n] = { label: '[Other ' + n + ']', url: 'https://example.test/' + n }
  }
  const migrated = migrateHeroSlides(old)
  expect(migrated.slides).toEqual({ items: ['i1', 'i2', 'i3'] })
  for (let n = 1; n <= 3; n++)
    for (const field of ['title', 'intro', 'photo', 'primary', 'secondary']) {
      expect(migrated['slides__i' + n + '__' + field]).toEqual(old[field + n])
      expect(migrated).not.toHaveProperty(field + n)
    }
  expect(migrated.__cms_sample_fields).toEqual(['slides__i2__photo'])
  expect(migrateHeroSlides(migrated)).toEqual(migrated)
  expect(old.title1).toBe('[Title 1]')
})
it('shows only enabled slides inside their valid date window, including precise boundaries', () => {
  const values = {
    slides: { items: ['i1', 'i2', 'i3', 'i4'] },
    slides__i2__enabled: 'off',
    slides__i3__starts_at: '2026-11-01T09:00:00.000Z',
    slides__i3__ends_at: '2026-11-02T09:00:00.000Z',
    slides__i4__starts_at: 'invalid',
  }
  expect(activeHeroSlideKeys(values, 'slides', Date.parse('2026-11-01T08:59:59Z'))).toEqual(['i1'])
  expect(activeHeroSlideKeys(values, 'slides', Date.parse('2026-11-01T09:00:00Z'))).toEqual(['i1', 'i3'])
  expect(activeHeroSlideKeys(values, 'slides', Date.parse('2026-11-02T09:00:00Z'))).toEqual(['i1'])
  expect(
    heroSlideDateProblem(
      { slides__i1__starts_at: '2026-11-01T10:00:00Z', slides__i1__ends_at: '2026-11-01T09:00:00Z' },
      'slides',
      'i1',
    ),
  ).toContain('end must be after')
})

it('requires a meaningful title, picked photo and description before a slide is ready', () => {
  const values: Record<string, unknown> = {}
  expect(heroSlideContentProblem(values, 'slides', 'i1')).toContain('Add a title')
  values.slides__i1__title = '[Heading]'
  expect(heroSlideContentProblem(values, 'slides', 'i1')).toContain('Choose a photo')
  values.slides__i1__photo = { src: '/cms-samples/r8-landscape.png', alt: '' }
  expect(heroSlideContentProblem(values, 'slides', 'i1')).toContain('Describe the photo')
  values.slides__i1__photo = { src: '/cms-samples/r8-landscape.png', alt: '[Description]' }
  expect(heroSlideContentProblem(values, 'slides', 'i1')).toBeNull()
})

it('does not silently remove active slides after twelve', () => {
  const keys = Array.from({ length: 14 }, (_, i) => 'i' + (i + 1))
  expect(activeHeroSlideKeys({ slides: { items: keys } })).toEqual(keys)
})

it('bounds the new hero fields and requires only buttons and phone photos switched on', async () => {
  const { heroSlideParityProblem, heroSlidePresentation } = await import('./hero-slides.ts'),
    v: Record<string, unknown> = { slides__i1__title: 'Title', slides__i1__intro: 'Intro' }
  expect(heroSlidePresentation(v, 'slides', 'i1').main).toBe(false)
  expect(heroSlideParityProblem(v, 'slides', 'i1')).toBeNull()
  v.slides__i1__title = 'x'.repeat(101)
  expect(heroSlideParityProblem(v, 'slides', 'i1')).toContain('100')
  v.slides__i1__title = 'Title'
  v.slides__i1__primary_visible = 'on'
  expect(heroSlideParityProblem(v, 'slides', 'i1')).toContain('button text and destination')
  v.slides__i1__primary = { label: 'x'.repeat(21), url: '/' }
  expect(heroSlideParityProblem(v, 'slides', 'i1')).toContain('20')
  v.slides__i1__primary_visible = 'off'
  v.slides__i1__phone_photo_enabled = 'on'
  expect(heroSlideParityProblem(v, 'slides', 'i1')).toContain('phone photo')
  v.slides__i1__phone_photo = { src: '/photo', alt: 'Description' }
  expect(heroSlideParityProblem(v, 'slides', 'i1')).toBeNull()
})

it('keeps an existing published long introduction exactly but refuses a newly changed overlong version', async () => {
  const { heroSlideParityProblem } = await import('./hero-slides.ts'),
    intro = 'x'.repeat(230),
    values = { slides__i1__intro: intro }
  expect(heroSlideParityProblem(values, 'slides', 'i1', intro)).toBeNull()
  expect(heroSlideParityProblem({ ...values, slides__i1__intro: intro + 'y' }, 'slides', 'i1', intro)).toContain('200')
  expect(heroSlideParityProblem(values, 'slides', 'i1')).toContain('200')
})
