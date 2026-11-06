const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const formatter = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  calendar: 'gregory',
  numberingSystem: 'latn',
  month: 'numeric',
  day: 'numeric',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  hour12: true,
})

/** Ignore ICU punctuation so server and browser hydrate the same review time.
 * The explicit zone also matches the chapter review working-day clock. */
export function reviewTime(value: string): string {
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return 'Time unavailable'
  const parts = new Map(formatter.formatToParts(date).map(part => [part.type, part.value]))
  const month = months[Number(parts.get('month')) - 1]
  return `${month} ${Number(parts.get('day'))}, ${parts.get('year')} · ${Number(parts.get('hour')) % 12 || 12}:${parts.get('minute')} ${parts.get('dayPeriod')} Eastern time`
}

/** Recent-work dates follow the same Eastern working-day clock as review times. */
export function reviewDate(value: string): string {
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return 'Date unavailable'
  const parts = new Map(formatter.formatToParts(date).map(part => [part.type, part.value]))
  return `${months[Number(parts.get('month')) - 1]} ${Number(parts.get('day'))}`
}
