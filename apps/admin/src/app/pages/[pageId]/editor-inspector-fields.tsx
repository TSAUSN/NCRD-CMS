import type { ComponentProps, Dispatch, SetStateAction } from 'react'
import {
  cancelFieldEdit,
  revertSlot,
  setCustomCss,
  setMeta,
  setRawHtml,
  setSectionAppearance,
  setSectionLabel,
  setSectionValues,
  setSelection,
  setValue,
  toggleHidden,
  toggleHiddenAt,
  type EditorSection,
  type EditorState,
} from '@cms/domain'
import { repeatItemSpec } from '@cms/schema'
import { discardNewRepeatItem, repeatItemHasContent } from '../../../lib/editor-repeat-item.ts'
import { listItemUnit as listUnit } from '../../../lib/list-items.ts'
import type { SitePreviewContext } from '../../../lib/preview-context.ts'
import type { LibraryEntry } from '../../../lib/queries.ts'
import { sectionVersionKey } from '../../../lib/section-version.ts'
import type { EditorPane, PageEditorProps } from './editor-types.ts'
import { Inspector } from './inspector.tsx'

type InspectorProps = ComponentProps<typeof Inspector>
type Set<T> = Dispatch<SetStateAction<T>>
type SiteWide = { part: 'header' | 'footer'; editing: boolean } | null

type Props = {
  selection: {
    state: EditorState
    setState: Set<EditorState>
    selected: number | null
    selectedSection: EditorSection | null
    slotsByDef: Map<string, LibraryEntry>
    canManageSections: boolean
    canInsertAt: (index: number) => boolean
    repeatValues: (section: EditorSection, next: Record<string, unknown>) => Record<string, unknown>
    hasEditableFields: boolean
    nameOf: (section: EditorSection) => string
  }
  page: {
    props: Pick<
      PageEditorProps,
      | 'originalDesign'
      | 'liveSections'
      | 'pageScoped'
      | 'library'
      | 'siteId'
      | 'canPublish'
      | 'pageId'
      | 'metadataContext'
      | 'linkTargets'
      | 'mediaAssets'
      | 'imagePreviews'
      | 'publishedImagePreviews'
      | 'themeColors'
      | 'draftThemeColors'
      | 'canApproveTrustedCode'
      | 'canAdvanced'
    >
    savedVersionId: { current: string | null }
    publishedVersionId: string | null
    saveDetails: NonNullable<InspectorProps['onSaveDetails']>
    pageIdentity: { address: string }
    sitePreview: SitePreviewContext
    readiness: InspectorProps['readiness']
    approved: boolean
  }
  navigation: {
    setSiteWide: Set<SiteWide>
    setPane: Set<EditorPane>
    closeSharedPanel: () => void
    openSectionTool: (kind: 'link' | 'copy', index: number) => Promise<void>
    reviewSectionUpgrade: (index: number, version: number) => Promise<void>
    setPageSettingsOpen: Set<boolean>
    setPageDanger: Set<'archive' | 'unpublish' | null>
    setInlineList: Set<{ readerKey: string; stableKey?: string; unit: string } | null>
    openLayoutChoice: (index: number) => Promise<void>
    reviewFieldUpdate: (index: number) => Promise<void>
    openLibrary: (at: number) => void
    setChoosingSectionSpot: Set<boolean>
    pageSettingsOpen: boolean
  }
}

