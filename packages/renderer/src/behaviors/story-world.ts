import { renderStoryWorld } from '../story-world.ts'
import type { SectionBodyBehavior } from './types.ts'

export const storyWorld: SectionBodyBehavior = (body, { index, world }) => {
  if (world) body = renderStoryWorld(body, index, world)
  return body
}
