import { expect, it } from 'vitest'
import { validHeaderButtonUrl } from './header-button-link.ts'
it('accepts site paths, credential-free HTTPS, email and phone destinations', () => {
  for (const url of [
    '/give',
    'https://example.test/give?form=main#donate',
    'mailto:hello@example.test',
    'tel:+1-202-555-0100',
  ])
    expect(validHeaderButtonUrl(url)).toBe(true)
})
it('keeps existing frame website restrictions and refuses incomplete contact links', () => {
  for (const url of [
    'http://example.test',
    'https://name:password@example.test',
    '//example.test',
    '/\\example.test',
    'javascript:alert(1)',
    'data:text/html,x',
    'mailto:',
    'tel:',
    'mailto:hello@example.test\n',
    null,
  ])
    expect(validHeaderButtonUrl(url)).toBe(false)
})
