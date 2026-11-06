import { expect, it } from 'vitest'
import { readFooterLinks, writeFooterLinks, readFooterText, writeFooterText } from './footer-links.ts'
it('round trips ordinary links and escapes words, queries and quotes', () => {
  const links = [
    { label: 'Home & help', url: '/' },
    { label: '"Give"', url: 'https://example.org/?a=1&b=2#gift' },
  ]
  expect(readFooterLinks(writeFooterLinks(links))).toEqual(links)
  expect(writeFooterLinks(links)).toContain('&amp;')
})
it('keeps unfamiliar formatting intact by refusing a lossy list conversion', () => {
  for (const value of [
    '<p>Keep these words <a href="/">Home</a></p>',
    '<p><a href="/" target="_blank">Home</a></p>',
    '<p><a href="/"><strong>Home</strong></a></p>',
    '<a href="javascript:alert(1)">Unsafe</a>',
    '<p>Unlinked words</p>',
  ])
    expect(readFooterLinks(value)).toBeNull()
  expect(readFooterLinks('')).toEqual([])
  expect(readFooterLinks(undefined)).toEqual([])
})
it('refuses empty, overlong or unsafe entries instead of saving a leftover', () => {
  expect(() => writeFooterLinks([{ label: '', url: '/' }])).toThrow()
  expect(() => writeFooterLinks([{ label: 'Link', url: 'javascript:alert(1)' }])).toThrow()
  expect(() => writeFooterLinks(Array.from({ length: 51 }, () => ({ label: 'Link', url: '/' })))).toThrow()
})

it('offers plain text only when all paragraph words and breaks can round trip', () => {
  const words = 'The mission & work.\nNext line.\n\nAnother paragraph.'
  expect(readFooterText(writeFooterText(words))).toBe(words)
  expect(readFooterText('<p>Keep <a href="/">this link</a></p>')).toBeNull()
  expect(readFooterText('<p><strong>Keep emphasis</strong></p>')).toBeNull()
})
