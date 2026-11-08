'use client'

import { useEffect, useRef, useState } from 'react'
import { useNavigationGuard } from '../../../../components/navigation-guard.ts'
import { Button, Disclosure, TextLink } from '../../../../components/ui/index.ts'
import listInspectorStyles from '../../../../components/workspace-styles/list-inspector.module.css'
import { ConfirmDialog } from '../../../../components/confirm.tsx'
import type { PreparedRecovery, RecoveryReview } from '../../../../lib/release-recovery.ts'
import { releaseLabel } from '../../../../lib/release-copy.ts'
import { prepareRelease, type ReleaseResult } from './release-actions.ts'
import { prepareRecovery, reviewRecovery } from './recovery-actions.ts'

type PlannedRelease = NonNullable<ReleaseResult['release']>
export function ReleaseRecoveryReview({
  releaseId,
  canAdminister,
  onPlanned,
  onBusyChange,
}: {
  releaseId: string
  canAdminister: boolean
  onPlanned: (release: PlannedRelease) => void
  onBusyChange: (busy: boolean) => void
}) {
  const [review, setReview] = useState<RecoveryReview | null>(null)
  const [prepared, setPrepared] = useState<PreparedRecovery | null>(null)
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)
  const [confirm, setConfirm] = useState(false)
  const lock = useRef(false)
  const requestId = useRef<string | null>(null)
  const planId = useRef<string | null>(null)
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])
  useNavigationGuard(() => ({ dirty: false, pending: lock.current }))
  useEffect(() => {
    const guard = (event: BeforeUnloadEvent) => {
      if (lock.current) {
        event.preventDefault()
        event.returnValue = ''
      }
    }
    window.addEventListener('beforeunload', guard)
    return () => window.removeEventListener('beforeunload', guard)
  }, [])
  async function run(action: () => Promise<void>) {
    if (lock.current) return
    lock.current = true
    onBusyChange(true)
    setPending(true)
    setError('')
    try {
      await action()
    } catch {
      if (alive.current)
        setError('The result could not be confirmed. Retry the same action to retrieve its saved result.')
    } finally {
      lock.current = false
      onBusyChange(false)
      if (alive.current) setPending(false)
    }
  }
  function load(resume = true) {
    void run(async () => {
      const outcome = await reviewRecovery(releaseId)
      if (!alive.current) return
      if (!outcome.ok) {
        setError(outcome.message)
        return
      }
      setReview(outcome.review)
      requestId.current = null
      setPrepared(resume ? outcome.prepared : null)
      planId.current = resume ? (outcome.prepared?.plannedReleaseId ?? null) : null
    })
  }
  const needsAdmin =
    review?.available &&
    review.items.some(
      item =>
        item.type === 'theme' ||
        item.type === 'collection_schema' ||
        item.type === 'site_settings' ||
        item.type === 'chapter_setup' ||
        item.type === 'site_files',
    )
  return (
    <div className={listInspectorStyles.formStack} aria-label="Recover a release">
      <h3>Recover the state before this release</h3>
      <p>
        Review the items this release changed. Recovery first prepares private drafts and preserves later work in
        history. You then review and publish them together.
      </p>
      {!prepared && (
        <Button variant="secondary" disabled={pending} onClick={() => load()}>
          {review ? 'Refresh recovery review' : 'Review recovery'}
        </Button>
      )}
      {error && !confirm && (
        <p role="alert" className="notice notice-error">
          {error}
        </p>
      )}
      {review && !review.available && <p className="notice">{review.reason}</p>}
      {review?.available && !prepared && (
        <>
          {review.wasPrivate && (
            <p className="notice">
              This release first made the site public. Recovery returns it to private only if that can be done without
              hiding unrelated later pages.
            </p>
          )}
          <ul className="recovery-items">
            {review.items.map(item => (
              <li key={item.key}>
                <strong>{releaseLabel(item)}</strong> —{' '}
                {item.wasUnpublished
                  ? 'Become unpublished; keep the content and history'
                  : 'Restore the previously published version'}
                {item.laterDraft && (
                  <p className="hint">
                    A later draft exists. It will be preserved before a recovery draft is prepared.
                  </p>
                )}
                {item.type === 'collection_entries' && (
                  <p className="hint">Includes the earlier items, their order and hidden state.</p>
                )}
              </li>
            ))}
          </ul>
          {needsAdmin && !canAdminister && (
            <p className="notice">
              A site administrator must prepare this recovery because it includes site settings, Site look or list field
              changes.
            </p>
          )}
          <Button
            disabled={pending || !review.items.length || (!!needsAdmin && !canAdminister)}
            onClick={() => setConfirm(true)}
          >
            Prepare recovery drafts
          </Button>
        </>
      )}
      {prepared && (
        <>
          <p role="status" className="notice notice-ok">
            Recovery drafts are ready. The live site is unchanged.
          </p>
          {prepared.preservedDrafts.length > 0 && (
            <Disclosure title={`Preserved drafts (${prepared.preservedDrafts.length})`}>
              <ul>
                {prepared.preservedDrafts.map(item => (
                  <li key={item.key}>
                    {releaseLabel(item)} — retained in version history
                    {item.type === 'page' && item.versionId && (
                      <>
                        {' '}
                        ·{' '}
                        <TextLink
                          href={`/pages/${item.id}/history?version=${item.versionId}`}
                          target="_blank"
                          rel="noopener"
                        >
                          View preserved draft
                        </TextLink>
                      </>
                    )}
                  </li>
                ))}
              </ul>
            </Disclosure>
          )}
          <Button variant="secondary" disabled={pending} onClick={() => load(false)}>
            Start a new recovery review
          </Button>
          <p>
            Review the complete recovery together before publishing. Changes made after this preparation require a fresh
            review.
          </p>
          <Button
            disabled={pending}
            onClick={() => {
              planId.current ??= crypto.randomUUID()
              void run(async () => {
                const outcome = await prepareRelease(prepared.siteId, planId.current!, prepared.items)
                if (!alive.current) return
                if (!outcome.ok || !outcome.release) {
                  setError(outcome.message)
                  return
                }
                onPlanned(outcome.release)
              })
            }}
          >
            Review recovery release
          </Button>
        </>
      )}
      {confirm && review?.available && (
        <ConfirmDialog
          title="Prepare these recovery drafts?"
          what={`${review.items.length} affected items will receive recovery drafts or explicit unpublish intentions.`}
          reassurance="Later drafts are preserved in history. Live content changes only after you review and publish the recovery release."
          confirmLabel="Prepare recovery drafts"
          tone="primary"
          pending={pending}
          error={error || undefined}
          onCancel={() => setConfirm(false)}
          onConfirm={() => {
            requestId.current ??= crypto.randomUUID()
            void run(async () => {
              const outcome = await prepareRecovery(requestId.current!, releaseId, review.expectedState)
              if (!alive.current) return
              if (!outcome.ok) {
                setError(outcome.message)
                return
              }
              setPrepared(outcome.recovery)
              setConfirm(false)
            })
          }}
        />
      )}
    </div>
  )
}
