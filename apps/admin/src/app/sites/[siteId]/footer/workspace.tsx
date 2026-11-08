'use client'
import { useState } from 'react'
import type { MediaAsset } from '../../../../lib/media-library.ts'
import { contentCountsForPages } from '../../../../lib/content-counts.ts'
import { unpublishedChangeLabel } from '../../../../components/status.tsx'
import { Badge, Button, ButtonLink, Note, PageHeader, TextLink } from '../../../../components/ui/index.ts'
import { MediaPicker } from '../../../pages/[pageId]/media-picker.tsx'
import { PresetFooterCards } from '../../../../components/preset-footer-cards.tsx'
import styles from '../../../../components/workspace.module.css'
import { useFooterDraft, type FooterWorkspaceProps } from './use-footer-draft.ts'
import { FooterContentCards } from './footer-content-cards.tsx'
import { FooterLinkList, FooterLinkDialogs } from './footer-link-controls.tsx'
import { FrameWorkspacePreview, FrameWorkspacePreviewDialog } from '../frame-workspace-preview.tsx'
export function FooterWorkspace(props: FooterWorkspaceProps) {
  const { siteId, siteName, initial, navigation, savedLogos, superAdmin } = props
  const model = useFooterDraft(props)
  const [chosenLogo, setChosenLogo] = useState<Pick<MediaAsset, 'id' | 'previewUrl'> | null>(null)
  const {
    footer,
    setFooter,
    dirty,
    changed,
    pending,
    valid,
    preview,
    save,
    notice,
    error,
    latest,
    pin,
    upgrade,
    picker,
    logoSlot,
    logo,
    value,
    setPicker,
  } = model
  const { editing } = model.linkControls
  const logoPreviewUrl =
    (chosenLogo?.id === logo.media_id
      ? chosenLogo?.previewUrl
      : savedLogos.find(asset => asset.id === logo.media_id)?.previewUrl) ?? String(logo.src ?? '')
  return (
    <div className={styles.denseStack + ' ' + styles.singleColumn}>
      <PageHeader
        stacked
        density="compact"
        showWayfinding={false}
        title="Footer"
        sub={`Shown across ${initial.contentSummary ?? contentCountsForPages(initial.pages)} on ${siteName}. Editing a page never changes this.`}
        actions={
          <>
            <Badge tone={dirty || changed ? 'pending' : 'live'}>
              {dirty ? 'Unsaved changes' : changed ? unpublishedChangeLabel(1) : 'Live'}
            </Badge>
            <Button
              variant="secondary"
              disabled={!preview.ticket || !valid || pending || preview.loading}
              onClick={preview.open}
            >
              Preview
            </Button>
            <Button
              variant="secondary"
              loading={pending}
              disabled={!dirty || !valid || Boolean(editing)}
              onClick={() => void save()}
            >
              Save draft
            </Button>
            <ButtonLink
              variant="publish"
              href={'/sites/' + siteId + '/publishing?area=footer'}
              aria-disabled={dirty || pending || Boolean(editing)}
              onClick={event => {
                if (dirty || pending || editing) event.preventDefault()
              }}
            >
              Publish…
            </ButtonLink>
          </>
        }
      />
      {error && (
        <p role="alert" className="error-inline">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      {dirty && <p className="muted">Save this draft before reviewing it in Publish.</p>}
      <p className="hint">
        Social accounts are managed in{' '}
        <TextLink href={'/sites/' + siteId + '/settings/social'}>Settings · Social accounts</TextLink>.
      </p>

      <FrameWorkspacePreview part="footer" preview={preview} valid={valid} />
      {footer.schemaVersion === 2 ? (
        <div className={styles.threeColumns}>
          <FooterContentCards model={model} logoPreviewUrl={logoPreviewUrl} superAdmin={superAdmin} />
          <FooterLinkList model={model} />
        </div>
      ) : (
        <PresetFooterCards
          footer={footer}
          canManage={!pending}
          superAdmin={false}
          pages={navigation.pages}
          siteName={siteName}
          onChange={setFooter}
        />
      )}
      {latest && pin && latest.version > pin.version && (
        <Note>
          The template has updated footer controls. Your current words and links stay in place.{' '}
          <Button variant="secondary" disabled={pending} onClick={upgrade}>
            Preview updated footer
          </Button>
        </Note>
      )}
      {picker && logoSlot && (
        <MediaPicker
          siteId={siteId}
          mode="placement"
          confirmLabel="Use this logo"
          initialAssets={[]}
          onSelectedAsset={({ id, previewUrl }) => setChosenLogo({ id, previewUrl })}
          currentValue={logo}
          onChoose={image => {
            value(logoSlot.id, { ...image, decorative: false })
            setPicker(false)
          }}
          onClose={() => setPicker(false)}
        />
      )}

      <FooterLinkDialogs model={model} navigation={navigation} />
      <FrameWorkspacePreviewDialog part="footer" preview={preview} />
    </div>
  )
}
