import { describe, it, expect } from 'vitest'
import { recoverStoryDraft, chooseStoryDraft } from './story-draft-recovery.ts'
import type { StoryEditInput } from './stories-edit.ts'
const base: StoryEditInput = {
  title: 'Title',
  summary: 'Summary',
  body: '<p>Body</p>',
  body_is_sample: false,
  tags: ['health'],
  region: 'africa',
  regions: ['africa'],
  countries: 'Zambia',
  published_date: '2026-10-31',
}
describe('Story draft recovery', () => {
  it('keeps independent changes and leaves all inputs untouched', () => {
    const mine = { ...base, body: '<p>My words</p>' },
      saved = { ...base, countries: 'Kenya' },
      before = JSON.stringify([base, mine, saved]),
      result = recoverStoryDraft(base, mine, saved)
    expect(result.conflicts).toEqual([])
    expect(result.merged).toEqual({ ...mine, countries: 'Kenya' })
    expect(JSON.stringify([base, mine, saved])).toBe(before)
  })
  it('requires an explicit choice when the same field changed', () => {
    const mine = { ...base, title: 'Mine' },
      saved = { ...base, title: 'Saved' },
      result = recoverStoryDraft(base, mine, saved)
    expect(result.conflicts).toEqual(['title'])
    expect(chooseStoryDraft(result, saved, {})).toBeNull()
    expect(chooseStoryDraft(result, saved, { title: 'mine' })?.title).toBe('Mine')
    expect(chooseStoryDraft(result, saved, { title: 'saved' })?.title).toBe('Saved')
  })
  it('does not create a conflict when both edits agree', () => {
    const changed = { ...base, title: 'Same' }
    expect(recoverStoryDraft(base, changed, changed).conflicts).toEqual([])
  })
  it('keeps related region ids together', () => {
    const mine = { ...base, regions: ['asia'] },
      saved = { ...base, region: 'europe', regions: ['europe'] },
      result = recoverStoryDraft(base, mine, saved)
    expect(result.conflicts).toEqual(['regions'])
    expect(chooseStoryDraft(result, saved, { regions: 'saved' })).toMatchObject({
      region: 'europe',
      regions: ['europe'],
    })
  })
  it('treats photo selection, description and focus as one choice', () => {
    const mine = { ...base, photo: { id: 'a', description: 'Mine', focus: null } },
      saved = { ...base, photo: { id: 'b', description: 'Saved', focus: { x: 0, y: 1 } } },
      result = recoverStoryDraft(base, mine, saved)
    expect(result.conflicts).toEqual(['photo'])
    expect(chooseStoryDraft(result, saved, { photo: 'saved' })?.photo).toEqual(saved.photo)
  })
  it('retains body and sample marker together', () => {
    const mine = { ...base, body: 'Mine' },
      saved = { ...base, body_is_sample: true },
      result = recoverStoryDraft(base, mine, saved)
    expect(result.conflicts).toEqual(['body'])
    expect(chooseStoryDraft(result, saved, { body: 'saved' })).toMatchObject({ body: base.body, body_is_sample: true })
  })
})
