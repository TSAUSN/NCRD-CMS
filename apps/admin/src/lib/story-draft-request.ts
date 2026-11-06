import { createHash } from 'node:crypto'
import { imageFocus, COLLECTION_LIMITS } from '@cms/schema'
import { sanitizeRichText } from '@cms/renderer'
import { DomainError } from '@cms/domain'
import type { NewStoryInput } from './stories-create.ts'
/** An immutable authored intention, not mutable labels or a media-library default. */
export function storyDraftFingerprint(input: NewStoryInput): string {
  if (input?.author !== undefined && (typeof input.author !== 'string' || input.author.length > 120))
    throw new DomainError('invalid_state', 'Use up to 120 characters for Author.')
  if (
    !input ||
    typeof input.title !== 'string' ||
    typeof input.summary !== 'string' ||
    typeof input.region !== 'string' ||
    typeof input.published_date !== 'string' ||
    typeof input.photoId !== 'string' ||
    typeof input.photoAlt !== 'string' ||
    !Array.isArray(input.tags) ||
    input.tags.length > 100 ||
    input.tags.some(tag => typeof tag !== 'string' || tag.length > 80) ||
    (input.regions !== undefined &&
      (!Array.isArray(input.regions) ||
        input.regions.length > 100 ||
        input.regions.some(tag => typeof tag !== 'string' || tag.length > 80))) ||
    (input.body !== undefined && (typeof input.body !== 'string' || input.body.length > COLLECTION_LIMITS.storyBody)) ||
    (input.countries !== undefined && (typeof input.countries !== 'string' || input.countries.length > 300)) ||
    input.title.length > 180 ||
    input.summary.length > 200 ||
    input.photoAlt.length > 1000 ||
    input.photoId.length > 36 ||
    input.region.length > 80 ||
    input.published_date.length > 10 ||
    (input.photoFocus !== undefined &&
      input.photoFocus !== null &&
      (!imageFocus(input.photoFocus) || Object.keys(input.photoFocus).some(key => key !== 'x' && key !== 'y')))
  )
    throw new DomainError('invalid_state', 'Check the new story fields before saving.')
  const value = {
    ...(input.author?.trim() ? { author: input.author.trim() } : {}),
    title: input.title.trim(),
    summary: input.summary.trim(),
    tags: [...new Set(input.tags)].sort(),
    regions: [...new Set(input.regions ?? (input.region ? [input.region] : []))].sort(),
    day: input.published_date,
    countries: (input.countries ?? '').trim(),
    body: sanitizeRichText(input.body ?? ''),
    photo: { id: input.photoId.toLowerCase(), description: input.photoAlt.trim(), focus: imageFocus(input.photoFocus) },
  }
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}
