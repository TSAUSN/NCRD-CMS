import { describe, expect, it } from 'vitest'
import { htmlAddressTarget } from './routing.ts'

describe('V1 file-style addresses', () => {
  it('maps each to its clean address', () => {
    expect(htmlAddressTarget('/index.html')).toBe('/')
    expect(htmlAddressTarget('/explore-data.html')).toBe('/explore-data')
    expect(htmlAddressTarget('/Resources.HTML')).toBe('/Resources')
    expect(htmlAddressTarget('/guides/index.html')).toBe('/guides')
    expect(htmlAddressTarget('/guides/start.html')).toBe('/guides/start')
  })
  it('leaves every other address alone', () => {
    for (const path of ['/', '/explore-data', '/file.htm', '/html', '/page.html/extra'])
      expect(htmlAddressTarget(path)).toBeNull()
  })
  it('never redirects to another host', () => {
    for (const path of ['//evil.test/a.html', '/\\evil.test/a.html', 'evil.test/a.html'])
      expect(htmlAddressTarget(path)).toBeNull()
  })
})
