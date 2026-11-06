import { ThemeTokens, DEFAULT_THEME_TOKENS, THEME_FONT_OPTIONS } from '@cms/schema'
const defaults = structuredClone(DEFAULT_THEME_TOKENS)
const legacyNative = ThemeTokens.parse({
  ...defaults,
  colors: {
    ...defaults.colors,
    primary: '#ee3a43',
    primaryContrast: '#000000',
    accent: '#0d234f',
    accentContrast: '#ffffff',
    ink: '#142238',
    muted: '#5a6575',
  },
  fonts: { heading: THEME_FONT_OPTIONS[0].value, body: THEME_FONT_OPTIONS[0].value },
  radius: '0.25rem',
})
/** Presets are reversible starting points; site imports retain their reviewed CSS.
 * National values use the approved local measured reference and approved local font. */
export const NATIONAL_THEME = ThemeTokens.parse({
  ...defaults,
  colors: {
    ...defaults.colors,
    primary: '#ef3e42',
    primaryContrast: '#000000',
    accent: '#002056',
    accentContrast: '#ffffff',
    surface: '#ffffff',
    surfaceAlt: '#efefef',
    ink: '#1c1b1f',
    muted: '#5b5b5b',
  },
  fonts: {
    heading: THEME_FONT_OPTIONS.find(font => font.label === 'Creato Display (local)')!.value,
    body: THEME_FONT_OPTIONS.find(font => font.label === 'Creato Display (local)')!.value,
  },
  radius: '1.25rem',
  spacing: 'comfortable',
  buttons: { ...defaults.buttons, radius: '0.5rem' },
  presentation: { kind: 'panels', canvas: '#d9d9d9' },
})
/** One parent, with site-owned font choices. Existing snapshots are never rewritten. */
export const NATIONAL_TEMPLATE_VERSION = 3
export const NATIONAL_TEMPLATE_THEME = ThemeTokens.parse({
  ...NATIONAL_THEME,
  colors: { ...NATIONAL_THEME.colors, primaryContrast: '#ffffff', surfaceAlt: '#f2f2f2' },
  buttons: { ...NATIONAL_THEME.buttons, weight: 'regular' },
  presentation: {
    ...NATIONAL_THEME.presentation,
    layout: 'national',
    referenceContrast: 'sawso-2026-10-29',
    template: { id: 'national', version: NATIONAL_TEMPLATE_VERSION, mayChangeColours: false },
  },
})
export function nationalTemplateTheme(fonts: ThemeTokens['fonts'], smallCaps = false): ThemeTokens {
  return ThemeTokens.parse({
    ...structuredClone(NATIONAL_TEMPLATE_THEME),
    fonts,
    presentation: { ...NATIONAL_TEMPLATE_THEME.presentation, ...(smallCaps ? { headings: 'small-caps' } : {}) },
  })
}
export const ECHELON_THEME = nationalTemplateTheme(NATIONAL_THEME.fonts)
export const SAWSO_THEME = nationalTemplateTheme(
  {
    heading: THEME_FONT_OPTIONS.find(font => font.label === 'Source Serif 4')!.value,
    body: THEME_FONT_OPTIONS[0].value,
  },
  true,
)
export const CORE_THEME_PRESETS = [
  { name: 'National', theme: NATIONAL_THEME },
  {
    name: 'Better Together 2027',
    theme: ThemeTokens.parse({
      ...legacyNative,
      colors: {
        ...legacyNative.colors,
        primary: '#175777',
        primaryContrast: '#ffffff',
        accent: '#8a6a00',
        accentContrast: '#ffffff',
      },
    }),
  },
  { name: 'Echelon', theme: ECHELON_THEME },
  { name: 'SAWSO', theme: SAWSO_THEME },
  { name: 'Neutral', theme: ThemeTokens.parse(defaults) },
  {
    name: 'Forest',
    theme: ThemeTokens.parse({ ...defaults, colors: { ...defaults.colors, primary: '#165b43', accent: '#894823' } }),
  },
] as const
