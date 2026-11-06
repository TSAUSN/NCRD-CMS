import { checkContrast, type ContrastVerdict } from '@cms/domain'
import { DEFAULT_THEME_TOKENS, THEME_FONT_OPTIONS, type ThemeTokens } from '@cms/schema'

// The site wizard's Look step (SPEC §6.2 step 2, reference 22): a brand colour,
// a supported type pairing and a button shape, each a choice a newcomer can
// judge from a sample rather than a token they have to understand. Everything
// here writes ordinary theme tokens, so Design shows and changes the same
// values later.

/** Every preset carries white button labels at 4.5:1 or better, and stays
 * readable as small text on both page surfaces, so no preset needs a caveat. */
export const BRAND_COLOURS = [
  {
    name: 'Navy',
    primary: DEFAULT_THEME_TOKENS.colors.primary,
    accent: DEFAULT_THEME_TOKENS.colors.accent,
    description: 'The standard starting design: calm and institutional, with the brand red as its accent.',
  },
  // The brand red darkened until white text passes, as the admin's own
  // `--sa-red-ink` is; the brighter brand fill measures 3.6:1 under white.
  {
    name: 'Salvation Army red',
    primary: '#cf1f2a',
    accent: DEFAULT_THEME_TOKENS.colors.primary,
    description: 'The national brand red. Use it when the site speaks for the organisation as a whole.',
  },
  {
    name: 'Gold',
    primary: '#8a6a00',
    accent: DEFAULT_THEME_TOKENS.colors.primary,
    description: 'Warm and celebratory — anniversaries, galas and awards.',
  },
  {
    name: 'Forest',
    primary: '#165b43',
    accent: '#894823',
    description: 'Grounded and hopeful — environment, food and housing programs.',
  },
  {
    name: 'Teal',
    primary: '#0f6b75',
    accent: DEFAULT_THEME_TOKENS.colors.primary,
    description: 'Clear and steady — health, recovery and support services.',
  },
  {
    name: 'Plum',
    primary: '#6b2d5c',
    accent: '#0f6b75',
    description: 'Distinctive without shouting — conferences and campaigns.',
  },
  {
    name: 'Slate',
    primary: '#34475a',
    accent: '#754580',
    description: 'Quiet and neutral — lets photography carry the page.',
  },
] as const

type FontStack = ThemeTokens['fonts']['heading']
const font = (label: (typeof THEME_FONT_OPTIONS)[number]['label']): FontStack =>
  THEME_FONT_OPTIONS.find(option => option.label === label)!.value

export const TYPE_PAIRINGS = [
  {
    name: 'Classic',
    heading: font('Classic serif'),
    body: font('System sans'),
    description: 'Serif headings over a clear sans-serif body. The standard pairing.',
  },
  {
    name: 'Modern',
    heading: font('System sans'),
    body: font('System sans'),
    description: 'Sans-serif throughout — direct and practical.',
  },
  {
    name: 'Editorial',
    heading: font('Book serif'),
    body: font('Classic serif'),
    description: 'Serif throughout, for long reading — reports and stories.',
  },
  {
    name: 'Friendly',
    heading: font('Humanist sans'),
    body: font('System sans'),
    description: 'Humanist headings that feel warm and approachable.',
  },
  {
    name: 'Technical',
    heading: font('Technical mono'),
    body: font('System sans'),
    description: 'Monospaced headings for data, tools and dashboards.',
  },
] as const

/** Curated specimens use only fonts shipped with the CMS, without a font CDN. */
export const SELF_HOSTED_TYPE_PAIRINGS = [
  {
    name: 'Modern',
    heading: font('Open Sans'),
    body: font('Open Sans'),
    description: 'Clear and welcoming throughout.',
  },
  {
    name: 'Editorial',
    heading: font('Source Serif 4'),
    body: font('Open Sans'),
    description: 'Distinctive headings, clear everyday reading.',
  },
  {
    name: 'Reading',
    heading: font('Open Sans'),
    body: font('Source Serif 4'),
    description: 'Simple headings and a generous reading voice.',
  },
] as const

export const BUTTON_SHAPES = [
  { name: 'Square', radius: '0rem' },
  { name: 'Soft', radius: '0.25rem' },
  { name: 'Rounded', radius: '0.5rem' },
  { name: 'Pill', radius: '1rem' },
] as const satisfies readonly { name: string; radius: ThemeTokens['buttons']['radius'] }[]

