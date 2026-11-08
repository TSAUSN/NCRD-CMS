'use client'
import { useState } from 'react'
import { DEFAULT_FOOTER_CONFIG, DEFAULT_HEADER_CONFIG, type FooterConfig, type HeaderConfig } from '@cms/schema'
import { contentCountsForPages } from '../../../../lib/content-counts.ts'
import { PresetFrameFields } from '../../../../components/preset-frame-fields.tsx'
import { FrameComponentPanel } from './frame-component-panel.tsx'
import { IconAlert, IconCheck, IconEye, IconFrame, IconInfo } from '../../../../components/icons.tsx'
import { ConfirmDialog } from '../../../../components/confirm.tsx'
import { useGlobalFrameDraft, type GlobalElementsProps } from './use-global-frame-draft.ts'
import { GlobalElementsPreview } from './global-elements-preview.tsx'

function FrameSourceSwitch({
  kind,
  authored,
  available,
  canManage,
  onChoose,
}: {
  kind: 'header' | 'footer'
  authored: boolean
  available: boolean
  canManage: boolean
  onChoose: (authored: boolean) => void
}) {
  if (!authored && !available) return null
  return (
    <div className="frame-source" role="radiogroup" aria-label={`${kind === 'header' ? 'Header' : 'Footer'} source`}>
      <button
        type="button"
        role="radio"
        aria-checked={!authored}
        className={!authored ? 'on' : ''}
        disabled={!canManage}
        onClick={() => onChoose(false)}
      >
        Layout presets
      </button>
      <button
        type="button"
        role="radio"
        aria-checked={authored}
        className={authored ? 'on' : ''}
        disabled={!canManage || !available}
        onClick={() => onChoose(true)}
      >
        Authored component
      </button>
    </div>
  )
}

