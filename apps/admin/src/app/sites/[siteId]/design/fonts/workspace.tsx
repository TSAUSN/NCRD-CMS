'use client'
import { contentCountsForPages } from '../../../../../lib/content-counts.ts'
import { useEffect, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { THEME_FONT_OPTIONS, type ThemeTokens, type NavTree } from '@cms/schema'
import { ADOBE_KIT_URL, PREVIEW_MESSAGE } from '@cms/renderer'
import type { ThemeWorkspace, GlobalElementsWorkspace } from '../../../../../lib/queries.ts'
import { Badge, Button, Card, Dialog, EmptyState, Field, Note, PageHeader } from '../../../../../components/ui/index.ts'
import { useNavigationGuard } from '../../../../../components/navigation-guard.ts'
import { saveThemeDraft } from '../../../../actions/site-look.ts'
import { type ActionResult } from '../../../../../lib/action-result.ts'
import { useSiteLookCanvas } from '../use-site-look-canvas.ts'
import { FontPreviewStage } from './font-preview-stage.tsx'
import styles from '../../../../../components/workspace.module.css'
const heading = THEME_FONT_OPTIONS.find(font => font.label === 'Trajan Pro 3 (Adobe)')!.value
const body = THEME_FONT_OPTIONS.find(font => font.label === 'Proxima Nova (Adobe)')!.value
export function FontLibrary({
  siteId,
  theme,
  frame,
  menu,
  chapter,
  origin,
  liveHost,
}: {
  siteId: string
  theme: ThemeWorkspace
  frame: GlobalElementsWorkspace
  menu: NavTree
  chapter: boolean
  origin: string | null
  liveHost: string | null
}) {
  const router = useRouter(),
    [tokens, setTokens] = useState<ThemeTokens>(() => structuredClone(theme.draft)),
    [saved, setSaved] = useState(JSON.stringify(theme.draft)),
    [revision, setRevision] = useState(theme.revision),
    [kit, setKit] = useState(ADOBE_KIT_URL),
    [error, setError] = useState(''),
    [notice, setNotice] = useState<ActionResult | null>(null),
    [retry, setRetry] = useState(0),
    [pending, start] = useTransition(),
    [review, setReview] = useState(false),
    [status, setStatus] = useState<'unchecked' | 'checking' | 'loaded' | 'unavailable'>('unchecked')
  const busy = useRef(false),
    iframe = useRef<HTMLIFrameElement>(null),
    newestFrame = useRef<HTMLIFrameElement>(null),
    connected = tokens.fonts.adobeKit?.enabled === true,
    dirty = JSON.stringify(tokens) !== saved || kit !== ADOBE_KIT_URL,
    page = frame.pages.find(page => page.published) ?? frame.pages[0],
    host = origin ? new URL(origin).hostname : null
  const canvas = useSiteLookCanvas({
    purpose: 'fonts',
    origin,
    siteId,
    pageId: page?.id ?? '',
    versionId: page?.versionId ?? '',
    look: connected ? { tokens, header: frame.header.draft, footer: frame.footer.draft, menu } : null,
    retry,
  })
  useNavigationGuard(() => ({
    dirty,
    pending: pending || busy.current,
    draft: {
      label: 'Font choices',
      saveDraft: persist,
      discard: () => {
        setTokens(JSON.parse(saved))
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
      if (dirty || pending) event.preventDefault()
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty, pending])
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
        heading: chapter ? current.fonts.heading : heading,
        body,
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
    setNotice(null)
    const snapshot = structuredClone(tokens),
      data = new FormData()
    data.set('siteId', siteId)
    data.set('revision', String(revision))
    data.set('tokens', JSON.stringify(snapshot))
    try {
      const result = await saveThemeDraft(data)
      setNotice(result)
      if (!result.ok) return { ok: false, message: result.message }
      setSaved(JSON.stringify(snapshot))
      setKit(ADOBE_KIT_URL)
      setRevision(result.revision)
      router.refresh()
      return { ok: true }
    } catch {
      const message = 'The font draft could not be saved. Your choices are still here. Try again when connected.'
      setNotice({ ok: false, kind: 'error', message })
      return { ok: false, message }
    } finally {
      busy.current = false
    }
  }
  function save() {
    start(async () => {
      await persist()
    })
  }

  const options = THEME_FONT_OPTIONS.filter(
    font => font.label.endsWith('(Adobe)') || font.value === tokens.fonts.heading,
  )
  const headingOptions = chapter ? options.filter(font => font.value !== heading) : options
  const previewFrame =
    canvas.error && !canvas.ticket ? (
      <EmptyState title="No font preview yet">{canvas.error}</EmptyState>
    ) : (
      <FontPreviewStage
        href={canvas.ticket ? canvas.ticket.href + '?visit=1&fonts=1' : null}
        loading={canvas.loading}
        visibleFrame={iframe}
        newestFrame={newestFrame}
      />
    )
  return (
    <>
      <PageHeader
        density="compact"
        showWayfinding={false}
        title="Site look"
        lede="Fonts come from the approved kit. Each site picks from them."
        tabs={[
          { label: 'Colours', href: '/sites/' + siteId + '/design' },
          { label: 'Fonts', href: '/sites/' + siteId + '/design/fonts', current: true },
          { label: 'Buttons', href: '/sites/' + siteId + '/design#theme-button-title' },
        ]}
        actions={
          <>
            <Button
              variant="secondary"
              disabled={!connected}
              onClick={() => iframe.current?.scrollIntoView({ block: 'center' })}
            >
              Preview
            </Button>
            <Button variant="publish" disabled={dirty || pending || !connected} onClick={() => setReview(true)}>
              Publish…
            </Button>
          </>
        }
      />
      {notice && (
        <p role={notice.ok ? 'status' : 'alert'} className={'notice ' + (notice.ok ? 'notice-ok' : 'notice-error')}>
          {notice.message}
          {!notice.ok && notice.kind === 'conflict' && (
            <Button variant="secondary" onClick={() => window.location.reload()}>
              Reload
            </Button>
          )}
        </p>
      )}
      {!connected ? (
        <>
          <Card className={styles.readableForm} density="editor" title="Connect an Adobe Fonts kit">
            <div className={styles.formStack}>
              <p className="muted">
                Paste the kit’s stylesheet link. Fonts load from Adobe, and your licence covers them. Nothing is
                uploaded here.
              </p>
              <Field id="font-kit" label="Kit link" error={error}>
                <input value={kit} onChange={event => setKit(event.target.value)} />
              </Field>
              <div className={styles.actions}>
                <Button onClick={check}>Check kit</Button>
              </div>
            </div>
          </Card>
          <Note>Until a kit is connected, the site uses the template’s stand-in fonts.</Note>
        </>
      ) : (
        <>
          {!page || !host ? (
            <Note>Create a page and set a staging address before checking these fonts.</Note>
          ) : status === 'loaded' ? (
            <Note tone="success">
              Kit connected. 4 font families found. Fonts load at {host}. Live addresses must be checked at launch.
            </Note>
          ) : status === 'unavailable' ? (
            <Note tone="warning">
              <strong>This address isn’t on the kit’s allowed list, or Adobe could not be reached.</strong> Visitors to{' '}
              {host} will see stand-in fonts. Whoever owns the Adobe account adds the address to the kit, then press
              Check again.
            </Note>
          ) : (
            <Note>Checking fonts at {host}… The page uses stand-in fonts while this check finishes.</Note>
          )}
          <div className={styles.equalColumns}>
            <Card density="editor" title="Which font goes where">
              <div className={styles.formStack}>
                <Field id="font-heading" label="Headings">
                  <select
                    value={tokens.fonts.heading}
                    disabled={pending}
                    onChange={event =>
                      setTokens(current => ({
                        ...current,
                        fonts: { ...current.fonts, heading: event.target.value as ThemeTokens['fonts']['heading'] },
                      }))
                    }
                  >
                    {headingOptions.map(font => (
                      <option key={font.value} value={font.value}>
                        {font.label.replace(' (Adobe)', '')}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field id="font-body" label="Body text">
                  <select
                    value={tokens.fonts.body}
                    disabled={pending}
                    onChange={event =>
                      setTokens(current => ({
                        ...current,
                        fonts: { ...current.fonts, body: event.target.value as ThemeTokens['fonts']['body'] },
                      }))
                    }
                  >
                    {THEME_FONT_OPTIONS.filter(font => font.label.includes('Proxima Nova')).map(font => (
                      <option key={font.value} value={font.value}>
                        {font.label.replace(' (Adobe)', '')}
                        {font.value === body ? ', light' : ''}
                      </option>
                    ))}
                    {!THEME_FONT_OPTIONS.some(
                      font => font.label.includes('Proxima Nova') && font.value === tokens.fonts.body,
                    ) && <option value={tokens.fonts.body}>Current stand-in</option>}
                  </select>
                </Field>
                <Field
                  id="font-buttons"
                  label="Buttons and small labels"
                  help="Uses the body font and the national template’s button weight."
                >
                  <select value={tokens.fonts.body} onChange={() => {}}>
                    <option value={tokens.fonts.body}>
                      {THEME_FONT_OPTIONS.find(font => font.value === tokens.fonts.body)?.label.replace(' (Adobe)', '')}{' '}
                      · template weight
                    </option>
                  </select>
                </Field>
                <p className="muted">
                  {chapter
                    ? 'Echelon keeps its sans-serif headings. Trajan Pro 3 is not available for chapters.'
                    : 'Trajan Pro 3 has capitals only, so section titles appear as small capitals.'}
                </p>
                <div className={styles.actions}>
                  <Button
                    variant="secondary"
                    loading={pending}
                    disabled={!dirty || status === 'checking'}
                    onClick={save}
                  >
                    Save draft
                  </Button>
                  <Button variant="secondary" disabled={pending || status === 'checking'} onClick={check}>
                    Check again
                  </Button>
                </div>
                {error && <p role="alert">{error}</p>}
              </div>
            </Card>
            <div>
              {previewFrame}
              <p className={styles.meta}>
                The saved page with these font choices. Preview changes stay private until published.
              </p>
              {canvas.error && <p role="alert">{canvas.error}</p>}
            </div>
          </div>
          <div className={styles.tableWrap}>
            <table className={styles.table + ' ' + styles.compactTable}>
              <thead>
                <tr>
                  <th>Address</th>
                  <th>Fonts load?</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td title={host ?? undefined}>{host}</td>
                  <td>
                    <Badge
                      tone={status === 'loaded' ? 'live' : 'pending'}
                      title={status === 'unavailable' ? 'Not allowed yet or unavailable' : undefined}
                    >
                      {status === 'loaded' ? 'Yes' : status === 'unavailable' ? 'Unavailable' : 'Checking…'}
                    </Badge>
                  </td>
                  <td>
                    <Button variant="secondary" size="s" disabled={status === 'checking'} onClick={check}>
                      Check again
                    </Button>
                  </td>
                </tr>
                {liveHost && liveHost !== host && (
                  <tr>
                    <td title={liveHost}>{liveHost}</td>
                    <td>
                      <Badge>Check at launch</Badge>
                    </td>
                    <td />
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
      {review && (
        <Dialog
          title="Publish site look"
          onClose={() => setReview(false)}
          footer={
            <>
              <Button variant="secondary" onClick={() => setReview(false)}>
                Cancel
              </Button>
              <Button variant="publish" onClick={() => router.push('/sites/' + siteId + '/publishing?area=site-look')}>
                Review saved changes
              </Button>
            </>
          }
        >
          <p>
            The saved font choices affect every page on this site. Review the saved changes and checks before
            publishing.
          </p>
          <p>{frame.contentSummary ?? contentCountsForPages(frame.pages)} use this site look.</p>
        </Dialog>
      )}
    </>
  )
}
