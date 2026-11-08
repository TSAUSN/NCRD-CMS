import type { EditorDocument } from '@cms/domain'
import { repeatItemSpec, repeatItemKeys, type FieldLike } from '@cms/schema'
import { discardNewRepeatItem, repeatItemHasContent } from './editor-repeat-item.ts'
export type PageLeaveSnapshot = { document: EditorDocument; sectionOrigins: string[] }
/** Keep authored words and pre-existing items; drop only new untouched insertions. */
export function pageLeaveSnapshot(
  current: PageLeaveSnapshot,
  opening: PageLeaveSnapshot,
  forms: ReadonlyMap<string, { slots: readonly FieldLike[] }>,
): PageLeaveSnapshot {
  const document = structuredClone(current.document)
  for (const [index, section] of document.sections.entries()) {
    const originalIndex = opening.sectionOrigins.indexOf(current.sectionOrigins[index]!)
    const original = opening.document.sections[originalIndex]
    for (const slot of forms.get(section.section_def_id + ':' + section.section_def_version)?.slots ?? []) {
      if (!repeatItemSpec(slot)) continue
      const oldKeys = repeatItemKeys(original?.values[slot.id])
      for (const key of repeatItemKeys(section.values[slot.id]))
        if (!oldKeys.includes(key) && !repeatItemHasContent(section.values, slot, key))
          section.values = discardNewRepeatItem(section.values, slot, key)
    }
  }
  return { document, sectionOrigins: [...current.sectionOrigins] }
}