export function EditorInspectorFields({ selection, page, navigation }: Props) {
  const {
    state,
    setState,
    selected,
    selectedSection,
    slotsByDef,
    canManageSections,
    canInsertAt,
    repeatValues,
    hasEditableFields,
    nameOf,
  } = selection
  const { props, savedVersionId, publishedVersionId, saveDetails, pageIdentity, sitePreview, readiness, approved } =
    page
  const {
    setSiteWide,
    setPane,
    closeSharedPanel,
    openSectionTool,
    reviewSectionUpgrade,
    setPageSettingsOpen,
    setPageDanger,
    setInlineList,
    openLayoutChoice,
    reviewFieldUpdate,
    openLibrary,
    setChoosingSectionSpot,
    pageSettingsOpen,
  } = navigation
  return (
    <Inspector
      onChangeLinkName={
        !props.originalDesign && selected !== null ? () => void openSectionTool('link', selected) : undefined
      }
      publishedHeroValues={
        selectedSection &&
        props.liveSections.filter(section => section.section_def_id === selectedSection.section_def_id).length === 1
          ? props.liveSections.find(section => section.section_def_id === selectedSection.section_def_id)?.values
          : undefined
      }
      canManageSections={canManageSections}
      canEditSiteLook={canManageSections && !props.pageScoped}
      canAddBelow={selected !== null && canInsertAt(selected + 1)}
      onDiscardEmptyRepeat={(origin, slotId, key) =>
        setState(current => {
          const index = current.sectionOrigins.indexOf(origin)
          if (index < 0) return current
          const section = current.document.sections[index]!,
            slot = slotsByDef
              .get(sectionVersionKey(section.section_def_id, section.section_def_version))
              ?.slots.find(field => field.id === slotId)
          if (!slot || !repeatItemSpec(slot) || repeatItemHasContent(section.values, slot, key)) return current
          const next = setSectionValues(
            current,
            index,
            repeatValues(section, discardNewRepeatItem(section.values, slot, key)),
          )
          return current.selection.section === index && current.selection.slot?.startsWith(slotId + '__' + key + '__')
            ? setSelection(next, { section: index, slot: null })
            : next
        })
      }
      originalDesign={props.originalDesign}
      state={state}
      onRestoreSlot={(slot, snapshot) => {
        const origin = selected === null ? null : state.sectionOrigins[selected]
        setState(current => {
          const index = origin ? current.sectionOrigins.indexOf(origin) : -1
          return index < 0 ? current : cancelFieldEdit(current, index, slot, snapshot)
        })
      }}
      sectionOutline={
        !props.originalDesign
          ? state.document.sections.map((section, index) => ({ index, label: nameOf(section) }))
          : undefined
      }
      onSelectSection={index => {
        setSiteWide(null)
        setState(current => setSelection(current, { section: index, slot: null }))
        setPane('inspector')
      }}
      onSelectSlot={slot => setState(current => setSelection(current, { section: current.selection.section, slot }))}
      onDone={() =>
        props.originalDesign
          ? setState(current => setSelection(current, { section: null, slot: null }))
          : closeSharedPanel()
      }
      hasEditableFields={hasEditableFields}
      entry={
        selectedSection
          ? (slotsByDef.get(sectionVersionKey(selectedSection.section_def_id, selectedSection.section_def_version)) ??
            null)
          : null
      }
      latestEntry={
        selectedSection
          ? (props.library.find(entry => entry.section_def_id === selectedSection.section_def_id) ?? null)
          : null
      }
      onReviewUpgrade={version => {
        if (selected !== null) void reviewSectionUpgrade(selected, version)
      }}
      siteId={props.siteId}
      canChooseStories={props.canPublish && !props.pageScoped}
      pageId={props.pageId}
      savedVersionId={savedVersionId.current}
      canManagePage={props.canPublish && !props.pageScoped}
      hasLivePage={Boolean(publishedVersionId)}
      onSaveDetails={saveDetails}
      onDanger={action => {
        setPageSettingsOpen(false)
        setPageDanger(action)
      }}
      metadataContext={{
        ...props.metadataContext,
        path: pageIdentity.address ? '/' + pageIdentity.address : '/',
      }}
      linkTargets={props.linkTargets}
      mediaAssets={props.mediaAssets}
      imagePreviews={sitePreview === 'draft' ? props.imagePreviews : props.publishedImagePreviews}
      themeColors={sitePreview === 'draft' ? props.draftThemeColors : props.themeColors}
      readiness={readiness}
      trustedCodeApproved={approved}
      canAuthorSource={props.canApproveTrustedCode}
      canAdvanced={props.canAdvanced}
      // Nothing here talks to the canvas. Every field, every revert and
      // every undo changes the document, and the effect above is what turns
      // a changed document into a changed page — so there is no handler
      // that can be the one that forgets.
      onChange={(slot, value) => {
        if (selected === null) return
        setState(setValue(state, selected, slot, value, { at: Date.now() }))
      }}
      onValuesChange={(values, slot) => {
        if (selected === null) return
        setState(
          setSelection(setSectionValues(state, selected, repeatValues(state.document.sections[selected]!, values)), {
            section: selected,
            slot,
          }),
        )
      }}
      onEditList={(readerKey, stableKey) =>
        setInlineList({ readerKey, ...(stableKey ? { stableKey } : {}), unit: listUnit(readerKey) })
      }
      onRevertSlot={slot => selected !== null && setState(revertSlot(state, selected, slot))}
      onMetaChange={(key, value) => setState(setMeta(state, key, value))}
      onAppearanceChange={appearance =>
        canManageSections && selected !== null && setState(setSectionAppearance(state, selected, appearance))
      }
      onToggleBreakpoint={breakpoint =>
        canManageSections && selected !== null && setState(toggleHiddenAt(state, selected, breakpoint))
      }
      onToggleHidden={() => canManageSections && selected !== null && setState(toggleHidden(state, selected))}
      onChangeLayout={() => {
        if (canManageSections && selected !== null) openLayoutChoice(selected)
      }}
      onUpdateImportedFields={() => {
        if (selected !== null) void reviewFieldUpdate(selected)
      }}
      onLabelChange={label => {
        if (selected !== null) setState(current => setSectionLabel(current, selected, label))
      }}
      onAddBelow={() => {
        if (selected !== null) openLibrary(selected + 1)
      }}
      onCustomCss={css => props.canAdvanced && selected !== null && setState(setCustomCss(state, selected, css))}
      onRawHtml={html =>
        props.canApproveTrustedCode && selected !== null && setState(setRawHtml(state, selected, html))
      }
      onAddSection={() =>
        props.originalDesign
          ? openLibrary(state.document.sections.length)
          : (setChoosingSectionSpot(true), setPane('inspector'))
      }
      pageSettingsOpen={pageSettingsOpen}
      onPageSettingsToggle={setPageSettingsOpen}
    />
  )
}
