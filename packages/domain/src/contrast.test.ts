import { describe, expect, it } from 'vitest'
import { checkContrast, composite, contrastFindings, contrastRatio, parseColor, relativeLuminance } from './contrast.ts'

describe('parseColor', () => {
  it.each([
    ['#000', { r: 0, g: 0, b: 0, a: 1 }],
    ['#fff', { r: 255, g: 255, b: 255, a: 1 }],
    ['#1f4e79', { r: 31, g: 78, b: 121, a: 1 }],
    ['#1F4E79', { r: 31, g: 78, b: 121, a: 1 }],
    ['1f4e79', { r: 31, g: 78, b: 121, a: 1 }],
    ['rgb(31, 78, 121)', { r: 31, g: 78, b: 121, a: 1 }],
    ['rgba(31, 78, 121, 0.5)', { r: 31, g: 78, b: 121, a: 0.5 }],
    ['white', { r: 255, g: 255, b: 255, a: 1 }],
  ])('parses %s', (input, expected) => {
    expect(parseColor(input)).toEqual(expected)
  })

  it('parses eight-digit hex alpha', () => {
    expect(parseColor('#00000080')?.a).toBeCloseTo(0.502, 2)
  })

  it.each(['', 'not-a-colour', '#12345', 'rgb(1,2)', 'var(--x)'])('refuses %p', input => {
    expect(parseColor(input)).toBeNull()
  })
})

describe('WCAG reference values', () => {
  it('black on white is 21:1', () => {
    expect(contrastRatio(parseColor('#000')!, parseColor('#fff')!)).toBeCloseTo(21, 5)
  })

  it('white on white is 1:1', () => {
    expect(contrastRatio(parseColor('#fff')!, parseColor('#fff')!)).toBeCloseTo(1, 5)
  })

  it('is symmetric — order of the pair does not change the ratio', () => {
    const a = contrastRatio(parseColor('#1f4e79')!, parseColor('#fff')!)
    const b = contrastRatio(parseColor('#fff')!, parseColor('#1f4e79')!)
    expect(a).toBeCloseTo(b, 10)
  })

  it('computes the reference luminance of mid grey', () => {
    expect(relativeLuminance(parseColor('#808080')!)).toBeCloseTo(0.2159, 3)
  })
})

describe('the v1 D14 reproduction', () => {
  // The exact defect: an outline button set to navy on a dark hero published at
  // a measured failure without a murmur.
  it('measures navy on navy as a failure and says so in plain language', () => {
    const verdict = checkContrast('#1f4e79', '#2a5f8f')!
    expect(verdict.passesAA).toBe(false)
    expect(verdict.message).toMatch(/Hard to read/)
    expect(verdict.message).toContain(verdict.display)
    // No standards jargon in editor-facing copy (SPEC §7).
    expect(verdict.message).not.toMatch(/WCAG|AA|ratio|luminance/)
  })

  it('passes white on that same navy', () => {
    expect(checkContrast('#ffffff', '#1f4e79')!.passesAA).toBe(true)
  })
})

describe('thresholds', () => {
  it('applies the lower bar to large text', () => {
    // A pair between 3:1 and 4.5:1 passes as large text and fails as body text.
    const foreground = '#767676'
    const background = '#ffffff'
    const normal = checkContrast(foreground, background)!
    const large = checkContrast(foreground, background, { largeText: true })!
    expect(normal.ratio).toBeGreaterThan(3)
    expect(normal.ratio).toBeLessThan(7)
    expect(large.passesAA).toBe(true)
  })

  it('reports AAA separately from AA', () => {
    // #767676 on white is 4.54:1 — over the AA bar, under the AAA one.
    const verdict = checkContrast('#767676', '#ffffff')!
    expect(verdict.passesAA).toBe(true)
    expect(verdict.passesAAA).toBe(false)
  })
})

describe('translucency is composited, not ignored', () => {
  it('flattens a half-transparent colour onto its background before measuring', () => {
    const flattened = composite(parseColor('rgba(255,255,255,0.5)')!, parseColor('#000')!)
    expect(flattened.r).toBeCloseTo(127.5, 1)
    expect(flattened.a).toBe(1)
  })

  it('a translucent white on navy measures lower than opaque white would', () => {
    const opaque = checkContrast('#ffffff', '#1f4e79')!.ratio
    const translucent = checkContrast('rgba(255,255,255,0.35)', '#1f4e79')!.ratio
    expect(translucent).toBeLessThan(opaque)
  })
})

describe('the displayed ratio never flatters the choice', () => {
  it('rounds down, so a shown 4.4 is never actually 4.49', () => {
    const verdict = checkContrast('#949494', '#ffffff')!
    const shown = Number(verdict.display.replace(':1', ''))
    expect(shown).toBeLessThanOrEqual(verdict.ratio)
  })
})

describe('unknown colours are not treated as fine', () => {
  it('returns null rather than a passing verdict', () => {
    expect(checkContrast('var(--brand)', '#fff')).toBeNull()
    expect(checkContrast('#fff', 'oklch(0.7 0.1 200)')).toBeNull()
  })
})

describe('publish readiness', () => {
  it('collects only the failing pairs, each with what to tell the person', () => {
    const failures = contrastFindings([
      { label: 'Button label', foreground: '#1f4e79', background: '#2a5f8f' },
      { label: 'Body text', foreground: '#111111', background: '#ffffff' },
      { label: 'Section heading', foreground: '#cccccc', background: '#ffffff', largeText: true },
    ])
    expect(failures.map(f => f.label)).toEqual(['Button label', 'Section heading'])
    expect(failures[0]!.verdict.display).toMatch(/^\d+\.\d:1$/)
  })

  it('finds nothing when every pair is readable', () => {
    expect(contrastFindings([{ label: 'ok', foreground: '#000', background: '#fff' }])).toEqual([])
  })
})
