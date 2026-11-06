'use client'
import { useState } from 'react'
import type { WorldChoice, SplitChoice } from '../../../../lib/story-widget-choice.ts'
import { Button, Dialog, Field, Note } from '../../../../components/ui/index.ts'
import { addWorld, addSplit, loadWorldPages } from './actions.ts'
import shared from '../../../../components/workspace.module.css'
type Page = { id: string; title: string; slug: string; revision: string }
export function AddStoryWidget({
  siteId,
  kind,
  choice,
  onSaved,
}: {
  siteId: string
  kind: 'world' | 'split'
  choice: WorldChoice | SplitChoice
  onSaved: (page: { pageId: string; title: string }) => void
}) {
  const label = kind === 'world' ? 'World View' : 'Split View',
    [open, setOpen] = useState(false),
    [pages, setPages] = useState<Page[]>([]),
    [loading, setLoading] = useState(false),
    [pending, setPending] = useState(false),
    [error, setError] = useState(''),
    [pageId, setPageId] = useState(''),
    [search, setSearch] = useState('')
  async function load() {
    setLoading(true)
    setError('')
    try {
      const result = await loadWorldPages(siteId)
      if (result.ok) {
        setPages(result.pages)
        setPageId('')
      } else setError(result.message)
    } catch {
      setError('Pages could not be loaded. Try again.')
    } finally {
      setLoading(false)
    }
  }
  async function add() {
    const page = pages.find(p => p.id === pageId)
    if (!page) return
    setPending(true)
    setError('')
    try {
      const result = await (kind === 'world' ? addWorld : addSplit)(siteId, page.id, page.revision, choice)
      if (result.ok) {
        onSaved({ pageId: page.id, title: page.title })
        setOpen(false)
      } else setError(result.message)
    } catch {
      setError(
        'The connection was interrupted. Try Add as draft again with the same page choice. A saved section will not be added twice.',
      )
    } finally {
      setPending(false)
    }
  }
  return (
    <>
      <div className={shared.actions}>
        <Button
          variant="secondary"
          onClick={() => {
            setOpen(true)
            setSearch('')
            void load()
          }}
        >
          Add to a page…
        </Button>
      </div>
      {open && (
        <Dialog
          title={'Add ' + label + ' to a page'}
          density="compact"
          onClose={() => {
            if (!pending) setOpen(false)
          }}
          pending={pending}
          footer={
            <>
              <Button variant="secondary" disabled={pending} onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button disabled={loading || pending || !pageId} onClick={() => void add()}>
                {pending ? 'Adding section…' : 'Add as draft'}
              </Button>
            </>
          }
        >
          <div className={shared.compactFields}>
            <p>The section will be added at the end of the page as a private draft. Existing content stays in place.</p>
            {error && (
              <Note tone="warning">
                {error}{' '}
                <Button variant="secondary" onClick={() => void load()} disabled={pending || loading}>
                  Reload page choices
                </Button>
              </Note>
            )}
            {loading ? (
              <p role="status">Loading pages…</p>
            ) : (
              <>
                <Field id="story-widget-page-search" label="Search pages">
                  <input
                    id="story-widget-page-search"
                    value={search}
                    onChange={event => setSearch(event.target.value)}
                  />
                </Field>
                <Field id="story-widget-page" label="Page">
                  <select id="story-widget-page" value={pageId} onChange={event => setPageId(event.target.value)}>
                    <option value="">Choose a page</option>
                    {pages
                      .filter(page => (page.title + ' ' + page.slug).toLowerCase().includes(search.toLowerCase()))
                      .map(page => (
                        <option key={page.id} value={page.id}>
                          {page.title} — /{page.slug}
                        </option>
                      ))}
                  </select>
                </Field>
                {!pages.length && <p>No eligible pages are available. Chapter pages do not use Stories.</p>}
              </>
            )}
          </div>
        </Dialog>
      )}
    </>
  )
}
