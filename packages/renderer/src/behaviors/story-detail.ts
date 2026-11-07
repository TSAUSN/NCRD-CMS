import { renderStoryAuthor, renderStoryDetail } from '../story-archive.ts'
import type { SectionBodyBehavior } from './types.ts'

export const storyDetail: SectionBodyBehavior = (body, { def, values }) => {
  if (def.slug === 'core-story-detail') body = renderStoryDetail(renderStoryAuthor(body, values.story))
  return body
}
