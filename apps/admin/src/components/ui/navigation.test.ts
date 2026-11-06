import { describe, it, expect } from 'vitest'
import { safeCmsPath } from './back-link.tsx'
import { clampPanelWidth } from './resizable-panel.tsx'
describe('safe CMS navigation', () => {
  it('keeps only same-origin editorial destinations', () => {
    const origin = 'http://localhost:3000'
    expect(safeCmsPath('http://localhost:3000/sites/abc?tab=pages#main', origin)).toBe('/sites/abc?tab=pages#main')
    for (const value of [
      '',
      ' ',
      'https://example.org/',
      'javascript:alert(1)',
      '//other.test/',
      '/sign-in',
      '/auth/confirm',
      '/api/sites',
      null,
    ])
      expect(safeCmsPath(value, origin)).toBeNull()
  })
  it('clamps restored and dragged widths to usable bounds', () => {
    expect(clampPanelWidth(1, 320, 900)).toBe(320)
    expect(clampPanelWidth(1400, 320, 900)).toBe(900)
    expect(clampPanelWidth(520, 320, 900)).toBe(520)
  })
})
