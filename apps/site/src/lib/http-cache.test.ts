import { expect, it } from 'vitest'
import { matchesEntityTag, representationTag } from './http-cache.ts'

it('invalidates a representation when the renderer output or security metadata changes', () => {
  expect(representationTag('same-revision', 'old HTML')).not.toBe(representationTag('same-revision', 'new HTML'))
  expect(representationTag('same', 'HTML', 'old policy')).not.toBe(representationTag('same', 'HTML', 'new policy'))
})
it('handles weak validators and validator lists for GET/HEAD revalidation', () => {
  const tag = representationTag('page', 'HTML')
  expect(matchesEntityTag(`"other", W/${tag}`, tag)).toBe(true)
  expect(matchesEntityTag('*', tag)).toBe(true)
  expect(matchesEntityTag(null, tag)).toBe(false)
  expect(matchesEntityTag('"other"', tag)).toBe(false)
})
