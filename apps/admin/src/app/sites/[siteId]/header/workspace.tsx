'use client'
import { contentCountsForPages } from '../../../../lib/content-counts.ts'
import { unpublishedChangeLabel } from '../../../../components/status.tsx'
import { Badge, Button, ButtonLink, Note, PageHeader, Tabs } from '../../../../components/ui/index.ts'
import styles from '../../../../components/workspace.module.css'
import listInspectorStyles from '../../../../components/workspace-styles/list-inspector.module.css'
import { useHeaderMenu, type HeaderMenuProps } from './use-header-menu.ts'
import { useMenuPreviewHeight } from './use-menu-preview-height.ts'
import { HeaderMenuTab } from './header-menu-tab.tsx'
import { HeaderLogoTab, HeaderExtraText, HeaderLogoPicker } from './header-logo-tab.tsx'
import { HeaderButtonsTab } from './header-buttons-tab.tsx'
import { FrameWorkspacePreview, FrameWorkspacePreviewDialog } from '../frame-workspace-preview.tsx'
export function HeaderMenuWorkspace(props: HeaderMenuProps) {
  const { siteId, siteName, initial } = props
  const model = useHeaderMenu(props)
  const { previewRef, holdHeight, onMenuPointerDown } = useMenuPreviewHeight()
  const {
    dirty,
    changes,
    valid,
    pending,
    saveValid,
    itemEditing,
    error,
    notice,
    logoProblem,
    tab,
    setTab,
    latest,
    pin,
    upgrade,
    save,
    preview,
  } = model
  return (
    <div className={styles.denseStack + ' ' + styles.singleColumn}>
      <PageHeader
        stacked
        density="compact"
        showWayfinding={false}
        title="Header & menu"
        sub={`Shown across ${initial.contentSummary ?? contentCountsForPages(initial.pages)} on ${siteName}. Changes wait for you to publish.`}
        actions={
          <>
            <Badge tone={dirty || changes ? 'pending' : 'live'}>
              {dirty ? 'Unsaved changes' : changes ? unpublishedChangeLabel(changes) : 'Live'}
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
              disabled={!dirty || !saveValid || itemEditing}
              onClick={() => void save()}
            >
              Save draft
            </Button>
            <ButtonLink
              variant="publish"
              href={'/sites/' + siteId + '/publishing?area=header-menu'}
              aria-disabled={dirty || pending || itemEditing}
              onClick={event => {
                if (dirty || pending || itemEditing) event.preventDefault()
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
      {dirty && logoProblem && tab !== 'logo' && <p role="alert">Add a logo description in Logo before saving.</p>}
      <Tabs
        label="Header settings"
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'menu', label: 'Menu' },
          { value: 'logo', label: 'Logo' },
          { value: 'buttons', label: 'Header buttons' },
        ]}
      >
        <div className={listInspectorStyles.formStack + ' ' + styles.singleColumn}>
          <div ref={previewRef} style={holdHeight === undefined ? undefined : { height: holdHeight, overflow: 'clip' }}>
            <FrameWorkspacePreview part="header" preview={preview} valid={valid} />
          </div>
          {!valid && preview.previouslyOpened && (
            <p role="status">Complete the fields to show your changes in the preview.</p>
          )}
          {tab === 'menu' && (
            <HeaderMenuTab model={model} navigation={props.navigation} onMenuPointerDown={onMenuPointerDown} />
          )}
          {tab === 'logo' && <HeaderLogoTab model={model} {...props} />}
          {tab === 'buttons' && <HeaderButtonsTab model={model} {...props} />}
          {tab !== 'menu' && latest && pin && latest.version > pin.version && (
            <Note>
              The template has updated header controls. Your current words and menu stay in place.{' '}
              <Button variant="secondary" disabled={pending} onClick={upgrade}>
                Preview updated header
              </Button>
            </Note>
          )}
          <HeaderExtraText model={model} siteId={siteId} />
        </div>
      </Tabs>

      <HeaderLogoPicker model={model} siteId={siteId} />
      <FrameWorkspacePreviewDialog part="header" preview={preview} />
    </div>
  )
}
