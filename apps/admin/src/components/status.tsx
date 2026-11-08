// Revision 8 status vocabulary, shared by dashboard, pages and publishing.
import { StatusPill, type StatusLabel } from './ui/status-pill.tsx'
export { STATUS_LABELS } from './ui/status-pill.tsx'
export type { StatusLabel } from './ui/status-pill.tsx'
const HEALTH_LABELS = ['Healthy', 'Delayed', 'Error'] as const
export type HealthLabel = (typeof HEALTH_LABELS)[number]
export function pageStatus(page: {
  published_version_id: string | null
  draft_version_id?: string | null
  status?: string
  no_visible_changes?: boolean
}): StatusLabel {
  if (page.status === 'archived') return 'Archived'
  if (page.status === 'error') return 'Error'
  if (page.status === 'submitted') return 'In review'
  if (page.status === 'scheduled') return 'Scheduled'
  if (!page.published_version_id) return 'Draft'
  return !page.no_visible_changes && page.draft_version_id && page.draft_version_id !== page.published_version_id
    ? 'Live · changes not published'
    : 'Live'
}
export function siteStatus(site: { status: string; published_count?: string; changed_count?: string }): StatusLabel {
  if (site.status === 'archived') return 'Archived'
  const live = site.published_count !== undefined ? Number(site.published_count) > 0 : site.status === 'live'
  if (live) return Number(site.changed_count ?? 0) > 0 ? 'Live · changes not published' : 'Live'
  return ['in_progress', 'onboarding', 'live'].includes(site.status) ? 'Draft' : 'Error'
}
// Retain the import name while screens migrate, with one visual implementation.
export function StatusChip({
  status,
  title,
  compact,
}: {
  status: StatusLabel
  compact?: boolean
  title?: string | undefined
  size?: 'lg'
}) {
  return <StatusPill status={status} title={title} compact={compact} />
}
export function HealthChip({ health, title }: { health: HealthLabel; title?: string }) {
  const css = health === 'Healthy' ? 'chip-published' : health === 'Delayed' ? 'chip-draft' : 'chip-error'
  return (
    <span className={`chip ${css}`} title={title}>
      {health}
    </span>
  )
}

export const unpublishedChangeLabel = (count: number) => `${count} ${count === 1 ? 'change' : 'changes'} not live`
