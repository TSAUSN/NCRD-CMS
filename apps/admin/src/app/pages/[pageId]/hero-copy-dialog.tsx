'use client'
import { useEffect, useRef, useState } from 'react'
import { Button, ButtonLink, Dialog, EmptyState, Field } from '../../../components/ui/index.ts'
import { useNavigationGuard } from '../../../components/navigation-guard.ts'
import { copyHeroSlide, loadHeroCopyTargets } from './hero-copy-actions.ts'
import shared from '../../../components/workspace.module.css'
import recordTableStyles from '../../../components/workspace-styles/record-table.module.css'
export function HeroCopyDialog({
  sourcePageId,
  definitionId,
  version,
  slotId,
  item,
  values,
  onClose,
}: {
  sourcePageId: string
  definitionId: string
  version: number
  slotId: string
  item: string
  values: Record<string, unknown>
  onClose: () => void
}) {
  const [pages, setPages] = useState<{ id: string; title: string; revision: string }[] | null>(null)
  const [selected, setSelected] = useState('')
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)
  const [pending, setPending] = useState(false)
  const [result, setResult] = useState<Extract<Awaited<ReturnType<typeof copyHeroSlide>>, { ok: true }> | null>(null)
  const busy = useRef(false)
  useEffect(() => {
    let active = true
    setPages(null)
    setError('')
    void loadHeroCopyTargets(sourcePageId)
      .then(result => {
        if (!active) return
        if (result.ok) setPages(result.pages)
        else setError(result.message)
      })
      .catch(() => {
        if (active) setError('Pages could not be loaded. Try again, or return to the slide.')
      })
    return () => {
      active = false
    }
  }, [sourcePageId, retry])
  useNavigationGuard(() => ({ dirty: false, pending: pending || busy.current }))
  async function copy() {
    const page = pages?.find(page => page.id === selected)
    if (!page || busy.current) return
    busy.current = true
    setPending(true)
    setError('')
    try {
      const result = await copyHeroSlide({
        sourcePageId,
        definitionId,
        version,
        slotId,
        key: item,
        values,
        targetPageId: page.id,
        targetRevision: page.revision,
      })
      if (result.ok) setResult(result)
      else setError(result.message)
    } catch {
      setError('The copy could not be confirmed. Check the destination page before trying again.')
    } finally {
      busy.current = false
      setPending(false)
    }
  }
  return (
    <Dialog
      title="Copy slide to another page"
      pending={pending}
      onClose={() => {
        if (!busy.current) onClose()
      }}
      footer={
        result ? (
          <Button onClick={onClose}>Done</Button>
        ) : (
          <>
            <Button variant="secondary" disabled={pending} onClick={onClose}>
              Cancel
            </Button>
            <Button loading={pending} disabled={!selected || !pages} onClick={() => void copy()}>
              Copy slide
            </Button>
          </>
        )
      }
    >
      <div className={shared.denseStack}>
        {result ? (
          <>
            <p role="status">{result.message}</p>
            <ButtonLink variant="secondary" href={'/pages/' + result.pageId} target="_blank" rel="noopener noreferrer">
              Open {result.title}
            </ButtonLink>
            <p className={recordTableStyles.meta}>Opens in a new tab so your current page edits stay here.</p>
          </>
        ) : (
          <>
            <p>The copy goes last on the other page’s Hero slider, switched off. Nothing is published.</p>
            {pages === null && !error ? (
              <p role="status">Loading pages…</p>
            ) : pages?.length ? (
              <Field id="hero-copy-page" label="Page">
                <select value={selected} disabled={pending} onChange={event => setSelected(event.target.value)}>
                  <option value="">Choose a page…</option>
                  {pages.map(page => (
                    <option key={page.id} value={page.id}>
                      {page.title}
                    </option>
                  ))}
                </select>
                <p className={recordTableStyles.meta}>
                  If needed, the page gets the shared Hero slider and its approved controls as a draft. Existing slide
                  words and photos are kept.
                </p>
              </Field>
            ) : !error ? (
              <EmptyState title="No other pages yet">
                Add another page on this site, then return to copy the slide.
              </EmptyState>
            ) : null}
          </>
        )}
        {error && (
          <>
            <p role="alert">{error}</p>
            <Button
              variant="secondary"
              disabled={pending}
              onClick={() => {
                setSelected('')
                setRetry(value => value + 1)
              }}
            >
              Reload page choices
            </Button>
          </>
        )}
      </div>
    </Dialog>
  )
}
