'use client'

import { SectionSaved } from '../../../../components/section-saved.tsx'
import { useNavigationGuard } from '../../../../components/navigation-guard.ts'
import { ScriptlessPreview } from '../../../../components/scriptless-preview.tsx'

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { StructuredDocument } from '@cms/schema'
import type { AuthoringRights } from '../../../../lib/queries.ts'
import type { DefinitionSource } from '../../../../lib/definition-source.ts'
import { visualSourceCss } from '../../../../lib/visual-authoring.ts'
import { BUILDER_CSS, includeNewBlockStyles, newStructuredSection } from '../../../../lib/structured-builder.ts'
import { StructuredBuilder } from '../../../../components/structured-builder.tsx'
import { PageHeader } from '../../../../components/shell.tsx'
import {
  compileSectionDraft,
  saveSectionDefinition,
  type SectionCompileReport,
  type SectionDraft,
} from '../../../actions/section-definitions.ts'
import { SectionCreator } from './new/creator.tsx'
import { sitePreviewPhrase, type SitePreviewContext } from '../../../../lib/preview-context.ts'

export function SectionAuthor({
  siteId,
  siteName,
  rights,
  initial,
}: {
  siteId: string
  siteName: string
  rights: AuthoringRights
  initial?: DefinitionSource
}) {
  const [previewContext, setPreviewContext] = useState<SitePreviewContext>('published')
  const [mode, setMode] = useState<'structured' | 'legacy'>(initial?.kind ?? 'structured')
  const [busy, setBusy] = useState(false)
  if (initial && !rights.global && (initial.kind !== 'structured' || initial.placement !== 'page'))
    return (
      <div className="empty-state">
        <h2>This section uses advanced source</h2>
        <p>A super admin can revise this definition. Its current version remains available for page editing.</p>
      </div>
    )
  // As in V1's creator (reference 20) the page names the task first; the
  // choice of tool follows it as one control, and the preview's appearance
  // sits with the preview it changes. Only the visible tool renders them.
  const modeSwitch =
    !initial && rights.global ? (
      <div className="creator-mode">
        <div className="group" role="group" aria-label="Section authoring mode">
          <button
            type="button"
            disabled={busy}
            aria-pressed={mode === 'structured'}
            onClick={() => setMode('structured')}
          >
            Visual builder
          </button>
          <button type="button" disabled={busy} aria-pressed={mode === 'legacy'} onClick={() => setMode('legacy')}>
            HTML template
          </button>
        </div>
        <p className="hint">Each tool keeps a separate draft while you switch.</p>
      </div>
    ) : null
  const appearance = (
    <div className="field creator-appearance">
      <label htmlFor="creator-preview-context">Preview appearance</label>
      <select
        id="creator-preview-context"
        value={previewContext}
        disabled={busy}
        onChange={event => setPreviewContext(event.target.value as SitePreviewContext)}
      >
        <option value="published">Published site settings</option>
        <option value="draft">Saved site drafts</option>
      </select>
      <p className="hint">
        {previewContext === 'draft'
          ? 'Saved header, footer, navigation and design; unsaved changes are excluded.'
          : 'The site settings currently published.'}
      </p>
    </div>
  )
  return (
    <>
      {/* Keep both drafts mounted: switching tools must not discard authored work. */}
      <div hidden={mode !== 'structured'}>
        <VisualSectionCreator
          siteId={siteId}
          siteName={siteName}
          rights={rights}
          onBusy={setBusy}
          previewContext={previewContext}
          modeSwitch={mode === 'structured' ? modeSwitch : null}
          appearance={mode === 'structured' ? appearance : null}
          {...(initial?.kind === 'structured' ? { initial } : {})}
        />
      </div>
      {rights.global && (
        <div hidden={mode !== 'legacy'}>
          <SectionCreator
            siteId={siteId}
            siteName={siteName}
            rights={rights}
            onBusy={setBusy}
            previewContext={previewContext}
            modeSwitch={mode === 'legacy' ? modeSwitch : null}
            appearance={mode === 'legacy' ? appearance : null}
            {...(initial?.kind === 'legacy' ? { initial } : {})}
          />
        </div>
      )}
    </>
  )
}

