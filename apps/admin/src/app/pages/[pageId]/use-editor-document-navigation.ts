import { useEffect, useState } from 'react'
import type { SaveQueue } from '@cms/domain'
import type { SaveSnapshot } from './use-draft-save.ts'

/** Keep the draft warning active until any acknowledged page action has settled. */
export function useEditorDocumentNavigation({
  dirty,
  saving,
  queue,
  transitionPending,
  upgrade,
  replacement,
  recovery,
}: {
  dirty: boolean
  saving: boolean
  queue: { current: SaveQueue<SaveSnapshot> }
  transitionPending: boolean
  upgrade: { busy?: boolean } | null
  replacement: { busy?: boolean } | null
  recovery: { pending: () => boolean; busy: boolean }
}) {
  const [destination, openAfterPageAction] = useState<string | null>(null)

  useEffect(() => {
    function hasPendingWork() {
      return (
        dirty ||
        saving ||
        queue.current.busy() ||
        transitionPending ||
        upgrade?.busy ||
        replacement?.busy ||
        recovery.pending()
      )
    }

    function onLeave(event: BeforeUnloadEvent) {
      if (hasPendingWork()) event.preventDefault()
    }

    window.addEventListener('beforeunload', onLeave)
    // Archive and Duplicate can acknowledge inside an async React transition.
    // Open the next document only after the native warning sees settled work.
    if (destination && !hasPendingWork()) {
      openAfterPageAction(null)
      window.location.assign(destination)
    }
    return () => window.removeEventListener('beforeunload', onLeave)
  }, [destination, dirty, saving, queue, transitionPending, upgrade?.busy, replacement?.busy, recovery])

  return openAfterPageAction
}
