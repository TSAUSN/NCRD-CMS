import { withStoriesCatalog } from '@cms/schema'
import { sawsoStoriesSettings } from './sawso-story-tags.ts'
import { CollectionModel } from '@cms/schema'
import { SAWSO_APPROVED } from './sawso-approved.ts'
export { SAWSO_APPROVED }
export const STORY_SECTORS = [...SAWSO_APPROVED.feed.sectors, { id: 'family-care', label: 'Family Care' }]
export const STORY_REGIONS = SAWSO_APPROVED.feed.regions
export const SAMPLE_STORY_TITLES = new Set([
  'Primary Health Care to Support the Growing Chikankata Community',
  'Reliable Power at Chikankata: When outages put lives at risk',
  'Life in Ukraine, Years into War',
])
export const STORY_SAMPLE_BODY = '<p>[Story text — sample content. Replace with the approved story text.]</p>'
/** Parse only a list of identifiers; never evaluate the source string. */
export function parseStoryTags(raw: unknown): string[] {
  let value = raw
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value.replace(/'([a-z0-9-]+)'/g, (_, id: string) => JSON.stringify(id)))
    } catch {
      throw new Error('Story tags must be a list of identifiers.')
    }
  }
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string' || !/^[a-z][a-z0-9-]*$/.test(item)))
    throw new Error('Story tags must be a list of identifiers.')
  return [...new Set(value as string[])]
}
export const LEGACY_STORIES_MODEL = CollectionModel.parse({
  fields: [
    { key: 'title', type: 'text', label: 'Title', required: true },
    { key: 'summary', type: 'text', label: 'Summary', required: true },
    { key: 'published_date', type: 'date', label: 'Story date', required: false },
    { key: 'tags', type: 'text', label: 'Sectors', required: true, help: 'Sector identifiers separated by commas.' },
    { key: 'region', type: 'select', label: 'Region', required: true, options: STORY_REGIONS.map(region => region.id) },
    { key: 'countries', type: 'text', label: 'Countries', required: false },
    { key: 'body', type: 'richtext', label: 'Story text', required: false },
    { key: 'body_is_sample', type: 'boolean', label: 'Story text is sample content', required: false },
    { key: 'photo', type: 'image', label: 'Lead photo', required: false },
    { key: 'photo_is_sample', type: 'boolean', label: 'Lead photo is sample content', required: false },
    { key: 'old_address', type: 'url', label: 'Old address', required: false },
    { key: 'image_url', type: 'url', label: 'Original image address (data only)', required: false },
    { key: 'story_url', type: 'url', label: 'Read More', required: true },
    { key: 'region_label', type: 'text', label: 'Region label', required: false },
    { key: 'sector_links', type: 'richtext', label: 'Sector links', required: false },
    { key: 'photo_note', type: 'text', label: 'Photo note', required: false },
  ],
  presentation: {
    schemaVersion: 1,
    titleField: 'title',
    subtitleField: 'published_date',
    imageField: 'photo',
    groupField: 'region',
  },
})
export const STORIES_MODEL = withStoriesCatalog(LEGACY_STORIES_MODEL, sawsoStoriesSettings())

export function sawsoStoryRows() {
  return SAWSO_APPROVED.feed.stories.map(story => {
    const tags = parseStoryTags(story.themes)
    const regions = parseStoryTags(story.regions)
    const sample = SAMPLE_STORY_TITLES.has(story.title)
    if (
      tags.some(tag => !STORY_SECTORS.some(sector => sector.id === tag)) ||
      regions.length !== 1 ||
      !STORY_REGIONS.some(region => region.id === regions[0])
    )
      throw new Error('The local story has an unknown sector or region.')
    const old = new URL(story.link)
    if (
      old.origin !== 'https://sawso.org' ||
      !old.pathname.startsWith('/sawso/story/') ||
      !/^https:\/\//.test(story.image) ||
      story.description.length > 200
    )
      throw new Error('Review the local story source before importing it.')
    return {
      id: null,
      stableKey: 'story-' + story.id,
      values: {
        title: story.title,
        summary: story.description,
        published_date: story.publishDate,
        tags: tags.join(','),
        region_label: STORY_REGIONS.find(region => region.id === regions[0])!.label,
        sector_links: tags
          .map(tag => {
            const sector = STORY_SECTORS.find(sector => sector.id === tag)!
            return '<a href="/ways-we-help/' + tag + '">' + sector.label.replace(/&/g, '&amp;') + '</a>'
          })
          .join(' '),
        photo_note: '[Sample photo]',
        region: regions[0]!,
        countries: '',
        body: sample ? STORY_SAMPLE_BODY : '',
        body_is_sample: sample,
        photo: { src: '/cms-samples/r8-landscape.png', alt: '[Story photo] (sample)', decorative: false },
        photo_is_sample: true,
        old_address: story.link,
        image_url: story.image,
        story_url: '/stories/' + old.pathname.split('/').at(-1)!,
      },
    }
  })
}

export function storiesBinding(sector: string | null, limit: 3 | 6 | 9 = 6, excludeStableKey?: string) {
  return {
    readerKey: 'stories',
    selection: {
      mode: 'automatic' as const,
      order: 'newest' as const,
      dateField: 'published_date',
      maxAgeMonths: 13,
      limit,
      ...(sector ? { filter: { field: 'tags', value: sector } } : {}),
      ...(excludeStableKey ? { excludeStableKey } : {}),
    },
  }
}
