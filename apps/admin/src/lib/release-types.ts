import type { ReadinessReport } from '@cms/domain'

export type ReleaseType =
  | 'page'
  | 'theme'
  | 'navigation'
  | 'frame'
  | 'collection_schema'
  | 'collection_entries'
  | 'site_files'
  | 'chapter_setup'
  | 'site_settings'
export type ReleaseItem = {
  key: string
  type: ReleaseType
  id: string
  label: string
  revision: string
  versionId: string | null
  secondaryRevision?: string
  secondaryVersionId?: string | null
  unpublished?: boolean
  requiresAdmin?: boolean
  action?: 'publish' | 'unpublish'
  recoveryId?: string
  entryIds?: string[]
}

export type ReleaseCheck = {
  pageId: string
  versionId: string
  title: string
  report: ReadinessReport
  fixLinks?: string[]
}
export type ReleaseRow = {
  id: string
  site_id: string
  status: 'planned' | 'applied' | 'cancelled'
  snapshot: ReleaseItem[]
  context_hash: string
  after_hash: string
  preview_report: ReleaseCheck[]
  created_at: Date
  finished_at: Date | null
  created_by: string
  finished_by?: string | null
  stale?: boolean
  scope_before_hash?: string | null
  scope_after_hash?: string | null
}
