'use client'

import { TextLink } from '../../../../components/ui/text-link.tsx'
import { Card } from '../../../../components/ui/card.tsx'
import { Button } from '../../../../components/ui/button.tsx'
import { useEffect, useRef, useState } from 'react'

type ExportError = { message: string; recovery?: 'media' }
export function ContentExport({ siteId, chaptersEnabled = false }: { siteId: string; chaptersEnabled?: boolean }) {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<ExportError | null>(null)
  const [downloaded, setDownloaded] = useState(false)
  const inFlight = useRef(false)
  const controller = useRef<AbortController | null>(null)
  const downloadUrl = useRef<string | null>(null)
  useEffect(
    () => () => {
      controller.current?.abort()
      if (downloadUrl.current) URL.revokeObjectURL(downloadUrl.current)
    },
    [],
  )

  async function download() {
    if (inFlight.current) return
    inFlight.current = true
    setPending(true)
    setError(null)
    setDownloaded(false)
    const current = new AbortController()
    controller.current = current
    try {
      const response = await fetch(`/api/sites/${siteId}/export`, { cache: 'no-store', signal: current.signal })
      if (!response.ok) {
        const result = (await response.json().catch(() => null)) as { message?: unknown; recovery?: unknown } | null
        setError({
          message:
            typeof result?.message === 'string' ? result.message : 'The archive could not be downloaded. Try again.',
          ...(result?.recovery === 'media' ? { recovery: 'media' as const } : {}),
        })
        return
      }
      const blob = await response.blob()
      if (downloadUrl.current) URL.revokeObjectURL(downloadUrl.current)
      downloadUrl.current = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = downloadUrl.current
      link.download = `cms-site-${siteId}.json`
      document.body.appendChild(link)
      link.click()
      link.remove()
      setDownloaded(true)
    } catch (cause) {
      if (!current.signal.aborted)
        setError({ message: 'The archive could not be downloaded. Check your connection and try again.' })
    } finally {
      if (!current.signal.aborted) setPending(false)
      inFlight.current = false
    }
  }

  return (
    <Card
      density="settings"
      title="Backup"
      actions={
        <Button type="button" disabled={pending} aria-busy={pending} onClick={() => void download()}>
          {pending ? 'Preparing content archive…' : 'Download content archive'}
        </Button>
      }
    >
      <p>Download a portable copy of the site’s pages, saved versions, lists, site look, menu and pictures.</p>
      <p className="hint">
        The archive includes private drafts. Keep it with people who should have this content. Import creates a separate
        draft site.
      </p>
      {chaptersEnabled && (
        <p className="hint">
          Chapter setup, private contacts and form messages stay in the database. This file contains website content; an
          operator database backup is needed to preserve the chapter setup and private records.
        </p>
      )}

      {pending && <p role="status">Preparing the archive and checking its images. You can stay on this page.</p>}
      {error && (
        <div role="alert">
          <p className="error">{error.message}</p>
          {error.recovery === 'media' && (
            <p className="hint">
              Check the affected image in <TextLink href={`/sites/${siteId}/media`}>Media</TextLink>, or ask a site
              administrator to recover an unavailable file, then try again.
            </p>
          )}
        </div>
      )}
      {downloaded && <p role="status">Your content archive is ready. Check your browser’s downloads.</p>}
    </Card>
  )
}
