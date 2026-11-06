import { expect, it } from 'vitest'
import { reportLinksMarkup } from './report-links.ts'
import { escapeText } from './escape.ts'

it('copies report link labels literally while removing preview marks at both visitor widths', () => {
  for (const label of ['Label $`', 'Label $&', "Label $'", 'Label $$', 'Label $1']) {
    const clean = '<a href="#target">' + escapeText(label) + '</a>'
    const marked = '<a href="#target" data-cms-slot="links__i1__action">' + escapeText(label) + '</a>'
    const body =
      '<section><nav class="ar-jump" aria-label="On this page">' +
      marked +
      '</nav><div data-report-links-copy="true"></div></section>'
    expect(reportLinksMarkup(body, 'core-report-page-links')).toBe(
      '<section><nav class="ar-jump" aria-label="On this page">' +
        clean +
        '</nav><nav aria-label="On this page on phones">' +
        clean +
        '</nav></section>',
    )
  }
})
