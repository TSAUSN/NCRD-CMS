import { CollectionModel, type CollectionField } from './collections.ts'
import type { StoriesSettings } from './stories.ts'

/** Upgrade only on an explicit tag-management save, never while reading a site. */
export function withStoriesCatalog(model: CollectionModel, settings: StoriesSettings): CollectionModel {
  const fields: CollectionField[] = model.fields.map(field =>
    field.key === 'published_date' && field.type === 'date'
      ? { ...field, label: 'Story date', required: false }
      : field.key === 'region'
        ? { key: 'region', label: settings.secondaryLabel, required: false, type: 'text' }
        : field.key === 'tags'
          ? { ...field, label: settings.mainLabel, required: false }
          : field,
  )
  for (const field of [
    { key: 'regions', label: 'Secondary tags', required: false, type: 'text' },
    { key: 'reviewed', label: 'Reviewed', required: false, type: 'boolean' },
    { key: 'hidden', label: 'Hide from feeds', required: false, type: 'boolean' },
    { key: 'feed_removed', label: 'No longer in feed', required: false, type: 'boolean' },
    { key: 'newsroom_rank', label: 'Newsroom order', required: false, type: 'number' },
    { key: 'author', label: 'Author', required: false, type: 'text' },
  ] as const)
    if (!fields.some(f => f.key === field.key)) fields.push(field)
  return CollectionModel.parse({ ...model, fields, presentation: { ...model.presentation, stories: settings } })
}

/** Empty, site-owned starter. No borrowed words, tags, photos or feed connection. */
export function createStoriesModel(settings: StoriesSettings): CollectionModel {
  return withStoriesCatalog(
    CollectionModel.parse({
      fields: [
        { key: 'title', type: 'text', label: 'Title', required: true },
        { key: 'summary', type: 'text', label: 'Description', required: true },
        { key: 'published_date', type: 'date', label: 'Story date', required: false },
        { key: 'tags', type: 'text', label: 'Main tags', required: false },
        { key: 'region', type: 'text', label: 'Secondary tags', required: false },
        { key: 'countries', type: 'text', label: 'Countries', required: false },
        { key: 'body', type: 'richtext', label: 'Story text', required: false },
        { key: 'body_is_sample', type: 'boolean', label: 'Story text is sample content', required: false },
        { key: 'photo', type: 'image', label: 'Lead photo', required: false },
        { key: 'photo_is_sample', type: 'boolean', label: 'Lead photo is sample content', required: false },
        { key: 'old_address', type: 'url', label: 'Old address', required: false },
        { key: 'image_url', type: 'url', label: 'Original image address (data only)', required: false },
        { key: 'story_url', type: 'url', label: 'Read more address', required: true },
        { key: 'region_label', type: 'text', label: 'Secondary tag labels', required: false },
        { key: 'sector_links', type: 'richtext', label: 'Main tag links', required: false },
        { key: 'photo_note', type: 'text', label: 'Photo note', required: false },
      ],
      presentation: {
        schemaVersion: 1,
        titleField: 'title',
        subtitleField: 'published_date',
        imageField: 'photo',
        groupField: 'region',
      },
    }),
    settings,
  )
}
