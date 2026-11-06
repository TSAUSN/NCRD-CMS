import { expect, it } from 'vitest'
import { renderStructuredField } from './structured.ts'
it('escapes names in an explicitly requested initials fallback', () => {
  const html = renderStructuredField(
    { type: 'image', field: 'photo', staticAttributes: { class: ['cms-avatar-fallback'] } },
    { photo: '', name: '<img onerror=bad>' },
  )
  expect(html).toContain('aria-label="No picture for &lt;img onerror=bad&gt;"')
  expect(html).not.toContain('<img')
})
it('keeps unmarked images on the existing empty-image path', () => {
  expect(renderStructuredField({ type: 'image', field: 'photo' }, { photo: '' })).toBe('')
})
