'use client'
import { useEffect, useRef, useState } from 'react'
import { Button, ButtonLink, Note } from '../../../components/ui/index.ts'
import { IconChevronLeft } from '../../../components/icons.tsx'
import { loadPageFrameNote } from './site-look-actions.ts'
import shared from '../../../components/workspace.module.css'
import workspaceFormsStyles from '../../../components/workspace-styles/workspace-forms.module.css'
import recordTableStyles from '../../../components/workspace-styles/record-table.module.css'
export function SiteFrameNote({
  pageId,
  part,
  onDone,
}: {
  pageId: string
  part: 'header' | 'footer'
  onDone: () => void
}) {
  const back = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    back.current?.focus({ preventScroll: true })
  }, [])
  const [loaded, setLoaded] = useState<Extract<Awaited<ReturnType<typeof loadPageFrameNote>>, { ok: true }> | null>(
      null,
    ),
    [error, setError] = useState<string | null>(null),
    [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let active = true
    setLoaded(null)
    setError(null)
    void loadPageFrameNote(pageId)
      .then(result => {
        if (!active) return
        if (result.ok) setLoaded(result)
        else setError(result.message)
      })
      .catch(() => {
        if (active) setError('This shared area could not be loaded. Try again, or return to your page.')
      })
    return () => {
      active = false
    }
  }, [pageId, attempt])
  const title = part === 'header' ? 'Header' : 'Footer',
    count = loaded?.[part]
  return (
    <aside
      className="pane"
      aria-label="Site-wide settings"
      onKeyDown={event => {
        if (event.key === 'Escape') {
          event.preventDefault()
          onDone()
        }
      }}
    >
      <div className={shared.denseStack + ' ' + workspaceFormsStyles.compactForm}>
        <div className={workspaceFormsStyles.panelActions}>
          <Button ref={back} variant="tertiary" onClick={onDone}>
            <IconChevronLeft size={16} />
            Back
          </Button>
          <Button onClick={onDone}>Done</Button>
        </div>
        <h2>{title}</h2>
        {!loaded && !error && <p role="status">Loading shared area…</p>}
        {error && (
          <>
            <p role="alert">{error}</p>
            <Button variant="secondary" onClick={() => setAttempt(value => value + 1)}>
              Try again
            </Button>
          </>
        )}
        {loaded && (
          <>
            <Note tone="shared">
              <strong>
                {title}: on all {count} {count === 1 ? 'page' : 'pages'}.
              </strong>{' '}
              It isn't part of this page, so it's changed in one place for the whole site.
            </Note>
            {loaded.canManage ? (
              <>
                <ButtonLink
                  variant="secondary"
                  href={'/sites/' + loaded.siteId + '/' + part}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {part === 'header' ? 'Open Header & menu' : 'Open Footer'}
                </ButtonLink>
                <p className={recordTableStyles.meta}>
                  {part === 'header'
                    ? 'Menu, logo and the Donate button are all there.'
                    : 'Footer text, links and logo are all there.'}{' '}
                  Opens in a new tab. Return here with your page edits still in place.
                </p>
              </>
            ) : (
              <p className={recordTableStyles.meta}>A Site admin can change this shared area.</p>
            )}
          </>
        )}
      </div>
    </aside>
  )
}
