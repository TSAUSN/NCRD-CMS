import { themePublishReadiness } from './theme-readiness.ts'
import { useEffect, useRef, useState, useTransition, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { ThemeTokens as ThemeValue, type ThemeTokens } from '@cms/schema'
import { useNavigationGuard } from '../../../../components/navigation-guard.ts'
import { publishTheme, revertThemeToLive, saveThemeDraft } from '../../../actions/site-look.ts'
import { type ActionResult } from '../../../../lib/action-result.ts'
type InitialWorkspace = {
  revision: number
  draftVersionId: string
  publishedVersionId: string | null
  draft: ThemeTokens
  published: ThemeTokens
  usage: Record<string, number>
  previewPages: { title: string; versionId: string }[]
}
export const cloneThemeTokens = (tokens: ThemeTokens): ThemeTokens => structuredClone(tokens)
export const serializeThemeTokens = (tokens: ThemeTokens): string => JSON.stringify(tokens)

export type ThemeEditorProps = {
  startingControls?: ReactNode
  commands?: ReactNode
  relatedControls?: ReactNode
  presetTokens?: ThemeTokens
  controlsOnly?: boolean
  onDraftChange?: (tokens: ThemeTokens, dirty: boolean, pending: boolean, ready: boolean) => void
  siteId: string
  siteName: string
  initial: InitialWorkspace
  canManage: boolean
}

function themeDraftForm(siteId: string, revision: number, snapshot: ThemeTokens): FormData {
  const data = new FormData()
  data.set('siteId', siteId)
  data.set('revision', String(revision))
  data.set('tokens', JSON.stringify(snapshot))
  return data
}

export function useThemeDraft({
  siteId,
  initial,
  canManage,
  onDraftChange,
  presetTokens,
}: Pick<ThemeEditorProps, 'siteId' | 'initial' | 'canManage' | 'onDraftChange' | 'presetTokens'>) {
  const router = useRouter()
  const [tokens, setTokens] = useState<ThemeTokens>(() => cloneThemeTokens(initial.draft))
  const [published, setPublished] = useState<ThemeTokens>(() => cloneThemeTokens(initial.published))
  const [saved, setSaved] = useState(serializeThemeTokens(initial.draft))
  const [revision, setRevision] = useState(initial.revision)
  const [notice, setNotice] = useState<ActionResult | null>(null)
  const [confirming, setConfirming] = useState<'publish' | 'revert' | 'defaults' | null>(null)
  const [pending, startTransition] = useTransition()
  const actionInFlight = useRef(false)
  useEffect(() => {
    setTokens(cloneThemeTokens(initial.draft))
    setPublished(cloneThemeTokens(initial.published))
    setSaved(serializeThemeTokens(initial.draft))
    setRevision(initial.revision)
  }, [initial.revision, initial.draftVersionId, initial.publishedVersionId])

  useEffect(() => {
    if (presetTokens) setTokens(cloneThemeTokens(presetTokens))
  }, [presetTokens])
  const valid = ThemeValue.safeParse(tokens).success
  const dirty = serializeThemeTokens(tokens) !== saved
  useNavigationGuard(() => ({
    dirty,
    pending: pending || actionInFlight.current,
    draft: {
      label: 'Site look',
      saveDraft: saveBeforeLeaving,
      discard: () => {
        setTokens(JSON.parse(saved))
        setNotice(null)
        setConfirming(null)
      },
    },
  }))
  const hasLiveVersion = initial.publishedVersionId !== null
  const draftIsLive = hasLiveVersion && serializeThemeTokens(tokens) === serializeThemeTokens(published) && !dirty
  const { ready: contrastReady, approvedPrimary } = themePublishReadiness(tokens)

  useEffect(() => {
    function warn(event: BeforeUnloadEvent) {
      if (!dirty && !pending && !actionInFlight.current) return
      event.preventDefault()
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty, pending])

  useEffect(() => {
    onDraftChange?.(tokens, dirty, pending, valid && contrastReady)
  }, [serializeThemeTokens(tokens), dirty, pending, valid, contrastReady, onDraftChange])

  async function saveBeforeLeaving(): Promise<{ ok: boolean; message?: string }> {
    if (actionInFlight.current) return { ok: false, message: 'Wait for the current design action to finish.' }
    if (!canManage) return { ok: false, message: 'A site administrator can save this design.' }
    if (!valid) return { ok: false, message: 'Check the colour and font choices before saving.' }
    actionInFlight.current = true
    setNotice(null)
    const snapshot = cloneThemeTokens(tokens)
    const data = themeDraftForm(siteId, revision, snapshot)
    try {
      const result = await saveThemeDraft(data)
      setNotice(result)
      if (!result.ok) return { ok: false, message: result.message }
      setRevision(result.revision)
      setSaved(serializeThemeTokens(snapshot))
      setConfirming(null)
      return { ok: true }
    } catch {
      const message =
        'The design draft could not be saved. Your choices are still here. Check the saved design before trying again.'
      setNotice({ ok: false, kind: 'error', message })
      return { ok: false, message }
    } finally {
      actionInFlight.current = false
    }
  }

  function act(kind: 'save' | 'publish' | 'revert') {
    if (actionInFlight.current || !canManage || (kind !== 'revert' && !valid)) return
    actionInFlight.current = true
    setNotice(null)
    const snapshot = cloneThemeTokens(tokens)
    const data = themeDraftForm(siteId, revision, snapshot)
    startTransition(async () => {
      try {
        const result =
          kind === 'save'
            ? await saveThemeDraft(data)
            : kind === 'publish'
              ? await publishTheme(data)
              : await revertThemeToLive(data)
        setNotice(result)
        setConfirming(null)
        if (result.ok) {
          setRevision(result.revision)
          if (kind === 'save') setSaved(serializeThemeTokens(snapshot))
          else if (kind === 'publish') {
            setPublished(snapshot)
            router.refresh()
          } else {
            setTokens(cloneThemeTokens(published))
            setSaved(serializeThemeTokens(published))
            router.refresh()
          }
        }
      } catch {
        setConfirming(null)
        setNotice({
          ok: false,
          kind: 'error',
          message:
            'The design change could not be confirmed. Reload to check the saved and live design before trying again.',
        })
      } finally {
        actionInFlight.current = false
      }
    })
  }

  return {
    tokens,
    setTokens,
    notice,
    confirming,
    setConfirming,
    pending,
    dirty,
    valid,
    contrastReady,
    approvedPrimary,
    hasLiveVersion,
    draftIsLive,
    actionInFlight,
    act,
  }
}
