import { expect, it } from 'vitest'
import { DEFAULT_THEME_TOKENS, THEME_FONT_OPTIONS, ThemeTokens } from './theme.ts'
it('keeps legacy themes unchanged and accepts only the bounded panel presentation', () => {
  expect(ThemeTokens.parse(DEFAULT_THEME_TOKENS)).toEqual(DEFAULT_THEME_TOKENS)
  const national = { ...DEFAULT_THEME_TOKENS, radius: '1.25rem', presentation: { kind: 'panels', canvas: '#d9d9d9' } }
  expect(ThemeTokens.parse(national)).toEqual(national)
  for (const presentation of [
    null,
    { kind: 'free', canvas: '#d9d9d9' },
    { kind: 'panels', canvas: 'red' },
    { kind: 'panels', canvas: '#d9d9d9', css: 'body{}' },
  ])
    expect(ThemeTokens.safeParse({ ...national, presentation }).success).toBe(false)
  expect(ThemeTokens.safeParse({ ...national, radius: '99rem' }).success).toBe(false)
})
it('accepts the shipped serif font while preserving the bounded font vocabulary', () => {
  const serif = THEME_FONT_OPTIONS.find(font => font.label === 'Source Serif 4')!.value
  expect(ThemeTokens.parse({ ...DEFAULT_THEME_TOKENS, fonts: { heading: serif, body: serif } }).fonts).toEqual({
    heading: serif,
    body: serif,
  })
  for (const bad of ['url(https://example.org/font)', 'Unregistered Family', "'Source Serif 4';background:red"]) {
    expect(ThemeTokens.safeParse({ ...DEFAULT_THEME_TOKENS, fonts: { heading: serif, body: bad } }).success).toBe(false)
  }
})
