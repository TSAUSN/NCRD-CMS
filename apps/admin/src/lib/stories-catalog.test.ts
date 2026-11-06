import { describe, expect, it } from 'vitest'
import { emptyStoriesSettings } from '@cms/schema'
import { LEGACY_STORIES_MODEL as STORIES_MODEL } from '@cms/seeds/sawso-stories'
import { storiesCatalog, withStoriesCatalog } from './stories-catalog.ts'
import { newStoryTagId } from './stories-tags.ts'
describe('Stories catalog upgrade', () => {
  it('preserves the legacy catalog on copies while respecting an explicit empty per-site setup', () => {
    expect(storiesCatalog(STORIES_MODEL, 'copied-site').mainLabel).toBe('Project Sectors')
    const own = withStoriesCatalog(STORIES_MODEL, emptyStoriesSettings())
    expect(storiesCatalog(own, 'sawso').mainTags).toEqual([])
    expect(own.fields.find(f => f.key === 'region')).toMatchObject({ type: 'text', required: false })
    expect(STORIES_MODEL.fields.find(f => f.key === 'region')?.type).toBe('select')
    expect(newStoryTagId('Fifty years & more', ['fifty-years-and-more', 'fifty-years-and-more-2'])).toBe(
      'fifty-years-and-more-3',
    )
  })
})
