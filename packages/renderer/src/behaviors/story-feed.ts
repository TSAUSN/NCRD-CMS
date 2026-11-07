import { STORY_FEED_SLUGS } from '../section/stylesheet.ts'
import { isStoryFeedSlot } from '../story-feed-dates.ts'
import { renderStoryGrid } from '../story-grid.ts'
import type { SectionBodyBehavior } from './types.ts'

export const storyFeed: SectionBodyBehavior = (body, { def }) => {
  if (STORY_FEED_SLUGS.has(def.slug ?? '') && (def.slots ?? []).some(slot => isStoryFeedSlot(slot, def.slug)))
    body = renderStoryGrid(body)
  return body
}
