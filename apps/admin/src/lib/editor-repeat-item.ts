import {
  addRepeatItem,
  repeatItemSlotId,
  isHeroSlides,
  HERO_SLIDE_FIELDS,
  sampleFieldNames,
  SAMPLE_FIELDS_KEY,
  repeatItemSpec,
  removeRepeatItem,
  type FieldLike,
} from '@cms/schema'
/** Chapter boards keep neutral placeholders; a newly added hero slide starts empty. */
export function addEditorRepeatItem(
  values: Record<string, unknown>,
  slot: FieldLike,
  options: NonNullable<Parameters<typeof addRepeatItem>[2]> & { empty?: boolean } = {},
) {
  const added = addRepeatItem(values, slot, options)
  if (added.key && slot.constraints?.['boardCards'] === true && !options.from) {
    const field = (id: string) => repeatItemSlotId(slot.id, added.key!, id)
    added.values = {
      ...added.values,
      [field('title')]: '[Name] (sample)',
      [field('description')]: '[Board role]',
      [field('action')]: { label: 'Contact', url: 'mailto:chapter@example.test' },
    }
  }
  if (added.key && options.empty && !options.from) {
    const next = { ...added.values },
      names = (repeatItemSpec(slot)?.fields ?? []).map(field => repeatItemSlotId(slot.id, added.key!, field.id))
    for (const field of repeatItemSpec(slot)?.fields ?? []) {
      const name = repeatItemSlotId(slot.id, added.key, field.id)
      next[name] = field.kind === 'image' ? null : ['link', 'button'].includes(field.kind) ? { label: '', url: '' } : ''
    }
    const marked = sampleFieldNames(next).filter(name => !names.includes(name))
    if (marked.length) next[SAMPLE_FIELDS_KEY] = marked
    else delete next[SAMPLE_FIELDS_KEY]
    added.values = next
  }
  if (added.key && isHeroSlides(slot) && !options.from) {
    const next = { ...added.values },
      names = HERO_SLIDE_FIELDS.map(field => repeatItemSlotId(slot.id, added.key!, field))
    for (const [index, field] of HERO_SLIDE_FIELDS.entries())
      next[names[index]!] =
        field === 'enabled'
          ? 'on'
          : ['primary', 'secondary'].includes(field)
            ? { label: '', url: '' }
            : field === 'photo'
              ? null
              : ''
    const marked = sampleFieldNames(next).filter(field => !names.includes(field))
    if (marked.length) next[SAMPLE_FIELDS_KEY] = marked
    else delete next[SAMPLE_FIELDS_KEY]
    added.values = next
  }
  return added
}

/** An untouched insertion has no saved words, photo, link or chosen icon. */
export function repeatItemHasContent(values: Record<string, unknown>, slot: FieldLike, key: string): boolean {
  return (repeatItemSpec(slot)?.fields ?? []).some(field => {
    if (
      field.constraints?.presentation ||
      field.constraints?.destinationOnly ||
      (isHeroSlides(slot) && !['title', 'intro', 'photo', 'primary', 'secondary'].includes(field.id))
    )
      return false
    const value = values[repeatItemSlotId(slot.id, key, field.id)]
    if (typeof value === 'string')
      return Boolean(
        value
          .replace(/<[^>]*>/g, '')
          .replace(/&(?:nbsp|#160);/g, ' ')
          .trim(),
      )
    return Boolean(
      value && typeof value === 'object' && Object.values(value).some(part => typeof part === 'string' && part.trim()),
    )
  })
}
/** Cancelling a new, transient item restores the old list even below its minimum. */
export function discardNewRepeatItem(values: Record<string, unknown>, slot: FieldLike, key: string) {
  const item = slot.constraints?.item
  if (!item || typeof item !== 'object' || Array.isArray(item)) return values
  return removeRepeatItem(values, { ...slot, constraints: { ...slot.constraints, item: { ...item, min: 0 } } }, key)
}
