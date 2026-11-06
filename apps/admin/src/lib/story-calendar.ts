import type { StoryListRow } from './story-list.ts'
export type StoryCalendarJob = {
  id: string
  entryId: string
  title: string
  runAt: string
  status: 'pending' | 'running' | 'succeeded' | 'failed' | 'needs_review'
  releaseId: string | null
}
export function validStoryDay(day: unknown): day is string {
  return (
    typeof day === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(day) &&
    Number(day.slice(0, 4)) >= 2000 &&
    Number(day.slice(0, 4)) <= 2200 &&
    Number.isFinite(Date.parse(day + 'T12:00:00Z')) &&
    new Date(day + 'T12:00:00Z').toISOString().slice(0, 10) === day
  )
}
export function calendarDay(date: Date, zone = 'UTC'): string {
  const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(date),
    part = (name: string) => parts.find(p => p.type === name)!.value
  return part('year') + '-' + part('month') + '-' + part('day')
}
export function calendarMonth(month: string): Array<string | null> {
  if (!validStoryDay(month + '-01')) return []
  const date = new Date(month + '-01T12:00:00Z'),
    offset = (date.getUTCDay() + 6) % 7,
    count = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate()
  return [
    ...Array<null>(offset).fill(null),
    ...Array.from({ length: count }, (_, i) => month + '-' + String(i + 1).padStart(2, '0')),
  ]
}
export function readyUndatedStories(rows: readonly StoryListRow[], jobs: readonly StoryCalendarJob[]): StoryListRow[] {
  const queued = new Set(
    jobs.filter(job => job.status === 'pending' || job.status === 'running').map(job => job.entryId),
  )
  return rows.filter(
    row =>
      !row.published &&
      !row.values.published_date &&
      row.values.reviewed === true &&
      row.values.hidden !== true &&
      row.values.feed_removed !== true &&
      row.values.in_feed !== false &&
      row.hasText &&
      typeof row.values.summary === 'string' &&
      !!row.values.summary.trim() &&
      !!row.values.photo &&
      !queued.has(row.id),
  )
}
