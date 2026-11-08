'use client'

import { useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { retryThumbnail } from './thumbnail-actions.ts'

export function ThumbnailRetry({
  failedId,
  retryId,
  retryStatus,
}: {
  failedId: string
  retryId: string | null
  retryStatus: string | null
}) {
  const router = useRouter()
  const inFlight = useRef(false)
  const [pending, startTransition] = useTransition()
  const [notice, setNotice] = useState<{ ok: boolean; message: string } | null>(null)
  function retry() {
    if (inFlight.current) return
    inFlight.current = true
    startTransition(async () => {
      try {
        const result = await retryThumbnail(failedId)
        setNotice(result)
        if (result.ok) {
          window.dispatchEvent(new Event('cms:inbox-changed'))
          router.refresh()
        }
      } catch {
        setNotice({
          ok: false,
          message:
            'The retry could not be confirmed. Try again; the same failed delivery will not create duplicate work.',
        })
      } finally {
        inFlight.current = false
      }
    })
  }
  return (
    <div>
      {retryId ? (
        <p role="status">
          Section preview retry {retryId} is {retryStatus === 'running' ? 'running' : 'queued'}.{' '}
          <button
            className="ghost"
            onClick={() => {
              window.dispatchEvent(new Event('cms:inbox-changed'))
              router.refresh()
            }}
          >
            Refresh status
          </button>
        </p>
      ) : (
        <>
          <p>
            After the section or worker issue is fixed, generate this preview again. This does not publish page content.
          </p>
          <button type="button" disabled={pending || notice?.ok} onClick={retry}>
            {pending ? 'Queuing preview…' : 'Retry section preview'}
          </button>
        </>
      )}
      {notice && <p role={notice.ok ? 'status' : 'alert'}>{notice.message}</p>}
    </div>
  )
}
