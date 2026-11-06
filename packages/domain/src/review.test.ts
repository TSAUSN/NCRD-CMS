import { describe, expect, it } from 'vitest'
import { reviewStatusLabel, summarizePageReview } from './review.ts'

const section = (id: string, value: string) => ({
  section_def_id: id,
  section_def_version: 1,
  values: { heading: value },
})

describe('review summaries', () => {
  it('names a first publication without pretending there is a previous version to diff', () => {
    expect(
      summarizePageReview({
        submittedSections: [section('hero', 'Hello')],
        submittedMeta: { title: 'Home' },
        liveSections: null,
        liveMeta: null,
      }),
    ).toEqual({
      firstPublication: true,
      submittedSections: 1,
      addedSections: 1,
      removedSections: 0,
      changedSections: 0,
      reordered: false,
      changedMetadata: ['title'],
    })
  })

  it('reports structural, content, and metadata changes conservatively', () => {
    const summary = summarizePageReview({
      submittedSections: [section('prose', 'Rewritten'), section('hero', 'Hello')],
      submittedMeta: { title: 'New', description: '' },
      liveSections: [section('hero', 'Hello'), section('prose', 'Old')],
      liveMeta: { title: 'Old' },
    })
    expect(summary.reordered).toBe(true)
    expect(summary.changedSections).toBe(2)
    expect(summary.changedMetadata).toEqual(['title'])
  })

  it('uses product language for every stored state', () => {
    expect(reviewStatusLabel('open')).toBe('Waiting for review')
    expect(reviewStatusLabel('approved')).toBe('Approved and published')
    expect(reviewStatusLabel('rejected')).toBe('Changes requested')
    expect(reviewStatusLabel('superseded')).toBe('Replaced by newer work')
  })
})
