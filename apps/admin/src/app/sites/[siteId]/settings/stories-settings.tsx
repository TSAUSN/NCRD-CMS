'use client'
import { useEffect, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button, ButtonLink, Card } from '../../../../components/ui/index.ts'
import { useNavigationGuard } from '../../../../components/navigation-guard.ts'
import { changeTags } from '../stories/tags/actions.ts'
import workspaceFormsStyles from '../../../../components/workspace-styles/workspace-forms.module.css'
import recordTableStyles from '../../../../components/workspace-styles/record-table.module.css'
import selectionControlsStyles from '../../../../components/workspace-styles/selection-controls.module.css'
export type StoriesPolicy = {
  collectionId: string
  revision: string
  entryRevision: string
  publishUnreviewed: boolean
  configured: boolean
  changed: boolean
}
export function StoriesSettings({ siteId, policy }: { siteId: string; policy: StoriesPolicy | null }) {
  const router = useRouter(),
    [value, setValue] = useState(policy?.publishUnreviewed ?? true),
    [saved, setSaved] = useState(policy?.publishUnreviewed ?? true),
    [result, setResult] = useState<{ ok: boolean; message: string } | null>(null),
    [pending, start] = useTransition(),
    busy = useRef(false)
  useEffect(() => {
    setValue(policy?.publishUnreviewed ?? true)
    setSaved(policy?.publishUnreviewed ?? true)
  }, [policy?.publishUnreviewed])
  useNavigationGuard(() => ({
    dirty: value !== saved,
    pending: busy.current,
    draft: {
      label: 'Stories setting',
      saveDraft: save,
      discard: () => {
        setValue(saved)
        setResult(null)
      },
    },
  }))
  useEffect(() => {
    const leave = (event: BeforeUnloadEvent) => {
      if (value !== saved || busy.current) {
        event.preventDefault()
        event.returnValue = ''
      }
    }
    window.addEventListener('beforeunload', leave)
    return () => window.removeEventListener('beforeunload', leave)
  }, [value, saved])
  async function save(): Promise<{ ok: boolean; message?: string }> {
    if (busy.current) return { ok: false, message: 'Wait for the current save to finish.' }
    if (!policy) return { ok: false, message: 'Turn on Stories before changing this setting.' }
    if (value === saved) return { ok: true }
    busy.current = true
    try {
      const outcome = await changeTags(siteId, policy.collectionId, policy.revision, policy.entryRevision, {
        action: 'review-policy',
        publishUnreviewed: value,
      })
      if (outcome.ok) {
        setSaved(value)
        setResult({ ok: true, message: 'Stories setting saved as a draft. Publish to update the site.' })
        router.refresh()
        return { ok: true }
      }
      setResult(outcome)
      return outcome
    } catch {
      const outcome = { ok: false, message: 'The setting could not be saved. Try again when connected.' }
      setResult(outcome)
      return outcome
    } finally {
      busy.current = false
    }
  }
  return (
    <Card density="settings" title="Stories">
      <div className={workspaceFormsStyles.compactFields}>
        {!policy ? (
          <>
            <p>
              Turn on a Stories library with this site’s own main and secondary tags. Choose stories by tag in page
              sections.
            </p>
            <div>
              <ButtonLink variant="secondary" href={'/sites/' + siteId + '/stories/setup'}>
                Turn on Stories
              </ButtonLink>
            </div>
          </>
        ) : (
          <>
            <p>Stories is on. Manage the words, photos and tags in Stories.</p>
            <label className={selectionControlsStyles.toggleRow}>
              <span>Include unreviewed stories in feeds</span>
              <input
                type="checkbox"
                checked={value}
                disabled={pending}
                onChange={event => setValue(event.target.checked)}
              />
            </label>
            <p className={recordTableStyles.meta}>
              When this is off, a story needs Reviewed before it appears in feeds. The setting changes the public site
              after publishing.
            </p>
            <div className={workspaceFormsStyles.actions}>
              <Button
                variant="secondary"
                loading={pending}
                disabled={value === saved}
                onClick={() =>
                  start(async () => {
                    await save()
                  })
                }
              >
                Save Stories setting
              </Button>
              <ButtonLink variant="secondary" href={'/sites/' + siteId + '/stories'}>
                Open Stories
              </ButtonLink>
              {policy.changed && (
                <ButtonLink variant="secondary" href={'/sites/' + siteId + '/publishing?lists=1'}>
                  Review and publish
                </ButtonLink>
              )}
            </div>
            {!policy.configured && (
              <p className={recordTableStyles.meta}>
                Saving adopts the existing Stories library’s tag settings as a draft.
              </p>
            )}
          </>
        )}
        {result && <p role={result.ok ? 'status' : 'alert'}>{result.message}</p>}
      </div>
    </Card>
  )
}
