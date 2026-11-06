import { describe, expect, it } from 'vitest'
import { STORY_REGIONS, STORY_SECTORS } from './sawso-stories.ts'
import { sawsoStoriesSettings } from './sawso-story-tags.ts'
import { suggestStoryTags } from '@cms/schema'
describe('approved SAWSO tag source', () => {
  it('preserves all existing IDs, names both groups and starts with the approved review policy', () => {
    const settings = sawsoStoriesSettings()
    expect(settings.mainTags.map(t => t.id).sort()).toEqual(STORY_SECTORS.map(t => t.id).sort())
    expect(settings.secondaryTags.map(t => t.id).sort()).toEqual(STORY_REGIONS.map(t => t.id).sort())
    expect(settings).toMatchObject({
      mainLabel: 'Project Sectors',
      secondaryLabel: 'Regions',
      publishUnreviewed: true,
      source: 'sawso',
    })
    expect(settings.mainTags.find(t => t.id === 'family-care')?.keywords).toEqual([])
  })
  it('uses approved keyword suggestions and returns independent catalog copies', () => {
    const first = sawsoStoriesSettings(),
      second = sawsoStoriesSettings()
    first.mainTags[0]!.label = 'Changed locally'
    expect(second.mainTags[0]!.label).not.toBe(first.mainTags[0]!.label)
    expect(
      suggestStoryTags(
        { title: 'Hurricane Melissa recovery in Jamaica', summary: 'Students return to school.' },
        second,
      ),
    ).toEqual({ main: ['disaster-relief-recovery', 'education'], secondary: ['latin-america-caribbean'] })
  })
})
