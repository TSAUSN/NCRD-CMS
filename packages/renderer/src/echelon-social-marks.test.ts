import { it, expect } from 'vitest'
import { renderEchelonSocialMarks } from './echelon-social-marks.ts'
it('adds only fixed local brand marks inside the approved social nav and keeps destinations and accessible names', () => {
  const html =
      '<nav class="echelon-social" aria-label="Echelon social media"><a href="https://facebook.com/account/" target="_blank" rel="noopener noreferrer">Facebook</a></nav><nav class="echelon-jump"><a href="#facebook">Facebook</a></nav>',
    result = renderEchelonSocialMarks(html, 'core-echelon-jump-links')
  expect(result).toContain('aria-label="Echelon on Facebook"')
  expect(result).toContain('<svg aria-hidden="true"')
  expect(result).toContain('href="https://facebook.com/account/" target="_blank" rel="noopener noreferrer"')
  expect(result).toContain('<nav class="echelon-jump"><a href="#facebook">Facebook</a></nav>')
  expect(result).not.toMatch(/<script|onload|<img/)
  expect(renderEchelonSocialMarks(html, 'core-on-page-navigation')).toBe(html)
  const follow = renderEchelonSocialMarks(
    '<nav class="ech-social-placeholders"><a href="https://instagram.com/account/">Instagram</a><a href="https://example.test/account">[Other account]</a></nav>',
    'core-echelon-follow',
  )
  expect(follow).toContain('bi-instagram')
  expect(follow).toContain('</svg>Instagram</a>')
  expect(follow).toContain('<a href="https://example.test/account">[Other account]</a>')
})

it('omits social links without a destination while preserving ordinary page jumps', () => {
  for (const [slug, className] of [
    ['core-echelon-follow', 'ech-social-placeholders'],
    ['core-echelon-jump-links', 'echelon-social'],
  ]) {
    const empty =
      '<a href="#">Facebook</a><cms-slot data-cms-slot="links__i2__action"><a href="">[Other account]</a></cms-slot><a href="&#35;placeholder">Instagram</a>'
    const jump = '<nav class="echelon-jump"><a href="#chapter">[Chapter]</a></nav>'
    const body =
      '<nav class="' + className + '">' + empty + '<a href="https://instagram.com/account/">Instagram</a></nav>' + jump
    const result = renderEchelonSocialMarks(body, slug)
    expect(result).not.toContain('>Facebook</a>')
    expect(result).not.toContain('>[Other account]</a>')
    expect(result).not.toContain('href="&#35;placeholder"')
    expect(result).toContain('href="https://instagram.com/account/"')
    expect(result).toContain('bi-instagram')
    expect(result).toContain(jump)
    expect(renderEchelonSocialMarks('<nav class="' + className + '">' + empty + '</nav>', slug)).toBe('')
    expect(renderEchelonSocialMarks(body, 'core-on-page-navigation')).toBe(body)
  }
})