export function GlobalElementsEditor(props: GlobalElementsProps) {
  const { siteId, siteName, initial, canManage, superAdmin, media, initialSitePreview = 'published' } = props
  const [active, setActive] = useState<'header' | 'footer'>('header')
  const {
    header,
    editHeader,
    footer,
    editFooter,
    publishedHeader,
    publishedFooter,
    pending,
    notice,
    confirming,
    setConfirming,
    chooseSource,
    act,
    cancelConfirmation,
    currentSerial,
    dirty,
    hasLiveVersion,
    draftIsLive,
  } = useGlobalFrameDraft(props)

  return (
    <div className="global-elements-workspace">
      {!canManage && (
        <p className="notice" role="note">
          <IconEye size={16} />
          <span className="notice-body">
            You can inspect the site frame. An editor or site administrator can change it.
          </span>
        </p>
      )}
      {notice && (
        <p className={`notice ${notice.ok ? 'notice-ok' : 'notice-error'}`} role={notice.ok ? 'status' : 'alert'}>
          {notice.ok ? <IconCheck size={16} /> : <IconAlert size={16} />}
          <span className="notice-body">{notice.message}</span>
          {!notice.ok && notice.kind === 'conflict' && (
            <button type="button" className="small secondary" onClick={() => window.location.reload()}>
              Reload
            </button>
          )}
        </p>
      )}

      <section className="global-commandbar" aria-label="Header and footer publishing status">
        <div>
          <span className={`nav-live-dot ${draftIsLive ? 'is-live' : ''}`} aria-hidden="true" />
          <span>
            <strong>
              {!hasLiveVersion
                ? 'Not published yet'
                : draftIsLive
                  ? 'Matches the live site'
                  : 'Saved changes are not live yet'}
            </strong>
            <small>{dirty ? 'Save before publishing.' : 'Your changes are saved.'}</small>
          </span>
        </div>
        {canManage && (
          <div className="actions">
            <button
              type="button"
              className="ghost"
              disabled={!hasLiveVersion || dirty || draftIsLive || pending}
              onClick={() => setConfirming('revert')}
            >
              Revert to live
            </button>
            <button type="button" className="secondary" disabled={!dirty || pending} onClick={() => act('save')}>
              {pending ? 'Working…' : 'Save draft'}
            </button>
            <button
              type="button"
              className="cta"
              disabled={dirty || draftIsLive || pending}
              onClick={() => setConfirming('publish')}
            >
              Publish header &amp; footer
            </button>
          </div>
        )}
      </section>

      <div className="global-ownership" role="note">
        <IconInfo size={17} />
        <div>
          <strong>Edited elsewhere</strong>
          <span>
            Menu items are in <a href={`/sites/${siteId}/navigation`}>Navigation</a>, colours and buttons in{' '}
            <a href={`/sites/${siteId}/design`}>Design</a>, and logo files in{' '}
            <a href={`/sites/${siteId}/media`}>Media</a>.
          </span>
        </div>
      </div>

      <div className="global-grid">
        <fieldset
          className="global-controls"
          aria-label="Header and footer fields"
          disabled={pending}
          aria-busy={pending}
          style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}
        >
          <div className="global-tabs" role="tablist" aria-label="Site-wide elements">
            <button
              type="button"
              role="tab"
              aria-selected={active === 'header'}
              className={active === 'header' ? 'on' : ''}
              onClick={() => setActive('header')}
            >
              <IconFrame size={17} />
              Header
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={active === 'footer'}
              className={active === 'footer' ? 'on' : ''}
              onClick={() => setActive('footer')}
            >
              <IconFrame size={17} />
              Footer
            </button>
          </div>

          <FrameSourceSwitch
            kind={active}
            authored={(active === 'header' ? header : footer).schemaVersion === 2}
            available={initial.components.some(
              component => component.placement === active && component.status === 'active',
            )}
            canManage={canManage && !pending}
            onChoose={authored => chooseSource(active, authored)}
          />

          {active === 'header' ? (
            header.schemaVersion === 2 ? (
              <FrameComponentPanel
                kind="header"
                config={header}
                components={initial.components}
                media={media}
                pageCount={initial.pages.length}
                pageCountLabel={initial.contentSummary ?? contentCountsForPages(initial.pages)}
                canManage={canManage && !pending}
                siteId={siteId}
                onChange={next => editHeader(next as HeaderConfig)}
              />
            ) : (
              <PresetFrameFields
                siteId={siteId}
                part="header"
                siteName={siteName}
                header={header.schemaVersion === 1 ? header : DEFAULT_HEADER_CONFIG}
                footer={footer.schemaVersion === 1 ? footer : DEFAULT_FOOTER_CONFIG}
                canManage={canManage && !pending}
                superAdmin={superAdmin}
                media={media}
                pages={initial.pages}
                onHeader={editHeader}
                onFooter={editFooter}
              />
            )
          ) : footer.schemaVersion === 2 ? (
            <FrameComponentPanel
              kind="footer"
              config={footer}
              components={initial.components}
              media={media}
              pageCount={initial.pages.length}
              pageCountLabel={initial.contentSummary ?? contentCountsForPages(initial.pages)}
              canManage={canManage && !pending}
              siteId={siteId}
              onChange={next => editFooter(next as FooterConfig)}
            />
          ) : (
            <PresetFrameFields
              siteId={siteId}
              part="footer"
              siteName={siteName}
              header={header.schemaVersion === 1 ? header : DEFAULT_HEADER_CONFIG}
              footer={footer.schemaVersion === 1 ? footer : DEFAULT_FOOTER_CONFIG}
              canManage={canManage && !pending}
              superAdmin={superAdmin}
              media={media}
              pages={initial.pages}
              onHeader={editHeader}
              onFooter={editFooter}
            />
          )}
        </fieldset>

        <GlobalElementsPreview
          siteId={siteId}
          siteName={siteName}
          previewPages={initial.previewPages}
          initialSitePreview={initialSitePreview}
          currentSerial={currentSerial}
          header={header}
          footer={footer}
          active={active}
        />
      </div>

      {confirming === 'publish' && (
        <ConfirmDialog
          title="Publish the site frame?"
          what="The saved header and footer draft will go live together on every published page."
          reassurance="Page content, navigation and design settings are not changed. You can create another draft afterward."
          confirmLabel="Publish header & footer"
          pending={pending}
          tone="primary"
          onConfirm={() => act('publish')}
          onCancel={cancelConfirmation}
        />
      )}
      {confirming === 'revert' && (
        <ConfirmDialog
          title="Revert the draft to live?"
          what="Both header and footer drafts will be replaced by fresh copies of what visitors currently see."
          reassurance="The live site is not changed. Draft-only edits cannot be recovered after this action."
          confirmLabel="Revert both drafts"
          pending={pending}
          onConfirm={() => act('revert')}
          onCancel={cancelConfirmation}
        />
      )}
    </div>
  )
}