function VisualSectionCreator({
  siteId,
  siteName,
  rights,
  initial,
  onBusy,
  previewContext,
  modeSwitch,
  appearance,
}: {
  siteId: string
  siteName: string
  rights: AuthoringRights
  initial?: DefinitionSource
  previewContext: SitePreviewContext
  onBusy: (busy: boolean) => void
  modeSwitch: ReactNode
  appearance: ReactNode
}) {
  const [name, setName] = useState(initial?.name ?? '')
  const [slug, setSlug] = useState(initial?.slug ?? '')
  const [touchedSlug, setTouchedSlug] = useState(initial !== undefined)
  const [category, setCategory] = useState(initial?.category ?? 'Content')
  const [previewWidth, setPreviewWidth] = useState(768)
  const [document, setDocument] = useState(() => initial?.structuredDoc ?? newStructuredSection())
  const [css, setCss] = useState(initial?.sourceCss ?? BUILDER_CSS)
  const [placement, setPlacement] = useState<'page' | 'header' | 'footer'>(initial?.placement ?? 'page')
  const [scope, setScope] = useState<'site' | 'global'>(initial?.scope ?? 'site')
  const [changelog, setChangelog] = useState('')
  const [report, setReport] = useState<SectionCompileReport | null>(null)
  const [previewed, setPreviewed] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const inFlight = useRef(false)
  const structureFile = useRef<HTMLInputElement>(null)
  const effectiveSlug = touchedSlug
    ? slug
    : name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 64)
        .replace(/-$/, '')
  const draft: SectionDraft = {
    name,
    slug: effectiveSlug,
    category,
    sourceHtml: '',
    sourceCss: css,
    slots: [],
    scope,
    siteId,
    previewContext,
    placement,
    definitionKind: 'structured',
    structuredDoc: document,
    changelog,
    expectedVersion: initial?.version ?? 0,
    ...(initial ? { definitionId: initial.id } : {}),
  }
  const fingerprint = JSON.stringify({ ...draft, changelog: '' })
  const currentPreview = report?.ok && previewed === fingerprint
  const fields = { name, slug, touchedSlug, category, document, css, placement, scope, changelog },
    signature = JSON.stringify(fields),
    opening = useRef(fields),
    openingSignature = useRef(signature),
    dirty = saved === null && signature !== openingSignature.current
  function discard() {
    const value = opening.current
    setName(value.name)
    setSlug(value.slug)
    setTouchedSlug(value.touchedSlug)
    setCategory(value.category)
    setDocument(value.document)
    setCss(value.css)
    setPlacement(value.placement)
    setScope(value.scope)
    setChangelog(value.changelog)
    setReport(null)
    setPreviewed(null)
    setError(null)
  }
  useNavigationGuard(() => ({
    dirty,
    pending: busy || inFlight.current,
    draft: {
      label: 'Visual section' + (name.trim() ? ' “' + name.trim() + '”' : ''),
      saveDraft: () => run(true),
      discard,
    },
  }))
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (dirty || busy || inFlight.current) event.preventDefault()
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty, busy])

  async function run(save: boolean) {
    if (inFlight.current) return { ok: false, message: 'Wait for the current section action to finish.' }
    if (save && (!currentPreview || !name.trim()))
      return { ok: false, message: 'Name the section, then use Check and preview before saving and leaving.' }
    if (save && !changelog.trim()) return { ok: false, message: 'Describe what changed before saving and leaving.' }
    inFlight.current = true
    setBusy(true)
    onBusy(true)
    setError(null)
    try {
      if (save) {
        const result = await saveSectionDefinition(draft)
        if (result.ok) setSaved(result.message)
        else setError(result.message)
        return { ok: result.ok, message: result.message }
      } else {
        const result = await compileSectionDraft(draft)
        setReport(result)
        setPreviewed(result.ok ? fingerprint : null)
        return { ok: result.ok, message: result.blocking.join(' ') }
      }
    } catch {
      const message = 'This request could not be completed. Your section is still here; check Sections before retrying.'
      setError(message)
      return { ok: false, message }
    } finally {
      inFlight.current = false
      setBusy(false)
      onBusy(false)
    }
  }
  async function loadStructure(file: File | undefined) {
    if (!file || inFlight.current) return
    if (file.size > 300_000) {
      setError('The structure file must be smaller than 300 KB.')
      return
    }
    inFlight.current = true
    setBusy(true)
    onBusy(true)
    try {
      const parsed = StructuredDocument.safeParse(JSON.parse(await file.text()))
      if (!parsed.success) {
        setError(parsed.error.issues[0]?.message ?? 'Unsupported section structure.')
        return
      }
      setCss(current => includeNewBlockStyles(document, parsed.data, current))
      setDocument(parsed.data)
      setError(null)
    } catch {
      setError('The structure file is not valid JSON.')
    } finally {
      inFlight.current = false
      setBusy(false)
      onBusy(false)
    }
  }
  function downloadStructure() {
    const url = URL.createObjectURL(new Blob([JSON.stringify(document, null, 2)], { type: 'application/json' }))
    const anchor = window.document.createElement('a')
    anchor.href = url
    anchor.download = `${effectiveSlug || 'section'}-structure.json`
    anchor.click()
    setTimeout(() => URL.revokeObjectURL(url), 0)
  }
  if (saved)
    return (
      <SectionSaved
        siteId={siteId}
        siteName={siteName}
        definitionId={initial?.id}
        placement={placement}
        message={saved}
      />
    )

  return (
    <>
      <PageHeader
        title={initial ? `Edit ${initial.name}` : 'Create a section'}
        crumbs={[
          { label: 'All sites', href: '/' },
          { label: siteName, href: `/sites/${siteId}` },
          { label: 'Sections', href: `/sites/${siteId}/sections` },
          { label: initial ? initial.name : 'New section' },
        ]}
        lede={
          initial
            ? `Editing version ${initial.version}. Saving creates a new version; existing pages stay unchanged.`
            : 'Arrange editable blocks, check the real preview, and make the section available to your site.'
        }
      />
      {modeSwitch}
      {error && (
        <p className="notice notice-error" role="alert">
          {error}
        </p>
      )}
      <div className="creator">
        <div>
          <section className="card">
            <div className="field">
              <label htmlFor="visual-section-name">Section name</label>
              <input
                id="visual-section-name"
                value={name}
                maxLength={200}
                disabled={busy}
                onChange={event => setName(event.target.value)}
              />
            </div>
            <div className="row2">
              <div className="field">
                <label htmlFor="visual-section-slug">Short name</label>
                <input
                  id="visual-section-slug"
                  value={effectiveSlug}
                  maxLength={64}
                  disabled={busy || !!initial}
                  onChange={event => {
                    setTouchedSlug(true)
                    setSlug(event.target.value)
                  }}
                />
              </div>
              <div className="field">
                <label htmlFor="visual-section-category">Category</label>
                <input
                  id="visual-section-category"
                  value={category}
                  disabled={busy}
                  onChange={event => setCategory(event.target.value)}
                />
              </div>
            </div>
            {rights.global && (
              <div className="field">
                <label htmlFor="visual-section-placement">Used as</label>
                <select
                  id="visual-section-placement"
                  value={placement}
                  disabled={busy}
                  onChange={event => setPlacement(event.target.value as 'page' | 'header' | 'footer')}
                >
                  <option value="page">Page section</option>
                  <option value="header">Site header</option>
                  <option value="footer">Site footer</option>
                </select>
                <p className="hint">
                  Headers and footers are edited and published in Header &amp; footer. Placement can change only before
                  the component is in use.
                </p>
              </div>
            )}
            <div className="field">
              <label htmlFor="visual-section-scope">Who can use this section?</label>
              <select
                id="visual-section-scope"
                value={scope}
                disabled={busy || !!initial}
                onChange={event => setScope(event.target.value as 'site' | 'global')}
              >
                <option value="site" disabled={!rights.site}>
                  Only {siteName}
                </option>
                <option value="global" disabled={!rights.global}>
                  Every site
                </option>
              </select>
            </div>
          </section>
          <section className="card">
            <h2>Structure</h2>
            <StructuredBuilder
              document={document}
              onChange={next => {
                setCss(current =>
                  rights.global
                    ? includeNewBlockStyles(document, next, current)
                    : visualSourceCss(next, initial?.sourceCss),
                )
                setDocument(next)
              }}
              disabled={busy}
            />
          </section>
          {rights.global && (
            <details className="card">
              <summary>Advanced structure and styling</summary>
              <div className="field">
                <label htmlFor="visual-section-css">Section CSS</label>
                <textarea
                  id="visual-section-css"
                  className="code"
                  value={css}
                  disabled={busy}
                  onChange={event => setCss(event.target.value)}
                />
              </div>
              <button type="button" className="secondary small" disabled={busy} onClick={downloadStructure}>
                Save structure JSON
              </button>{' '}
              <button
                type="button"
                className="secondary small"
                disabled={busy}
                onClick={() => structureFile.current?.click()}
              >
                Load structure JSON
              </button>
              <input
                type="file"
                hidden
                ref={structureFile}
                accept="application/json,.json"
                onChange={event => {
                  const file = event.target.files?.[0]
                  event.target.value = ''
                  void loadStructure(file)
                }}
              />
            </details>
          )}
          {!rights.global && (
            <p className="hint">
              Visual changes preserve the approved styling. Advanced source changes are managed by a super admin.
            </p>
          )}
        </div>
        <div>
          <section className="card">
            <h2>Check the result</h2>
            {appearance}
            <p>
              The preview uses sample content and {sitePreviewPhrase(previewContext)}. Actual page content stays
              separate.
            </p>
            <button
              type="button"
              className="secondary"
              disabled={busy || !effectiveSlug}
              onClick={() => void run(false)}
            >
              {busy ? 'Checking…' : 'Check and preview'}
            </button>
            {report?.blocking.map((problem, index) => (
              <p className="notice notice-error" role="alert" key={index}>
                {problem}
              </p>
            ))}
            {report?.problems.map((problem, index) => (
              <p className="hint" key={index}>
                {problem}
              </p>
            ))}
            {currentPreview && report?.previewHtml && (
              <>
                <div className="group" role="group" aria-label="Visual section preview width">
                  {[
                    { label: 'Desktop', width: 1280 },
                    { label: 'Tablet', width: 768 },
                    { label: 'Phone', width: 390 },
                  ].map(device => (
                    <button
                      type="button"
                      key={device.label}
                      className="secondary small"
                      aria-pressed={previewWidth === device.width}
                      onClick={() => setPreviewWidth(device.width)}
                    >
                      {device.label}
                    </button>
                  ))}
                </div>
                <p className="hint">Visitor viewport · {previewWidth}px</p>
                <div className="section-live-preview-scroll">
                  <ScriptlessPreview
                    className="visual-section-preview"
                    title="Visual section preview"
                    style={{ width: previewWidth, maxWidth: 'none' }}
                    srcDoc={report.previewHtml}
                  />
                </div>
              </>
            )}
            {previewed && !currentPreview && (
              <p className="hint">
                The section or preview appearance changed after this preview. Check it again before saving.
              </p>
            )}
            <div className="field">
              <label htmlFor="section-change-note">What changed?</label>
              <textarea
                id="section-change-note"
                value={changelog}
                disabled={busy}
                maxLength={1000}
                onChange={event => setChangelog(event.target.value)}
              />
            </div>
            <button
              type="button"
              disabled={busy || !currentPreview || !name.trim() || !changelog.trim()}
              onClick={() => void run(true)}
            >
              {initial ? 'Save new section version' : 'Save this section'}
            </button>
          </section>
        </div>
      </div>
    </>
  )
}
