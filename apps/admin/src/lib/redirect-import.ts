import { parseCsvRows } from '@cms/schema'
export type RedirectPage = { id: string; title: string; path: string; publishedPath: string | null }
export type RedirectRow = {
  id: string
  revision: string
  oldPath: string
  pageId: string
  title: string
  publishedPath: string | null
}
export type RedirectImportRow = {
  line: number
  oldPath: string
  newPath: string
  pageId: string | null
  id: string | null
  revision: string
  issue: string | null
  unchanged: boolean
}
export function redirectPath(input: string): string | null {
  const path = input.trim().toLowerCase().replace(/\/+$/, '')
  return path.length >= 2 &&
    path.length <= 2048 &&
    /^(\/[a-z0-9][a-z0-9._-]*)+$/.test(path) &&
    !path.includes('..') &&
    !/^\/(api|_next|_cms|assets|media|documents|fonts|scripts|styles|images|preview|previews)(\/|$)/.test(path) &&
    !/\.(js|css|json|jpe?g|png|gif|webp|svg|ico|woff2?|ttf|otf|eot)$/.test(path) &&
    !['/robots.txt', '/sitemap.xml'].includes(path)
    ? path
    : null
}
export function previewRedirectCsv(
  source: string,
  pages: RedirectPage[],
  existing: RedirectRow[],
): RedirectImportRow[] {
  if (source.length > 262144) throw new Error('Use a spreadsheet with at most 200 redirects.')
  const rows = parseCsvRows(source.replace(/^\uFEFF/, ''))
  const header = rows.shift()?.map(value => value.trim().toLowerCase())
  if (!header || header.length !== 2 || header[0] !== 'old address' || header[1] !== 'new address')
    throw new Error('Use two columns named Old address and New address, then save the spreadsheet as CSV.')
  if (!rows.length || rows.length > 200) throw new Error('Add between 1 and 200 redirect rows.')
  const seen = new Set<string>()
  return rows.map((cells, index) => {
    const old = redirectPath(cells[0] ?? '')
    const rawNew = (cells[1] ?? '').trim().toLowerCase()
    const newPath = rawNew === '/' ? '/' : rawNew.replace(/\/+$/, '')
    const page = pages.find(page => page.path === newPath || page.publishedPath === newPath)
    const current = existing.find(row => row.oldPath === old)
    let issue =
      cells.length !== 2
        ? 'Use exactly two cells on this row.'
        : !old
          ? 'Use an old page address, beginning with /.'
          : !page
            ? 'Choose a page on this site for the new address.'
            : pages.some(page => page.path === old || page.publishedPath === old)
              ? 'A page already uses the old address.'
              : old && seen.has(old)
                ? 'This old address appears twice in the spreadsheet.'
                : null
    if (old) seen.add(old)
    return {
      line: index + 2,
      oldPath: old ?? cells[0] ?? '',
      newPath,
      pageId: page?.id ?? null,
      id: current?.id ?? null,
      revision: current?.revision ?? '0',
      issue,
      unchanged: Boolean(current && page && current.pageId === page.id),
    }
  })
}
