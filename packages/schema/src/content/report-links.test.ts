import { expect, it } from 'vitest'
import { reportPageLinkValues } from './report-links.ts'
it('derives only unique visible primary section destinations and current plain heading values', () => {
  const content = [
    { values: { __cms_anchor: 'first-section', heading: '[First heading]' } },
    { hidden: true, values: { __cms_anchor: 'hidden-section', heading: '[Hidden]' } },
    { values: { __cms_anchor_aliases: ['old-section'], heading: '[Earlier name]' } },
    { values: { __cms_anchor: 'javascript:alert(1)', heading: '[Invalid]' } },
    { values: { __cms_anchor: 'duplicate', heading: '[First duplicate]' } },
    { values: { __cms_anchor: 'duplicate', heading: '[Second duplicate]' } },
    { values: { __cms_anchor: 'last-section', title: '[Last heading]' } },
  ]
  const values = reportPageLinkValues(content)
  expect(values).toEqual({
    links: { items: ['i1', 'i2'] },
    links__i1__action: { url: '#first-section', label: '[First heading]' },
    links__i2__action: { url: '#last-section', label: '[Last heading]' },
  })
  expect(
    reportPageLinkValues([{ ...content[0]!, values: { ...content[0]!.values, page_link_label: '[Short link]' } }])
      .links__i1__action,
  ).toEqual({ url: '#first-section', label: '[Short link]' })
  content[0]!.values!.heading = '[Updated heading]'
  expect(reportPageLinkValues(content).links__i1__action).toEqual({ url: '#first-section', label: '[Updated heading]' })
})
