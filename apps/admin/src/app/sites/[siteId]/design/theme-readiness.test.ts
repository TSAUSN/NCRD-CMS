import { describe, expect, it } from 'vitest'
import { DEFAULT_THEME_TOKENS } from '@cms/schema'
import { SAWSO_THEME, ECHELON_THEME } from '@cms/seeds/core-themes'
import { themePublishReadiness } from './theme-readiness.ts'

describe('site look publish readiness', () => {
  it('recognizes the exact approved national pair for both site font choices', () => {
    for (const theme of [SAWSO_THEME, ECHELON_THEME])
      expect(themePublishReadiness(theme)).toEqual({ ready: true, approvedPrimary: true })
  })
  it('never exempts a different pair, missing marker or another failed pair', () => {
    const changed = structuredClone(SAWSO_THEME)
    changed.colors.primary = '#ee3e42'
    expect(themePublishReadiness(changed).ready).toBe(false)
    const unmarked = structuredClone(SAWSO_THEME)
    delete unmarked.presentation!.referenceContrast
    expect(themePublishReadiness(unmarked).ready).toBe(false)
    const unreadable = structuredClone(SAWSO_THEME)
    unreadable.colors.ink = '#eeeeee'
    expect(themePublishReadiness(unreadable)).toEqual({ ready: false, approvedPrimary: true })
  })
  it('keeps ordinary AA readiness without a reference exception', () => {
    expect(themePublishReadiness(structuredClone(DEFAULT_THEME_TOKENS))).toEqual({
      ready: true,
      approvedPrimary: false,
    })
  })
})
