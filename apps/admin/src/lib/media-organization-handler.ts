import type { MediaLibraryQuery, MediaScopeFilter, MediaSort, MediaStatus } from './media-library.ts'

const STATUSES = new Set(['all', 'ready', 'processing', 'failed', 'deleted'])
const SCOPES = new Set(['all', 'site', 'shared'])
const SORTS = new Set(['newest', 'oldest', 'name-asc', 'name-desc'])

export function mediaLibraryResponse(status: number, message: string): Response {
  return Response.json(
    { error: { code: 'media-library-invalid', message } },
    {
      status,
      headers: { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' },
    },
  )
}

export function mediaLibraryQuery(params: URLSearchParams): MediaLibraryQuery | null {
  const search = (params.get('search') ?? '').trim()
  const status = params.get('status') ?? 'all'
  const scope = params.get('scope') ?? 'all'
  const folder = (params.get('folder') ?? '').trim()
  const tag = (params.get('tag') ?? '').trim().toLocaleLowerCase()
  const sort = params.get('sort') ?? 'newest'
  const pageRaw = params.get('page') ?? '1'
  const sizeRaw = params.get('pageSize') ?? '24'
  if (
    search.length > 200 ||
    folder.length > 200 ||
    tag.length > 48 ||
    !STATUSES.has(status) ||
    !SCOPES.has(scope) ||
    !SORTS.has(sort) ||
    !/^\d+$/.test(pageRaw) ||
    !/^\d+$/.test(sizeRaw)
  )
    return null
  const page = Number(pageRaw)
  const pageSize = Number(sizeRaw)
  if (!Number.isSafeInteger(page) || page < 1 || page > 100_000 || ![12, 24, 48].includes(pageSize)) return null
  return {
    search,
    status: status as 'all' | MediaStatus,
    scope: scope as MediaScopeFilter,
    folder,
    tag,
    sort: sort as MediaSort,
    page,
    pageSize,
  }
}
