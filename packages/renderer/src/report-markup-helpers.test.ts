import { describe, expect, it } from 'vitest'
import { hasWords, hideElement } from './report-template.ts'

describe('shared report markup helpers', () => {
  it('treats tags and every non-breaking space spelling as empty', () => {
    for (const empty of ['', ' ', '<p></p>', '&nbsp;', '&#160;', '&#xa0;', '<p>&#xA0;</p>', undefined, 3])
      expect(hasWords(empty)).toBe(false)
    expect(hasWords('<p>Jamaica</p>')).toBe(true)
  })

  it('hides only the first exact tag and class', () => {
    const body = '<div class="a"></div><div class="a"></div><div class="a b"></div>'
    expect(hideElement(body, 'div', 'a')).toBe(
      '<div class="a" hidden></div><div class="a"></div><div class="a b"></div>',
    )
  })
})
