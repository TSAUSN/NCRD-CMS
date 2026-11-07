import { renderEchelonSocialMarks } from '../echelon-social-marks.ts'
import type { SectionBodyBehavior } from './types.ts'

export const socialMarks: SectionBodyBehavior = (body, { def }) => {
  body = renderEchelonSocialMarks(body, def.slug)
  return body
}
