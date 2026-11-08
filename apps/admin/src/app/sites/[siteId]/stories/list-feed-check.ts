import { useEffect, useRef, useState } from 'react'
import { storySourceResult } from '../../../../lib/story-source-status.ts'
import type { StorySourceCheck } from '../../../../lib/story-source-check.ts'
import { reloadStoryList } from './actions.ts'
import type { StoryListSummary } from './list-draft.ts'

export function useStoryListFeedCheck({
  siteId,
  collectionId,
  initialStatus,
  cannotCheck,
  applySnapshot,
}: {
  siteId: string
  collectionId: string
  initialStatus: StoryListSummary['sourceStatus']
  cannotCheck: () => boolean
  applySnapshot: (latest: StoryListSummary) => void
}) {
  const [sourceStatus, setSourceStatus] = useState(initialStatus)
  const [checking, setChecking] = useState(false)
  const [checkMessage, setCheckMessage] = useState('')
  const [checkFailed, setCheckFailed] = useState(false)
  const [newStories, setNewStories] = useState(0)
  const checkBusy = useRef(false)
  const checkRequest = useRef<string | null>(null)
  useEffect(() => {
    if (!checking) return
    const timer = setTimeout(
      () => setCheckMessage('Still checking the feed. Saved stories are safe; this can take a little longer.'),
      8000,
    )
    return () => clearTimeout(timer)
  }, [checking])
  const checkSource = async () => {
    if (checkBusy.current || cannotCheck()) return
    checkBusy.current = true
    setChecking(true)
    setCheckFailed(false)
    setNewStories(0)
    setCheckMessage('Checking the public stories feed…')
    checkRequest.current ??= crypto.randomUUID()
    try {
      const response = await fetch('/api/sites/' + siteId + '/stories/check', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ collectionId: collectionId, requestId: checkRequest.current }),
      })
      const result = (await response.json()) as { check?: StorySourceCheck; error?: string }
      if (!response.ok || !result.check)
        throw new Error(result.error || 'The connection was lost. Retry this check to see its saved result.')
      const check = result.check
      checkRequest.current = null
      setSourceStatus(previous => ({
        latest: check,
        lastSuccessAt: check.status === 'ok' ? check.finished_at : previous.lastSuccessAt,
      }))
      setCheckMessage(storySourceResult(check))
      setCheckFailed(check.status === 'error')
      setNewStories(check.status === 'ok' ? (check.result.added ?? 0) : 0)
      if (check.status === 'ok') {
        const latest = await reloadStoryList(siteId)
        if (!latest.ok)
          throw new Error('The check finished, but the list could not reload. Reload Stories to see saved drafts.')
        applySnapshot(latest)
        setSourceStatus(latest.sourceStatus)
      }
    } catch (error) {
      setCheckFailed(true)
      setCheckMessage(
        error instanceof Error && !(error instanceof TypeError) && !(error instanceof SyntaxError)
          ? error.message
          : 'The connection was lost. Retry this check to see its saved result. Saved stories are safe.',
      )
    } finally {
      checkBusy.current = false
      setChecking(false)
    }
  }

  return {
    sourceStatus,
    setSourceStatus,
    checking,
    checkMessage,
    checkFailed,
    newStories,
    checkBusy,
    retryCheck: checkRequest.current !== null,
    checkSource,
  }
}
