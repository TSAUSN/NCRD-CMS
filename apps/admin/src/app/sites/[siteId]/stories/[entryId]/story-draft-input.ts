import { storyPhotoInput } from '../../../../../lib/story-photo-input.ts'
import { storyTagIds, type StoriesSettings } from '@cms/schema'
import { storyTags } from '../../../../../lib/stories-model.ts'
import type { NewStoryInput } from '../../../../../lib/stories-create.ts'
import type { StoryEditInput } from '../../../../../lib/stories-edit.ts'

export function storyDraftInput(
  values: Record<string, unknown>,
  catalog: StoriesSettings,
  configured: boolean,
  authorAvailable = false,
): StoryEditInput {
  const photo = storyPhotoInput(values.photo)
  return {
    ...(authorAvailable ? { author: String(values.author ?? '') } : {}),
    title: String(values.title ?? ''),
    summary: String(values.summary ?? ''),
    tags: storyTags(values, catalog),
    ...(configured ? { regions: storyTagIds(values, 'secondary') } : {}),
    region: String(values.region ?? ''),
    published_date: String(values.published_date ?? ''),
    countries: String(values.countries ?? ''),
    body: String(values.body ?? ''),
    body_is_sample: values.body_is_sample === true,
    ...(photo ? { photo } : {}),
  }
}

export function newStoryInput(value: StoryEditInput): NewStoryInput {
  return {
    title: value.title,
    summary: value.summary,
    ...(value.author !== undefined ? { author: value.author } : {}),
    tags: value.tags,
    regions: value.regions,
    region: value.region,
    published_date: value.published_date,
    countries: value.countries,
    body: value.body,
    photoId: value.photo?.id ?? '',
    photoAlt: value.photo?.description ?? '',
    photoFocus: value.photo?.focus,
  }
}

export function missingNewStoryField(value: StoryEditInput): { field: string; message: string } | null {
  if (!value.title.trim()) return { field: 'story-title', message: 'Add a title.' }
  if (!value.summary.trim()) return { field: 'story-summary', message: 'Add a summary.' }
  if (!value.photo?.id) return { field: 'story-photo-picker', message: 'Choose a lead photo and describe it.' }
  if (!value.photo.description.trim()) return { field: 'story-photo-description', message: 'Describe the lead photo.' }
  return null
}
