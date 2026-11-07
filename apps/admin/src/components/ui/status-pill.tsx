import type { ReactNode } from 'react'
import styles from './status-pill-styles.module.css'
export const STATUS_LABELS = [
  'Draft',
  'Live',
  'Live · changes not published',
  'Scheduled',
  'In review',
  'Hidden',
  'Archived',
  'Error',
] as const
export type StatusLabel = (typeof STATUS_LABELS)[number]
const tones: Record<StatusLabel, string> = {
  Draft: 'draft',
  Live: 'live',
  'Live · changes not published': 'pending',
  Scheduled: 'scheduled',
  'In review': 'review',
  Hidden: 'hidden',
  Archived: 'archived',
  Error: 'error',
}
export function StatusPill({
  status,
  title,
  scheduledAt,
  compact = false,
}: {
  status: StatusLabel
  title?: string | undefined
  scheduledAt?: string
  compact?: boolean
}) {
  return (
    <span
      className={styles.pill}
      data-status={tones[status]}
      title={title ?? (compact ? (status === 'Live · changes not published' ? 'Changes not live' : status) : undefined)}
    >
      {status === 'Live · changes not published' ? 'Changes not live' : status}
      {scheduledAt && ` · ${scheduledAt}`}
    </span>
  )
}

export function Badge({
  children,
  tone = 'neutral',
  title,
  truncate = false,
}: {
  children: ReactNode
  title?: string
  truncate?: boolean
  tone?: 'neutral' | 'pending' | 'live' | 'review' | 'error' | 'info'
}) {
  return (
    <span
      className={styles.pill}
      data-density="compact"
      data-status={tone}
      data-truncate={truncate || undefined}
      title={title}
    >
      {truncate ? <span>{children}</span> : children}
    </span>
  )
}
