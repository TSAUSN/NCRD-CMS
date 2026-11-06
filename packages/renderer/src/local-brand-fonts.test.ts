import { it, expect } from 'vitest'
import { LOCAL_BRAND_FONTS, localBrandFont } from './local-brand-fonts.ts'
import { themeCss } from './render.ts'
it('adds only the approved same-origin Creato faces when that family is selected', () => {
  const font = "'Creato Display', 'Open Sans', Arial, sans-serif",
    css = themeCss({ fonts: { heading: font, body: font } })
  expect(LOCAL_BRAND_FONTS).toHaveLength(7)
  expect(new Set(LOCAL_BRAND_FONTS.map(face => face.file)).size).toBe(7)
  for (const face of LOCAL_BRAND_FONTS) {
    expect(css).toContain('/__cms/fonts/' + face.file)
    expect(face.sha256).toMatch(/^[a-f0-9]{64}$/)
    expect(localBrandFont(face.file)).toEqual(face)
  }
  expect(css).not.toContain('https://')
  expect(themeCss({})).not.toContain('Creato Display')
})
it('refuses paths outside the exact font registry', () => {
  for (const file of ['constructor', '../../secret', 'creato-display-regular.woff2'])
    expect(localBrandFont(file)).toBeNull()
})
