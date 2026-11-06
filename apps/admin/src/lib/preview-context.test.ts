import { expect, it } from 'vitest'
import { sitePreviewContext, sitePreviewLabel } from './preview-context.ts'

it('opts into saved site drafts only with the exact supported value', () => {
  expect(sitePreviewContext('draft')).toBe('draft')
  for (const value of [undefined, null, '', 'published', 'DRAFT', true, ['draft'], {}]) {
    expect(sitePreviewContext(value)).toBe('published')
  }
})

it('uses truthful, distinct appearance labels', () => {
  expect(sitePreviewLabel('published')).toBe('Live')
  expect(sitePreviewLabel('draft')).toBe('Saved drafts')
})
