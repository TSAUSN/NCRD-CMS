'use client'

import { Badge, Button, Card, Disclosure, Field } from '../../../../components/ui/index.ts'
import workspace from '../../../../components/workspace.module.css'
import { NATIONAL_THEME } from '@cms/seeds/core-themes'
import { ThemeFontPairings, ThemeButtonChoices } from '../../../../components/theme-choice-fields.tsx'
import styles from './theme-editor.module.css'
import { themePublishReadiness } from './theme-readiness.ts'
import settings from '../../../../components/settings-controls.module.css'
import { ScriptlessPreview } from '../../../../components/scriptless-preview.tsx'
import { useEffect, useMemo, useRef, useState, useTransition, type CSSProperties, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { DEFAULT_THEME_TOKENS, THEME_FONT_OPTIONS, ThemeTokens as ThemeValue, type ThemeTokens } from '@cms/schema'
import { checkContrast, type ContrastVerdict } from '@cms/domain'
import { IconAlert, IconCheck, IconEye, IconInfo } from '../../../../components/icons.tsx'
import { ConfirmDialog } from '../../../../components/confirm.tsx'
import { useNavigationGuard } from '../../../../components/navigation-guard.ts'
import { queueFramePreview, requestFramePreview } from '../../../../lib/frame-preview-request.ts'
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

type ThemeStyle = CSSProperties & Record<`--${string}`, string>

const clone = (tokens: ThemeTokens): ThemeTokens => structuredClone(tokens)
const serial = (tokens: ThemeTokens): string => JSON.stringify(tokens)

// One contrast policy for every colour decision point (packages/domain
// contrast.ts): the same ratio, the same rounding down for display and the
// same 4.5:1 threshold as the wizard, the inspector and publish readiness.
const verdict = (foreground: string, background: string): ContrastVerdict | null =>
  checkContrast(foreground, background)

const COLOR_CONTROLS: { key: keyof ThemeTokens['colors']; label: string; help: string }[] = [
  { key: 'primary', label: 'Primary', help: 'Header rule, focus rings and the main action colour.' },
  { key: 'primaryContrast', label: 'On primary', help: 'Text and icons shown on the primary colour.' },
  { key: 'accent', label: 'Accent', help: 'A second action or emphasis colour.' },
  { key: 'accentContrast', label: 'On accent', help: 'Text and icons shown on the accent colour.' },
  { key: 'surface', label: 'Page', help: 'The main page and navigation background.' },
  { key: 'surfaceAlt', label: 'Soft surface', help: 'Cards and quiet bands that need separation.' },
  { key: 'ink', label: 'Text', help: 'Headings and body copy on the main page colour.' },
  { key: 'muted', label: 'Muted text', help: 'Supporting copy, labels and less prominent details.' },
]

function verdictFor(
  key: keyof ThemeTokens['colors'],
  colors: ThemeTokens['colors'],
): ContrastVerdict | null | undefined {
  if (key === 'ink') return verdict(colors.ink, colors.surface)
  if (key === 'primaryContrast') return verdict(colors.primaryContrast, colors.primary)
  if (key === 'accentContrast') return verdict(colors.accentContrast, colors.accent)
  return undefined
}

export function ThemeEditor({
  siteId,
  siteName,
  initial,
  canManage,
  controlsOnly = false,
  onDraftChange,
  presetTokens,
  commands,
  relatedControls,
  startingControls,
}: {
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
}) {
  const router = useRouter()
  const [tokens, setTokens] = useState<ThemeTokens>(() => clone(initial.draft))
  const [published, setPublished] = useState<ThemeTokens>(() => clone(initial.published))
  const [saved, setSaved] = useState(serial(initial.draft))
  const [revision, setRevision] = useState(initial.revision)
  const [notice, setNotice] = useState<ActionResult | null>(null)
  const [confirming, setConfirming] = useState<'publish' | 'revert' | 'defaults' | null>(null)
  const [previewVersion, setPreviewVersion] = useState(initial.previewPages[0]?.versionId ?? '')
  const [previewWidth, setPreviewWidth] = useState<'desktop' | 'tablet' | 'phone'>('desktop')
  const [previewHtml, setPreviewHtml] = useState('')
  const [previewError, setPreviewError] = useState('')
  const [previewAttempt, setPreviewAttempt] = useState(0)
  const [previewLoading, setPreviewLoading] = useState(initial.previewPages.length > 0)
  const [pending, startTransition] = useTransition()
  const actionInFlight = useRef(false)
  const [advancedColours, setAdvancedColours] = useState(false)

  useEffect(() => {
    setTokens(clone(initial.draft))
    setPublished(clone(initial.published))
    setSaved(serial(initial.draft))
    setRevision(initial.revision)
  }, [initial.revision, initial.draftVersionId, initial.publishedVersionId])

  useEffect(() => {
    if (presetTokens) setTokens(clone(presetTokens))
  }, [presetTokens])
  const valid = ThemeValue.safeParse(tokens).success
  const dirty = serial(tokens) !== saved
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
  const draftIsLive = hasLiveVersion && serial(tokens) === serial(published) && !dirty
  const contrastChecks = useMemo(
    () => [
      { name: 'Body text', verdict: verdict(tokens.colors.ink, tokens.colors.surface) },
      { name: 'Primary button', verdict: verdict(tokens.colors.primaryContrast, tokens.colors.primary) },
      { name: 'Accent button', verdict: verdict(tokens.colors.accentContrast, tokens.colors.accent) },
    ],
    [tokens.colors],
  )
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
  }, [serial(tokens), dirty, pending, valid, contrastReady, onDraftChange])

  useEffect(() => {
    if (controlsOnly || !previewVersion) return
    setPreviewHtml('')
    setPreviewError('')
    if (!Object.values(tokens.colors).every(value => /^#[0-9a-f]{6}$/i.test(value))) {
      setPreviewLoading(false)
      setPreviewError('Enter complete six-digit colours to preview this design.')
      return
    }
    setPreviewLoading(true)
    return queueFramePreview(async signal => {
      const result = await requestFramePreview(
        `/api/sites/${siteId}/design/preview`,
        { versionId: previewVersion, tokens },
        signal,
      )
      if (signal.aborted || result.kind === 'aborted') return
      if (result.kind === 'ready') setPreviewHtml(result.html)
      else setPreviewError(result.message)
      setPreviewLoading(false)
    })
  }, [previewVersion, serial(tokens), siteId, previewAttempt])

  function setColor(key: keyof ThemeTokens['colors'], value: string) {
    setTokens(current => ({ ...current, colors: { ...current.colors, [key]: value } }))
  }

  async function saveBeforeLeaving(): Promise<{ ok: boolean; message?: string }> {
    if (actionInFlight.current) return { ok: false, message: 'Wait for the current design action to finish.' }
    if (!canManage) return { ok: false, message: 'A site administrator can save this design.' }
    if (!valid) return { ok: false, message: 'Check the colour and font choices before saving.' }
    actionInFlight.current = true
    setNotice(null)
    const snapshot = clone(tokens),
      data = new FormData()
    data.set('siteId', siteId)
    data.set('revision', String(revision))
    data.set('tokens', JSON.stringify(snapshot))
    try {
      const result = await saveThemeDraft(data)
      setNotice(result)
      if (!result.ok) return { ok: false, message: result.message }
      setRevision(result.revision)
      setSaved(serial(snapshot))
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
    const snapshot = clone(tokens)
    const data = new FormData()
    data.set('siteId', siteId)
    data.set('revision', String(revision))
    data.set('tokens', JSON.stringify(snapshot))
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
          if (kind === 'save') setSaved(serial(snapshot))
          else if (kind === 'publish') {
            setPublished(snapshot)
            router.refresh()
          } else {
            setTokens(clone(published))
            setSaved(serial(published))
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

  const chosenButtonColor = tokens.buttons.color === 'accent' ? tokens.colors.accent : tokens.colors.primary
  const chosenButtonInk =
    tokens.buttons.color === 'accent' ? tokens.colors.accentContrast : tokens.colors.primaryContrast
  const previewStyle: ThemeStyle = {
    '--theme-primary': tokens.colors.primary,
    '--theme-accent': tokens.colors.accent,
    '--theme-surface': tokens.colors.surface,
    '--theme-surface-alt': tokens.colors.surfaceAlt,
    '--theme-ink': tokens.colors.ink,
    '--theme-muted': tokens.colors.muted,
    '--theme-button': chosenButtonColor,
    '--theme-button-ink': chosenButtonInk,
    '--theme-radius': tokens.radius,
    '--theme-button-radius': tokens.buttons.radius,
    '--theme-heading': tokens.fonts.heading,
    '--theme-body': tokens.fonts.body,
    '--theme-density': tokens.spacing === 'compact' ? '.82' : tokens.spacing === 'spacious' ? '1.18' : '1',
    '--theme-speed': tokens.buttons.speed === 'fast' ? '100ms' : tokens.buttons.speed === 'slow' ? '300ms' : '180ms',
  }

  return (
    <div className={`theme-workspace ${settings.controls} ${controlsOnly ? styles.embedded : ''}`}>
      {!canManage && !controlsOnly && (
        <p className="notice" role="note">
          <IconEye size={16} />
          <span className="notice-body">You can inspect this design. A site administrator can change it.</span>
        </p>
      )}
      {notice && !controlsOnly && (
        <p className={`notice ${notice.ok ? 'notice-ok' : 'notice-error'}`} role={notice.ok ? 'status' : 'alert'}>
          {notice.ok ? <IconCheck size={16} /> : <IconAlert size={16} />}
          <span className="notice-body">{notice.message}</span>
          {!notice.ok && notice.kind === 'conflict' && (
            <button type="button" className="small secondary" onClick={() => window.location.reload()}>
              Reload
            </button>
          )}
        </p>
      )}

      <section className="theme-commandbar" aria-label="Design publishing status">
        <div>
          <span className={`nav-live-dot ${draftIsLive ? 'is-live' : ''}`} aria-hidden="true" />
          <span>
            <strong>
              {!hasLiveVersion
                ? 'Not published yet'
                : draftIsLive
                  ? 'Matches the live site'
                  : 'Saved changes are not live yet'}
            </strong>
            <small role={!dirty && notice?.ok ? 'status' : undefined}>
              {!dirty && notice?.ok
                ? notice.message
                : dirty
                  ? 'Save the draft before publishing.'
                  : 'Your changes are saved.'}
            </small>
          </span>
        </div>
        {controlsOnly && notice && !notice.ok && (
          <p role="alert" className={styles.fieldError}>
            {notice.message}
            {notice.kind === 'conflict' && (
              <Button variant="secondary" onClick={() => window.location.reload()}>
                Reload
              </Button>
            )}
          </p>
        )}
        {valid && !contrastReady && (
          <p role="alert" className={styles.fieldError}>
            Improve colour contrast before publishing. Check the marked colours above.
          </p>
        )}
        {!valid && (
          <p id="theme-colour-error" role="alert" className={styles.fieldError}>
            Enter complete six-digit colours before saving.
          </p>
        )}
        {canManage && (
          <div className="actions">
            <Button
              variant="secondary"
              disabled={!hasLiveVersion || dirty || draftIsLive || pending}
              onClick={() => setConfirming('revert')}
            >
              Revert to live
            </Button>
            <Button
              variant="secondary"
              disabled={!dirty || pending || !valid}
              loading={pending}
              onClick={() => act('save')}
            >
              Save draft
            </Button>
            {controlsOnly && commands}
            {!controlsOnly && (
              <Button
                variant="publish"
                disabled={dirty || draftIsLive || pending || !contrastReady}
                onClick={() => setConfirming('publish')}
              >
                Publish design
              </Button>
            )}
          </div>
        )}
      </section>

      <div className="theme-grid">
        {!canManage && controlsOnly && (
          <p className="notice" role="note">
            <IconEye size={16} />
            <span className="notice-body">You can inspect this design. A site administrator can change it.</span>
          </p>
        )}
        <fieldset
          className="theme-controls"
          disabled={pending || !canManage}
          aria-busy={pending}
          style={{ border: 0, margin: 0, padding: 0, minWidth: 0 }}
        >
          {controlsOnly && startingControls}
          <Card
            title="Colours"
            id="theme-colours-title"
            density="editor"
            headerActions={
              controlsOnly ? (
                <Button
                  variant="tertiary"
                  size="compact"
                  aria-expanded={advancedColours}
                  onClick={() => setAdvancedColours(value => !value)}
                >
                  Advanced colours
                </Button>
              ) : undefined
            }
          >
            <div className={workspace.formStack}>
              {COLOR_CONTROLS.map(control => {
                const pair = controlsOnly
                  ? control.key === 'primary'
                    ? verdict(tokens.colors.primaryContrast, tokens.colors.primary)
                    : control.key === 'accent'
                      ? verdict(tokens.colors.accentContrast, tokens.colors.accent)
                      : ['ink', 'surface'].includes(control.key)
                        ? verdict(tokens.colors.ink, tokens.colors.surface)
                        : verdictFor(control.key, tokens.colors)
                  : verdictFor(control.key, tokens.colors)
                const label = controlsOnly
                  ? (({ primary: 'Brand', accent: 'Accent', ink: 'Dark', surface: 'Light' } as Record<string, string>)[
                      control.key
                    ] ?? control.label)
                  : control.label
                const uses = initial.usage[control.key] ?? 0,
                  approvedPair = approvedPrimary && ['primary', 'primaryContrast'].includes(control.key)
                return (
                  <div
                    className={workspace.colourRole}
                    data-compact={(controlsOnly && !advancedColours) || undefined}
                    key={control.key}
                    hidden={
                      controlsOnly && !advancedColours && !['primary', 'accent', 'ink', 'surface'].includes(control.key)
                    }
                  >
                    <label htmlFor={`theme-${control.key}`}>{label}</label>
                    <div className={workspace.colourInputs}>
                      <input
                        type="color"
                        aria-label={`${label} colour picker`}
                        value={tokens.colors[control.key]}
                        disabled={!canManage}
                        onChange={event => setColor(control.key, event.target.value)}
                      />
                      <input
                        id={`theme-${control.key}`}
                        value={tokens.colors[control.key]}
                        maxLength={7}
                        aria-invalid={!/^#[0-9a-f]{6}$/i.test(tokens.colors[control.key]) || undefined}
                        aria-describedby={
                          !/^#[0-9a-f]{6}$/i.test(tokens.colors[control.key]) ? 'theme-colour-error' : undefined
                        }
                        disabled={!canManage}
                        spellCheck={false}
                        onChange={event => setColor(control.key, event.target.value)}
                      />
                    </div>
                    {(!controlsOnly || advancedColours) && <p className="hint">{control.help}</p>}
                    {(!controlsOnly || advancedColours) && (
                      <small>
                        {['primary', 'surface', 'ink'].includes(control.key)
                          ? `Used by the site shell${uses > 0 ? ` and ${uses} ${uses === 1 ? 'page' : 'pages'}` : ''}.`
                          : uses > 0
                            ? `Used on ${uses} ${uses === 1 ? 'page' : 'pages'}.`
                            : 'Available to sections that opt into this role.'}
                      </small>
                    )}
                    <div className={workspace.colourMeta}>
                      {pair !== undefined && (
                        <Badge
                          tone={approvedPair ? 'neutral' : pair?.passesAA ? 'live' : 'error'}
                          title={
                            approvedPair ? 'The approved national red and white pair does not meet 4.5:1.' : undefined
                          }
                        >
                          {pair
                            ? `${pair.display} ${approvedPair ? 'Approved pair' : pair.passesAA ? 'AA' : 'Needs 4.5:1'}`
                            : 'Not a colour yet'}
                        </Badge>
                      )}
                      {canManage && tokens.colors[control.key] !== DEFAULT_THEME_TOKENS.colors[control.key] && (
                        <Button
                          variant="tertiary"
                          size="compact"
                          onClick={() => setColor(control.key, DEFAULT_THEME_TOKENS.colors[control.key])}
                        >
                          Reset {label.toLowerCase()}
                        </Button>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
            {approvedPrimary && (
              <p role="note" className="hint">
                The national template keeps the approved red and white button colours.
              </p>
            )}
          </Card>

          <Card title="Type pairing" id="theme-type-title" density="editor">
            <p className="hint">Choose a heading and body pairing. The specimens use fonts included with your site.</p>
            <ThemeFontPairings tokens={tokens} disabled={pending || !canManage} onChange={setTokens} />
            <Disclosure title="More font choices">
              <div className={workspace.formStack}>
                <Field id="theme-heading-font" label="Headings">
                  <select
                    id="theme-heading-font"
                    value={tokens.fonts.heading}
                    disabled={!canManage}
                    onChange={event =>
                      setTokens(current => ({
                        ...current,
                        fonts: { ...current.fonts, heading: event.target.value as ThemeTokens['fonts']['heading'] },
                      }))
                    }
                  >
                    {THEME_FONT_OPTIONS.map(font => (
                      <option value={font.value} key={font.value}>
                        {font.label}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field id="theme-body-font" label="Body copy">
                  <select
                    id="theme-body-font"
                    value={tokens.fonts.body}
                    disabled={!canManage}
                    onChange={event =>
                      setTokens(current => ({
                        ...current,
                        fonts: { ...current.fonts, body: event.target.value as ThemeTokens['fonts']['body'] },
                      }))
                    }
                  >
                    {THEME_FONT_OPTIONS.map(font => (
                      <option value={font.value} key={font.value}>
                        {font.label}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
            </Disclosure>
          </Card>

          <Card title="Buttons and links" id="theme-button-title" density="editor">
            <p className="hint">One button style for the whole site.</p>
            <ThemeButtonChoices tokens={tokens} disabled={pending || !canManage} onChange={setTokens} />
            <Disclosure title="More button options">
              <div className={workspace.formStack}>
                <ThemeSelect
                  label="Colour"
                  value={tokens.buttons.color}
                  disabled={!canManage}
                  options={[
                    ['primary', 'Primary'],
                    ['accent', 'Accent'],
                  ]}
                  onChange={color =>
                    setTokens(current => ({
                      ...current,
                      buttons: { ...current.buttons, color: color as ThemeTokens['buttons']['color'] },
                    }))
                  }
                />
                <ThemeSelect
                  label="Label"
                  value={tokens.buttons.weight}
                  disabled={!canManage}
                  options={[
                    ['regular', 'Regular'],
                    ['bold', 'Bold'],
                  ]}
                  onChange={weight =>
                    setTokens(current => ({
                      ...current,
                      buttons: { ...current.buttons, weight: weight as ThemeTokens['buttons']['weight'] },
                    }))
                  }
                />
                <ThemeSelect
                  label="Hover speed"
                  value={tokens.buttons.speed}
                  disabled={!canManage}
                  options={[
                    ['fast', 'Fast'],
                    ['normal', 'Normal'],
                    ['slow', 'Slow'],
                  ]}
                  onChange={speed =>
                    setTokens(current => ({
                      ...current,
                      buttons: { ...current.buttons, speed: speed as ThemeTokens['buttons']['speed'] },
                    }))
                  }
                />
              </div>
            </Disclosure>
          </Card>

          <Card title="Site density" id="theme-rhythm-title" density="editor">
            <p className="hint">How roomy sections feel across the whole site.</p>
            <div className={workspace.formStack}>
              <ThemeSelect
                label="Spacing"
                value={tokens.spacing}
                disabled={!canManage}
                options={[
                  ['compact', 'Compact'],
                  ['comfortable', 'Comfortable'],
                  ['spacious', 'Spacious'],
                ]}
                onChange={spacing => setTokens(current => ({ ...current, spacing: spacing as ThemeTokens['spacing'] }))}
              />
              <ThemeSelect
                label="Card corners"
                value={tokens.radius}
                disabled={!canManage}
                options={[
                  ['0rem', 'Square'],
                  ['0.25rem', 'Soft'],
                  ['0.5rem', 'Rounded'],
                  ['0.75rem', 'Rounder'],
                  ['1rem', 'Pill'],
                  ['1.25rem', 'National rounded'],
                ]}
                onChange={radius => setTokens(current => ({ ...current, radius: radius as ThemeTokens['radius'] }))}
              />
              {!tokens.presentation?.template && (
                <ThemeSelect
                  label="Page layout"
                  value={tokens.presentation?.kind ?? 'standard'}
                  disabled={!canManage}
                  options={[
                    ['standard', 'Standard'],
                    ['panels', 'Rounded panels'],
                  ]}
                  onChange={kind =>
                    setTokens(current => {
                      const { presentation, ...rest } = current
                      return kind === 'panels'
                        ? {
                            ...rest,
                            presentation: {
                              kind: 'panels',
                              canvas: presentation?.canvas ?? NATIONAL_THEME.presentation!.canvas,
                            },
                          }
                        : rest
                    })
                  }
                />
              )}
              {tokens.presentation?.template && <p role="note">The national template sets the page layout.</p>}
            </div>
            {canManage && (
              <div className="theme-defaults-action">
                <Button
                  variant="secondary"
                  disabled={serial(tokens) === serial(DEFAULT_THEME_TOKENS)}
                  onClick={() => setConfirming('defaults')}
                >
                  Use the standard Salvation Army starting design
                </Button>
                <small>This changes the local draft only. Review it, then save.</small>
              </div>
            )}
          </Card>
          {controlsOnly && relatedControls}
        </fieldset>

        {!controlsOnly && (
          <aside className="theme-preview" style={previewStyle} aria-labelledby="theme-preview-title">
            <div className="theme-preview-head">
              <div>
                <p className="eyebrow">Live draft preview</p>
                <h2 id="theme-preview-title">Preview</h2>
              </div>
              <span>
                <IconEye size={14} /> Actual page
              </span>
            </div>
            {initial.previewPages.length > 0 ? (
              <>
                <div className="theme-preview-toolbar">
                  <label htmlFor="theme-preview-page">Page</label>
                  <select
                    id="theme-preview-page"
                    value={previewVersion}
                    onChange={event => setPreviewVersion(event.target.value)}
                  >
                    {initial.previewPages.map(page => (
                      <option key={page.versionId} value={page.versionId}>
                        {page.title}
                      </option>
                    ))}
                  </select>
                  <div className="theme-preview-widths" aria-label="Public preview width">
                    {(['desktop', 'tablet', 'phone'] as const).map(width => (
                      <button
                        type="button"
                        key={width}
                        className={previewWidth === width ? 'on' : ''}
                        aria-pressed={previewWidth === width}
                        onClick={() => setPreviewWidth(width)}
                      >
                        {width[0]!.toUpperCase() + width.slice(1)}
                      </button>
                    ))}
                  </div>
                </div>
                <div className={`theme-real-preview is-${previewWidth} ${previewLoading ? 'is-loading' : ''}`}>
                  {previewError ? (
                    <div className="notice notice-error" role="alert">
                      <span>{previewError}</span>
                      <button
                        type="button"
                        className="small secondary"
                        onClick={() => setPreviewAttempt(value => value + 1)}
                      >
                        Retry preview
                      </button>
                    </div>
                  ) : (
                    previewHtml && <ScriptlessPreview title="Draft theme page preview" srcDoc={previewHtml} />
                  )}
                  {previewLoading && <span role="status">Updating the page preview…</span>}
                </div>
              </>
            ) : (
              <div className="theme-preview-page">
                <header>
                  <strong>{siteName}</strong>
                  <nav aria-label="Example site navigation">
                    <a href="#preview">About</a>
                    <a href="#preview">Resources</a>
                  </nav>
                </header>
                <main id="preview">
                  <p className="theme-preview-kicker">A shared visual language</p>
                  <h3>Make every page feel like the same site.</h3>
                  <p>
                    Editors choose meaningful content. The design system keeps colour, type, spacing and actions
                    consistent.
                  </p>
                  <div className="theme-preview-actions">
                    <a
                      href="#preview"
                      className="theme-preview-button"
                      data-style={tokens.buttons.style}
                      data-hover={tokens.buttons.hover}
                    >
                      Primary action
                    </a>
                    <a href="#preview" className="theme-preview-link">
                      Supporting link
                    </a>
                  </div>
                  <article>
                    <strong>Reusable card</strong>
                    <p>This soft surface and muted copy show the secondary roles.</p>
                  </article>
                </main>
              </div>
            )}
            <div className={`theme-readiness ${contrastReady ? 'ready' : 'blocked'}`}>
              {contrastReady ? <IconCheck size={16} /> : <IconAlert size={16} />}
              <div>
                <strong>{contrastReady ? 'Contrast is ready to publish' : 'Contrast needs attention'}</strong>
                <ul>
                  {contrastChecks.map(check => (
                    <li key={check.name}>
                      {check.name}: {check.verdict?.display ?? 'not a colour yet'}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
            <p className="theme-preview-note">
              <IconInfo size={14} /> This is the selected page rendered through the public renderer with the private
              draft theme substituted. Visitors keep the published theme until you publish.
            </p>
          </aside>
        )}
      </div>

      {confirming === 'publish' && (
        <ConfirmDialog
          tone="primary"
          title="Publish this site design?"
          what="Every published page on this site will begin using these colours, fonts, spacing and button styles."
          reassurance="Page content and navigation are not changed. The current live design remains in version history."
          confirmLabel="Publish design"
          pending={pending}
          onCancel={() => {
            if (!actionInFlight.current) setConfirming(null)
          }}
          onConfirm={() => act('publish')}
        />
      )}
      {confirming === 'revert' && (
        <ConfirmDialog
          title="Revert the design draft to live?"
          what="A new saved draft will be created from the design visitors see now."
          reassurance="The live site will not change, and the discarded draft remains in immutable history."
          confirmLabel="Revert draft"
          pending={pending}
          onCancel={() => {
            if (!actionInFlight.current) setConfirming(null)
          }}
          onConfirm={() => act('revert')}
        />
      )}
      {confirming === 'defaults' && (
        <ConfirmDialog
          title="Use the standard starting design?"
          what="All colour, type, spacing and button controls in this unsaved draft will return to the standard starting values."
          reassurance="Nothing live changes until you save and publish. Reloading before save restores the current saved draft."
          confirmLabel="Use starting design"
          onCancel={() => setConfirming(null)}
          onConfirm={() => {
            setTokens(clone(DEFAULT_THEME_TOKENS as ThemeTokens))
            setConfirming(null)
          }}
        />
      )}
    </div>
  )
}

function ThemeSelect({
  label,
  value,
  options,
  disabled,
  onChange,
}: {
  label: string
  value: string
  options: readonly (readonly [string, string])[]
  disabled: boolean
  onChange: (value: string) => void
}) {
  const id = `theme-${label.toLowerCase().replace(/\s+/g, '-')}`
  return (
    <Field id={id} label={label}>
      <select id={id} value={value} disabled={disabled} onChange={event => onChange(event.target.value)}>
        {options.map(([option, name]) => (
          <option key={option} value={option}>
            {name}
          </option>
        ))}
      </select>
    </Field>
  )
}
