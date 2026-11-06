import { it, expect } from 'vitest'
import { storyDraftFingerprint } from './story-draft-request.ts'
import type { NewStoryInput } from './stories-create.ts'
const input: NewStoryInput = {
  title: '[Story]',
  summary: '[Description]',
  tags: ['food', 'homes'],
  region: 'east',
  published_date: '',
  photoId: '11111111-1111-4111-8111-111111111111',
  photoAlt: '[Photo description]',
  body: '<p>[Body]</p>',
}
it('retries the same authored intention across harmless normalization but distinguishes changed words, dates or photo choices', () => {
  const original = storyDraftFingerprint(input)
  expect(original).toMatch(/^[0-9a-f]{64}$/)
  expect(
    storyDraftFingerprint({
      ...input,
      title: ' ' + input.title + ' ',
      tags: ['homes', 'food', 'food'],
      regions: ['east'],
    }),
  ).toBe(original)
  for (const next of [
    { title: '[Other]' },
    { summary: '[Other]' },
    { published_date: '2026-11-04' },
    { countries: '[Country]' },
    { body: '<p>[Other]</p>' },
    { photoAlt: '[Other]' },
    { photoFocus: { x: 0.2, y: 0.8 } },
  ])
    expect(storyDraftFingerprint({ ...input, ...next })).not.toBe(original)
})
it('rejects malformed or oversized creation fields before hashing them', () => {
  for (const next of [
    { tags: [{}] },
    { regions: [1] },
    { body: 'a'.repeat(100001) },
    { photoFocus: { x: 2, y: 0.5 } },
    { countries: 'a'.repeat(301) },
  ])
    expect(() => storyDraftFingerprint({ ...input, ...next } as NewStoryInput)).toThrow()
})
