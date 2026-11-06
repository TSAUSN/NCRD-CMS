import { expect, it } from 'vitest'
import { redirectPath, previewRedirectCsv, type RedirectPage } from './redirect-import.ts'
const pages: RedirectPage[] = [
  { id: 'one', title: 'Peoria', path: '/chapters/peoria', publishedPath: '/chapters/peoria' },
  { id: 'home', title: 'Home', path: '/', publishedPath: '/' },
]
it('previews spreadsheet rows using only pages of the selected site and keeps exact update revisions', () => {
  const current = {
    id: 'redirect',
    revision: '4',
    oldPath: '/chapter/peoria',
    pageId: 'one',
    title: 'Peoria',
    publishedPath: '/chapters/peoria',
  }
  expect(
    previewRedirectCsv('\uFEFFOld address,New address\r\n"/Chapter/Peoria/","/chapters/peoria"\r\n/old-home,/', pages, [
      current,
    ]),
  ).toEqual([
    {
      line: 2,
      oldPath: '/chapter/peoria',
      newPath: '/chapters/peoria',
      pageId: 'one',
      id: 'redirect',
      revision: '4',
      issue: null,
      unchanged: true,
    },
    {
      line: 3,
      oldPath: '/old-home',
      newPath: '/',
      pageId: 'home',
      id: null,
      revision: '0',
      issue: null,
      unchanged: false,
    },
  ])
})
it('names every malformed, conflicting, duplicate or foreign row without silently dropping it', () => {
  const rows = previewRedirectCsv(
    'Old address,New address\n/chapters/peoria,/\n/old,/missing\n/old,/\n/old,/\nhttps://example.test,/\n/extra,/,third',
    pages,
    [],
  )
  expect(rows).toHaveLength(6)
  expect(rows.map(row => row.issue)).toEqual([
    'A page already uses the old address.',
    'Choose a page on this site for the new address.',
    'This old address appears twice in the spreadsheet.',
    'This old address appears twice in the spreadsheet.',
    'Use an old page address, beginning with /.',
    'Use exactly two cells on this row.',
  ])
  for (const path of [
    '//evil',
    '/../path',
    '/assets/file',
    '/api',
    '/robots.txt',
    '/scripts.js',
    '/old?x=1',
    '/old%2fpath',
    '/old\\path',
  ])
    expect(redirectPath(path)).toBeNull()
  for (const source of ['', 'old,new\n/a,/', 'Old address,New address', 'Old address,New address\n"unfinished'])
    expect(() => previewRedirectCsv(source, pages, [])).toThrow()
})
