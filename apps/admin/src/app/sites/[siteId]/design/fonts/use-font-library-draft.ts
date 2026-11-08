import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { THEME_FONT_OPTIONS, type ThemeTokens } from '@cms/schema'
import { ADOBE_KIT_URL, PREVIEW_MESSAGE } from '@cms/renderer'
import type { FontLibraryWorkspace } from '../../../../../server/queries/font-library.ts'
import { useNavigationGuard } from '../../../../../components/navigation-guard.ts'
import { saveThemeDraft } from '../../../../actions/site-look.ts'
import type { ActionResult } from '../../../../../lib/action-result.ts'
import { useSiteLookCanvas } from '../use-site-look-canvas.ts'

const defaultHeading = THEME_FONT_OPTIONS.find(font => font.label === 'Trajan Pro 3 (Adobe)')!.value
const defaultBody = THEME_FONT_OPTIONS.find(font => font.label === 'Proxima Nova (Adobe)')!.value
const bodyOptions = THEME_FONT_OPTIONS.filter(font => font.label.includes('Proxima Nova'))

export type FontLibraryProps = {
  siteId: string
  initial: FontLibraryWorkspace
  chapter: boolean
  origin: string | null
  liveHost: string | null
}

export function useFontLibraryDraft({ siteId, initial, chapter, origin }: FontLibraryProps) {
  const [tokens, setTokens] = useState<ThemeTokens>(() => structuredClone(initial.draft))
  const [saved, setSaved] = useState(JSON.stringify(initial.draft))
  const [revision, setRevision] = useState(initial.revision)
  const [kit, setKit] = useState(ADOBE_KIT_URL)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState<ActionResult | null>(null)
  const [retry, setRetry] = useState(0)
  const [pending, setPending] = useState(false)
  const [status, setStatus] = useState<'unchecked' | 'checking' | 'loaded' | 'unavailable'>('unchecked')
  const busy = useRef(false)
  const iframe = useRef<HTMLIFrameElement>(null)
  const newestFrame = useRef<HTMLIFrameElement>(null)
  const connected = tokens.fonts.adobeKit?.enabled === true
  const dirty = JSON.stringify(tokens) !== saved || kit !== ADOBE_KIT_URL
  const unsaved = useRef(dirty)
  useLayoutEffect(() => {
    unsaved.current = dirty
  }, [dirty])
  const { page, header, footer, menu } = initial
  const host = origin ? new URL(origin).hostname : null
  const canvas = useSiteLookCanvas({
    purpose: 'fonts',
    origin,
    siteId,
    pageId: page?.id ?? '',
    versionId: page?.versionId ?? '',
    look: connected ? { tokens, header, footer, menu } : null,
    retry,
  })
  useNavigationGuard(() => ({
    dirty,
    pending: pending || busy.current,
    draft: {
      label: 'Font choices',
      saveDraft: persist,
      discard: () => {
        const savedTokens: ThemeTokens = JSON.parse(saved)
        unsaved.current = false
        setTokens(savedTokens)
        setKit(ADOBE_KIT_URL)
        setError('')
        setNotice(null)
      },
    },
  }))
  useEffect(() => {
    if (canvas.error) setStatus('unavailable')
  }, [canvas.error])
  useEffect(() => {
    function warn(event: BeforeUnloadEvent) {
      if (unsaved.current || busy.current) event.preventDefault()
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [])
  useEffect(() => {
    if (!connected || !canvas.ticket) return
    setStatus('checking')
    const ticket = canvas.ticket
    function receive(event: MessageEvent) {
      if (
        event.source !== newestFrame.current?.contentWindow ||
        event.origin !== origin ||
        event.data?.type !== PREVIEW_MESSAGE.fontStatus ||
        event.data.channel !== ticket.channel ||
        event.data.hostname !== host ||
        typeof event.data.loaded !== 'boolean'
      )
        return
      setStatus(event.data.loaded ? 'loaded' : 'unavailable')
    }
    window.addEventListener('message', receive)
    const timer = window.setTimeout(
      () => setStatus(current => (current === 'checking' ? 'unavailable' : current)),
      16000,
    )
    return () => {
      window.removeEventListener('message', receive)
      window.clearTimeout(timer)
    }
  }, [canvas.ticket, connected, origin, host])
  function check() {
    if (kit.trim() !== ADOBE_KIT_URL) {
      setError('Use the approved kit link: ' + ADOBE_KIT_URL)
      return
    }
    if (!host || !page) {
      setError('Create a page and set a staging address before checking the kit.')
      return
    }
    setError('')
    setNotice(null)
    setStatus('checking')
    setTokens(current => ({
      ...current,
      fonts: {
        ...current.fonts,
        heading: chapter ? current.fonts.heading : defaultHeading,
        body: defaultBody,
        adobeKit: {
          id: 'euh2hvn',
          enabled: true,
          domains: [...new Set([host, ...(current.fonts.adobeKit?.domains ?? [])])].slice(0, 10),
        },
      },
    }))
    setRetry(value => value + 1)
  }
  async function persist(): Promise<{ ok: boolean; message?: string }> {
    if (busy.current) return { ok: false, message: 'Wait for the current font save to finish.' }
    if (kit.trim() !== ADOBE_KIT_URL) {
      const message = 'Use the approved kit link: ' + ADOBE_KIT_URL
      setError(message)
      return { ok: false, message }
    }
    if (!connected) {
      const message = 'Use Check kit before saving this connection.'
      setError(message)
      return { ok: false, message }
    }
    busy.current = true
    setPending(true)
    setNotice(null)
    const snapshot = structuredClone(tokens)
    const data = new FormData()
    data.set('siteId', siteId)
    data.set('revision', String(revision))
    data.set('tokens', JSON.stringify(snapshot))
    try {
      const result = await saveThemeDraft(data)
      setNotice(result)
      if (!result.ok) return { ok: false, message: result.message }
      unsaved.current = false
      setSaved(JSON.stringify(snapshot))
      setKit(ADOBE_KIT_URL)
      setRevision(result.revision)
      // The server action already invalidates the design. A refresh here can cancel the requested exit.
      return { ok: true }
    } catch {
      const message = 'The font draft could not be saved. Your choices are still here. Try again when connected.'
      setNotice({ ok: false, kind: 'error', message })
      return { ok: false, message }
    } finally {
      busy.current = false
      setPending(false)
    }
  }

  const options = THEME_FONT_OPTIONS.filter(
    font => font.label.endsWith('(Adobe)') || font.value === tokens.fonts.heading,
  )
  const headingOptions = chapter ? options.filter(font => font.value !== defaultHeading) : options

  const buttonFont = THEME_FONT_OPTIONS.find(font => font.value === tokens.fonts.body)?.label.replace(' (Adobe)', '')

  function setFont<K extends 'heading' | 'body'>(slot: K, value: ThemeTokens['fonts'][K]) {
    setTokens(current => ({ ...current, fonts: { ...current.fonts, [slot]: value } }))
  }

  return {
    iframe,
    newestFrame,
    canvas,
    connected,
    dirty,
    pending,
    notice,
    error,
    kit,
    setKit,
    check,
    page,
    host,
    status,
    tokens,
    setFont,
    headingOptions,
    bodyOptions,
    defaultBody,
    buttonFont,
    save: persist,
  }
}