const HEX = /^#[0-9a-f]{6}$/i
export const isHexColour = (value: string): boolean => HEX.test(value)

/**
 * The label colour for text set on `background`: white when white is readable,
 * otherwise the site's own ink, otherwise black. White or black always reaches
 * 4.5:1 on an opaque colour, so the result is never a failing pair.
 */
export function readableLabel(background: string, ink: string = DEFAULT_THEME_TOKENS.colors.ink): string {
  for (const candidate of ['#ffffff', ink, '#000000']) {
    if (checkContrast(candidate, background)?.passesAA) return candidate
  }
  return '#000000'
}

/** Choose a brand colour: the primary (and optionally its accent) with
 * readable labels computed rather than assumed. */
export function withBrandColour(theme: ThemeTokens, primary: string, accent?: string): ThemeTokens {
  const colors = {
    ...theme.colors,
    primary: primary.toLowerCase(),
    primaryContrast: readableLabel(primary, theme.colors.ink),
  }
  if (accent)
    Object.assign(colors, { accent: accent.toLowerCase(), accentContrast: readableLabel(accent, theme.colors.ink) })
  return { ...theme, colors }
}

export const brandColourFor = (theme: ThemeTokens) =>
  BRAND_COLOURS.find(colour => colour.primary.toLowerCase() === theme.colors.primary.toLowerCase()) ?? null
export const typePairingFor = (theme: ThemeTokens) =>
  TYPE_PAIRINGS.find(pairing => pairing.heading === theme.fonts.heading && pairing.body === theme.fonts.body) ?? null
export const buttonShapeFor = (theme: ThemeTokens) =>
  BUTTON_SHAPES.find(shape => shape.radius === theme.buttons.radius) ?? null

/** “Navy · Classic type · Soft buttons”, as the review step names the look. */
export function lookSummary(theme: ThemeTokens): string {
  return [
    brandColourFor(theme)?.name ?? `Your own colour ${theme.colors.primary}`,
    `${typePairingFor(theme)?.name ?? 'Custom'} type`,
    `${buttonShapeFor(theme)?.name ?? 'Custom'} buttons`,
  ].join(' · ')
}

export type LookCheck = {
  id: 'button' | 'brand-text' | 'body-text'
  pass: boolean
  verdict: ContrastVerdict
  message: string
}

/**
 * The readability of the choices, measured on the backgrounds the text will
 * actually sit on. Ordinary-size labels need 4.5:1: V1 called a 4.2:1 button
 * label a pass, and this is the correction (SPEC §6.2, reference C).
 */
export function lookChecks(theme: ThemeTokens): LookCheck[] {
  const { colors, buttons } = theme
  const fill = buttons.color === 'accent' ? colors.accent : colors.primary
  const solid = buttons.style === 'solid'
  const label = solid ? (buttons.color === 'accent' ? colors.accentContrast : colors.primaryContrast) : fill
  const checks: LookCheck[] = []
  const button = checkContrast(label, solid ? fill : colors.surface)
  if (button)
    checks.push({
      id: 'button',
      pass: button.passesAA,
      verdict: button,
      message: button.passesAA
        ? `Button labels pass at ${button.display}.`
        : `Button labels are hard to read at ${button.display}. Ordinary-size text needs at least 4.5:1; choose a darker or lighter colour.`,
    })
  const onPage = checkContrast(colors.primary, colors.surface),
    onBand = checkContrast(colors.primary, colors.surfaceAlt)
  const brand = onPage && onBand ? (onBand.ratio < onPage.ratio ? onBand : onPage) : (onPage ?? onBand)
  if (brand)
    checks.push({
      id: 'brand-text',
      pass: brand.passesAA,
      verdict: brand,
      message: brand.passesAA
        ? `Text in this colour passes at ${brand.display} on the page and on quiet bands.`
        : `Small text in this colour, such as dates, roles and names, is hard to read at ${brand.display}. Choose a darker shade.`,
    })
  const body = checkContrast(colors.ink, colors.surface)
  if (body && !body.passesAA)
    checks.push({
      id: 'body-text',
      pass: false,
      verdict: body,
      message: `Body text is hard to read at ${body.display}. Adjust the text and page colours in Design.`,
    })
  return checks
}
