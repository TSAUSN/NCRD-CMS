'use client'
import { ConfirmDialog, ReasonDialog } from '../../../../components/confirm.tsx'
import type { MediaAsset } from '../../../../lib/media-library.ts'

export type MediaLifecycleAction = { kind: 'delete' | 'restore'; asset: MediaAsset }
type Props = {
  pending: MediaLifecycleAction | null
  bulkDeletePending: { count: number; referenced: boolean } | null
  working: boolean
  deletionReason: string
  changeReason: (value: string) => void
  confirmSingle: () => void
  closeSingle: () => void
  confirmBulk: () => void
  closeBulk: () => void
}

/** Explain and confirm recoverable deletion or restoration. */
export function MediaLifecycleDialogs({
  pending,
  bulkDeletePending,
  working,
  deletionReason,
  changeReason,
  confirmSingle,
  closeSingle,
  confirmBulk,
  closeBulk,
}: Props) {
  return (
    <>
      {pending?.kind === 'delete' && pending.asset.usedInVersions > 0 ? (
        <ReasonDialog
          minLength={8}
          tone="destructive"
          pending={working}
          title="Delete an image that is still referenced?"
          explanation={
            <>
              {pending.asset.usedOnItems} content items reference this image across {pending.asset.usedInVersions} saved
              versions. Record why breaking those references is acceptable.
            </>
          }
          label="Reason for breaking these references"
          value={deletionReason}
          confirmLabel="Delete image"
          onChange={changeReason}
          onConfirm={() => {
            if (deletionReason.trim().length >= 8) confirmSingle()
          }}
          onCancel={closeSingle}
        />
      ) : pending ? (
        <ConfirmDialog
          tone={pending.kind === 'restore' ? 'primary' : 'danger'}
          pending={working}
          title={pending.kind === 'delete' ? 'Delete this image?' : 'Restore this image?'}
          what={
            pending.kind === 'delete'
              ? 'It will leave the active library.'
              : `“${pending.asset.name}” will return to the active library.`
          }
          reassurance={
            pending.kind === 'delete' ? 'This is a recoverable soft delete.' : 'Restoring does not add it to content.'
          }
          confirmLabel={pending.kind === 'delete' ? 'Delete image' : 'Restore image'}
          onConfirm={() => confirmSingle()}
          onCancel={closeSingle}
        />
      ) : null}

      {bulkDeletePending && bulkDeletePending.referenced ? (
        <ReasonDialog
          minLength={8}
          tone="destructive"
          pending={working}
          title={`Delete ${bulkDeletePending.count} selected images?`}
          explanation={
            <>
              At least one selected image is referenced by saved content. The entire delete is atomic: either every
              selected image is deleted or none are.
            </>
          }
          label="Reason for breaking these references"
          value={deletionReason}
          confirmLabel="Delete selected"
          onChange={changeReason}
          onConfirm={() => {
            if (deletionReason.trim().length >= 8) confirmBulk()
          }}
          onCancel={closeBulk}
        />
      ) : bulkDeletePending ? (
        <ConfirmDialog
          pending={working}
          title={`Delete ${bulkDeletePending.count} selected images?`}
          what="None of the selected images is currently referenced."
          reassurance="The entire operation is atomic and each image remains recoverable during retention."
          confirmLabel="Delete selected"
          onConfirm={() => confirmBulk()}
          onCancel={closeBulk}
        />
      ) : null}
    </>
  )
}
