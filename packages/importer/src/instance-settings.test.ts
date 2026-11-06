import { describe, expect, it } from 'vitest'
import { applyInstanceSettings } from './instance-settings.ts'
import { staticCompatibility } from './static-compatibility.ts'

describe('V1 saved section positions', () => {
  const html =
    '<section class="fe-section" style="--rows:12"><h1 data-fe-block="hero-title" style="--c0:1;--c1:12">Saved title</h1></section>'
  it('carries the real bounded desktop grid and mobile density without losing copy', () => {
    const result = applyInstanceSettings(html, {
      freeform: { v: 1, grid: { d: { rows: 15 } }, blocks: { 'hero-title': { d: { c0: 14, c1: 23, r0: 2, r1: 9 } } } },
      mobileDensity: 'compact',
    })
    expect(result.html).toMatch(/--rows:\s*15/)
    expect(result.html).toMatch(/--c0:\s*14;--c1:\s*23;--r0:\s*2;--r1:\s*9/)
    expect(result.html).toContain('Saved title')
    expect(result.css).toContain('zoom:0.92')
    expect(result.issues).toEqual(['source-freeform-grid-preserved', 'source-mobile-density-preserved'])
    expect(staticCompatibility({ slug: 'saved-layout', html: result.html, css: result.css }).compiled).not.toBeNull()
  })
  it('refuses partial rectangles and never lets a settings value become CSS', () => {
    const result = applyInstanceSettings(html, {
      freeform: { blocks: { 'hero-title': { d: { c0: 23, c1: 14, r0: 2, r1: '9;display:none' } } } },
      mobileDensity: 'url(https://example.test)',
    })
    expect(result.html).toContain('--c0:1;--c1:12')
    expect(result.html).not.toContain('display:none')
    expect(result.css).toBe('')
    expect(result.issues).toContain('freeform-invalid-rectangle-preserved-in-source')
  })
  it('finds the grid inside the wrapper an imported section adds, as V1 finds it by its class', () => {
    const wrapped = `<div class="v1-reference-root"><section class="hni-hero">${html}</section></div>`
    const result = applyInstanceSettings(wrapped, {
      freeform: { grid: { d: { rows: 15 } }, blocks: { 'hero-title': { d: { c0: 14, c1: 23, r0: 2, r1: 9 } } } },
    })
    expect(result.html).toMatch(/<section class="fe-section" style="--rows:\s*15">/)
    expect(result.html).toMatch(/--r0:\s*2;--r1:\s*9/)
    expect(result.issues).toEqual(['source-freeform-grid-preserved'])
    expect(applyInstanceSettings('<div><p>No grid</p></div>', { freeform: { blocks: {} } }).issues).toEqual([
      'freeform-root-mapping-review',
    ])
  })
})
