import { renderStoryArchive } from '../story-archive.ts'
import type { SectionBodyBehavior } from './types.ts'

export const storyArchive: SectionBodyBehavior = (body, { def, values }) => {
  if (def.slug === 'core-stories' && Object.hasOwn(values, 'newsroom')) body = renderStoryArchive(body, values.newsroom)
  return body
}
