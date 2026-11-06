import { CollectionModel, StoriesSettings, emptyStoriesSettings } from '@cms/schema'
import { sawsoStoriesSettings } from '@cms/seeds/sawso-story-tags'

export function storiesCatalog(model: CollectionModel, slug: string): StoriesSettings {
  const legacyRegion = model.fields.find(f => f.key === 'region'),
    sawso = sawsoStoriesSettings()
  const legacySawso =
    legacyRegion?.type === 'select' &&
    legacyRegion.options.length === sawso.secondaryTags.length &&
    sawso.secondaryTags.every(t => legacyRegion.options.includes(t.id))
  return model.presentation.stories ?? (slug === 'sawso' || legacySawso ? sawso : emptyStoriesSettings())
}
export { withStoriesCatalog } from '@cms/schema'

/** Only tag metadata travels to the catalog client, never complete articles. */
export function storyTagAssignments(values: Record<string, unknown>): Record<string, unknown> {
  return {
    tags: values.tags ?? '',
    regions: values.regions ?? '',
    region: values.region ?? '',
    reviewed: values.reviewed === true,
  }
}
