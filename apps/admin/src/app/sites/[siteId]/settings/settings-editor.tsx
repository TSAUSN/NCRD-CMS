'use client'
import { useEffect, useRef, useState, useTransition, type ReactNode, type SetStateAction } from 'react'
import { useRouter } from 'next/navigation'
import { SitePublicSettings } from '@cms/schema'
import type { SiteSettingsWorkspace } from '../../../../lib/site-settings.ts'
import { useNavigationGuard } from '../../../../components/navigation-guard.ts'
import { PageHeader } from '../../../../components/ui/page-header.tsx'
import { Button } from '../../../../components/ui/button.tsx'
import { TextLink } from '../../../../components/ui/text-link.tsx'
import { SettingsNavigation } from '../../../../components/settings-navigation.tsx'
import { savePublicSiteSettings, prepareSiteSettingsPublication } from './public-settings-actions.ts'
import shared from '../../../../components/workspace.module.css'
type Block = 'social' | 'search' | 'general' | 'analytics'
export function useSettingsDraft<T>(
  siteId: string,
  archived: boolean,
  initial: SiteSettingsWorkspace,
  block: Block,
  label: string,
  initialValue: T,
  toPayload: (value: T) => unknown | null,
  fromPayload: (payload: unknown) => T,
  invalidMessage: string,
) {
  const router = useRouter()
  const [value, setValue] = useState(initialValue)
  const [baseline, setBaseline] = useState(JSON.stringify(initialValue))
  const [revision, setRevision] = useState(initial.revision)
  const [changed, setChanged] = useState(initial.changed)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState(false)
  const [pending, startTransition] = useTransition()
  const busy = useRef(false)
  const review = useRef<{ revision: string; id: string } | null>(null)
  const payload = toPayload(value)
  const dirty = JSON.stringify(value) !== baseline
  const valid =
    payload !== null &&
    SitePublicSettings.safeParse({
      ...initial.settings,
      ...(block === 'general' ? (payload as object) : { [block]: payload }),
    }).success
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (dirty || pending || busy.current) event.preventDefault()
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty, pending])
  async function persist() {
    if (!valid) {
      setError(true)
      setNotice(invalidMessage)
      return null
    }
    const outcome = await savePublicSiteSettings(siteId, revision, block, payload)
    setError(!outcome.ok)
    setNotice(outcome.message)
    if (!outcome.ok) return null
    const next = fromPayload(block === 'general' ? outcome.settings : outcome.settings[block])
    setValue(next)
    setBaseline(JSON.stringify(next))
    setRevision(outcome.revision)
    setChanged(true)
    return outcome.revision
  }
  function save() {
    if (busy.current || archived)
      return Promise.resolve({ ok: false, message: 'Wait for the current action to finish.' })
    busy.current = true
    return new Promise<{ ok: boolean; message?: string }>(resolve =>
      startTransition(async () => {
        try {
          const saved = await persist()
          resolve(saved ? { ok: true } : { ok: false, message: invalidMessage })
        } catch {
          setError(true)
          setNotice('The save could not be confirmed. Your fields are kept. Check the saved settings before retrying.')
          resolve({ ok: false, message: 'The save could not be confirmed.' })
        } finally {
          busy.current = false
        }
      }),
    )
  }
  useNavigationGuard(() => ({
    dirty,
    pending: pending || busy.current,
    draft: {
      label,
      saveDraft: save,
      discard: () => {
        setValue(JSON.parse(baseline))
        setNotice('')
      },
    },
  }))
  function change(next: SetStateAction<T>) {
    setValue(next)
    review.current = null
    setNotice('')
  }
  function act(intent: 'save' | 'schedule' | 'publish') {
    if (busy.current || archived) return
    busy.current = true
    startTransition(async () => {
      try {
        const saved = dirty ? await persist() : revision
        if (!saved || !valid) return
        if (intent === 'save') return
        if (review.current?.revision !== saved) review.current = { revision: saved, id: crypto.randomUUID() }
        const outcome = await prepareSiteSettingsPublication(siteId, saved, review.current.id)
        if (!outcome.ok) {
          setError(true)
          setNotice(outcome.message)
          if ('firstSiteReview' in outcome) router.push('/sites/' + siteId + '/publishing')
          return
        }
        router.push(
          '/sites/' +
            siteId +
            '/publishing?release=' +
            outcome.releaseId +
            (intent === 'schedule' ? '&intent=schedule' : ''),
        )
      } catch {
        setError(true)
        setNotice('The action could not be confirmed. Your settings are kept. Check Publish before trying again.')
      } finally {
        busy.current = false
      }
    })
  }
  return { value, change, dirty, valid, pending, changed, notice, error, act }
}
type DraftState = {
  dirty: boolean
  valid: boolean
  pending: boolean
  changed: boolean
  notice: string
  error: boolean
  act: (intent: 'save' | 'schedule' | 'publish') => void
}
export function SettingsEditor({
  siteId,
  siteName,
  archived,
  current,
  path,
  draft,
  children,
}: {
  siteId: string
  siteName: string
  archived: boolean
  current: string
  path: string
  draft: DraftState
  children: ReactNode
}) {
  const { dirty, valid, pending, changed, notice, error, act } = draft
  return (
    <div className={shared.denseStack} data-layout="compact">
      <PageHeader
        title="Settings"
        density="compact"
        showWayfinding={false}
        sub={siteName + ' · rules for the whole site. Changes appear on Publish.'}
        actions={
          !archived ? (
            <>
              <Button variant="secondary" disabled={pending || !dirty || !valid} onClick={() => act('save')}>
                Save draft
              </Button>
              <Button
                variant="secondary"
                disabled={pending || !valid || (!dirty && !changed)}
                onClick={() => act('schedule')}
              >
                Schedule
              </Button>
              <Button
                variant="publish"
                disabled={pending || !valid || (!dirty && !changed)}
                loading={pending}
                onClick={() => act('publish')}
              >
                Publish
              </Button>
            </>
          ) : undefined
        }
      />
      {archived && <p role="status">This site is archived. Its settings remain available in History.</p>}
      {notice && (
        <p role={error ? 'alert' : 'status'} className={error ? 'notice notice-error' : 'notice notice-ok'}>
          {notice}
          {error && (
            <>
              {' '}
              <TextLink href={'/sites/' + siteId + '/settings' + path} target="_blank" rel="noopener">
                Check saved settings in a new tab
              </TextLink>
            </>
          )}
        </p>
      )}
      {pending && (
        <p role="status">
          {dirty ? 'Saving the settings draft…' : 'Preparing the reviewed release. This can take up to a minute…'}
        </p>
      )}
      <div className={shared.workspaceSplit} data-layout="compact">
        <SettingsNavigation siteId={siteId} current={current} />
        {children}
      </div>
    </div>
  )
}
