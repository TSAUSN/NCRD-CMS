export const validScheduleRequest = (value: unknown): value is string =>
  typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
export const validScheduleChoices = (value: unknown): boolean => {
  const data = value as { time?: unknown; override?: unknown; zone?: unknown }
  try {
    return (
      !!data &&
      typeof data.time === 'string' &&
      data.time.length <= 32 &&
      typeof data.override === 'string' &&
      data.override.length <= 2000 &&
      typeof data.zone === 'string' &&
      data.zone.length <= 100 &&
      !!new Intl.DateTimeFormat(undefined, { timeZone: data.zone })
    )
  } catch {
    return false
  }
}
