import { describe, expect, it } from 'vitest'
import { checkContrast } from '@cms/domain'
import { DEFAULT_THEME_TOKENS, ThemeTokens } from '@cms/schema'
import {
  SELF_HOSTED_TYPE_PAIRINGS,
  BRAND_COLOURS,
  BUTTON_SHAPES,
  TYPE_PAIRINGS,
  brandColourFor,
  lookChecks,
  lookSummary,
  readableLabel,
  withBrandColour,
} from './site-look.ts'

const standard = () => ThemeTokens.parse(structuredClone(DEFAULT_THEME_TOKENS))

describe('the site wizard look choices', () => {
  it('starts on the standard design, which every summary names', () => {
    const theme = standard()
    expect(brandColourFor(theme)?.name).toBe('Navy')
    expect(lookSummary(theme)).toBe('Navy · Classic type · Soft buttons')
  })

  it('offers only brand colours that are readable under white labels and as small text on both page surfaces', () => {
    for (const colour of BRAND_COLOURS) {
      const theme = withBrandColour(standard(), colour.primary, colour.accent)
      expect({
        colour: colour.name,
        label: theme.colors.primaryContrast,
        accentLabel: theme.colors.accentContrast,
      }).toEqual({ colour: colour.name, label: '#ffffff', accentLabel: '#ffffff' })
      expect({
        colour: colour.name,
        failing: lookChecks(theme)
          .filter(check => !check.pass)
          .map(check => check.id),
      }).toEqual({ colour: colour.name, failing: [] })
      expect(ThemeTokens.safeParse(theme).success).toBe(true)
    }
  })

  it('chooses a dark label for a light colour of the editor’s own and says when small text in it would be hard to read', () => {
    const theme = withBrandColour(standard(), '#F2C14E')
    expect(theme.colors.primary).toBe('#f2c14e')
    expect(theme.colors.primaryContrast).toBe(DEFAULT_THEME_TOKENS.colors.ink)
    expect(theme.colors.accent).toBe(DEFAULT_THEME_TOKENS.colors.accent)
    const [button, text] = lookChecks(theme)
    expect(button).toMatchObject({ id: 'button', pass: true })
    expect(text).toMatchObject({ id: 'brand-text', pass: false })
    expect(text!.message).toContain('hard to read at 1.')
    expect(lookSummary(theme)).toBe('Your own colour #f2c14e · Classic type · Soft buttons')
  })

  it('never calls a 4.2:1 ordinary-size button label a pass, unlike V1', () => {
    // V1 set its ink on its brand red and reported “passes at 4.2:1”.
    const v1 = {
      ...standard(),
      colors: { ...standard().colors, primary: '#ef3e42', primaryContrast: DEFAULT_THEME_TOKENS.colors.ink },
    }
    const button = lookChecks(v1).find(check => check.id === 'button')!
    expect(button.verdict.display).toBe('4.2:1')
    expect(button.pass).toBe(false)
    expect(button.message).toContain('needs at least 4.5:1')
    // The wizard itself never produces that pair: it chooses black instead.
    expect(readableLabel('#ef3e42')).toBe('#000000')
    expect(checkContrast('#000000', '#ef3e42')!.passesAA).toBe(true)
  })

  it('measures outline and accent buttons against what is actually behind their labels', () => {
    const outline = { ...standard(), buttons: { ...standard().buttons, style: 'outline' as const } }
    expect(lookChecks(outline)[0]!.verdict.ratio).toBeCloseTo(
      checkContrast(outline.colors.primary, outline.colors.surface)!.ratio,
    )
    const accent = { ...standard(), buttons: { ...standard().buttons, color: 'accent' as const } }
    expect(lookChecks(accent)[0]!.verdict.ratio).toBeCloseTo(
      checkContrast(accent.colors.accentContrast, accent.colors.accent)!.ratio,
    )
  })

  it('writes only supported theme values', () => {
    for (const pairing of TYPE_PAIRINGS) {
      expect(
        ThemeTokens.safeParse({ ...standard(), fonts: { heading: pairing.heading, body: pairing.body } }).success,
      ).toBe(true)
    }
    for (const shape of BUTTON_SHAPES) {
      expect(
        ThemeTokens.safeParse({ ...standard(), buttons: { ...standard().buttons, radius: shape.radius } }).success,
      ).toBe(true)
    }
    expect(new Set(BRAND_COLOURS.map(colour => colour.primary)).size).toBe(BRAND_COLOURS.length)
  })
})

it('offers distinct, bounded font specimens using only shipped font families', () => {
  expect(SELF_HOSTED_TYPE_PAIRINGS.map(pair => pair.name)).toEqual(['Modern', 'Editorial', 'Reading'])
  for (const pair of SELF_HOSTED_TYPE_PAIRINGS) {
    expect(ThemeTokens.safeParse({ ...standard(), fonts: { heading: pair.heading, body: pair.body } }).success).toBe(
      true,
    )
    expect(pair.heading + pair.body).toMatch(/Open Sans/)
    expect(pair.heading + pair.body).not.toMatch(/https?:/)
  }
  expect(new Set(SELF_HOSTED_TYPE_PAIRINGS.map(pair => pair.heading + '|' + pair.body)).size).toBe(3)
})
