'use client'

import { resolveCanonical } from '@cms/renderer'
import type { Ref } from 'react'
import { IconPlus, IconSettings } from '../../../components/icons.tsx'
import { Button, Disclosure, Drawer, IconButton, TextLink } from '../../../components/ui/index.ts'
import contentEditorStyles from '../../../components/content-editor.module.css'
import { socialImageProblem } from '../../../lib/page-meta-edit.ts'
import type { InspectorProps } from './inspector.tsx'
import styles from './inspector.module.css'
import ownedStyles from './inspector-styles.module.css'
import { MediaPicker } from './media-picker.tsx'
import { PageChecklist } from './page-checklist.tsx'
import { PageDetailsFields } from './page-details-fields.tsx'
import { Readiness } from './readiness-panel.tsx'

type PageInspectorProps = Pick<
  InspectorProps,
  | 'state'
  | 'siteId'
  | 'originalDesign'
  | 'canManageSections'
  | 'canEditSiteLook'
  | 'pageId'
  | 'savedVersionId'
  | 'canManagePage'
  | 'hasLivePage'
  | 'onSaveDetails'
  | 'onDanger'
  | 'metadataContext'
  | 'mediaAssets'
  | 'readiness'
  | 'sectionOutline'
  | 'onSelectSection'
  | 'onMetaChange'
  | 'onAddSection'
  | 'pageSettingsOpen'
  | 'onPageSettingsToggle'
>

export function PageInspector({
  inspector,
  props,
  sharingPickerOpen,
  setSharingPickerOpen,
}: {
  inspector: Ref<HTMLElement>
  props: PageInspectorProps
  sharingPickerOpen: boolean
  setSharingPickerOpen: (open: boolean) => void
}) {
  const { state } = props
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
          {!props.sectionOutline?.length && <p className="hint">No sections yet. Add a section to begin this page.</p>}
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
                Shown in the browser tab and as the headline in search results. {(meta.title ?? '').length} characters;
                aim for about 60.
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
                The sentence or two under the title in search results. {(meta.description ?? '').length} characters; aim
                for 120–160.
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
