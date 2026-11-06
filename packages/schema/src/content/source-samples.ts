/** Optional authored examples from source organization. Copy only supported
 * field shapes into new instances; never apply defaults to an existing pin or
 * overwrite an author's explicit empty value. Rendering still sanitizes them. */
import { isIconSlot } from './icons.ts'
import { StructuredRepeatBinding } from './structured.ts'
import { siteWidget } from './site-widgets.ts'
import { repeatSampleValues } from './repeat-items.ts'

type SampleSlot = { id: string; kind: string; label?: string; constraints?: Record<string, unknown> }

/** One field's starting value from its sample, or undefined when the shape is not one it takes. */
export function sourceSampleValue(slot: { kind: string }, sample: unknown): unknown {
  if ((slot.kind === 'text' || slot.kind === 'richtext') && typeof sample === 'string' && sample.length <= 100_000)
    return sample
  if (!sample || typeof sample !== 'object' || Array.isArray(sample)) return undefined
  const record = sample as Record<string, unknown>
  if (
    slot.kind === 'image' &&
    typeof record.src === 'string' &&
    record.src.length <= 2048 &&
    typeof record.alt === 'string' &&
    record.alt.length <= 2000
  ) {
    return { src: record.src, alt: record.alt, decorative: record.decorative === true }
  }
  if (
    (slot.kind === 'link' || slot.kind === 'button') &&
    typeof record.url === 'string' &&
    record.url.length <= 2048 &&
    typeof record.label === 'string' &&
    record.label.length <= 2000
  ) {
    return {
      url: record.url,
      label: record.label,
      ...(typeof record.newTab === 'boolean' ? { newTab: record.newTab } : {}),
      ...(typeof record.nofollow === 'boolean' ? { nofollow: record.nofollow } : {}),
    }
  }
  return undefined
}

export function sourceSampleValues(slots: readonly SampleSlot[]): Record<string, unknown> {
  const values: Record<string, unknown> = {}
  for (const slot of slots) {
    if (siteWidget(slot)) continue
    // A repeated list starts with its declared items (LIB-02).
    if (slot.kind === 'repeat' && slot.constraints?.collection === true) {
      const binding = StructuredRepeatBinding.safeParse(slot.constraints.sourceSample)
      if (binding.success) {
        values[slot.id] = binding.data
        continue
      }
    }
    if (slot.kind === 'repeat') {
      Object.assign(
        values,
        repeatSampleValues(
          { id: slot.id, kind: 'repeat', label: slot.label ?? slot.id, constraints: slot.constraints ?? {} },
          sourceSampleValue,
        ),
      )
      continue
    }
    const value = sourceSampleValue(slot, slot.constraints?.sourceSample)
    if (value !== undefined) values[slot.id] = value
  }
  return values
}

/** Core list bindings are deliberate starting values, never hydrated records. */
export function sectionStartingValues(slots: readonly SampleSlot[]): Record<string, unknown> {
  const values = sourceSampleValues(slots)
  for (const slot of slots) {
    if (
      slots.some(field => field.constraints?.heroEditingParity === true) &&
      ['auto_change', 'seconds'].includes(slot.id)
    )
      continue
    if (siteWidget(slot) || Object.hasOwn(values, slot.id) || slot.kind === 'repeat' || slot.kind === 'navigation')
      continue
    if (slot.kind === 'text')
      values[slot.id] = isIconSlot(slot)
        ? 'heart'
        : /heading|title/i.test(slot.id)
          ? 'A shared purpose. A stronger community.'
          : 'Practical ideas, meaningful connections and a welcome for everyone.'
    if (slot.kind === 'richtext')
      values[slot.id] =
        '<p>Every community has people ready to make a difference. Share the story behind your work and invite people to take the next step.</p>'
    if (slot.kind === 'image')
      values[slot.id] = {
        src: '/cms-samples/r8-landscape.png',
        alt: 'Original illustration of a welcoming community building',
        decorative: false,
      }
    if (slot.kind === 'link' || slot.kind === 'button') values[slot.id] = { url: '/', label: 'Find out more' }
  }
  const reader = slots[0]?.constraints?.coreLibrary === 'r8' ? slots[0]?.constraints?.coreList : null
  if (
    typeof reader === 'string' &&
    /^[a-z][a-z0-9_]{0,63}$/.test(reader) &&
    slots.some(slot => slot.id === reader && slot.kind === 'repeat')
  ) {
    values[reader] = { readerKey: reader, selection: { mode: 'automatic', limit: 100 } }
  }
  return values
}
