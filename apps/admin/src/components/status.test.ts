import { describe, it, expect } from 'vitest'
import { pageStatus, siteStatus } from './status.tsx'
describe('revision 8 honest status', () => {
  it('distinguishes live, pending, never-published and archived pages', () => {
    expect(pageStatus({ published_version_id: 'live', draft_version_id: 'draft' })).toBe('Live · changes not published')
    expect(pageStatus({ published_version_id: 'same', draft_version_id: 'same' })).toBe('Live')
    expect(pageStatus({ published_version_id: 'live', draft_version_id: null })).toBe('Live')
    expect(pageStatus({ published_version_id: null, draft_version_id: 'draft' })).toBe('Draft')
    expect(pageStatus({ published_version_id: 'live', status: 'archived' })).toBe('Archived')
  })
  it('preserves scheduled and submitted precedence without calling them live', () => {
    expect(pageStatus({ published_version_id: 'live', status: 'scheduled' })).toBe('Scheduled')
    expect(pageStatus({ published_version_id: 'live', status: 'submitted' })).toBe('In review')
  })
  it('uses the same page-change counts on site cards', () => {
    expect(siteStatus({ status: 'live', published_count: '3', changed_count: '1' })).toBe(
      'Live · changes not published',
    )
    expect(siteStatus({ status: 'live', published_count: '3', changed_count: '0' })).toBe('Live')
    expect(siteStatus({ status: 'in_progress', published_count: '0', changed_count: '2' })).toBe('Draft')
    expect(siteStatus({ status: 'archived', published_count: '3', changed_count: '1' })).toBe('Archived')
  })
})
