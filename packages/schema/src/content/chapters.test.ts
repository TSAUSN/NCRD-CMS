import { it, expect } from 'vitest'
import { ChapterSetup, chapterUsesLinkedPage } from './chapters.ts'
const input = {
  name: '[Chapter]',
  destination: 'division',
  pageId: null,
  externalUrl: 'https://division.example.test/echelon',
  contact: { name: '[Name]', role: '[Division] web team', email: 'chapter@example.test' },
  sections: {},
}
it('division pages are distinct HTTPS destinations with required private contact and no implicit local page', () => {
  const parsed = ChapterSetup.parse(input)
  expect(parsed.destination).toBe('division')
  expect(parsed.pageId).toBeNull()
  expect(chapterUsesLinkedPage(parsed.destination)).toBe(true)
  expect(ChapterSetup.safeParse({ ...input, externalUrl: null }).success).toBe(false)
  expect(ChapterSetup.safeParse({ ...input, externalUrl: 'http://division.example.test/' }).success).toBe(false)
  expect(
    ChapterSetup.safeParse({ ...input, externalUrl: 'https://person:secret@division.example.test/' }).success,
  ).toBe(false)
  expect(ChapterSetup.safeParse({ ...input, contact: { ...input.contact, email: '' } }).success).toBe(false)
})

it('keeps national-only sections and Story feeds out of chapter choices and generates only visible named jumps', async () => {
  const { chapterAllowsSection, chapterJumpValues } = await import('./chapters.ts')
  for (const slug of [
    'core-stories',
    'core-newsroom',
    'core-story-world',
    'core-story-split',
    'core-story-detail',
    'core-echelon-directory',
    'core-echelon-leadership',
  ])
    expect(chapterAllowsSection({ slug })).toBe(false)
  expect(chapterAllowsSection({ slug: 'custom', slots: [{ constraints: { storyFeed: true } }] })).toBe(false)
  expect(chapterAllowsSection({ slug: 'custom', slots: [{ constraints: { echelonAudience: 'national' } }] })).toBe(
    false,
  )
  expect(chapterAllowsSection({ slug: 'core-echelon-events' })).toBe(true)
  const values = chapterJumpValues([
    { values: { __cms_chapter_part: 'paragraph', __cms_anchor: 'our-chapter' } },
    { hidden: true, values: { __cms_chapter_part: 'events', __cms_anchor: 'events' } },
    { values: { __cms_chapter_part: 'board', __cms_anchor: 'cms-invalid' } },
    { values: { __cms_chapter_part: 'form', __cms_anchor: 'contact-us' } },
  ])
  expect(values.links).toEqual({ items: ['i1', 'i6'] })
  expect(values.links__i1__action).toEqual({ label: 'Who we are', url: '#our-chapter' })
  expect(values.links__i6__action).toEqual({ label: 'Join us', url: '#contact-us' })
  expect(JSON.stringify(values)).not.toContain('#events')
})

it('keeps chapter events out of the national section map', async () => {
  const { echelonNationalAllowsSection, isReviewedNationalComposition } = await import('./chapters.ts')
  expect(echelonNationalAllowsSection({ slug: 'core-echelon-events' })).toBe(false)
  expect(echelonNationalAllowsSection({ category: 'Events' })).toBe(false)
  expect(echelonNationalAllowsSection({ slots: [{ constraints: { echelonAudience: 'chapter' } }] })).toBe(false)
  expect(echelonNationalAllowsSection({ slug: 'core-echelon-stories' })).toBe(true)
  expect(isReviewedNationalComposition([{ values: { __cms_echelon_template: 'national' } }])).toBe(true)
})

for (const address of ['', 'not a URL', 'https://']) {
  it('reports an invalid chapter address without throwing: ' + JSON.stringify(address), () => {
    expect(() => ChapterSetup.safeParse({ ...input, externalUrl: address })).not.toThrow()
    expect(ChapterSetup.safeParse({ ...input, externalUrl: address }).success).toBe(false)
  })
}
