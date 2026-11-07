import { expect, test } from 'vitest'
import { sectionBodyBehaviors } from './registry.ts'

test('post-render transforms preserve the report and story markup order', () => {
  expect(sectionBodyBehaviors.map(behavior => behavior.name)).toEqual([
    'feature-tiles', 'social-marks', 'report-template', 'report-content', 'story-detail',
    'story-world', 'story-split', 'story-archive', 'story-feed',
  ])
})
