import { expect, it } from 'vitest'
import { ThemeTokens } from '@cms/schema'
import {
  CORE_THEME_PRESETS,
  NATIONAL_THEME,
  ECHELON_THEME,
  SAWSO_THEME,
  NATIONAL_TEMPLATE_VERSION,
} from './core-themes.ts'
import { checkContrast } from '../../domain/src/contrast.ts'
it('supplies the requested named, immutable-starting-value theme presets', () => {
  const names = CORE_THEME_PRESETS.map(preset => preset.name)
  for (const name of ['National', 'Better Together 2027', 'Echelon', 'SAWSO', 'Neutral']) expect(names).toContain(name)
  expect(new Set(names).size).toBe(names.length)
  for (const preset of CORE_THEME_PRESETS) expect(ThemeTokens.safeParse(preset.theme).success).toBe(true)
  const copy = structuredClone(CORE_THEME_PRESETS[0]!.theme)
  copy.colors.primary = '#123456'
  expect(CORE_THEME_PRESETS[0]!.theme.colors.primary).toBe('#ef3e42')
})
it('uses one national palette and independent Echelon sans-serif headings', () => {
  expect(NATIONAL_THEME).toMatchObject({
    colors: { primary: '#ef3e42', accent: '#002056', ink: '#1c1b1f', surfaceAlt: '#efefef' },
    radius: '1.25rem',
    buttons: { radius: '0.5rem' },
    presentation: { kind: 'panels', canvas: '#d9d9d9' },
  })
  expect(ECHELON_THEME.colors).toEqual(SAWSO_THEME.colors)
  expect(ECHELON_THEME.presentation?.template).toEqual({
    id: 'national',
    version: NATIONAL_TEMPLATE_VERSION,
    mayChangeColours: false,
  })
  expect(ECHELON_THEME.fonts.heading).not.toContain('Serif')
  for (const theme of [NATIONAL_THEME]) {
    expect(theme.fonts.heading.startsWith("'Creato Display'")).toBe(true)
    expect(theme.fonts.body.startsWith("'Creato Display'")).toBe(true)
    expect(theme.fonts.heading).toContain('Open Sans')
    expect(theme.fonts.body).toContain('Open Sans')
    for (const [ink, fill] of [
      [theme.colors.ink, theme.colors.surface],
      [theme.colors.muted, theme.colors.surfaceAlt],
      [theme.colors.primaryContrast, theme.colors.primary],
      [theme.colors.accentContrast, theme.colors.accent],
    ])
      expect(checkContrast(ink!, fill!)?.passesAA).toBe(true)
  }
  expect(CORE_THEME_PRESETS.find(p => p.name === 'Better Together 2027')!.theme.presentation).toBeUndefined()
})

it('uses national SAWSO colors with self-hosted small-caps headings', () => {
  expect(SAWSO_THEME).toMatchObject({
    colors: { ...NATIONAL_THEME.colors, primaryContrast: '#ffffff', surfaceAlt: '#f2f2f2' },
    radius: '1.25rem',
    buttons: { radius: '0.5rem' },
    presentation: {
      kind: 'panels',
      canvas: '#d9d9d9',
      headings: 'small-caps',
      layout: 'national',
      referenceContrast: 'sawso-2026-10-29',
    },
    fonts: { heading: "'Source Serif 4', Georgia, serif", body: "'Open Sans', Arial, sans-serif" },
  })
})

it('keeps the shared parent independent from site font choices', () => {
  expect(ECHELON_THEME.presentation?.template).toEqual(SAWSO_THEME.presentation?.template)
  expect(ECHELON_THEME.buttons).toEqual(SAWSO_THEME.buttons)
  expect(ECHELON_THEME.fonts.heading).not.toEqual(SAWSO_THEME.fonts.heading)
  expect(ECHELON_THEME.presentation?.headings).toBeUndefined()
})
