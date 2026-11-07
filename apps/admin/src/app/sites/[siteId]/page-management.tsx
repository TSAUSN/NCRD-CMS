'use client'
import { GuardedLink as Link } from '../../../components/guarded-link.tsx'
import { useState, useRef, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { ConfirmDialog } from '../../../components/confirm.tsx'
import { Button, Menu, Drawer } from '../../../components/ui/index.ts'
import { IconMore } from '../../../components/icons.tsx'
import { archivePage, restoreArchivedPage, unpublishPage } from '../../actions/page-lifecycle.ts'
import { type ActionResult } from '../../../lib/action-result.ts'
import { PageDetailsFields } from '../../pages/[pageId]/page-details-fields.tsx'
import { savePageDetailsAction } from '../../pages/[pageId]/page-details-actions.ts'
import { duplicatePageAction } from '../../pages/[pageId]/page-copy-actions.ts'
type Mode = 'details' | 'unpublish' | 'archive' | 'restore' | null
export function PageManagement({
  pageId,
  title,
  slug: _slug,
  revision,
  live,
  archived = false,
  navigation,
}: {
  pageId: string
  title: string
  slug: string
  revision: string
  live: boolean
  archived?: boolean
  navigation?: { liveHref?: string }
}) {
  const router = useRouter(),
    [mode, setMode] = useState<Mode>(null),
    [result, setResult] = useState<ActionResult | null>(null),
    [pending, start] = useTransition(),
    busy = useRef(false)
  const error = result && !result.ok ? result.message : undefined
  function run(action: (form: FormData) => Promise<ActionResult>) {
    if (busy.current) return
    busy.current = true
    setResult(null)
    const form = new FormData()
    form.set('pageId', pageId)
    form.set('revision', revision)
    start(async () => {
      try {
        const next = await action(form)
        setResult(next)
        if (next.ok) {
          setMode(null)
          router.refresh()
        }
      } catch {
        setResult({
          ok: false,
          kind: 'error',
          message: 'The change could not be confirmed. Refresh Pages to check before trying again.',
        })
      } finally {
        busy.current = false
      }
    })
  }
  function duplicate() {
    if (busy.current) return
    busy.current = true
    setResult(null)
    start(async () => {
      try {
        const next = await duplicatePageAction(pageId, Number(revision))
        if (next.ok) router.push('/pages/' + next.pageId)
        else setResult(next)
      } catch {
        setResult({
          ok: false,
          kind: 'error',
          message: 'The copy could not be confirmed. Refresh Pages to check before trying again.',
        })
      } finally {
        busy.current = false
      }
    })
  }
  return (
    <div>
      {archived ? (
        <Button variant="secondary" size="s" onClick={() => setMode('restore')} disabled={pending}>
          Restore page
        </Button>
      ) : (
        <Menu accessibleLabel={'More actions for ' + title} label={<IconMore size={16} />}>
          {navigation && (
            <>
              <Link href={'/pages/' + pageId} aria-label={'Edit ' + title}>
                Edit
              </Link>
              {navigation.liveHref && (
                <a
                  href={navigation.liveHref}
                  target="_blank"
                  rel="noopener"
                  aria-label={'View ' + title + ' on the live site'}
                >
                  View live
                </a>
              )}
            </>
          )}
          <Button
            variant="tertiary"
            onClick={() => {
              setResult(null)
              setMode('details')
            }}
          >
            Rename
          </Button>
          <Button variant="tertiary" loading={pending} onClick={duplicate}>
            Duplicate
          </Button>
          <Button
            variant="tertiary"
            onClick={() => {
              setResult(null)
              setMode('details')
            }}
          >
            Move
          </Button>
          {live && (
            <Button
              variant="tertiary"
              onClick={() => {
                setResult(null)
                setMode('unpublish')
              }}
            >
              Unpublish
            </Button>
          )}
          <Button
            variant="destructive"
            onClick={() => {
              setResult(null)
              setMode('archive')
            }}
          >
            Archive
          </Button>
        </Menu>
      )}
      {!mode && result && <p role={result.ok ? 'status' : 'alert'}>{result.message}</p>}
      {mode === 'details' && (
        <Drawer title="Page name and address" onClose={() => setMode(null)}>
          <PageDetailsFields
            pageId={pageId}
            onSave={async input => {
              const next = await savePageDetailsAction(input, Number(revision))
              if (next.ok) router.refresh()
              return next
            }}
          />
        </Drawer>
      )}
      {mode === 'unpublish' && (
        <ConfirmDialog
          title={'Unpublish “' + title + '”?'}
          pending={pending}
          error={error}
          what="Visitors will no longer be able to open this page."
          reassurance="Its draft and full history stay in the CMS. You can publish it again."
          confirmLabel="Unpublish page"
          onCancel={() => setMode(null)}
          onConfirm={() => run(unpublishPage)}
        />
      )}
      {mode === 'archive' && (
        <ConfirmDialog
          title={'Archive “' + title + '”?'}
          pending={pending}
          error={error}
          what="This page will leave Pages and be removed from the live site and menu."
          reassurance="Its draft and full history are kept. You can restore it later."
          confirmLabel="Archive page"
          onCancel={() => setMode(null)}
          onConfirm={() => run(archivePage)}
        />
      )}
      {mode === 'restore' && (
        <ConfirmDialog
          title={'Restore “' + title + '”?'}
          tone="primary"
          pending={pending}
          error={error}
          what="This page will return to Pages as a private draft."
          reassurance="It stays off the live site until you publish it. Its history is kept."
          confirmLabel="Restore page"
          onCancel={() => setMode(null)}
          onConfirm={() => run(restoreArchivedPage)}
        />
      )}
    </div>
  )
}
