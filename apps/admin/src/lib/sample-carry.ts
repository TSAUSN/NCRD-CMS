import { SAMPLE_FIELDS_KEY, sampleFieldNames } from '@cms/schema'
/** Layout changes are not author edits: copied examples must still require consent. */
export function carrySampleMarkers(
  source: Record<string, unknown>,
  target: Record<string, unknown>,
  mapping: Record<string, string> = {},
  introduced: readonly string[] = [],
) {
  const sampled = new Set(sampleFieldNames(source)),
    fresh = new Set(introduced)
  const fields = Object.keys(target).filter(
    key => key !== SAMPLE_FIELDS_KEY && (sampled.has(mapping[key] ?? key) || fresh.has(key)),
  )
  return fields.length ? { ...target, [SAMPLE_FIELDS_KEY]: fields } : target
}
