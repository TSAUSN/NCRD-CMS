'use client'
import { EditorPanelNavigation } from './editor-panel-navigation.tsx'
import '../../../components/workspace.module.css'
import '../../../components/workspace-styles/workspace-forms.module.css'
import '../../../components/workspace-styles/record-table.module.css'
import './inspector-styles.module.css'
import { PageInspector } from './page-inspector.tsx'
import { InspectorSectionTitle } from './inspector-section-title.tsx'
import { InspectorSectionContent } from './inspector-section-content.tsx'
import type { PageDetailsInput } from '../../../lib/page-details.ts'
import type { savePageDetailsAction } from './page-details-actions.ts'
import styles from './inspector.module.css'
import { Button, Tabs } from '../../../components/ui/index.ts'
import { sectionDisplayName } from '../../../lib/section-display-name.ts'
import { useEffect, useRef, useState, type ComponentProps } from 'react'
import {
  SECTION_LABEL_MAX,
  type EditorMetadata,
  type EditorState,
  type ReadinessReport,
  type FieldEditSnapshot,
} from '@cms/domain'
import type { CanonicalInput } from '@cms/renderer'
import { isImportedDefinition } from '../../../lib/imported-definition.ts'
import { IconPlus } from '../../../components/icons.tsx'
import type { LinkTarget } from '../../../lib/queries.ts'
import type { MediaAsset } from '../../../lib/media-library.ts'
import type { LibraryEntry } from './editor.tsx'
import { editorContentSlots } from '../../../lib/editor-content-slots.ts'
import { repeatItemSpec, isHeroSlides, type SectionAppearance } from '@cms/schema'
import { SectionSourceControls } from './section-source-controls.tsx'
import { SectionAppearanceControls } from './section-appearance-controls.tsx'
import { AnchorField } from './inspector-fields/anchor-field.tsx'

const BREAKPOINTS = [
  { id: 'sm', label: 'Phone', width: 'under 768px' },
  { id: 'md', label: 'Tablet', width: '768–1023px' },
  { id: 'lg', label: 'Desktop', width: '1024px and up' },
] as const

export type InspectorProps = {
  state: EditorState
  entry: LibraryEntry | null
  latestEntry: LibraryEntry | null
  onReviewUpgrade: (version: number) => void
  siteId: string
  canChooseStories?: boolean
  onDiscardEmptyRepeat?: (origin: string, slotId: string, key: string) => void
  publishedHeroValues?: Record<string, unknown>
  canManageSections?: boolean
  canEditSiteLook?: boolean
  canAddBelow?: boolean
  originalDesign?: boolean
  pageId?: string
  savedVersionId?: string | null
  canManagePage?: boolean
  hasLivePage?: boolean
  onSaveDetails?: (input: PageDetailsInput) => Promise<Awaited<ReturnType<typeof savePageDetailsAction>> | null>
  onDanger?: (action: 'unpublish' | 'archive') => void
  metadataContext: Omit<CanonicalInput, 'authored'>
  hasEditableFields: boolean
  linkTargets: LinkTarget[]
  mediaAssets: MediaAsset[]
  imagePreviews?: Record<string, string>
  themeColors: Record<string, string>
  readiness: ReadinessReport | null
  /** True once a super admin has cleared the custom code on this draft. */
  trustedCodeApproved: boolean
  /** Advanced page-instance source is reserved for Super Admins. */
  canAuthorSource: boolean
  onChangeLinkName?: () => void
  canAdvanced: boolean
  onRestoreSlot: (slot: string, snapshot: FieldEditSnapshot) => void
  sectionOutline?: { index: number; label: string }[]
  onSelectSection?: (index: number) => void
  onSelectSlot: (slot: string | null) => void
  onDone: () => void
  onChange: (slot: string, value: unknown) => void
  /** Several of the section's values at once, as one step: a repeated item added, moved or removed (LIB-02). */
  onValuesChange: (values: Record<string, unknown>, slot: string | null) => void
  onEditList?: (readerKey: string, stableKey?: string) => void
  onRevertSlot: (slot: string) => void
  onMetaChange: <K extends keyof EditorMetadata>(key: K, value: EditorMetadata[K]) => void
  onAppearanceChange: (appearance: SectionAppearance) => void
  onToggleBreakpoint: (breakpoint: string) => void
  onToggleHidden: () => void
  /** Open the library to choose a different layout for this section (LIB-11). */
  onChangeLayout: () => void
  /** The section's private editor label, shown only in the CMS. */
  onLabelChange: (label: string) => void
  /** Super admins: move an imported section to the current field mapping (EDIT-02). */
  onUpdateImportedFields: () => void
  onAddBelow: () => void
  onCustomCss: (css: string) => void
  onRawHtml: (html: string) => void
  /** Open the section library to add a section at the end of the page. */
  onAddSection: () => void
  /** The page's own settings (search, sharing) are shown open. */
  pageSettingsOpen: boolean
  onPageSettingsToggle: (open: boolean) => void
}

