import { describe, expect, it } from 'vitest'
import { editorialPosture } from './editorial-posture.ts'

describe('editorialPosture', () => {
  it('names a page that visitors have never received', () => {
    expect(editorialPosture({ draft_version_id: 'draft-1', published_version_id: null })).toEqual({
      detail: 'Draft',
      hasUnpublishedChanges: true,
    })
  })

  it('does not let a Published chip imply that newer saved work is live', () => {
    expect(editorialPosture({ draft_version_id: 'draft-2', published_version_id: 'live-1' })).toEqual({
      detail: 'Live · changes not published',
      hasUnpublishedChanges: true,
    })
  })

  it('calls the live version current only when the immutable ids agree', () => {
    expect(editorialPosture({ draft_version_id: 'same', published_version_id: 'same' })).toEqual({
      detail: 'Live',
      hasUnpublishedChanges: false,
    })
  })
})
