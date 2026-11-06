import { describe, expect, it } from 'vitest'
import { SOURCE_DRAWINGS } from './source-drawings.ts'

// The set is generated from V1's catalogue; this keeps what ships passive no
// matter how it was produced or edited.
describe('the code-owned source drawings', () => {
  it('holds only passive line art under stable names', () => {
    const entries = Object.entries(SOURCE_DRAWINGS)
    expect(entries.length).toBeGreaterThan(20)
    for (const [key, drawing] of entries) {
      expect(key).toMatch(/^d[0-9a-f]{10}$/)
      expect(drawing.label.trim()).not.toBe('')
      expect(drawing.svg).toMatch(/^<svg[\s>][\s\S]*<\/svg>$/)
      expect(drawing.svg).not.toMatch(
        /<\s*\/?\s*(script|style|foreignobject|use|image|a|iframe)\b|\bon[a-z]+\s*=|javascript:|url\s*\(|href/i,
      )
      const tags = [...drawing.svg.matchAll(/<([a-zA-Z]+)/g)].map(match => match[1]!.toLowerCase())
      expect(
        tags.every(tag =>
          ['svg', 'path', 'circle', 'rect', 'line', 'polyline', 'polygon', 'ellipse', 'g'].includes(tag),
        ),
      ).toBe(true)
    }
  })
})
