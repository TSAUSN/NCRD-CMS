import { imageFocus } from '@cms/schema'
import type { StoryPhotoInput } from './story-photo.ts'
/** Missing legacy images stay untouched until a deliberate library choice. */
export function storyPhotoInput(value: unknown): StoryPhotoInput | undefined {
  if (!value || typeof value !== 'object') return undefined
  const photo = value as Record<string, unknown>
  const match = typeof photo.src === 'string' ? /^\/media\/([0-9a-f-]{36})\/wide$/.exec(photo.src) : null
  return match
    ? { id: match[1]!, description: typeof photo.alt === 'string' ? photo.alt : '', focus: imageFocus(photo.focal) }
    : undefined
}
