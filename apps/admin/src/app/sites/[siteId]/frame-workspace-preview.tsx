import { useEffect, useState } from 'react'
import { SiteFramePreview } from '../../../components/site-frame-preview.tsx'
import { SiteHeaderPreview } from '../../../components/site-header-preview.tsx'
import { Button, Dialog } from '../../../components/ui/index.ts'
import { useSiteLookCanvas } from './design/use-site-look-canvas.ts'

type CanvasInput = Parameters<typeof useSiteLookCanvas>[0]
type PreviewInput = Pick<CanvasInput, 'siteId' | 'origin'> & {
  page?: { id: string; versionId: string | null }
  look: NonNullable<CanvasInput['look']>
  valid: boolean
}

export function useFrameWorkspacePreview({ siteId, origin, page, look, valid }: PreviewInput) {
  const [expanded, setExpanded] = useState(false)
  const [retry, setRetry] = useState(0)
  const [previouslyOpened, setPreviouslyOpened] = useState(false)
  const canvas = useSiteLookCanvas({
    purpose: 'frame',
    origin,
    siteId,
    pageId: page?.id ?? '',
    versionId: page?.versionId ?? '',
    look: valid ? look : null,
    retry,
  })

  useEffect(() => {
    if (canvas.ticket) setPreviouslyOpened(true)
  }, [canvas.ticket])

  return {
    ...canvas,
    pageAvailable: Boolean(page),
    previewAvailable: Boolean(origin),
    previouslyOpened,
    expanded,
    open: () => setExpanded(true),
    close: () => setExpanded(false),
    retry: () => setRetry(value => value + 1),
  }
}

type FramePreview = ReturnType<typeof useFrameWorkspacePreview>
type FramePreviewProps = { part: 'header' | 'footer'; preview: FramePreview }

export function FrameWorkspacePreview({ part, preview, valid }: FramePreviewProps & { valid: boolean }) {
  const { ticket, loading, error, pageAvailable, previewAvailable, previouslyOpened, retry } = preview
  return (
    <SiteFramePreview
      part={part}
      ticket={ticket}
      valid={valid}
      loading={loading}
      error={error}
      pageAvailable={pageAvailable}
      previewAvailable={previewAvailable}
      previouslyOpened={previouslyOpened}
      retry={retry}
    />
  )
}

export function FrameWorkspacePreviewDialog({ part, preview }: FramePreviewProps) {
  if (!preview.expanded || !preview.ticket) return null
  const title = part === 'header' ? 'Preview header & menu' : 'Preview footer'
  return (
    <Dialog size="large" title={title} onClose={preview.close} footer={<Button onClick={preview.close}>Done</Button>}>
      <SiteHeaderPreview part={part} channel={preview.ticket.channel} href={preview.ticket.href} expanded />
    </Dialog>
  )
}
