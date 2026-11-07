import { useCallback, useEffect, useMemo, useRef } from 'react'
import type { EditorSection } from '@cms/domain'
import { isDrawingSlot, isIconSlot, slotForId } from '@cms/schema'
import type { LibraryEntry } from '../../../lib/queries.ts'
import { sectionDisplayName } from '../../../lib/section-display-name.ts'
import { pinnedSectionCatalog, sectionVersionKey } from '../../../lib/section-version.ts'
import type { PageEditorProps } from './editor-types.ts'

/** Keep every definition version the current draft, recovery or undo can use. */
export function useEditorSectionCatalog(
  props: Pick<PageEditorProps, 'library' | 'pinnedSections'>,
  sections: EditorSection[],
  additions: {
    recipeDefinitions: LibraryEntry[]
    recoveryDefinitions: LibraryEntry[]
    replacementDefinitions: LibraryEntry[]
  },
) {
  const { recipeDefinitions, recoveryDefinitions, replacementDefinitions } = additions
  const knownDefinitions = useRef<ReadonlyMap<string, LibraryEntry>>(new Map())
  const slotsByDef = useMemo(
    () =>
      pinnedSectionCatalog(
        props.library,
        [...props.pinnedSections, ...recipeDefinitions, ...recoveryDefinitions, ...replacementDefinitions],
        knownDefinitions.current,
      ),
    [props.library, props.pinnedSections, recipeDefinitions, recoveryDefinitions, replacementDefinitions],
  )
  const hasEditableFields = sections.some(
    section =>
      (slotsByDef.get(sectionVersionKey(section.section_def_id, section.section_def_version))?.slots.length ?? 0) > 0,
  )
  // Undo can bring back a version no longer present in the current draft.
  useEffect(() => {
    knownDefinitions.current = slotsByDef
  }, [slotsByDef])
  const slotKind = useCallback(
    (section: EditorSection, slot: string) => {
      // A repeated item's field is named by its composed id (LIB-02).
      const declared =
        slotsByDef.get(sectionVersionKey(section.section_def_id, section.section_def_version))?.slots ?? []
      const field = slotForId(declared, section.values, slot)
      if (
        field?.kind === 'text' &&
        ['cms-date-long-v1', 'cms-date-calendar-v1'].includes(String(field.constraints?.presentation))
      )
        return 'date'
      return field && (isIconSlot(field) || isDrawingSlot(field)) ? 'icon' : field?.kind
    },
    [slotsByDef],
  )

  // A rich-text field's definition constraints (inline or block, and its
  // blocks' and marks' presentation), so live canvas updates and on-page
  // editing show what the page itself renders.
  const richTextConstraints = useCallback(
    (section: EditorSection | undefined, slot: string): unknown =>
      section
        ? slotForId(
            slotsByDef.get(sectionVersionKey(section.section_def_id, section.section_def_version))?.slots ?? [],
            section.values,
            slot,
          )?.constraints
        : undefined,
    [slotsByDef],
  )

  function nameOf(section: EditorSection): string {
    return sectionDisplayName(
      section,
      slotsByDef.get(sectionVersionKey(section.section_def_id, section.section_def_version)),
    )
  }
  return { slotsByDef, hasEditableFields, slotKind, richTextConstraints, nameOf }
}
