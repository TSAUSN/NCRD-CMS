'use client'
import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import { useRouter } from 'next/navigation'
import {
  ThemeTokens as ThemeValue,
  type HeaderConfig,
  type FooterConfig,
  type NavTree,
  type ThemeTokens,
} from '@cms/schema'
import { CORE_THEME_PRESETS } from '@cms/seeds/core-themes'
import type { ThemeWorkspace, GlobalElementsWorkspace } from '../../../../lib/queries.ts'
import type { MediaAsset } from '../../../../lib/media-library.ts'
import { ThemeEditor } from './theme-editor.tsx'
import { SiteLookPanel } from '../../../../components/site-look-panel.tsx'
import { ScriptlessPreview } from '../../../../components/scriptless-preview.tsx'
import {
  Button,
  ButtonLink,
  Field,
  SegmentedControl,
  ResizablePanel,
  Dialog,
  EmptyState,
  Card,
} from '../../../../components/ui/index.ts'
import { queueFramePreview, requestFramePreview } from '../../../../lib/frame-preview-request.ts'
import { useSiteLookCanvas } from './use-site-look-canvas.ts'
import styles from './site-look.module.css'
import workspace from '../../../../components/workspace.module.css'

type SharedDraft = { header: HeaderConfig; footer: FooterConfig; menu: NavTree }
type ChangedParts = { header: boolean; footer: boolean; menu: boolean }
export function SiteLookWorkspace({
  siteId,
  siteName,
  theme,
  frame,
  menu,
  canTheme,
  canFrame,
  media,
  isolatedOrigin = null,
}: {
  isolatedOrigin?: string | null
  siteId: string
  siteName: string
  theme: ThemeWorkspace
  frame: GlobalElementsWorkspace
  menu: NavTree
  canTheme: boolean
  canFrame: boolean
  media: MediaAsset[]
}) {
  const original = frame.originalDesign === true,
    router = useRouter()
  const [tab, setTab] = useState(original ? 'header' : 'theme')
  const [page, setPage] = useState(
    (original ? frame.pages.find(page => page.usesHeader !== false) : frame.pages[0])?.versionId ?? '',
  )
  const [device, setDevice] = useState('desktop'),
    [tokens, setTokens] = useState(theme.draft),
    [draft, setDraft] = useState<SharedDraft | null>(() =>
      original ? null : { header: frame.header.draft, footer: frame.footer.draft, menu },
    )
  const [themeStatus, setThemeStatus] = useState({ dirty: false, pending: false, ready: false }),
    [frameStatus, setFrameStatus] = useState({ dirty: false, pending: false, ready: !original })
  const [parts, setParts] = useState<ChangedParts>({ header: false, footer: false, menu: false })
  const [html, setHtml] = useState(''),
    [error, setError] = useState(''),
    [loading, setLoading] = useState(false),
    [retry, setRetry] = useState(0),
    [publishOpen, setPublishOpen] = useState(false),
    [preset, setPreset] = useState('')
  const [presetTokens, setPresetTokens] = useState<ThemeTokens | undefined>(undefined)
  const frameRef = useRef<HTMLIFrameElement | null>(null),
    viewport = useRef<HTMLDivElement | null>(null),
    [available, setAvailable] = useState(0),
    [canvasTop, setCanvasTop] = useState(280)
  const choices = frame.pages.filter(
    page => tab === 'theme' || (tab === 'footer' ? page.usesFooter !== false : page.usesHeader !== false),
  )
  const choiceIds = choices.map(page => page.versionId).join(',')
  useEffect(() => {
    if (!choices.some(choice => choice.versionId === page)) setPage(choices[0]?.versionId ?? '')
  }, [choiceIds, page])
  const isolated = useSiteLookCanvas({
    origin: isolatedOrigin,
    siteId,
    pageId: frame.pages.find(item => item.versionId === page)?.id ?? '',
    versionId: page,
    look: draft ? { tokens, ...draft } : null,
    retry,
  })
  const changedTheme = useCallback((value: ThemeTokens, dirty: boolean, pending: boolean, ready: boolean) => {
    if (ThemeValue.safeParse(value).success) setTokens(value)
    setThemeStatus({ dirty, pending, ready })
  }, [])
  const changedFrame = useCallback(
    (value: SharedDraft, dirty: boolean, pending: boolean, valid: boolean, changed?: ChangedParts) => {
      if (valid) setDraft(value)
      setFrameStatus({ dirty, pending, ready: valid })
      if (changed) setParts(changed)
    },
    [],
  )
  const refresh = useCallback(() => setRetry(value => value + 1), []),
    noop = useCallback(() => {}, [])
  useEffect(() => {
    const node = viewport.current
    if (!node) return
    const measure = () => {
      setAvailable(
        node.clientWidth -
          Number.parseFloat(getComputedStyle(node).paddingLeft) -
          Number.parseFloat(getComputedStyle(node).paddingRight),
      )
      // Ancestor scrollIntoView movement must not increase the panel's height.
      let top = 0,
        current: HTMLElement | null = node
      while (current) {
        top += current.offsetTop
        current = current.offsetParent as HTMLElement | null
      }
      setCanvasTop(top)
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(node)
    window.addEventListener('resize', measure)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [])
  function showArea(frame: HTMLIFrameElement | null) {
    if (!frame || isolatedOrigin) return
    const view = frame.contentWindow,
      footer = frame.contentDocument?.querySelector('footer,[data-cms-frame="footer"],.footer')
    if (tab === 'footer' && view && footer)
      view.scrollTo({ top: Math.max(0, footer.getBoundingClientRect().top + view.scrollY) })
    else view?.scrollTo({ top: 0 })
  }
  useEffect(() => showArea(frameRef.current), [tab])
  const serial = JSON.stringify([page, tokens, draft])
  useEffect(() => {
    if (isolatedOrigin || !page || !draft) return
    setLoading(true)
    setError('')
    return queueFramePreview(async signal => {
      const result = await requestFramePreview(
        '/api/sites/' + siteId + '/global-elements/preview',
        { versionId: page, tokens, ...draft, previewContext: 'draft' },
        signal,
      )
      if (result.kind === 'aborted' || signal.aborted) return
      if (result.kind === 'ready') setHtml(result.html)
      else {
        setError(result.message)
        setHtml('')
      }
      setLoading(false)
    })
  }, [serial, siteId, retry, isolatedOrigin])
  const previewError = isolatedOrigin ? isolated.error : error,
    previewLoading = isolatedOrigin ? isolated.loading : loading
  const width = device === 'phone' ? 390 : device === 'tablet' ? 768 : 1280,
    scale = Math.min(1, available / width || 1)
  const unsaved = themeStatus.dirty || frameStatus.dirty,
    pending = themeStatus.pending || frameStatus.pending
  const affected = original
    ? frame.pages.filter(
        page =>
          (parts.footer && page.usesFooter !== false) || ((parts.header || parts.menu) && page.usesHeader !== false),
      )
    : frame.pages
  const publishLabel = original ? 'Publish menu & footer' : 'Publish site look'
  const publishAction = (original ? canFrame : canTheme) && (
    <Button
      variant="publish"
      disabled={
        unsaved || pending || !frameStatus.ready || (!original && !themeStatus.ready) || (original && !affected.length)
      }
      onClick={() => setPublishOpen(true)}
    >
      {publishLabel}
    </Button>
  )
  function choosePreset(name: string) {
    if (pending) return
    if (themeStatus.dirty && !window.confirm('Replace your unsaved colour, font and button choices with this preset?'))
      return
    const chosen = CORE_THEME_PRESETS.find(item => item.name === name)
    if (!chosen) return
    setPreset(name)
    setPresetTokens(structuredClone(chosen.theme))
    setTokens(structuredClone(chosen.theme))
    setThemeStatus({ dirty: true, pending: false, ready: false })
  }
  return (
    <div
      className={styles.workspace + ' ' + workspace.compactForm}
      data-native={!original}
      style={{ '--site-look-top': canvasTop + 'px' } as CSSProperties}
    >
      <div className={styles.toolbar}>
        <div className={workspace.toolbarField}>
          <Field id="look-page" label="Preview page" density="compact">
            <select value={page} onChange={event => setPage(event.target.value)}>
              {choices.map(page => (
                <option key={page.id} value={page.versionId}>
                  {page.title}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <SegmentedControl
          appearance="pills"
          size="s"
          label="Site preview device"
          value={device}
          onChange={setDevice}
          options={[
            { value: 'desktop', label: 'Desktop' },
            { value: 'tablet', label: 'Tablet' },
            { value: 'phone', label: 'Phone' },
          ]}
        />
        {original && publishAction}
      </div>
      <div className={styles.layout}>
        <ResizablePanel
          storageKey="cms-r8-site-look-width"
          label={original ? 'Menu & footer controls' : 'Site look controls'}
          min={320}
          max={640}
          initial={400}
          reserveSpace={240}
          edge="right"
          className={styles.controls}
        >
          {original && (
            <SegmentedControl
              label={original ? 'Menu & footer area' : 'Site look area'}
              value={tab}
              onChange={setTab}
              options={[
                ...(original ? [] : [{ value: 'theme', label: 'Style' }]),
                { value: 'header', label: 'Header & menu' },
                { value: 'footer', label: 'Footer' },
              ]}
            />
          )}
          {!original && (
            <div hidden={tab !== 'theme'} className={styles.theme}>
              <ThemeEditor
                startingControls={
                  <Card
                    title="Starts from"
                    density="editor"
                    headerActions={
                      canTheme ? (
                        <ButtonLink variant="secondary" href={'/sites/' + siteId + '/design/fonts'}>
                          Fonts
                        </ButtonLink>
                      ) : undefined
                    }
                  >
                    <Field id="look-preset" label="Theme preset">
                      <select
                        value={preset}
                        disabled={!canTheme || pending}
                        onChange={event => choosePreset(event.target.value)}
                      >
                        <option value="">Current site look</option>
                        {CORE_THEME_PRESETS.map(item => (
                          <option key={item.name} value={item.name}>
                            {item.name}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <p className={workspace.meta}>
                      Choose a starting look, then adjust this site’s own choices below. Your public site changes after
                      publication.
                    </p>
                  </Card>
                }
                commands={publishAction}
                relatedControls={
                  canTheme ? (
                    <Card title="Logo and shared parts" density="editor">
                      <p className={workspace.meta}>The logo, menu and footer have their own site screens.</p>
                      <div className={workspace.actions}>
                        <ButtonLink variant="secondary" href={'/sites/' + siteId + '/header'}>
                          Header &amp; menu
                        </ButtonLink>
                        <ButtonLink variant="secondary" href={'/sites/' + siteId + '/footer'}>
                          Footer
                        </ButtonLink>
                      </div>
                    </Card>
                  ) : undefined
                }
                presetTokens={presetTokens}
                siteId={siteId}
                siteName={siteName}
                initial={theme}
                canManage={canTheme}
                controlsOnly
                onDraftChange={changedTheme}
              />
            </div>
          )}
          {original && frame.pages[0] && (
            <div hidden={tab === 'theme'} className={styles.frame}>
              <SiteLookPanel
                pageId={frame.pages[0].id}
                part={tab === 'footer' ? 'footer' : 'header'}
                editing
                frame={frameRef}
                canvasReady={0}
                scale={scale}
                media={media}
                menuEdit={null}
                menuMove={null}
                onEdit={noop}
                onDone={noop}
                onSaved={refresh}
                registerDone={noop}
                onDraftChange={changedFrame}
              />
            </div>
          )}
        </ResizablePanel>
        <div className={styles.canvas} ref={viewport} aria-label="Real site preview">
          {!page ? (
            <EmptyState title={original ? 'No pages use this shared area' : 'Create a page to preview Site look'}>
              {original
                ? 'Open a page to edit its own menu or footer.'
                : 'Your saved site look will apply to new pages too.'}
            </EmptyState>
          ) : previewError ? (
            <div role="alert">
              <p>{previewError}</p>
              <Button variant="secondary" onClick={refresh}>
                Retry preview
              </Button>
            </div>
          ) : (
            <div className={styles.stage} style={{ width: width * scale }}>
              {isolatedOrigin ? (
                isolated.ticket && (
                  <iframe
                    ref={frameRef}
                    title="Site look page preview"
                    sandbox="allow-scripts allow-same-origin"
                    referrerPolicy="no-referrer"
                    src={isolated.ticket.href + '?visit=1#cms-preview-' + (tab === 'footer' ? 'footer' : 'header')}
                    style={{
                      width,
                      transform: 'scale(' + scale + ')',
                      height: 'calc(var(--site-look-preview-height) / ' + scale + ')',
                    }}
                  />
                )
              ) : (
                <ScriptlessPreview
                  ref={frameRef}
                  title="Site look page preview"
                  onLoad={event => showArea(event.currentTarget)}
                  srcDoc={html}
                  style={{
                    width,
                    transform: 'scale(' + scale + ')',
                    height: 'calc(var(--site-look-preview-height) / ' + scale + ')',
                  }}
                />
              )}
              {previewLoading && (
                <p className={styles.loading} role="status">
                  Updating site preview…
                </p>
              )}
            </div>
          )}
        </div>
      </div>
      {publishOpen && (
        <Dialog
          title={publishLabel}
          onClose={() => setPublishOpen(false)}
          footer={
            <>
              <Button variant="secondary" onClick={() => setPublishOpen(false)}>
                Cancel
              </Button>
              <Button variant="publish" onClick={() => router.push('/sites/' + siteId + '/publishing?area=site-look')}>
                {original ? 'Review menu & footer changes' : 'Review site look changes'}
              </Button>
            </>
          }
        >
          <p>
            {original
              ? 'The saved menu and footer changes affect these pages. Review the checks and publish them together.'
              : 'The saved colours, fonts and buttons affect these pages. Review the checks before publishing.'}
          </p>
          <ul>
            {affected.map(page => (
              <li key={page.id}>
                {page.title}
                {!page.published ? ' · draft' : ''}
              </li>
            ))}
          </ul>
        </Dialog>
      )}
    </div>
  )
}
