import { expect, it } from 'vitest'
import { validSectionAnchor } from './section-anchor.ts'
it('admits readable section names and rejects document-id collisions and attribute injection', () => {
  for (const value of ['speakers', 'day-2', 'a']) expect(validSectionAnchor(value)).toBe(true)
  for (const value of ['', 's0', 's123', 'cms-main', '2day', 'Space Name', 'x" onclick="x', null, 123, 'a'.repeat(65)])
    expect(validSectionAnchor(value)).toBe(false)
})
