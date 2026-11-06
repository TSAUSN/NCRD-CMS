/** Internal instance metadata, kept beside values so snapshots and Undo preserve it. */
export const SAMPLE_FIELDS_KEY = '__cms_sample_fields'
export function sampleFieldNames(values: Record<string, unknown>): string[] {
  const names = values[SAMPLE_FIELDS_KEY]
  return Array.isArray(names)
    ? [
        ...new Set(
          names.filter(
            (name): name is string =>
              typeof name === 'string' && name !== SAMPLE_FIELDS_KEY && Object.hasOwn(values, name),
          ),
        ),
      ].slice(0, 1000)
    : []
}
export function markSampleValues(values: Record<string, unknown>): Record<string, unknown> {
  const fields = Object.keys(values).filter(key => key !== SAMPLE_FIELDS_KEY)
  return fields.length ? { ...values, [SAMPLE_FIELDS_KEY]: fields } : values
}
export function clearSampleField(values: Record<string, unknown>, field: string): Record<string, unknown> {
  if (!Object.hasOwn(values, SAMPLE_FIELDS_KEY)) return values
  const fields = sampleFieldNames(values).filter(name => name !== field)
  const next = { ...values }
  if (fields.length) next[SAMPLE_FIELDS_KEY] = fields
  else delete next[SAMPLE_FIELDS_KEY]
  return next
}

/** Immutable list declarations name their sample flags, including real bound items. */
export function boundSampleFieldNames(
  values: Record<string, unknown>,
  slots: readonly { id: string; constraints?: Record<string, unknown> }[],
): string[] {
  const result: string[] = []
  for (const slot of slots) {
    const flags = slot.constraints?.sampleFlags,
      bound = values[slot.id] as { kind?: unknown; entries?: { values?: Record<string, unknown> }[] } | undefined
    if (
      !flags ||
      typeof flags !== 'object' ||
      Array.isArray(flags) ||
      bound?.kind !== 'collection' ||
      !Array.isArray(bound.entries)
    )
      continue
    for (const entry of bound.entries.slice(0, 200))
      for (const [field, flag] of Object.entries(flags)) {
        if (
          typeof flag !== 'string' ||
          !/^[a-z][a-z0-9_]{0,63}$/.test(field) ||
          !/^[a-z][a-z0-9_]{0,63}$/.test(flag) ||
          entry.values?.[flag] !== true
        )
          continue
        const title = typeof entry.values.title === 'string' ? entry.values.title : 'Story',
          label = field === 'photo' ? 'Lead photo' : field === 'body' ? 'Story text' : field
        result.push(label + ': ' + title)
      }
  }
  return [...new Set(result)]
}
