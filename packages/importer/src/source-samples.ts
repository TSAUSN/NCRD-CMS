import type { SlotDef } from '@cms/schema'

/**
 * An imported definition carries its source's own words, pictures and links as
 * starting content (`constraints.sourceSample`, the same field the source
 * organizer fills): a section inserted from the library starts with them, and
 * its library card is drawn with them rather than with field names (V1
 * references 18/19). Only the shapes `sourceSampleValues` reads are kept, and
 * an empty value gives no sample.
 */
export function withSourceSamples(slots: readonly SlotDef[], values: Readonly<Record<string, unknown>>): SlotDef[] {
  return slots.map(slot => {
    const sample = sampleFor(slot, values[slot.id])
    return sample === undefined ? slot : { ...slot, constraints: { ...slot.constraints, sourceSample: sample } }
  })
}

/** One field's starting value from its imported value, in the shape `sourceSampleValues` reads. */
export function sampleFor(slot: Pick<SlotDef, 'kind'>, value: unknown): unknown {
  if (slot.kind === 'text' || slot.kind === 'richtext') {
    return typeof value === 'string' && value.trim() !== '' && value.length <= 100_000 ? value : undefined
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  if (
    slot.kind === 'image' &&
    typeof record['src'] === 'string' &&
    record['src'] !== '' &&
    typeof record['alt'] === 'string'
  ) {
    return { src: record['src'], alt: record['alt'], decorative: record['decorative'] === true }
  }
  if ((slot.kind === 'link' || slot.kind === 'button') && typeof record['url'] === 'string' && record['url'] !== '') {
    return { url: record['url'], label: typeof record['label'] === 'string' ? record['label'] : '' }
  }
  return undefined
}
