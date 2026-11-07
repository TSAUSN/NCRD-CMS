import { featureTileLayout } from './feature-tiles.ts'
import { socialMarks } from './social-marks.ts'
import { reportTemplate } from './report-template.ts'
import { reportContent } from './report-content.ts'
import { storyDetail } from './story-detail.ts'
import { storyWorld } from './story-world.ts'
import { storySplit } from './story-split.ts'
import { storyArchive } from './story-archive.ts'
import { storyFeed } from './story-feed.ts'
import type { SectionBodyBehavior, SectionBodyContext } from './types.ts'

// The report and story transforms consume the markup made by earlier steps.
// Keep their established order when adding a behavior to the renderer.
export const sectionBodyBehaviors = [
  { name: 'feature-tiles', apply: featureTileLayout },
  { name: 'social-marks', apply: socialMarks },
  { name: 'report-template', apply: reportTemplate },
  { name: 'report-content', apply: reportContent },
  { name: 'story-detail', apply: storyDetail },
  { name: 'story-world', apply: storyWorld },
  { name: 'story-split', apply: storySplit },
  { name: 'story-archive', apply: storyArchive },
  { name: 'story-feed', apply: storyFeed },
] as const satisfies readonly { name: string; apply: SectionBodyBehavior }[]

export function applySectionBodyBehaviors(body: string, context: SectionBodyContext): string {
  for (const behavior of sectionBodyBehaviors) body = behavior.apply(body, context)
  return body
}
