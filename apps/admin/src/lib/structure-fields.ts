import {
  editableSlots,
  isRepeatItemSlot,
  isHeroSlides,
  repeatItemSpec,
  parseRepeatItemSlotId,
  repeatItemSlotId,
  HERO_SLIDE_FIELDS,
  type FieldLike,
} from '@cms/schema'
/** Native repeated content has one navigation row per item; every field remains searchable. */
export function structureFields(slots: readonly FieldLike[], values: Record<string, unknown>, groupCards = false) {
  const heroes = new Set(slots.filter(isHeroSlides).map(slot => slot.id))
  return editableSlots(slots, values).flatMap(slot => {
    if (!isRepeatItemSlot(slot) || (!heroes.has(slot.repeat.id) && !groupCards))
      return [{ ...slot, memberIds: [slot.id], searchValues: [values[slot.id]] }]
    if (!heroes.has(slot.repeat.id)) {
      const root = slots.find(field => field.id === slot.repeat.id),
        spec = root && repeatItemSpec(root),
        parsed = parseRepeatItemSlotId(slot.id)
      if (!spec || parsed?.fieldId !== spec.fields[0]?.id) return []
      const memberIds = [
        slot.repeat.id,
        ...spec.fields.map(field => repeatItemSlotId(slot.repeat.id, slot.repeat.key, field.id)),
      ]
      const textFields = spec.fields.filter(
          field => ['text', 'richtext'].includes(field.kind) && !field.constraints?.presentation,
        ),
        preferred = textFields.find(field => ['title', 'name', 'heading'].includes(field.id)),
        words = [preferred, ...textFields]
          .filter(Boolean)
          .map(field =>
            String(values[repeatItemSlotId(slot.repeat.id, slot.repeat.key, field!.id)] ?? '')
              .replace(/<[^>]*>/g, ' ')
              .replace(/&nbsp;/g, ' ')
              .replace(/\s+/g, ' ')
              .trim(),
          )
          .find(Boolean)
      return [
        {
          ...slot,
          label: `${spec.unit} ${slot.repeat.index + 1}${words ? ': ' + words.slice(0, 72) : ''}`,
          memberIds,
          searchValues: memberIds.map(id => values[id]),
        },
      ]
    }
    if (parseRepeatItemSlotId(slot.id)?.fieldId !== 'photo') return []
    const key = slot.repeat.key,
      repeat = slot.repeat.id,
      title = String(values[repeatItemSlotId(repeat, key, 'title')] ?? '').trim() || 'Untitled slide'
    const memberIds = [repeat, ...HERO_SLIDE_FIELDS.map(field => repeatItemSlotId(repeat, key, field))]
    return [
      {
        ...slot,
        label: `Slide ${slot.repeat.index + 1}: ${title}`,
        memberIds,
        searchValues: memberIds.map(id => values[id]),
      },
    ]
  })
}
