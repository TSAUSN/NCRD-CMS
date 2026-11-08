/** Resolve a device-zone wall time without silently moving a spring-gap time.
 * In the repeated autumn hour, choose the next future occurrence and say which.
 * SQL still enforces the existing minute/two-year,permission and review rules. */
export function localScheduleTime(
  input: string,
  zone: string,
  now = Date.now(),
): { runAt: string; repeated: boolean; label: string } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(input)
  if (!match) return null
  const [year, month, day, hour, minute] = match.slice(1).map(Number) as [number, number, number, number, number]
  const wall = Date.UTC(year, month - 1, day, hour, minute)
  try {
    const format = new Intl.DateTimeFormat('en-CA', {
      timeZone: zone,
      calendar: 'gregory',
      numberingSystem: 'latn',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
    const parts = (time: number) => new Map(format.formatToParts(new Date(time)).map(part => [part.type, part.value]))
    const offsets = new Set(
      [-2, -1, 0, 1, 2].map(days => {
        const time = wall + days * 86400000
        const p = parts(time)
        return (
          Date.UTC(
            Number(p.get('year')),
            Number(p.get('month')) - 1,
            Number(p.get('day')),
            Number(p.get('hour')),
            Number(p.get('minute')),
          ) - time
        )
      }),
    )
    const candidates = [...offsets]
      .map(offset => wall - offset)
      .filter(time => {
        const p = parts(time)
        return (
          p.get('year') === match[1] &&
          p.get('month') === match[2] &&
          p.get('day') === match[3] &&
          p.get('hour') === match[4] &&
          p.get('minute') === match[5]
        )
      })
      .sort((a, b) => a - b)
    if (!candidates.length) return null
    const chosen = candidates.find(time => time > now) ?? candidates[0]!
    const label = new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      timeZoneName: 'short',
    }).format(new Date(chosen))
    return { runAt: new Date(chosen).toISOString(), repeated: candidates.length > 1, label }
  } catch {
    return null
  }
}
export function localScheduleHint(input: string, time: ReturnType<typeof localScheduleTime>): string {
  return !input
    ? ''
    : !time
      ? 'This clock time is unavailable in this time zone. Choose another time.'
      : time.repeated
        ? 'This clock time happens twice. This schedule uses ' + time.label + '.'
        : ''
}
