import type { PageHistoryRow } from '../../../../lib/queries.ts'

export function historyLabel(version: PageHistoryRow): string {
  if (version.is_live_now) return 'Live now'
  if (version.is_current_draft) return 'Current draft'
  if (version.was_published) return 'Published before'
  if (version.was_restored) return 'Restored version'
  if (version.kind === 'checkpoint') return 'Saved draft'
  if (version.kind === 'autosave') return 'Automatic save'
  return 'Saved version'
}

const historyDate = new Intl.DateTimeFormat('en-US', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'America/New_York',
})

export function historyTime(date: Date): string {
  return historyDate.format(date)
}

export function historyHref(
  pageId: string,
  options: {
    version?: string
    compare?: string | undefined
    includeAutosaves: boolean
    before?: string | null
  },
): string {
  const params = new URLSearchParams()
  if (options.version) params.set('version', options.version)
  if (options.compare && options.compare !== options.version) params.set('compare', options.compare)
  if (options.includeAutosaves) params.set('automatic', '1')
  if (options.before) params.set('before', String(options.before))
  const query = params.toString()
  return `/pages/${pageId}/history${query ? `?${query}` : ''}`
}
