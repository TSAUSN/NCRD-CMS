import { useEffect, useState } from 'react'
import {
  mediaUploadStatus,
  type MediaLibraryResult,
  type MediaUploadIntentStatus,
  type MediaUploadReceipt,
} from '../../../../lib/media-library.ts'
import type { NavigationGuardState } from '../../../../lib/navigation-guard.ts'
import type { Dispatch, RefObject, SetStateAction } from 'react'

type MediaUploadStateInputs = {
  native: boolean
  initialOpen: boolean
  uploadLeave: RefObject<(() => NavigationGuardState) | null>
  setSelectedId: Dispatch<SetStateAction<string | null>>
  refresh: () => Promise<MediaLibraryResult>
  mutationInFlight: RefObject<boolean>
  leaveDetails: (proceed: () => void) => void
}
export function useMediaWorkspaceUpload({
  native,
  initialOpen,
  uploadLeave,
  setSelectedId,
  refresh,
  mutationInFlight,
  leaveDetails,
}: MediaUploadStateInputs) {
  const [droppedFile, setDroppedFile] = useState<File | null>(null)
  const [uploadOpen, setUploadOpen] = useState(initialOpen)
  const [trackedUpload, setTrackedUpload] = useState<MediaUploadReceipt | null>(null)
  const [uploadState, setUploadState] = useState<MediaUploadIntentStatus | null>(null)
  const [pollCycle, setPollCycle] = useState(0)
  const [pollExhausted, setPollExhausted] = useState(false)
  useEffect(() => {
    if (!trackedUpload) return
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    let attempts = 0
    setPollExhausted(false)
    async function poll() {
      attempts += 1
      try {
        const next = await mediaUploadStatus(trackedUpload!.intentId)
        if (cancelled) return
        setUploadState(next)
        if (next.status === 'ready' && next.asset) {
          const uploadDraft = uploadLeave.current?.()
          if (!uploadDraft?.dirty && !uploadDraft?.pending) {
            setSelectedId(next.asset.id)
            setUploadOpen(false)
          }
          await refresh()
          return
        }
        if (next.status === 'failed') {
          const uploadDraft = uploadLeave.current?.()
          if (!uploadDraft?.dirty && !uploadDraft?.pending) setUploadOpen(false)
          return
        }
      } catch {
        /* the worker's durable state remains authoritative */
      }
      if (!cancelled && attempts < 48) timer = setTimeout(poll, 1_250)
      else if (!cancelled) setPollExhausted(true)
    }
    void poll()
    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
    }
  }, [trackedUpload, pollCycle])

  useEffect(() => {
    const drag = (event: DragEvent) => {
      if (event.dataTransfer?.types.includes('Files')) event.preventDefault()
    }
    const drop = (event: DragEvent) => {
      if (!event.dataTransfer?.files.length || (event.target as Element)?.closest?.('.media-upload')) return
      event.preventDefault()
      if (mutationInFlight.current) return
      const file = event.dataTransfer.files[0]!
      const open = () => {
        if (native) setSelectedId(null)
        setDroppedFile(file)
        setUploadOpen(true)
      }
      if (native) leaveDetails(open)
      else open()
    }
    window.addEventListener('dragover', drag)
    window.addEventListener('drop', drop)
    return () => {
      window.removeEventListener('dragover', drag)
      window.removeEventListener('drop', drop)
    }
  }, [])
  return {
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
  }
}
