'use client'
import { OptionalIntroduction } from './optional-introduction.tsx'
import { EditorPanelNavigation } from './editor-panel-navigation.tsx'
import { dataValueBindings, numberChoiceValues } from '@cms/schema'
import { usesSiteSocialAccounts, siteSocialGroup } from '@cms/schema'
import { LinkSettings } from '../../../components/link-settings.tsx'
import shared from '../../../components/workspace.module.css'
import workspaceFormsStyles from '../../../components/workspace-styles/workspace-forms.module.css'
import recordTableStyles from '../../../components/workspace-styles/record-table.module.css'
import ownedStyles from './inspector-styles.module.css'
import { ContentRepeatPanel } from './content-repeat-panel.tsx'
import { HeroSlidesPanel } from './hero-slides-panel.tsx'
import { PageDetailsFields } from './page-details-fields.tsx'
import { PageChecklist } from './page-checklist.tsx'
import type { PageDetailsInput } from '../../../lib/page-details.ts'
import type { savePageDetailsAction } from './page-details-actions.ts'
import dynamic from 'next/dynamic'
import styles from './inspector.module.css'
import contentEditorStyles from '../../../components/content-editor.module.css'
import { Button, IconButton, Drawer, Tabs, Disclosure, TextLink } from '../../../components/ui/index.ts'
import { sectionDisplayName } from '../../../lib/section-display-name.ts'
import { useEffect, useRef, useState, type ComponentProps } from 'react'
import {
  captureFieldEdit,
  isSectionNew,
  isSlotChanged,
  SECTION_LABEL_MAX,
  type EditorMetadata,
  type EditorState,
  type ReadinessReport,
  type FieldEditSnapshot,
} from '@cms/domain'
import { resolveCanonical, type CanonicalInput } from '@cms/renderer'
import { socialImageProblem } from '../../../lib/page-meta-edit.ts'
import { inspectorFieldGroups, linkWordsName } from '../../../lib/inspector-groups.ts'
import { isImportedDefinition } from '../../../lib/imported-definition.ts'
import { IconPlus, IconSettings, IconChevronLeft, SlotIcon } from '../../../components/icons.tsx'
import type { LinkTarget } from '../../../lib/queries.ts'
import type { MediaAsset } from '../../../lib/media-library.ts'
import type { LibraryEntry } from './editor.tsx'
import { MediaPicker } from './media-picker.tsx'
import { editorContentSlots } from '../../../lib/editor-content-slots.ts'
import {
  isDrawingSlot,
  isIconSlot,
  sampleFieldNames,
  repeatItemSlotId,
  repeatItemSpec,
  isHeroSlides,
  type SectionAppearance,
} from '@cms/schema'
import { Readiness } from './readiness-panel.tsx'
import { SectionSourceControls } from './section-source-controls.tsx'
import { SectionAppearanceControls } from './section-appearance-controls.tsx'
import { SlotField } from './inspector-fields/slot-field.tsx'
import { RepeatList } from './inspector-fields/repeat-list.tsx'
import { AnchorField } from './inspector-fields/anchor-field.tsx'

const DataValueField = dynamic(() => import('./data-value-field.tsx').then(module => module.DataValueField))

const BREAKPOINTS = [
  { id: 'sm', label: 'Phone', width: 'under 768px' },
  { id: 'md', label: 'Tablet', width: '768–1023px' },
  { id: 'lg', label: 'Desktop', width: '1024px and up' },
] as const

