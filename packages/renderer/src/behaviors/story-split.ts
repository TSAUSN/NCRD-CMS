import { renderStorySplit } from '../story-split.ts'
import type { SectionBodyBehavior } from './types.ts'

export const storySplit: SectionBodyBehavior = (body, { index, split }) => {
  if (split) body = renderStorySplit(body, index, split)
  return body
}
