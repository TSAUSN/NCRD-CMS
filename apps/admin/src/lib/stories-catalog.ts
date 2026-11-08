import { CollectionModel, StoriesSettings, emptyStoriesSettings } from '@cms/schema'
import { sawsoStoriesSettings } from '@cms/seeds/sawso-story-tags'
import { hasLegacyStorySource } from './site-installation-settings.ts'

export function storiesCatalog(model: CollectionModel, slug: string): StoriesSettings {
  if (model.presentation.stories) return model.presentation.stories
  const legacyRegion = model.fields.find(field => field.key === 'region')
  const legacyCatalog = sawsoStoriesSettings()
  const legacySawso =
    legacyRegion?.type === 'select' &&
    legacyRegion.options.length === legacyCatalog.secondaryTags.length &&
    legacyCatalog.secondaryTags.every(t => legacyRegion.options.includes(t.id))
  return hasLegacyStorySource(slug) || legacySawso ? legacyCatalog : emptyStoriesSettings()
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
