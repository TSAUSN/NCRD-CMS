import type { MediaLibraryQuery } from './media-library.ts'

export const DEFAULT_MEDIA_LIBRARY_QUERY: MediaLibraryQuery = {
  search: '',
  status: 'all',
  scope: 'all',
  folder: '',
  tag: '',
  sort: 'newest',
  page: 1,
  pageSize: 24,
}
