'use client'
import { GuardedLink as Link } from '../../../../../../components/guarded-link.tsx'
import { useEffect, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button, Dialog, EmptyState, SegmentedControl } from '../../../../../../components/ui/index.ts'
import { PageComparison } from '../../../../../../components/page-comparison.tsx'
import type { SectionUpdatePage } from '../../../../../../lib/section-page-updates.ts'
import { previewPageUpdate, updateSectionPages } from './actions.ts'
import styles from './updates.module.css'
type Preview = Awaited<ReturnType<typeof previewPageUpdate>>
export function SectionPageUpdates({
  siteId,
  definitionId,
  version,
  pages,
}: {
  siteId: string
  definitionId: string
  version: number
  pages: SectionUpdatePage[]
}) {
  const notice = useRef<HTMLParagraphElement>(null)
  const router = useRouter(),
    [selected, setSelected] = useState<string[]>([]),
    [message, setMessage] = useState(''),
    [failed, setFailed] = useState(false),
    [staleReview, setStaleReview] = useState(false),
    [pending, startTransition] = useTransition(),
    [confirm, setConfirm] = useState(false)
  const [refreshPending, startRefresh] = useTransition()
  const busy = pending || refreshPending
  const [review, setReview] = useState<SectionUpdatePage | null>(null),
    [preview, setPreview] = useState<Preview | null>(null),
    [attempt, setAttempt] = useState(0),
    [device, setDevice] = useState('1280')
  useEffect(() => {
    setSelected([])
  }, [pages])
  useEffect(() => {
    if (message) {
      notice.current?.focus()
      notice.current?.scrollIntoView({ block: 'nearest' })
    }
  }, [message])
  useEffect(() => {
    if (!review) return
    let active = true
    setPreview(null)
    void previewPageUpdate(siteId, definitionId, version, review)
      .then(result => {
        if (active) {
          setPreview(result)
          if (!result.ok && result.stale) setStaleReview(true)
        }
      })
      .catch(() => {
        if (active) setPreview({ ok: false, stale: false, message: 'The preview could not be loaded. Try again.' })
      })
    return () => {
      active = false
    }
  }, [siteId, definitionId, version, review, attempt])
  function refresh() {
    setSelected([])
    setStaleReview(false)
    setMessage('')
    setFailed(false)
    startRefresh(() => router.refresh())
  }
  const chosen = pages.filter(page => selected.includes(page.pageId)),
    base = `/sites/${siteId}/sections/${definitionId}`
  function apply() {
    startTransition(async () => {
      try {
        const result = await updateSectionPages(siteId, definitionId, version, chosen)
        setFailed(!result.ok)
        setMessage(result.message)
        setConfirm(false)
        if (result.ok) {
          setSelected([])
          router.refresh()
        }
      } catch {
        setFailed(true)
        setMessage('The update could not be confirmed. Refresh the page list before trying again.')
        setConfirm(false)
      }
    })
  }
  return (
    <>
      {message && (
        <p
          ref={notice}
          tabIndex={-1}
          className={`notice ${failed ? 'notice-error' : 'notice-ok'}`}
          role={failed ? 'alert' : 'status'}
        >
          {message}
        </p>
      )}
      {pages.length === 0 ? (
        <EmptyState
          title="All current drafts are up to date"
          action={
            <Link className="btn secondary" href={base}>
              Back to section
            </Link>
          }
        >
          <p>
            No older placements need version {version}. Live pages keep their published version until their drafts are
            published.
          </p>
        </EmptyState>
      ) : (
        <>
          <div className={styles.bar}>
            <p>
              {pages.length} {pages.length === 1 ? 'page' : 'pages'} can use version {version} · {selected.length}{' '}
              selected
            </p>
            <Button variant="secondary" disabled={busy} onClick={refresh}>
              {refreshPending ? 'Refreshing…' : 'Refresh page list'}
            </Button>
            <Button
              variant="tertiary"
              disabled={busy}
              onClick={() => setSelected(selected.length === pages.length ? [] : pages.map(page => page.pageId))}
            >
              {selected.length === pages.length ? 'Clear selection' : 'Select all'}
            </Button>
          </div>
          <p>
            Only pages on sites you administer appear here. All older placements of this section on each chosen page
            will be updated together. Compatible content stays; removed fields remain in history. New fields need
            checking before publication.
          </p>
          <ul className={styles.list} aria-label="Pages with an older section version">
            {pages.map(page => (
              <li key={page.pageId}>
                <label>
                  <input
                    type="checkbox"
                    disabled={busy}
                    checked={selected.includes(page.pageId)}
                    onChange={event =>
                      setSelected(current =>
                        event.target.checked ? [...current, page.pageId] : current.filter(id => id !== page.pageId),
                      )
                    }
                  />
                  <span>
                    <strong>{page.title}</strong>
                    <small>
                      {page.siteName} · {page.placements} {page.placements === 1 ? 'placement' : 'placements'}
                    </small>
                  </span>
                </label>
                <Button
                  variant="secondary"
                  disabled={busy}
                  onClick={() => {
                    setReview(page)
                    setDevice('1280')
                  }}
                >
                  View changes<span className="sr-only"> to {page.title}</span>
                </Button>
                <Link href={`/pages/${page.pageId}`}>
                  Open page<span className="sr-only"> {page.title}</span>
                </Link>
              </li>
            ))}
          </ul>
          <div className={styles.bar}>
            <Link className="btn secondary" href={base}>
              Leave as is
            </Link>
            <Button
              disabled={busy || failed || staleReview || !chosen.length || chosen.length > 100}
              onClick={() => setConfirm(true)}
            >
              {chosen.length === pages.length ? 'Update all' : 'Update selected'}
            </Button>
          </div>
          {chosen.length > 100 && (
            <p role="status">Choose up to 100 pages per update. Repeat for the remaining pages.</p>
          )}
        </>
      )}
      {confirm && (
        <Dialog
          title="Update saved page drafts?"
          pending={pending}
          onClose={() => setConfirm(false)}
          footer={
            <>
              <Button variant="secondary" disabled={busy} onClick={() => setConfirm(false)}>
                Cancel
              </Button>
              <Button disabled={busy} onClick={apply}>
                {pending ? 'Updating…' : `Update ${chosen.length} ${chosen.length === 1 ? 'page' : 'pages'}`}
              </Button>
            </>
          }
        >
          <p>
            Apply version {version} to {chosen.length} saved {chosen.length === 1 ? 'draft' : 'drafts'}. Live pages stay
            unchanged until you publish them.
          </p>
          <ul>
            {chosen.map(page => (
              <li key={page.pageId}>
                {page.title} · {page.siteName}
              </li>
            ))}
          </ul>
          <p>
            Each draft keeps a recovery checkpoint. If any page has changed, none of the chosen drafts will be updated.
          </p>
        </Dialog>
      )}
      {review && (
        <Dialog
          title={`Changes to ${review.title}`}
          size="wide"
          onClose={() => setReview(null)}
          footer={
            <Button variant="secondary" onClick={() => setReview(null)}>
              Done
            </Button>
          }
        >
          {!preview && <p role="status">Preparing page comparison…</p>}
          {preview && !preview.ok && (
            <EmptyState
              title="Changes unavailable"
              action={
                <>
                  {!preview.stale && (
                    <Button variant="secondary" onClick={() => setAttempt(value => value + 1)}>
                      Try again
                    </Button>
                  )}
                  <Button
                    variant="secondary"
                    onClick={() => {
                      setReview(null)
                      refresh()
                    }}
                  >
                    {refreshPending ? 'Refreshing…' : 'Refresh page list'}
                  </Button>
                </>
              }
            >
              <p role="alert">{preview.message}</p>
            </EmptyState>
          )}
          {preview?.ok && (
            <>
              <p>Both sides use the current live site look. Updating does not publish this page.</p>
              {preview.plans.map((plan, index) => (
                <div key={index}>
                  {plan.added.length > 0 && <p>New fields to fill: {plan.added.join(', ')}.</p>}
                  {plan.changed.length > 0 && <p>Changed fields need new values: {plan.changed.join(', ')}.</p>}
                  {plan.removed.length > 0 && <p>Removed fields remain in history: {plan.removed.join(', ')}.</p>}
                </div>
              ))}
              <SegmentedControl
                label="Compare page size"
                value={device}
                onChange={setDevice}
                options={[
                  { value: '1280', label: 'Desktop' },
                  { value: '768', label: 'Tablet' },
                  { value: '390', label: 'Phone' },
                ]}
              />
              <div className={styles.compare}>
                <section>
                  <h3>Current draft</h3>
                  <PageComparison title="Current draft" html={preview.beforeHtml} width={Number(device)} />
                </section>
                <section>
                  <h3>With this update</h3>
                  <PageComparison title="With this update" html={preview.html} width={Number(device)} />
                </section>
              </div>
            </>
          )}
        </Dialog>
      )}
    </>
  )
}