type Props = {
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

export function Inspector(props: Props) {
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
      const bounds = field.getBoundingClientRect(),
        viewport = scroller.getBoundingClientRect()
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

  if (section === null || index === null) {
    const meta = state.document.meta
    const canonical = resolveCanonical({ ...props.metadataContext, authored: meta.canonical })
    const socialProblem = socialImageProblem(meta.social_image ?? '')
    const sharingMediaId = /^\/media\/([0-9a-f-]{36})\/(original|thumbnail|card|wide)$/i.exec(
      meta.social_image ?? '',
    )?.[1]
    const sharingAsset = props.mediaAssets.find(asset => asset.id === sharingMediaId)
    return (
      <aside
        ref={inspector}
        id="editor-panel-inspector"
        className={`pane inspector ${styles.inspector}`}
        data-selected-section={section !== null || undefined}
        aria-label="Inspector"
      >
        <div className="pane-head">
          <h2 className="pane-title">This page</h2>
          <IconButton
            variant="tertiary"
            size="s"
            tooltip="Open page settings"
            onClick={() => props.onPageSettingsToggle(true)}
          >
            <IconSettings size={16} />
          </IconButton>
        </div>
        {!props.originalDesign && (
          <p className="hint">Click anything on the page to edit it. Your work saves as a draft as you go.</p>
        )}
        {props.canManageSections !== false && (
          <Button
            fullWidth
            aria-label={props.originalDesign ? 'Add section at end' : 'Add a section'}
            onClick={props.onAddSection}
          >
            <IconPlus size={16} /> {props.originalDesign ? 'Add section at end' : 'Add a section'}
          </Button>
        )}
        {props.originalDesign ? (
          <>
            <p className="hint">Click anything on the page to edit it. Your work saves as a draft as you go.</p>
            <h3>Page outline</h3>
            <p>
              {state.document.sections.length} {state.document.sections.length === 1 ? 'section' : 'sections'} on this
              page.
            </p>
            <div className={styles.pageActions}>
              {props.canEditSiteLook !== false && <a href={'/sites/' + props.siteId + '/design'}>Menu &amp; footer</a>}
            </div>
            <Readiness report={props.readiness} />
          </>
        ) : (
          <>
            <h3>Sections</h3>
            <ul className={ownedStyles.actionList} aria-label="Page outline">
              {props.sectionOutline?.map(item => (
                <li key={item.index}>
                  <Button
                    variant="secondary"
                    size="s"
                    title={item.label}
                    aria-label={'Open section: ' + item.label}
                    onClick={() => props.onSelectSection?.(item.index)}
                  >
                    {item.label}
                  </Button>
                </li>
              ))}
            </ul>
            {!props.sectionOutline?.length && (
              <p className="hint">No sections yet. Add a section to begin this page.</p>
            )}
            <p className="hint">
              The header and footer are shared by all pages.{' '}
              {props.canEditSiteLook !== false ? (
                <>
                  Change them in <TextLink href={'/sites/' + props.siteId + '/header'}>Header &amp; menu</TextLink>.
                </>
              ) : (
                'Site admins look after them.'
              )}
            </p>
            <Disclosure title="Page checks" open={props.readiness?.ok === false}>
              <Readiness report={props.readiness} />
              {props.canEditSiteLook !== false && (
                <div className={styles.pageActions}>
                  <TextLink href={'/sites/' + props.siteId + '/design'}>Site look</TextLink>
                </div>
              )}
            </Disclosure>
          </>
        )}

        {props.pageSettingsOpen && (
          <Drawer title="Page settings" onClose={() => props.onPageSettingsToggle(false)}>
            {props.pageId && props.onSaveDetails && (
              <PageDetailsFields
                pageId={props.pageId}
                originalDesign={props.originalDesign}
                onSave={props.onSaveDetails}
              />
            )}
            <h3>Search &amp; sharing</h3>
            <div className={styles.content}>
              <div className="field">
                <label htmlFor="meta-title">Search title</label>
                <input
                  id="meta-title"
                  type="text"
                  maxLength={512}
                  value={state.document.meta.title ?? ''}
                  onChange={event => props.onMetaChange('title', event.target.value)}
                />
                <p className="hint">
                  Shown in the browser tab and as the headline in search results. {(meta.title ?? '').length}{' '}
                  characters; aim for about 60.
                </p>
              </div>

              <div className="field">
                <label htmlFor="meta-description">Search description</label>
                <textarea
                  id="meta-description"
                  rows={3}
                  maxLength={2048}
                  value={state.document.meta.description ?? ''}
                  onChange={event => props.onMetaChange('description', event.target.value)}
                />
                <p className="hint">
                  The sentence or two under the title in search results. {(meta.description ?? '').length} characters;
                  aim for 120–160.
                </p>
              </div>

              <Disclosure className={contentEditorStyles.disclosure} title={<>Search visibility & sharing</>}>
                <p className="hint">
                  These choices are saved with this page. Publish to apply them to visitors and search engines.
                </p>
                <div className="field">
                  <label className="check-row" htmlFor="meta-noindex">
                    <input
                      id="meta-noindex"
                      type="checkbox"
                      checked={meta.noindex === true}
                      onChange={event => props.onMetaChange('noindex', event.target.checked)}
                    />
                    Ask search engines not to index this page
                  </label>
                  <p className="hint">
                    The page remains publicly accessible. Search engines decide when to update their results. Staging
                    addresses always request no indexing.
                  </p>
                </div>
                <div className="field">
                  <span className="field-label">Sharing image</span>
                  {sharingAsset?.previewUrl && (
                    <img
                      src={sharingAsset.previewUrl}
                      alt=""
                      style={{ maxWidth: '100%', maxHeight: '9rem', objectFit: 'contain' }}
                    />
                  )}
                  {sharingAsset && <p className="hint">{sharingAsset.name}</p>}
                  <div className="actions">
                    <button type="button" className="secondary small" onClick={() => setSharingPickerOpen(true)}>
                      {meta.social_image ? 'Change sharing image' : 'Choose sharing image'}
                    </button>
                    {meta.social_image && (
                      <button
                        type="button"
                        className="secondary small"
                        onClick={() => props.onMetaChange('social_image', '')}
                      >
                        Remove sharing image
                      </button>
                    )}
                  </div>
                  <label htmlFor="meta-social-image">Sharing image address</label>
                  <input
                    id="meta-social-image"
                    type="text"
                    maxLength={2048}
                    value={meta.social_image ?? ''}
                    placeholder="https://example.org/image.jpg"
                    aria-invalid={socialProblem ? true : undefined}
                    aria-describedby="meta-social-image-help"
                    onChange={event => props.onMetaChange('social_image', event.target.value)}
                  />
                  <p id="meta-social-image-help" className={socialProblem ? 'warn-inline' : 'hint'}>
                    {socialProblem ??
                      'Choose from Media, or paste a public HTTPS image address. Used when someone shares the page; removing it does not delete the image.'}
                  </p>
                </div>
                <div className="field">
                  <label htmlFor="meta-canonical">Preferred search address (canonical)</label>
                  <input
                    id="meta-canonical"
                    type="text"
                    maxLength={2048}
                    value={meta.canonical ?? ''}
                    placeholder="Use this page’s own address"
                    aria-invalid={canonical.refusal ? true : undefined}
                    aria-describedby="meta-canonical-help"
                    onChange={event => props.onMetaChange('canonical', event.target.value)}
                  />
                  <p id="meta-canonical-help" className={canonical.refusal ? 'warn-inline' : 'hint'}>
                    {canonical.refusal
                      ? `${canonical.refusal.message} Clear the field to use this page’s address.`
                      : 'Usually leave this blank. Use a path such as /about or an HTTPS address on this site’s verified domain. Addresses on other sites are refused at publication.'}
                  </p>
                </div>
              </Disclosure>
              {sharingPickerOpen && (
                <MediaPicker
                  siteId={props.siteId}
                  initialAssets={props.mediaAssets}
                  currentValue={
                    sharingMediaId
                      ? { media_id: sharingMediaId, alt: sharingAsset?.altText, decorative: sharingAsset?.decorative }
                      : undefined
                  }
                  onChoose={value => {
                    if (value.media_id)
                      props.onMetaChange('social_image', `/media/${value.media_id}/${value.variant ?? 'wide'}`)
                    setSharingPickerOpen(false)
                  }}
                  onClose={() => setSharingPickerOpen(false)}
                />
              )}
              {props.savedVersionId && (
                <PageChecklist
                  versionId={props.savedVersionId}
                  description={meta.description ?? ''}
                  sectionCount={state.document.sections.length}
                />
              )}
              <Readiness report={props.readiness} />
              {props.canManagePage && props.onDanger && (
                <section className={styles.danger}>
                  <h3>Danger zone</h3>
                  <p>
                    Unpublish removes the live page. Archive also moves the page out of the active Pages list; its draft
                    and history are kept.
                  </p>
                  <div className="actions">
                    {props.hasLivePage && (
                      <Button variant="destructive" onClick={() => props.onDanger?.('unpublish')}>
                        Unpublish page
                      </Button>
                    )}
                    <Button variant="destructive" onClick={() => props.onDanger?.('archive')}>
                      Archive page
                    </Button>
                  </div>
                </section>
              )}
            </div>
          </Drawer>
        )}
      </aside>
    )
  }

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
    const headingLink = slots.find(slot => ['link', 'button'].includes(slot.kind) && slot.id === 'link'),
      name = sectionDisplayName(section, entry)
    return (
      <aside
        ref={inspector}
        id="editor-panel-inspector"
        data-selected-section
        className={`pane inspector ${styles.inspector} ${workspaceFormsStyles.compactForm}`}
        aria-label="Inspector"
        onKeyDown={event => {
          if (event.key === 'Escape' && !event.defaultPrevented && !(event.target as Element).closest('dialog')) {
            event.preventDefault()
            props.onSelectSlot(null)
          }
        }}
      >
        <div className={shared.denseStack}>
          <div className={workspaceFormsStyles.panelActions}>
            <Button variant="tertiary" onClick={() => props.onSelectSlot(null)}>
              <IconChevronLeft size={16} />
              Back
            </Button>
            <Button onClick={props.onDone}>Done</Button>
          </div>
          <h2>Section title</h2>
          <p className={recordTableStyles.meta}>Part of the {name} section. It moves with the section.</p>
          <div className="field" data-inspector-slot={focusedTitle.id} data-selected="true">
            <div className="field-head">
              <label htmlFor={'slot-' + index + '-' + focusedTitle.id}>Title</label>
              {sampleFieldNames(section.values).includes(focusedTitle.id) && (
                <span className="chip chip-neutral">Sample</span>
              )}
              {!isSectionNew(state, index) && isSlotChanged(state, index, focusedTitle.id) && (
                <IconButton
                  variant="tertiary"
                  size="s"
                  tooltip="Revert Title to the version when you opened this page"
                  onClick={() => props.onRevertSlot(focusedTitle.id)}
                >
                  <span className="dot" aria-hidden="true" />
                </IconButton>
              )}
            </div>
            <input
              id={'slot-' + index + '-' + focusedTitle.id}
              value={String(section.values[focusedTitle.id] ?? '')}
              onChange={event => props.onChange(focusedTitle.id, event.target.value)}
            />
          </div>
          {headingLink && (
            <LinkSettings
              id={'heading-link-' + index}
              onEditStart={() => {
                const snapshot = captureFieldEdit(section.values, headingLink.id)
                return () => props.onRestoreSlot(headingLink.id, snapshot)
              }}
              summaryLabel="Link beside the title"
              value={section.values[headingLink.id]}
              targets={props.linkTargets}
              onChange={value => props.onChange(headingLink.id, value)}
            />
          )}
        </div>
      </aside>
    )
  }
  const sectionCount = state.document.sections.length
  // A newly added section has no earlier field value in this session.
  const isNew = isSectionNew(state, index)

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
          {tab === 'content' && (
            <div className={styles.content}>
              {!props.canAdvanced && Boolean(section.custom_css?.trim() || section.raw_html?.trim()) && (
                <p className="notice notice-info">
                  This section contains preserved custom code. Only an administrator can change it. Content fields
                  remain available.
                </p>
              )}
              {section.values.__cms_report_links === true && (
                <p className="hint">Add a web page or a PDF, or both. The buttons show only for what exists.</p>
              )}
              {entry?.slug === 'core-report-page-links' && (
                <p className="hint">
                  Made from this page. These links follow visible sections with a link name and a heading. Change a
                  heading to change its words, or use the section’s Page link label for a shorter name. An Admin can
                  choose Change link name from a section’s menu.
                </p>
              )}
              {slots.length === 0 && (
                <p className="muted">
                  {props.canManageSections === false
                    ? 'This section has no content fields. A Site admin can change its layout.'
                    : 'This section has no editable fields. You can move or hide it here; its content follows its saved layout.'}
                </p>
              )}

              {(() => {
                // One field: its name, changed marker and revert, then its control.
                const row = (slot: (typeof slots)[number], label: string, className: string, grouped = false) => {
                  const changed = !isNew && isSlotChanged(state, index, slot.id)
                  const id = `slot-${index}-${slot.id}`
                  return (
                    <div
                      className={className}
                      key={slot.id}
                      data-inspector-slot={slot.id}
                      data-selected={className === 'field' && state.selection.slot === slot.id ? 'true' : undefined}
                    >
                      <div className="field-head">
                        <label id={`field-label-${id}`} htmlFor={slot.kind === 'richtext' ? undefined : id}>
                          {!grouped && (
                            <span className="field-kind">
                              <SlotIcon kind={isIconSlot(slot) || isDrawingSlot(slot) ? 'icon' : slot.kind} size={13} />
                            </span>
                          )}
                          {label}
                        </label>
                        {sampleFieldNames(section.values).includes(slot.id) && (
                          <span className="chip chip-neutral">Sample</span>
                        )}
                        {changed && (
                          <IconButton
                            variant="tertiary"
                            size="s"
                            tooltip={`Revert ${label} to the version when you opened this page`}
                            onClick={() => props.onRevertSlot(slot.id)}
                          >
                            <span className="dot" aria-hidden="true" />
                          </IconButton>
                        )}
                      </div>
                      {(() => {
                        const field = (
                          <SlotField
                            id={id}
                            slot={slot}
                            value={section.values[slot.id]}
                            siteId={props.siteId}
                            mediaAssets={props.mediaAssets}
                            linkTargets={props.linkTargets}
                            pagePath={props.metadataContext.path ?? '/'}
                            imagePreviews={props.imagePreviews}
                            originalDesign={props.originalDesign}
                            supportsFocus={!props.originalDesign && entry?.image_focus_supported === true}
                            definitionId={section.section_def_id}
                            definitionVersion={section.section_def_version}
                            themeColors={props.themeColors}
                            onEditList={props.onEditList}
                            customCode={Boolean(section.raw_html?.trim() || section.custom_css?.trim())}
                            onBeginLinkEdit={() => {
                              const snapshot = captureFieldEdit(section.values, slot.id)
                              return () => props.onRestoreSlot(slot.id, snapshot)
                            }}
                            canAdvanced={props.canAdvanced}
                            grouped={grouped}
                            onChange={next => props.onChange(slot.id, next)}
                          />
                        )
                        const bindings = dataValueBindings(section.values),
                          bound = bindings[slot.id],
                          eligible =
                            bound ||
                            (slot.kind === 'text' &&
                              (/^(number|value|amount|total|figure)$/i.test(slot.label) ||
                                slot.id.split('__').at(-1) === 'value'))
                        return !props.originalDesign && props.pageId && eligible ? (
                          <DataValueField
                            id={id}
                            pageId={props.pageId}
                            binding={bound}
                            onChange={(binding, value, label) =>
                              props.onValuesChange(
                                numberChoiceValues(section.values, slot.id, binding, value, label),
                                slot.id,
                              )
                            }
                          >
                            {field}
                          </DataValueField>
                        ) : (
                          field
                        )
                      })()}
                    </div>
                  )
                }
                const groupRow = (group: ReturnType<typeof inspectorFieldGroups<(typeof slots)[number]>>[number]) => {
                  if (group.kind === 'single') return row(group.slot, group.slot.label, 'field')
                  // An imported link: its words and where it goes, under its name.
                  const members = [group.destination, ...group.words]
                  const titleId = `link-group-${index}-${group.destination.id}`
                  return (
                    <div
                      className="field link-group"
                      key={group.destination.id}
                      role="group"
                      aria-labelledby={titleId}
                      data-selected={members.some(slot => slot.id === state.selection.slot) ? 'true' : undefined}
                    >
                      <p className="link-group-title" id={titleId}>
                        <span className="field-kind">
                          <SlotIcon kind="link" size={13} />
                        </span>
                        {group.name}
                      </p>
                      {group.words.map(slot => row(slot, linkWordsName(group, slot), 'link-group-row', true))}
                      {row(group.destination, 'Where it goes', 'link-group-row', true)}
                    </div>
                  )
                }
                const focusedRepeat = !props.originalDesign
                  ? slots.find(slot => repeatItemSpec(slot) && state.selection.slot?.startsWith(slot.id + '__'))
                  : null
                return inspectorFieldGroups(slots).map(group => {
                  if (focusedRepeat && (group.kind !== 'single' || group.slot.id !== focusedRepeat.id)) return null
                  if (
                    group.kind === 'single' &&
                    group.slot.id === 'sample_note' &&
                    entry?.slug === 'core-echelon-follow' &&
                    usesSiteSocialAccounts(section.values, slots, entry.slug)
                  )
                    return null
                  if (
                    group.kind === 'single' &&
                    group.slot.id === siteSocialGroup(slots) &&
                    usesSiteSocialAccounts(section.values, slots, entry?.slug)
                  )
                    return (
                      <p key="site-social-accounts" className="hint">
                        These accounts come from site Settings.{' '}
                        {props.canEditSiteLook !== false ? (
                          <TextLink href={'/sites/' + props.siteId + '/settings/social'}>Open Social accounts</TextLink>
                        ) : (
                          'An Admin can change them.'
                        )}
                      </p>
                    )
                  const spec = group.kind === 'single' ? repeatItemSpec(group.slot) : null
                  if (
                    !props.originalDesign &&
                    group.kind === 'single' &&
                    group.slot.id === 'intro' &&
                    group.slot.kind === 'richtext' &&
                    group.slot.constraints?.required !== true &&
                    slots.some(slot => repeatItemSpec(slot))
                  )
                    return (
                      <OptionalIntroduction
                        key={state.sectionOrigins[index] + ':intro'}
                        value={section.values.intro}
                        focused={state.selection.slot === 'intro'}
                      >
                        {groupRow(group)}
                      </OptionalIntroduction>
                    )
                  if (group.kind !== 'single' || !spec) return groupRow(group)
                  if (isHeroSlides(group.slot))
                    return (
                      <HeroSlidesPanel
                        key={state.sectionOrigins[index] + ':' + group.slot.id}
                        slot={group.slot}
                        spec={spec}
                        values={section.values}
                        selected={state.selection.slot}
                        onValuesChange={props.onValuesChange}
                        siteId={props.siteId}
                        canChooseStories={props.canChooseStories === true}
                        media={props.mediaAssets}
                        pageId={props.pageId}
                        definitionId={section.section_def_id}
                        definitionVersion={section.section_def_version}
                        publishedValues={props.publishedHeroValues}
                        canStyle={props.canAdvanced}
                        targets={props.linkTargets}
                        renderField={(key, id) => {
                          const field = spec.fields.find(field => field.id === id)
                          return field
                            ? row(
                                { ...field, id: repeatItemSlotId(group.slot.id, key, field.id) },
                                field.label,
                                'field',
                              )
                            : null
                        }}
                        renderItem={key =>
                          inspectorFieldGroups(
                            ['photo', 'title', 'intro', 'primary', 'secondary']
                              .flatMap(id => spec.fields.filter(field => field.id === id))
                              .map(field => ({ ...field, id: repeatItemSlotId(group.slot.id, key, field.id) })),
                          ).map(groupRow)
                        }
                      />
                    )
                  if (!props.originalDesign)
                    return (
                      <ContentRepeatPanel
                        key={state.sectionOrigins[index] + ':' + group.slot.id}
                        origin={state.sectionOrigins[index]!}
                        slot={group.slot}
                        spec={spec}
                        values={section.values}
                        selected={state.selection.slot}
                        onValuesChange={props.onValuesChange}
                        onDiscardEmpty={props.onDiscardEmptyRepeat}
                        renderItem={key =>
                          inspectorFieldGroups(
                            spec.fields.map(field => ({
                              ...field,
                              id: repeatItemSlotId(group.slot.id, key, field.id),
                            })),
                          ).map(groupRow)
                        }
                      />
                    )
                  return (
                    <RepeatList
                      key={group.slot.id}
                      index={index}
                      slot={group.slot}
                      spec={spec}
                      values={section.values}
                      selected={state.selection.slot}
                      onValuesChange={props.onValuesChange}
                      renderItem={key =>
                        inspectorFieldGroups(
                          spec.fields.map(field => ({ ...field, id: repeatItemSlotId(group.slot.id, key, field.id) })),
                        ).map(groupRow)
                      }
                    />
                  )
                })
              })()}
            </div>
          )}
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
