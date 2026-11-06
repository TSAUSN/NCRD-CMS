const formatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/New_York',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
})
export function heroEasternInput(value: unknown, end = false): string {
  if (typeof value !== 'string' || !value) return ''
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return value
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return ''
  if (end) date.setMinutes(date.getMinutes() - 1)
  const parts = new Map(formatter.formatToParts(date).map(part => [part.type, part.value]))
  return (
    parts.get('year') +
    '-' +
    parts.get('month') +
    '-' +
    parts.get('day') +
    'T' +
    parts.get('hour') +
    ':' +
    parts.get('minute')
  )
}
/** Reject the spring gap; use the first occurrence of the repeated autumn hour. */
export function heroEasternValue(input: string, end = false): string {
  if (!input) return ''
  const parts = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(input)
  if (!parts) return input
  const base = Date.UTC(
    ...([Number(parts[1]), Number(parts[2]) - 1, Number(parts[3]), Number(parts[4]), Number(parts[5])] as [
      number,
      number,
      number,
      number,
      number,
    ]),
  )
  const candidates = [4, 5]
    .map(offset => base + offset * 3600000)
    .filter(time => heroEasternInput(new Date(time).toISOString()) === input)
  return candidates.length ? new Date(Math.min(...candidates) + (end ? 60000 : 0)).toISOString() : input
}
