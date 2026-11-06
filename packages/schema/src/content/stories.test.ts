import { describe, expect, it } from 'vitest'
import { CollectionModel } from './collections.ts'
import { createStoriesModel, withStoriesCatalog } from './stories-model.ts'
import {
  StoriesSettings,
  emptyStoriesSettings,
  removeStoryTag,
  resuggestStoryTags,
  storyAllowedInFeeds,
  storyMatchesTags,
  storyTagIds,
  toggleStoryTag,
} from './stories.ts'
const settings = StoriesSettings.parse({
  ...emptyStoriesSettings(),
  mainTags: [
    { id: 'education', label: 'Education', keywords: ['school', 'clean water', 'C++'] },
    { id: 'health', label: 'Health', keywords: ['water'] },
  ],
  secondaryTags: [
    { id: 'africa', label: 'Africa', keywords: ['congo'], areas: ['africa'] },
    { id: 'asia', label: 'Asia', keywords: ['nepal'], areas: ['asia'] },
  ],
})
describe('site-owned Stories catalog', () => {
  it('allows date-less drafts through an explicit catalog upgrade without changing other fields', () => {
    const model = createStoriesModel(settings),
      date = model.fields.find(f => f.key === 'published_date')!
    expect(date.required).toBe(false)
    const legacy = {
        ...model,
        fields: model.fields.map(f => (f.key === 'published_date' ? { ...f, label: 'Published', required: true } : f)),
      },
      upgraded = withStoriesCatalog(legacy, settings)
    expect(upgraded).toEqual(model)
  })
  it('allows empty catalogs for any site while keeping the model closed', () => {
    expect(emptyStoriesSettings().publishUnreviewed).toBe(true)
    const model = {
      fields: [{ key: 'title', label: 'Title', type: 'text', required: true }],
      presentation: {
        schemaVersion: 1,
        titleField: 'title',
        subtitleField: null,
        imageField: null,
        groupField: null,
        stories: settings,
      },
    }
    expect(CollectionModel.safeParse(model).success).toBe(true)
    for (const invalid of [
      { ...settings, surprise: true },
      { ...settings, mainTags: [settings.mainTags[0], settings.mainTags[0]] },
      { ...settings, secondaryTags: [{ ...settings.secondaryTags[0], areas: ['a-country'] }] },
      { ...settings, mainTags: [{ ...settings.mainTags[0], keywords: ['water', ' WATER '] }] },
    ])
      expect(StoriesSettings.safeParse(invalid).success).toBe(false)
  })
  it('keeps renamed IDs and multiple secondary tags, including legacy single-region rows', () => {
    const renamed = { ...settings, mainTags: settings.mainTags.map(t => ({ ...t, label: 'Renamed ' + t.label })) }
    const record = { title: 'Story', tags: 'education', region: 'africa', body: 'Keep this text' }
    const toggled = toggleStoryTag(record, 'secondary', 'asia', renamed)
    expect(storyTagIds(toggled, 'secondary')).toEqual(['africa', 'asia'])
    expect(toggled).toMatchObject({ region: 'africa', tags: 'education', body: record.body, reviewed: true })
    expect(storyMatchesTags(toggled, ['education', 'health'], ['asia'])).toBe(true)
    expect(storyMatchesTags(toggled, ['health'], ['asia'])).toBe(false)
    expect(storyMatchesTags(toggled, [], [])).toBe(true)
    expect(() => toggleStoryTag(record, 'main', 'deleted', settings)).toThrow('no longer available')
  })
  it('moves/removes only the deleted tag without changing story text or other groups', () => {
    const first = {
      tags: 'education,health',
      region: 'africa',
      regions: 'africa,asia',
      reviewed: false,
      body: 'Reviewed body',
    }
    const moved = removeStoryTag(settings, 'secondary', 'africa', 'asia', [first])
    expect(moved.settings.secondaryTags.map(t => t.id)).toEqual(['asia'])
    expect(moved.stories[0]).toEqual({ ...first, region: 'asia', regions: 'asia' })
    expect(removeStoryTag(settings, 'main', 'education', null, [first]).stories[0]).toEqual({
      ...first,
      tags: 'health',
    })
    expect(() => removeStoryTag(settings, 'main', 'education', 'asia', [first])).toThrow('same group')
    expect(first.regions).toBe('africa,asia')
  })
  it('suggests whole words/phrases and literal punctuation, never overwriting reviewed tags', () => {
    const source = {
      title: 'SCHOOL in Congo',
      summary: 'Clean water; C++ lessons in Nepal.',
      tags: 'health',
      region: 'africa',
    }
    expect(resuggestStoryTags(source, settings)).toMatchObject({ tags: 'education,health', regions: 'africa,asia' })
    expect(resuggestStoryTags({ ...source, title: 'schooling congolese', summary: '' }, settings)).toMatchObject({
      tags: '',
      regions: '',
    })
    const reviewed = { ...source, reviewed: true }
    expect(resuggestStoryTags(reviewed, settings)).toBe(reviewed)
    expect(resuggestStoryTags({ title: 'C++', summary: '' }, settings).tags).toBe('education')
  })
  it('applies source, hidden and unreviewed policies independently', () => {
    expect(storyAllowedInFeeds({}, settings)).toBe(true)
    expect(storyAllowedInFeeds({}, { ...settings, publishUnreviewed: false })).toBe(false)
    expect(storyAllowedInFeeds({ reviewed: true }, { ...settings, publishUnreviewed: false })).toBe(true)
    for (const values of [
      { hidden: true, reviewed: true },
      { in_feed: false, reviewed: true },
    ])
      expect(storyAllowedInFeeds(values, settings)).toBe(false)
  })
})