function SectionSettings({ contentOnly, ...props }: ComponentProps<typeof Tabs> & { contentOnly: boolean }) {
  return contentOnly ? props.children : <Tabs {...props} />
}

export function Inspector(props: InspectorProps) {
  const { state, entry } = props
  const [tab, setTab] = useState('content')
  const [sharingPickerOpen, setSharingPickerOpen] = useState(false)
  const index = state.selection.section
  const section = index === null ? null : (state.document.sections[index] ?? null)
  const inspector = useRef<HTMLElement>(null)
  useEffect(() => {
    if (state.selection.slot !== null) setTab('content')
  }, [index, state.selection.slot])
  useEffect(() => {
    const panel = inspector.current
    if (
      !panel ||
      (!props.originalDesign && entry?.slots.some(slot => repeatItemSpec(slot))) ||
      entry?.slots.some(isHeroSlides)
    )
      return
    const slot = state.selection.slot
    const reveal = () => {
      const field = slot
        ? [...panel.querySelectorAll<HTMLElement>('[data-inspector-slot]')].find(
            node => node.dataset.inspectorSlot === slot,
          )
        : null
      if (!field) return false
      const scroller = panel.querySelector<HTMLElement>(':scope > [role="tabpanel"]') ?? panel
      const bounds = field.getBoundingClientRect()
      const viewport = scroller.getBoundingClientRect()
      if (bounds.top < viewport.top || bounds.bottom > viewport.bottom) {
        scroller.scrollTop += bounds.top - viewport.top - 16
      }
      return true
    }
    if (!reveal()) {
      panel.scrollTop = 0
      return
    }
    // Image previews and the formatting editor finish loading after this runs
    // and push later fields down. Keep the chosen field in view while the panel
    // settles; resizing never fires for the author's own scrolling.
    const observer = new ResizeObserver(() => {
      reveal()
    })
    for (const child of panel.children) observer.observe(child)
    const settle = setTimeout(() => observer.disconnect(), 1500)
    return () => {
      clearTimeout(settle)
      observer.disconnect()
    }
  }, [index, state.selection.slot, tab])

  if (section === null || index === null)
    return (
      <PageInspector
        inspector={inspector}
        props={props}
        sharingPickerOpen={sharingPickerOpen}
        setSharingPickerOpen={setSharingPickerOpen}
      />
    )

  const slots = editorContentSlots(entry?.slots ?? [], entry?.slug, !props.originalDesign, section.values)
  const focusedTitle = !props.originalDesign
    ? slots.find(
        slot =>
          slot.id === state.selection.slot &&
          slot.kind === 'text' &&
          ['heading', 'title', 'page_heading'].includes(slot.id),
      )
    : null

  if (focusedTitle) {
    return (
      <InspectorSectionTitle
        inspector={inspector}
        props={props}
        index={index}
        section={section}
        slots={slots}
        focusedTitle={focusedTitle}
      />
    )
  }
  const sectionCount = state.document.sections.length

  return (
    <aside
      ref={inspector}
      id="editor-panel-inspector"
      className={`pane inspector ${styles.inspector}`}
      data-selected-section={section !== null || undefined}
      aria-label="Inspector"
      onKeyDown={event => {
        if (
          !props.originalDesign &&
          event.key === 'Escape' &&
          !event.defaultPrevented &&
          !(event.target as Element).closest('dialog')
        ) {
          event.preventDefault()
          if (state.selection.slot !== null) props.onSelectSlot(null)
          else props.onDone()
        }
      }}
    >
      <EditorPanelNavigation
        enabled={!props.originalDesign}
        onBack={() => (state.selection.slot !== null ? props.onSelectSlot(null) : props.onDone())}
        onDone={props.onDone}
      >
        <div className="pane-head">
          <h2 className="pane-title">{sectionDisplayName(section, entry)}</h2>
          <span className="muted">
            {index + 1} of {sectionCount}
          </span>
        </div>

        <SectionSettings
          contentOnly={!props.originalDesign && props.canManageSections === false && !props.canAdvanced}
          label="Section settings"
          value={tab}
          onChange={setTab}
          tabs={[
            { value: 'content', label: 'Content' },
            ...(props.canManageSections !== false
              ? [
                  { value: 'style', label: 'Style' },
                  { value: 'visibility', label: 'Visibility' },
                ]
              : []),
            ...(props.canAdvanced ? [{ value: 'advanced', label: 'Advanced' }] : []),
          ]}
        >
          {tab === 'content' && <InspectorSectionContent props={props} index={index} section={section} slots={slots} />}
          {tab === 'style' && props.canManageSections !== false && (
            <Button variant="tertiary" size="s" className={styles.layoutChip} onClick={props.onChangeLayout}>
              Layout: {entry?.name ?? 'Section'}
            </Button>
          )}
          {tab === 'style' && props.canManageSections !== false && entry?.slug === 'core-report-country-story' && (
            <div className={styles.content}>
              <div className="field">
                <label htmlFor="report-story-layout">Story layout</label>
                <select
                  id="report-story-layout"
                  value={String(section.values.layout ?? 'feature')}
                  onChange={event => props.onChange('layout', event.target.value)}
                >
                  {[
                    { value: 'response', label: 'Response with stats' },
                    { value: 'feature', label: 'Photo and story' },
                    { value: 'reading', label: 'Reading story' },
                    { value: 'text', label: 'Text and facts' },
                  ].map(choice => (
                    <option key={choice.value} value={choice.value}>
                      {choice.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          )}
          {tab === 'style' && props.canManageSections !== false && (
            <SectionAppearanceControls
              value={section.appearance ?? {}}
              support={entry?.appearance_support}
              originalDesign={props.originalDesign}
              customCode={Boolean(section.custom_css?.trim() || section.raw_html?.trim())}
              colors={props.themeColors}
              onChange={props.onAppearanceChange}
            />
          )}
          {tab === 'visibility' && props.canManageSections !== false && (
            <div className={styles.content}>
              <h3>Show on</h3>
              <div role="group" aria-label="Show this section on" className={styles.visibility}>
                {BREAKPOINTS.map(device => (
                  <label key={device.id}>
                    <input
                      type="checkbox"
                      checked={!(section.hidden_at ?? []).includes(device.id)}
                      onChange={() => props.onToggleBreakpoint(device.id)}
                    />
                    {device.label}
                  </label>
                ))}
              </div>
              <p className="hint">This changes layout; it does not hide content from people who look at the code.</p>
              <label className={styles.toggle}>
                <input type="checkbox" checked={section.hidden === true} onChange={props.onToggleHidden} />
                Hide until ready
              </label>
              <p className="hint">
                Hidden sections stay here for editing. Visitors will not see them after you publish.
              </p>
            </div>
          )}
          {tab === 'advanced' && props.canAdvanced && (
            <div className={styles.content}>
              <div className="field">
                <label htmlFor={`section-label-${index}`}>Section name (only editors see this)</label>
                <input
                  type="text"
                  id={`section-label-${index}`}
                  value={section.label ?? ''}
                  maxLength={SECTION_LABEL_MAX}
                  placeholder={sectionDisplayName(section, entry)}
                  onChange={event => props.onLabelChange(event.target.value)}
                />
              </div>
              {props.onChangeLinkName ? (
                <Button variant="secondary" onClick={props.onChangeLinkName}>
                  Change link name
                </Button>
              ) : (
                <AnchorField
                  value={section.values.__cms_anchor}
                  used={state.document.sections
                    .filter((_, sectionIndex) => sectionIndex !== index)
                    .map(section => section.values.__cms_anchor)}
                  onChange={value => {
                    const values = { ...section.values }
                    if (value) values.__cms_anchor = value
                    else delete values.__cms_anchor
                    props.onValuesChange(values, null)
                  }}
                />
              )}
              {props.latestEntry && props.latestEntry.version > section.section_def_version && (
                <Button
                  variant="secondary"
                  onClick={event => {
                    event.currentTarget.focus()
                    props.onReviewUpgrade(props.latestEntry!.version)
                  }}
                >
                  Review layout update
                </Button>
              )}
              {props.canAuthorSource && entry && isImportedDefinition(entry) && (
                <Button variant="secondary" onClick={props.onUpdateImportedFields}>
                  Update imported fields
                </Button>
              )}
              <SectionSourceControls
                index={index}
                css={section.custom_css ?? ''}
                html={section.raw_html ?? ''}
                approved={props.trustedCodeApproved}
                canEditHtml={props.canAuthorSource}
                onCustomCss={props.onCustomCss}
                onRawHtml={props.onRawHtml}
              />
            </div>
          )}
        </SectionSettings>
        {props.canManageSections !== false && (
          <div className={styles.addBelow}>
            <Button
              variant="secondary"
              disabled={props.canAddBelow === false}
              title={
                props.canAddBelow === false
                  ? 'Shared sections keep their position. Add new sections at the end of this page.'
                  : undefined
              }
              onClick={() => props.onAddBelow()}
            >
              <IconPlus size={16} />
              Add section below
            </Button>
            {props.canAddBelow === false && (
              <p className="hint">Shared sections keep their position. Add new sections at the end of this page.</p>
            )}
          </div>
        )}
      </EditorPanelNavigation>
    </aside>
  )
}
