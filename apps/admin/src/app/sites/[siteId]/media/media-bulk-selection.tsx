'use client'
import { Button } from '../../../../components/ui/index.ts'
import { IconTrash } from '../../../../components/icons.tsx'

type Props = {
  count: number
  bulkFolder: string
  bulkTags: string
  working: boolean
  metadataBusy: boolean
  bulkDirty: boolean
  canDeleteSelection: boolean
  clearSelection: () => void
  changeFolder: (value: string) => void
  changeTags: (value: string) => void
  applyOrganization: () => void
  discardChanges: () => void
  openDelete: () => void
}

/** Edit shared folder and tag values for the selected images. */
export function MediaBulkSelection({
  count,
  bulkFolder,
  bulkTags,
  working,
  metadataBusy,
  bulkDirty,
  canDeleteSelection,
  clearSelection,
  changeFolder,
  changeTags,
  applyOrganization,
  discardChanges,
  openDelete,
}: Props) {
  return (
    <section className="media-bulk" aria-label="Bulk media actions">
      <div>
        <strong>{count} selected</strong>
        <Button variant="tertiary" type="button" className="link" onClick={clearSelection}>
          Clear selection
        </Button>
      </div>
      <p>Folder and tags update selected images in Media. Page and story content stays unchanged.</p>
      <label>
        <span>Move to folder</span>
        <input
          disabled={working || metadataBusy}
          value={bulkFolder}
          placeholder="Campaigns/Fall Appeal"
          onChange={event => changeFolder(event.target.value)}
        />
      </label>
      <label>
        <span>Add tags</span>
        <input
          disabled={working || metadataBusy}
          value={bulkTags}
          placeholder="appeal, approved"
          onChange={event => changeTags(event.target.value)}
        />
      </label>
      <Button variant="primary" type="button" disabled={working} onClick={applyOrganization}>
        Apply organization
      </Button>
      {bulkDirty && (
        <Button variant="secondary" type="button" className="secondary" disabled={working} onClick={discardChanges}>
          Discard organization changes
        </Button>
      )}
      {bulkDirty && canDeleteSelection && <p>Apply or discard organization changes before deleting selected images.</p>}
      {canDeleteSelection && (
        <Button
          variant="destructive"
          type="button"
          className="danger"
          disabled={working || bulkDirty}
          onClick={openDelete}
        >
          <IconTrash size={15} /> Delete selected
        </Button>
      )}
    </section>
  )
}
