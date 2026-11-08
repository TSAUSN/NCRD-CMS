'use client'
import { useCallback, useEffect, useState, type CSSProperties } from 'react'
import { useRouter } from 'next/navigation'
import { ThemeTokens as ThemeValue, type NavTree, type ThemeTokens } from '@cms/schema'
import { CORE_THEME_PRESETS } from '@cms/seeds/core-themes'
import type { ThemeWorkspace, GlobalElementsWorkspace } from '../../../../lib/queries.ts'
import type { MediaAsset } from '../../../../lib/media-library.ts'
import { framePreviewAddress } from '../../../../lib/frame-preview-request.ts'
import { ThemeEditor } from './theme-editor.tsx'
import { SiteLookPanel } from '../../../../components/site-look-panel.tsx'
import { SiteLookPreviewStage } from './site-look-preview-stage.tsx'
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
import { useSiteLookPreviewStage, type SharedDraft } from './use-site-look-preview-stage.ts'
import styles from './site-look.module.css'
import workspaceFormsStyles from '../../../../components/workspace-styles/workspace-forms.module.css'
import recordTableStyles from '../../../../components/workspace-styles/record-table.module.css'

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
  const original = frame.originalDesign === true
  const router = useRouter()
  const [tab, setTab] = useState(original ? 'header' : 'theme')
  const [page, setPage] = useState(
    (original ? frame.pages.find(page => page.usesHeader !== false) : frame.pages[0])?.versionId ?? '',
  )
  const [device, setDevice] = useState('desktop')
  const [tokens, setTokens] = useState(theme.draft)
  const [draft, setDraft] = useState<SharedDraft | null>(() =>
    original ? null : { header: frame.header.draft, footer: frame.footer.draft, menu },
  )
  const [themeStatus, setThemeStatus] = useState({ dirty: false, pending: false, ready: false })
  const [frameStatus, setFrameStatus] = useState({ dirty: false, pending: false, ready: !original })
  const [parts, setParts] = useState<ChangedParts>({ header: false, footer: false, menu: false })
  const [retry, setRetry] = useState(0)
  const [publishOpen, setPublishOpen] = useState(false)
  const [preset, setPreset] = useState('')
  const [presetTokens, setPresetTokens] = useState<ThemeTokens | undefined>(undefined)
  const choices = frame.pages.filter(
    page => tab === 'theme' || (tab === 'footer' ? page.usesFooter !== false : page.usesHeader !== false),
  )
  const choiceIds = choices.map(page => page.versionId).join(',')
  useEffect(() => {
    if (!choices.some(choice => choice.versionId === page)) setPage(choices[0]?.versionId ?? '')
  }, [choiceIds, page])
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
  const refresh = useCallback(() => setRetry(value => value + 1), [])
  const noop = useCallback(() => {}, [])
  const { html, frameRef, viewport, available, canvasTop, showArea, isolated, previewError, previewLoading } =
    useSiteLookPreviewStage({
      isolatedOrigin,
      siteId,
      pageId: frame.pages.find(item => item.versionId === page)?.id ?? '',
      page,
      tokens,
      draft,
      retry,
      tab,
    })
  const width = device === 'phone' ? 390 : device === 'tablet' ? 768 : 1280
  const scale = Math.min(1, available / width || 1)
  const unsaved = themeStatus.dirty || frameStatus.dirty
  const pending = themeStatus.pending || frameStatus.pending
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
      className={styles.workspace + ' ' + workspaceFormsStyles.compactForm}
      data-native={!original}
      style={{ '--site-look-top': canvasTop + 'px' } as CSSProperties}
    >
      <div className={styles.toolbar}>
        <div className={workspaceFormsStyles.toolbarField}>
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
                    <p className={recordTableStyles.meta}>
                      Choose a starting look, then adjust this site’s own choices below. Your public site changes after
                      publication.
                    </p>
                  </Card>
                }
                commands={publishAction}
                relatedControls={
                  canTheme ? (
                    <Card title="Logo and shared parts" density="editor">
                      <p className={recordTableStyles.meta}>The logo, menu and footer have their own site screens.</p>
                      <div className={workspaceFormsStyles.actions}>
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
                // The preview already renders this draft. Saving only updates its revision.
                onSaved={noop}
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
            <SiteLookPreviewStage
              isolated={Boolean(isolatedOrigin)}
              href={
                isolated.ticket
                  ? framePreviewAddress(isolated.ticket.href, tab === 'footer' ? 'footer' : 'header')
                  : null
              }
              html={html}
              loading={previewLoading}
              width={width}
              scale={scale}
              frame={frameRef}
              showArea={showArea}
            />
          )}
        </div>
      </div>
      {publishOpen && (
        <SiteLookPublishDialog
          original={original}
          label={publishLabel}
          affected={affected}
          onClose={() => setPublishOpen(false)}
          onReview={() => router.push('/sites/' + siteId + '/publishing?area=site-look')}
        />
      )}
    </div>
  )
}

function SiteLookPublishDialog({
  original,
  label,
  affected,
  onClose,
  onReview,
}: {
  original: boolean
  label: string
  affected: GlobalElementsWorkspace['pages']
  onClose: () => void
  onReview: () => void
}) {
  return (
    <Dialog
      title={label}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="publish" onClick={onReview}>
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
  )
}
