// The colour guardrail (SPEC §6.4/D14, §6.6).
//
// v1's wizard measured contrast; its colour pickers did not, and an outline
// button set to navy on a dark hero published at a measured 4.2:1 without a
// murmur. The lesson is not "add a check to the picker" — it is that one
// implementation has to serve every colour decision point, so a new picker
// cannot be added without it.
//
// WCAG 2.1 relative luminance and contrast ratio, computed exactly.

export const WCAG_AA_NORMAL = 4.5
export const WCAG_AA_LARGE = 3
export const WCAG_AAA_NORMAL = 7

export type Rgb = { r: number; g: number; b: number; a: number }

const HEX = /^#?([0-9a-f]{3,8})$/i
const RGB_FUNCTION = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.%]+))?\s*\)$/i

/** Parse the colour notations a theme token or a picker can produce. */
export function parseColor(value: string): Rgb | null {
  const input = value.trim().toLowerCase()

  const named = NAMED[input]
  if (named) return named

  const hex = HEX.exec(input)
  if (hex) {
    const digits = hex[1]!
    const expand = (pair: string) => parseInt(pair.length === 1 ? pair + pair : pair, 16)
    if (digits.length === 3 || digits.length === 4) {
      return {
        r: expand(digits[0]!),
        g: expand(digits[1]!),
        b: expand(digits[2]!),
        a: digits.length === 4 ? expand(digits[3]!) / 255 : 1,
      }
    }
    if (digits.length === 6 || digits.length === 8) {
      return {
        r: expand(digits.slice(0, 2)),
        g: expand(digits.slice(2, 4)),
        b: expand(digits.slice(4, 6)),
        a: digits.length === 8 ? expand(digits.slice(6, 8)) / 255 : 1,
      }
    }
    return null
  }

  const fn = RGB_FUNCTION.exec(input)
  if (fn) {
    const alpha = fn[4]
    return {
      r: Number(fn[1]),
      g: Number(fn[2]),
      b: Number(fn[3]),
      a: alpha === undefined ? 1 : alpha.endsWith('%') ? Number(alpha.slice(0, -1)) / 100 : Number(alpha),
    }
  }

  return null
}

const NAMED: Record<string, Rgb> = {
  black: { r: 0, g: 0, b: 0, a: 1 },
  white: { r: 255, g: 255, b: 255, a: 1 },
  transparent: { r: 0, g: 0, b: 0, a: 0 },
}

function channel(value: number): number {
  const c = value / 255
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}

export function relativeLuminance(color: Rgb): number {
  return 0.2126 * channel(color.r) + 0.7152 * channel(color.g) + 0.0722 * channel(color.b)
}

/**
 * Flatten a translucent colour onto what is behind it. Without this, a
 * half-transparent white on navy measures as if it were opaque white and the
 * check passes a combination a reader cannot actually read.
 */
export function composite(foreground: Rgb, background: Rgb): Rgb {
  if (foreground.a >= 1) return foreground
  const a = foreground.a
  return {
    r: foreground.r * a + background.r * (1 - a),
    g: foreground.g * a + background.g * (1 - a),
    b: foreground.b * a + background.b * (1 - a),
    a: 1,
  }
}

export function contrastRatio(foreground: Rgb, background: Rgb): number {
  const front = relativeLuminance(composite(foreground, background))
  const back = relativeLuminance(background)
  const lighter = Math.max(front, back)
  const darker = Math.min(front, back)
  return (lighter + 0.05) / (darker + 0.05)
}

export type ContrastVerdict = {
  ratio: number
  /** Rounded the way it is shown to a person: "4.2:1". */
  display: string
  passesAA: boolean
  passesAAA: boolean
  /** Plain language, editor-facing. No standards jargon (SPEC §7). */
  message: string
}

export type ContrastOptions = {
  /** 18pt+, or 14pt+ bold, which WCAG allows at a lower ratio. */
  largeText?: boolean
}

/**
 * Measure a colour choice against the background it will actually sit on.
 * Returns null when either colour cannot be parsed — a caller must not silently
 * treat "unknown" as "fine".
 */
export function checkContrast(
  foreground: string,
  background: string,
  options: ContrastOptions = {},
): ContrastVerdict | null {
  const front = parseColor(foreground)
  const back = parseColor(background)
  if (!front || !back) return null

  const ratio = contrastRatio(front, back)
  // Rounded down, so a value shown as 4.5 is never actually 4.449.
  const display = `${(Math.floor(ratio * 10) / 10).toFixed(1)}:1`
  const threshold = options.largeText ? WCAG_AA_LARGE : WCAG_AA_NORMAL
  const passesAA = ratio >= threshold

  return {
    ratio,
    display,
    passesAA,
    passesAAA: ratio >= WCAG_AAA_NORMAL,
    message: passesAA
      ? `Good contrast (${display}). This will be readable for most people.`
      : `Hard to read (${display}). Text this close in colour to its background is difficult for many ` +
        `people to see. Try a lighter or darker shade.`,
  }
}

/**
 * The blocking half (SPEC §6.8): a failing colour combination becomes a
 * publish-readiness finding, overridable only with a logged reason.
 */
export function contrastFindings(
  pairs: readonly { label: string; foreground: string; background: string; largeText?: boolean }[],
): { label: string; verdict: ContrastVerdict }[] {
  const failures: { label: string; verdict: ContrastVerdict }[] = []
  for (const pair of pairs) {
    const verdict = checkContrast(pair.foreground, pair.background, { largeText: pair.largeText })
    if (verdict && !verdict.passesAA) failures.push({ label: pair.label, verdict })
  }
  return failures
}
