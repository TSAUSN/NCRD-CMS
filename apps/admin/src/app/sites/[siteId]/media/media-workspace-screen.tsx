import { requestLocalDraftNavigation } from '../../../../components/navigation-guard.ts'
import styles from './media-workspace.module.css'
import mediaUi from '../../../../components/media-ui.module.css'
import { Button } from '../../../../components/ui/index.ts'
import { PageHeader, siteAreaTabs } from '../../../../components/shell.tsx'
import listInspectorStyles from '../../../../components/workspace-styles/list-inspector.module.css'
import { IconImage, IconPlus } from '../../../../components/icons.tsx'
import { MediaUploadPanel } from './media-upload-panel.tsx'
import { ImageReplacement } from './image-replacement.tsx'
import { MediaBulkSelection } from './media-bulk-selection.tsx'
import { MediaNotices } from './media-notices.tsx'
import { MediaLifecycleDialogs } from './media-lifecycle-dialogs.tsx'
import { MediaLibraryBrowser } from './media-library-browser.tsx'
import type { MediaWorkspaceModel } from './use-media-workspace.ts'
import { MediaWorkspaceDetails } from './media-workspace-details.tsx'

export function MediaWorkspaceScreen({ model }: { model: MediaWorkspaceModel }) {
  const {
    checkedIds,
    setCheckedIds,
    pending,
    setPending,
    bulkDeletePending,
    setBulkDeletePending,
    deletionReason,
    setDeletionReason,
    working,
    mutationInFlight,
    refreshNeeded,
    bulkFolder,
    setBulkFolder,
    bulkTags,
    setBulkTags,
    checked,
    bulkDirty,
    discardBulk,
    leaveBulk,
    changeBulk,
    leaveDetails,
    canEdit,
    canDelete,
    toggleChecked,
    refreshLibraryOnly,
    confirmMutation,
    organizeChecked,
    deleteChecked,
  } = model.lifecycle
  const {
    droppedFile,
    uploadOpen,
    setUploadOpen,
    trackedUpload,
    setTrackedUpload,
    uploadState,
    setUploadState,
    setPollCycle,
    pollExhausted,
    setPollExhausted,
  } = model.upload
  const {
    siteId,
    native,
    metadataBusy,
    searchInput,
    view,
    setView,
    foldersExpanded,
    setFoldersExpanded,
    selectedId,
    setSelectedId,
    replacement,
    setReplacement,
    uploadLeave,
    result,
    query,
    loading,
    error,
    setError,
    selected,
    changeQuery,
    searchMedia,
    selectVisibleImages,
    clearMediaFilters,
    openImage,
    retryMediaLibrary,
  } = model
  const uploadActions = (
    <>
      <Button
        onClick={() => {
          if (!uploadOpen) {
            const open = () => {
              if (native) setSelectedId(null)
              setUploadOpen(true)
            }
            if (native) leaveDetails(open)
            else open()
            return
          }
          if (!uploadLeave.current) {
            setUploadOpen(false)
            return
          }
          const close = () => setUploadOpen(false)
          if (requestLocalDraftNavigation(() => uploadLeave.current?.() ?? { dirty: false, pending: false }, close))
            close()
        }}
        aria-expanded={uploadOpen}
      >
        <IconPlus size={16} />
        {uploadOpen ? 'Close upload' : 'Upload images'}
      </Button>
      {result.facets.statuses.failed > 0 && (
        <Button
          variant="secondary"
          aria-pressed={query.status === 'failed'}
          onClick={() => changeQuery({ status: query.status === 'failed' ? 'all' : 'failed' })}
        >
          Needs attention ({result.facets.statuses.failed})
        </Button>
      )}
    </>
  )
  const workspace = (
    <div
      className={styles.workspace + (native ? ' ' + listInspectorStyles.formStack : '')}
      data-native={native || undefined}
    >
      {native ? (
        <>
          <PageHeader
            title="Media"
            stacked
            density="compact"
            showWayfinding={false}
            sub="Photos for pages and stories. Large photos are resized for the web."
            actions={uploadActions}
            tabs={siteAreaTabs(siteId, 'media', 'media')}
          />
          <p className={mediaUi.dropHint}>
            <IconImage size={16} />
            Drop a JPEG, PNG or WebP image anywhere on this page
          </p>
        </>
      ) : (
        <div className={styles.actions}>{uploadActions}</div>
      )}

      {uploadOpen && (
        <MediaUploadPanel
          leaveRef={uploadLeave}
          siteId={siteId}
          defaultFolder={query.folder}
          droppedFile={droppedFile}
          onClose={() => setUploadOpen(false)}
          onAccepted={receipt => {
            setTrackedUpload(receipt)
            setPollExhausted(false)
            setUploadState({
              intentId: receipt.intentId,
              status: 'processing',
              originalName: receipt.originalName,
              failureCode: null,
              asset: null,
            })
          }}
        />
      )}

      <MediaNotices
        trackedUpload={trackedUpload}
        uploadState={uploadState}
        selectedId={selectedId}
        pollExhausted={pollExhausted}
        error={error}
        retrying={working || loading}
        checkStatus={() => setPollCycle(value => value + 1)}
        chooseFileAgain={() => {
          setTrackedUpload(null)
          setUploadState(null)
          setUploadOpen(true)
        }}
        retryLibrary={native || refreshNeeded ? retryMediaLibrary : undefined}
        dismissError={() => setError(null)}
      />

      {checked.length > 0 && (
        <MediaBulkSelection
          count={checked.length}
          bulkFolder={bulkFolder}
          bulkTags={bulkTags}
          working={working}
          metadataBusy={metadataBusy}
          bulkDirty={bulkDirty}
          canDeleteSelection={checked.every(canDelete)}
          clearSelection={() => leaveBulk(() => setCheckedIds(new Set()))}
          changeFolder={value => changeBulk(() => setBulkFolder(value))}
          changeTags={value => changeBulk(() => setBulkTags(value))}
          applyOrganization={() => void organizeChecked()}
          discardChanges={discardBulk}
          openDelete={() => {
            if (!mutationInFlight.current) {
              setDeletionReason('')
              setBulkDeletePending(true)
            }
          }}
        />
      )}

      <MediaLibraryBrowser
        browse={{
          native,
          loading,
          selectionBusy: loading || working || metadataBusy,
          result,
          query,
          view,
          searchInput,
          foldersExpanded,
          selectedId: selected?.id,
          checkedIds,
        }}
        actions={{
          changeSearch: searchMedia,
          changeQuery,
          changeView: setView,
          changeFoldersExpanded: setFoldersExpanded,
          selectPage: selectVisibleImages,
          clearFilters: clearMediaFilters,
          canEdit,
          toggleChecked,
          openImage,
        }}
      />

      {!native && <MediaWorkspaceDetails model={model} />}

      {replacement && (
        <ImageReplacement
          siteId={siteId}
          source={replacement}
          assets={result.assets}
          onClose={() => setReplacement(null)}
          onSaved={() => {
            setReplacement(null)
            setSelectedId(null)
            void refreshLibraryOnly()
          }}
        />
      )}

      <MediaLifecycleDialogs
        pending={pending}
        bulkDeletePending={
          bulkDeletePending
            ? { count: checked.length, referenced: checked.some(asset => asset.usedInVersions > 0) }
            : null
        }
        working={working}
        deletionReason={deletionReason}
        changeReason={value => {
          if (!mutationInFlight.current) setDeletionReason(value)
        }}
        confirmSingle={() => void confirmMutation()}
        closeSingle={() => {
          if (!mutationInFlight.current) setPending(null)
        }}
        confirmBulk={() => void deleteChecked()}
        closeBulk={() => {
          if (!mutationInFlight.current) setBulkDeletePending(false)
        }}
      />
    </div>
  )
  return workspace
}
