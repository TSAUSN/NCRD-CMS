import { Button, EmptyState } from './ui/index.ts'
import { SiteHeaderPreview, type FramePreviewRecovery, type FramePreviewTicket } from './site-header-preview.tsx'

/** Header and Footer use the same status and retry choices for their own canvas. */
export function SiteFramePreview({
  part,
  ticket,
  error,
  loading,
  valid,
  pageAvailable,
  previewAvailable,
  previouslyOpened,
  retry,
  recovery,
}: {
  part: 'header' | 'footer'
  ticket: FramePreviewTicket | null
  error: string
  loading: boolean
  valid: boolean
  pageAvailable: boolean
  previewAvailable: boolean
  previouslyOpened: boolean
  retry: () => void
  recovery?: FramePreviewRecovery
}) {
  if (pageAvailable && !previewAvailable)
    return (
      <EmptyState title="No preview address">
        Save changes here. This site needs a preview address before you can open a visitor preview.
      </EmptyState>
    )
  if ((!error || previouslyOpened) && pageAvailable && (valid || previouslyOpened)) {
    return (
      <div aria-busy={valid && loading}>
        <SiteHeaderPreview
          href={ticket?.href ?? null}
          channel={ticket?.channel}
          part={part}
          pending={valid && loading}
          retry={retry}
          recovery={recovery}
        />
        {error && (
          <div role="status">
            <p>{error}</p>
            <Button variant="secondary" onClick={retry}>
              Try preview again
            </Button>
          </div>
        )}
      </div>
    )
  }
  const name = part === 'header' ? 'Header' : 'Footer'
  return (
    <EmptyState
      title={
        !pageAvailable
          ? `Add a page to preview the ${part}`
          : !valid
            ? 'Complete the fields to preview your changes'
            : error
              ? `${name} preview unavailable`
              : `Opening the ${part} preview…`
      }
    >
      {!pageAvailable
        ? `The ${part === 'header' ? 'header and menu' : 'footer'} can still be saved before the first page is ready.`
        : !valid
          ? 'Check the required fields below.'
          : error || null}
      {pageAvailable && valid && error && (
        <Button variant="secondary" onClick={retry}>
          Try preview again
        </Button>
      )}
    </EmptyState>
  )
}
