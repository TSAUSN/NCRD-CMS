import { it, expect } from 'vitest'
import { renderEchelonDirectory } from './echelon-directory.ts'
import { ECHELON_MAP_POINTS } from './echelon-map-points.ts'
it('maps immutable identities to current published destinations while keeping unknown chapters in native lists and escaping text', () => {
  const html = renderEchelonDirectory({
    pagePath: '/',
    widgetKey: 's3',
    chapters: [
      { slug: 'peoria', name: '[Renamed chapter]', path: '/chapters/renamed' },
      {
        slug: 'new-chapter',
        name: '[New chapter]',
        externalUrl: 'https://division.example.test/echelon',
        destination: 'division',
      },
      { slug: 'unsafe', name: '<img src=x onerror=alert(1)>', path: '/safe' },
      { slug: 'blocked', name: '[Blocked]', externalUrl: 'javascript:alert(1)' },
    ],
  })
  expect(html).toContain('href="/chapters/renamed" data-chapter-marker="peoria"')
  expect(html).toContain('cx="' + ECHELON_MAP_POINTS.peoria!.x + '"')
  expect(html).toContain('data-chapter-entry="new-chapter"')
  expect(html).not.toContain('data-chapter-marker="new-chapter"')
  expect(html).toContain('rel="noopener noreferrer"')
  expect(html).not.toContain('javascript:')
  expect(html).not.toContain('<img src=x')
  expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;')
  expect(html).toContain('action="/#ech-directory-s3-list"')
  expect(html).not.toContain('<script')
})
it('native GET filtering hides unmatched list entries and map markers while retaining clear empty states', () => {
  const chapters = [
      { slug: 'peoria', name: 'Peoria Chapter', path: '/chapters/peoria' },
      { slug: 'detroit', name: 'Detroit Chapter', externalUrl: 'https://chapter.example.test/' },
    ],
    html = renderEchelonDirectory({ chapters, query: 'Detroit' })
  expect(html).toContain('aria-label="Peoria Chapter" hidden')
  expect(html).toContain('data-chapter-entry="peoria" data-chapter-name="Peoria Chapter" hidden')
  expect(html).toContain('1 chapter found')
  expect(renderEchelonDirectory({ chapters, query: 'No matching chapter' })).toContain(
    'No chapters match your search. Try another name.',
  )
  expect(renderEchelonDirectory({ chapters: [] })).toContain(
    'Chapter information is being updated. Contact Echelon to get connected.',
  )
})
