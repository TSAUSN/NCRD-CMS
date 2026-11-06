import { it, expect } from 'vitest'
import { parseCollectionEntryValues } from '@cms/schema'
import { parseStoryTags, sawsoStoryRows, STORIES_MODEL, STORY_SECTORS, SAWSO_APPROVED } from './sawso-stories.ts'
it('imports all approved local stories losslessly with safe tags and explicitly sample media/text', () => {
  expect(parseStoryTags("['health', 'education']")).toEqual(['health', 'education'])
  expect(parseStoryTags(['health', 'education'])).toEqual(['health', 'education'])
  expect(() => parseStoryTags("__import__('os')")).toThrow()
  expect(() => parseStoryTags([null])).toThrow()
  const stories = sawsoStoryRows()
  expect(stories).toHaveLength(34)
  expect(new Set(stories.map(s => s.stableKey)).size).toBe(34)
  expect(STORY_SECTORS.map(s => s.id)).toContain('family-care')
  expect(stories.filter(s => s.values.body)).toHaveLength(3)
  for (const [index, story] of stories.entries()) {
    expect(parseCollectionEntryValues(STORIES_MODEL.fields, story.values).ok).toBe(true)
    expect(story.values.title).toBe(SAWSO_APPROVED.feed.stories[index]!.title)
    expect(story.values.summary).toBe(SAWSO_APPROVED.feed.stories[index]!.description)
    expect(story.values.old_address).toBe(SAWSO_APPROVED.feed.stories[index]!.link)
    expect(story.values.image_url).toBe(SAWSO_APPROVED.feed.stories[index]!.image)
    expect(story.values.photo.src).toBe('/cms-samples/r8-landscape.png')
    expect(story.values.photo_is_sample).toBe(true)
    if (story.values.body) expect(story.values.body).toContain('[Story text — sample content.')
  }
})
