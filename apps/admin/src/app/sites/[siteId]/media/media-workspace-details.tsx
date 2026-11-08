import styles from './media-workspace.module.css'
import mediaUi from '../../../../components/media-ui.module.css'
import { Drawer, Button, DetailPanel } from '../../../../components/ui/index.ts'
import shared from '../../../../components/workspace.module.css'
import { MediaDetail } from './media-detail.tsx'
import type { MediaWorkspaceModel } from './use-media-workspace.ts'

export function MediaWorkspaceDetails({ model }: { model: MediaWorkspaceModel }) {
  const { setPending, setDeletionReason, working, mutationInFlight, leaveDetails, canEdit, canDelete } = model.lifecycle
  const {
    native,
    metadataBusy,
    setMetadataBusy,
    metadataChanged,
    setMetadataChanged,
    detailTab,
    setDetailTab,
    metadataLock,
    metadataDirty,
    setSelectedId,
    replacement,
    setReplacement,
    refresh,
    selected,
  } = model
  const DetailsPanel = native ? DetailPanel : Drawer
  return selected && !replacement ? (
    <DetailsPanel
      density="compact"
      size="narrow"
      title="Image details"
      onClose={() => {
        if (metadataLock.current || mutationInFlight.current) return
        leaveDetails(() => {
          setSelectedId(null)
          metadataDirty.current = false
          setMetadataChanged(false)
        })
      }}
      pending={working || metadataBusy}
      footer={
        detailTab === 'details' && canEdit(selected) ? (
          <Button
            type="submit"
            form={'media-metadata-' + selected.id}
            disabled={!metadataChanged || working || metadataBusy}
          >
            {metadataBusy ? 'Saving…' : 'Save image details'}
          </Button>
        ) : undefined
      }
    >
      <div className={styles.details + ' ' + mediaUi.details + ' ' + shared.singleColumn}>
        <MediaDetail
          key={selected.id}
          onReplace={() => {
            if (metadataLock.current || mutationInFlight.current) return
            leaveDetails(() => {
              metadataDirty.current = false
              setMetadataChanged(false)
              setReplacement(selected)
            })
          }}
          externalSave
          onTabChange={setDetailTab}
          onBusyChange={value => {
            metadataLock.current = value
            setMetadataBusy(value)
          }}
          onDirtyChange={value => {
            metadataDirty.current = value
            setMetadataChanged(value)
          }}
          asset={selected}
          canEdit={canEdit(selected)}
          canDelete={canDelete(selected)}
          working={working || metadataBusy}
          onSaved={async asset => {
            setSelectedId(asset.id)
            await refresh()
          }}
          onDelete={() =>
            leaveDetails(() => {
              setDeletionReason('')
              setPending({ kind: 'delete', asset: selected })
            })
          }
          onRestore={() => leaveDetails(() => setPending({ kind: 'restore', asset: selected }))}
        />
      </div>
    </DetailsPanel>
  ) : null
}
