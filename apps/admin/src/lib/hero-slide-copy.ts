import {
  addRepeatItem,
  repeatItemKeys,
  repeatItemSlotId,
  repeatItemSpec,
  sampleFieldNames,
  SAMPLE_FIELDS_KEY,
  type FieldLike,
} from '@cms/schema'
/** Copy only declared slide fields; the destination's other values and order stay intact. */
export function appendCopiedHeroSlide(
  source: Record<string, unknown>,
  sourceSlot: FieldLike,
  key: string,
  target: Record<string, unknown>,
  targetSlot: FieldLike,
) {
  const fields = repeatItemSpec(targetSlot)?.fields ?? []
  if (!repeatItemKeys(source[sourceSlot.id]).includes(key)) return null
  const added = addRepeatItem(target, targetSlot)
  if (!added.key) return null
  const names = new Set(fields.map(field => repeatItemSlotId(targetSlot.id, added.key!, field.id))),
    marked = sampleFieldNames(added.values).filter(name => !names.has(name)),
    sourceSamples = new Set(sampleFieldNames(source)),
    next = { ...added.values }
  for (const field of fields) {
    const from = repeatItemSlotId(sourceSlot.id, key, field.id),
      to = repeatItemSlotId(targetSlot.id, added.key, field.id)
    delete next[to]
    if (Object.hasOwn(source, from)) {
      next[to] = structuredClone(source[from])
      if (sourceSamples.has(from)) marked.push(to)
    }
  }
  next[repeatItemSlotId(targetSlot.id, added.key, 'enabled')] = 'off'
  if (marked.length) next[SAMPLE_FIELDS_KEY] = marked
  else delete next[SAMPLE_FIELDS_KEY]
  return { values: next, key: added.key }
}
