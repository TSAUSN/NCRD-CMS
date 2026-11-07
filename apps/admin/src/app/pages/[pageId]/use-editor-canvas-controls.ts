import { useEffect } from 'react'
import type { EditorSection, EditorState } from '@cms/domain'
import { repeatItemKeys, repeatItemSpec } from '@cms/schema/repeat-items'
import { sectionVersionKey } from '../../../lib/section-version.ts'
import type { LibraryEntry } from '../../../lib/queries.ts'
import type { PageEditorProps } from './editor-types.ts'

type Input = {
  isolated: { enabled: boolean }
  canvasReady: number
  state: EditorState
  listSelection: { section: number; readerKey: string; stableKey: string; field: string } | null
  previewScale: number
  slotsByDef: ReadonlyMap<string, LibraryEntry>
  nameOf: (section: EditorSection) => string
  libraryOpen: boolean
  siteWide: unknown
  sectionTool: unknown
  canvasAwaitingRender: boolean
  publishedVersionId: string | null
  props: Pick<PageEditorProps, 'liveSections' | 'originalDesign'>
  toCanvas: (message: Record<string, unknown>) => void
}

/** Give the current canvas only the display data needed for its field controls. */
export function useEditorCanvasControls({
  isolated,
  canvasReady,
  state,
  listSelection,
  previewScale,
  slotsByDef,
  nameOf,
  libraryOpen,
  siteWide,
  sectionTool,
  canvasAwaitingRender,
  publishedVersionId,
  props,
  toCanvas,
}: Input) {
  useEffect(() => {
    if (!isolated.enabled || !canvasReady) return
    const controls =
      libraryOpen || siteWide || sectionTool || canvasAwaitingRender
        ? null
        : {
            sections: state.document.sections.map(section => {
              const fields = (
                slotsByDef.get(sectionVersionKey(section.section_def_id, section.section_def_version))?.slots ?? []
              ).filter(
                field =>
                  field.kind === 'repeat' &&
                  (repeatItemSpec(field) ||
                    typeof (section.values[field.id] as { readerKey?: unknown } | undefined)?.readerKey === 'string'),
              )
              return {
                id: section.section_def_id,
                version: section.section_def_version,
                label: nameOf(section),
                hidden: Boolean(section.hidden),
                fields: fields.map(field => ({
                  id: field.id,
                  kind: field.kind,
                  label: field.label,
                  constraints: field.constraints,
                })),
                values: Object.fromEntries(
                  fields.map(field => [
                    field.id,
                    repeatItemSpec(field)
                      ? { items: repeatItemKeys(section.values[field.id]) }
                      : {
                          readerKey: (section.values[field.id] as { readerKey?: string } | undefined)?.readerKey ?? '',
                        },
                  ]),
                ),
              }
            }),
            selected: state.selection.section,
            slot: state.selection.slot,
            listItem:
              listSelection?.section === state.selection.section
                ? { readerKey: listSelection.readerKey, stableKey: listSelection.stableKey, field: listSelection.field }
                : null,
            scale: previewScale,
            canReset: Boolean(publishedVersionId && props.liveSections.length),
            preserveLayout: !props.originalDesign,
          }
    toCanvas({ type: 'cms:canvas-controls', controls })
  }, [
    isolated.enabled,
    canvasReady,
    state.document,
    state.selection,
    listSelection,
    previewScale,
    slotsByDef,
    libraryOpen,
    siteWide,
    sectionTool,
    canvasAwaitingRender,
    publishedVersionId,
    props.liveSections.length,
    toCanvas,
  ])
}
