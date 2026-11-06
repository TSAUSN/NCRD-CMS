import { describe, it, expect } from 'vitest'
import { renderStoryGrid, storyGridColumns } from './story-grid.ts'
describe('shared Story grid', () => {
  it('prefers full rows of four then three, with a half-width lone card and centered last row', () => {
    expect(Array.from({ length: 16 }, (_, i) => storyGridColumns(i + 1))).toEqual([
      2, 2, 3, 4, 3, 3, 3, 4, 3, 4, 3, 4, 3, 4, 3, 4,
    ])
  })
  it('counts actual direct cards after filtering, independently for each grid and without rewriting their contents', () => {
    const cards = (n: number) =>
        Array.from(
          { length: n },
          (_, i) => `<article class="core-story-card"><h3>Story ${i + 1}</h3><div>Body &amp; photo</div></article>`,
        ).join(''),
      first = cards(1),
      second = cards(6),
      html = `<section><div class="core-story-grid">${first}</div><div class="core-story-grid">${second}</div></section>`,
      out = renderStoryGrid(html)
    expect(out).toBe(
      `<section><div data-cms-story-grid="2" class="core-story-grid">${first}</div><div data-cms-story-grid="3" class="core-story-grid">${second}</div></section>`,
    )
    expect(renderStoryGrid(out)).toBe(out)
    expect(renderStoryGrid('<div class="other">unchanged</div>')).toBe('<div class="other">unchanged</div>')
  })
  it('omits only empty tag families on Story cards, preserving populated tags and tag-toggle ownership', () => {
    const tags = (sectors: string, region: string) =>
      '<div class="core-story-tags"><b>Project sector</b><div class="core-story-sectors">' +
      sectors +
      '</div><b>Region</b><span class="core-story-region-pill">' +
      region +
      '</span></div>'
    const html =
        '<div class="core-story-grid"><article class="core-story-card">' +
        tags('<p> &nbsp; </p>', 'Africa') +
        '</article><article class="core-story-card">' +
        tags('<a href="/health">Health</a>', '') +
        '</article><article class="core-story-card">' +
        tags('', '') +
        '</article></div><aside>' +
        tags('', '') +
        '</aside>',
      out = renderStoryGrid(html)
    expect(out).toContain(
      '<div class="core-story-tags"><b>Region</b><span class="core-story-region-pill">Africa</span></div>',
    )
    expect(out).toContain(
      '<div class="core-story-tags"><b>Project sector</b><div class="core-story-sectors"><a href="/health">Health</a></div></div>',
    )
    expect(out).toContain('<article class="core-story-card"><div class="core-story-tags"></div></article>')
    expect(out).toContain('<aside>' + tags('', '') + '</aside>')
    expect(renderStoryGrid(out)).toBe(out)
  })
})
