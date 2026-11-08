import type { ReviewSubmission } from '../../lib/review-queries.ts'

export function ReviewFact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}

export function summaryOf(review: ReviewSubmission): string {
  const summary = review.summary
  if (summary.firstPublication) return `${summary.submittedSections} ready to go live`
  const facts: string[] = []
  if (summary.addedSections) facts.push(`${summary.addedSections} added`)
  if (summary.removedSections) facts.push(`${summary.removedSections} removed`)
  if (summary.changedSections) facts.push(`${summary.changedSections} changed`)
  if (summary.reordered) facts.push('order changed')
  if (summary.changedMetadata.length) facts.push('metadata changed')
  return facts.length > 0 ? facts.join(' · ') : 'No visible difference found'
}

export function initials(value: string): string {
  const words = value.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return '?'
  return (words[0]![0]! + (words[1]?.[0] ?? words[0]![1] ?? '')).toUpperCase()
}

export function reviewAge(value: string, referenceTime: number) {
  const minutes = Math.max(0, Math.floor((referenceTime - Date.parse(value)) / 60000))
  return minutes < 1
    ? 'sent just now'
    : minutes < 60
      ? 'sent ' + minutes + ' ' + (minutes === 1 ? 'minute' : 'minutes') + ' ago'
      : minutes < 1440
        ? 'sent ' + Math.floor(minutes / 60) + ' ' + (minutes < 120 ? 'hour' : 'hours') + ' ago'
        : 'sent ' + Math.floor(minutes / 1440) + ' ' + (minutes < 2880 ? 'day' : 'days') + ' ago'
}
