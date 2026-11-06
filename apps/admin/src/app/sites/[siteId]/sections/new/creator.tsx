'use client'

import { SectionSaved } from '../../../../../components/section-saved.tsx'
import { ScriptlessPreview } from '../../../../../components/scriptless-preview.tsx'
// Source organization proposes bounded edits while retaining the original.
// The production compiler, current preview, and server authorization decide saves.
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  compileSectionDraft,
  saveSectionDefinition,
  type SectionCompileReport,
  type SectionDraft,
} from '../../../../actions/section-definitions.ts'
import { IconAlert, IconCheck, IconCode, IconEye, IconPlus, SlotIcon } from '../../../../../components/icons.tsx'
import { PageHeader } from '../../../../../components/shell.tsx'
import type { AuthoringRights } from '../../../../../lib/queries.ts'
import type { DefinitionSource } from '../../../../../lib/definition-source.ts'
import { SlotDef } from '@cms/schema'
import { organizeSource, type OrganizedSource } from '@cms/renderer/source-organizer'
import { SourceSampleEditor } from '../../../../../components/source-sample-editor.tsx'
import { useNavigationGuard } from '../../../../../components/navigation-guard.ts'
import { sitePreviewLabel, sitePreviewPhrase, type SitePreviewContext } from '../../../../../lib/preview-context.ts'

/** The kinds an author can choose, in the words the inspector will use. */
const KINDS = [
  { id: 'text', label: 'Short text', hint: 'One line — a heading, a name, a date.' },
  { id: 'richtext', label: 'Formatted text', hint: 'Paragraphs, with bold, italic and links.' },
  { id: 'image', label: 'Image', hint: 'A picture, with a description for screen readers.' },
  { id: 'link', label: 'Link', hint: 'Words and where they go.' },
  { id: 'button', label: 'Button', hint: 'A link that looks like a button.' },
  { id: 'navigation', label: 'Site menu', hint: 'Filled from Navigation, with no stored field value.' },
] as const

const TOKEN = /\{\{\s*([\w-]+)\s*\}\}/g

/** The four things that have to happen, in the order they can happen in. */
const STEPS = ['Write the markup', 'Name the fields', 'Check the preview', 'Save'] as const

const STARTER_HTML = `<section class="promo">
  <h2>{{heading}}</h2>
  <div class="promo-body">{{body}}</div>
  <p class="promo-action"><a href="{{action}}">Find out more</a></p>
</section>`

const STARTER_CSS = `.promo { padding: 3rem 1.5rem; text-align: center; }
.promo h2 { font-size: 2rem; margin: 0 0 1rem; }
.promo-body { max-width: 38rem; margin: 0 auto; }`

type SlotRow = { id: string; kind: string; label: string; constraints?: Record<string, unknown> }

export function SectionCreator({
  siteId,
  siteName,
  rights,
  initial,
  onBusy,
  previewContext = 'published',
  modeSwitch = null,
  appearance = null,
}: {
  siteId: string
  siteName: string
  rights: AuthoringRights
  initial?: DefinitionSource
  previewContext?: SitePreviewContext
  onBusy?: (busy: boolean) => void
  /** The choice of tool and the preview's appearance, from the authoring page. */
  modeSwitch?: ReactNode
  appearance?: ReactNode
}) {
  const [name, setName] = useState(initial?.name ?? '')
  const [slug, setSlug] = useState(initial?.slug ?? '')
  const [touchedSlug, setTouchedSlug] = useState(!!initial)
  const [category, setCategory] = useState(initial?.category ?? 'Content')
  const [html, setHtml] = useState(initial?.sourceHtml ?? STARTER_HTML)
  const [css, setCss] = useState(initial?.sourceCss ?? STARTER_CSS)
  const [placement, setPlacement] = useState<'page' | 'header' | 'footer'>(initial?.placement ?? 'page')
  const [scope, setScope] = useState<'global' | 'site'>(initial?.scope ?? 'site')
  const [labels, setLabels] = useState<Record<string, string>>(() =>
    Object.fromEntries((initial?.slots ?? []).map(slot => [slot.id, slot.label])),
  )
  const [kinds, setKinds] = useState<Record<string, string>>(() =>
    Object.fromEntries((initial?.slots ?? []).map(slot => [slot.id, slot.kind])),
  )
  const [constraints, setConstraints] = useState<Record<string, Record<string, unknown>>>(() =>
    Object.fromEntries((initial?.slots ?? []).map(slot => [slot.id, slot.constraints ?? {}])),
  )
  const [organization, setOrganization] = useState<OrganizedSource | null>(null)
  const [beforeOrganization, setBeforeOrganization] = useState<{
    html: string
    css: string
    labels: Record<string, string>
    kinds: Record<string, string>
    constraints: Record<string, Record<string, unknown>>
  } | null>(null)
  const [changelog, setChangelog] = useState('')
  const [report, setReport] = useState<SectionCompileReport | null>(null)
  /** The draft the preview above was rendered from. Save is open only for it. */
  const [previewed, setPreviewed] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const inFlight = useRef(false)
  const [saved, setSaved] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const suggested = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
  const effectiveSlug = touchedSlug ? slug : suggested

  // Derived, in document order, with duplicates collapsed — a template may use
  // the same slot twice and that is one field, not two.
  const slots: SlotRow[] = useMemo(() => {
    const ids: string[] = []
    for (const match of html.matchAll(TOKEN)) {
      const id = match[1]!
      if (!ids.includes(id)) ids.push(id)
    }
    return ids.map(id => ({
      id,
      kind: kinds[id] ?? guessKind(id),
      label: labels[id] ?? titleCase(id),
      constraints: constraints[id] ?? {},
    }))
  }, [html, kinds, labels, constraints])

  const draft: SectionDraft = {
    slug: effectiveSlug,
    name,
    category,
    sourceHtml: html,
    sourceCss: css,
    slots,
    changelog,
    scope,
    siteId,
    previewContext,
    placement,
    definitionKind: 'legacy',
    expectedVersion: initial?.version ?? 0,
    ...(initial ? { definitionId: initial.id } : {}),
  }
  const fingerprint = JSON.stringify({ ...draft, changelog: '' })
  const previewIsCurrent = previewed === fingerprint && report?.ok === true
  const fields = {
      name,
      slug,
      touchedSlug,
      category,
      html,
      css,
      placement,
      scope,
      labels,
      kinds,
      constraints,
      changelog,
    },
    signature = JSON.stringify(fields),
    opening = useRef(fields),
    [openingSignature, setOpeningSignature] = useState(signature)
  const dirty = saved === null && signature !== openingSignature
  function discard() {
    const value = opening.current
    setName(value.name)
    setSlug(value.slug)
    setTouchedSlug(value.touchedSlug)
    setCategory(value.category)
    setHtml(value.html)
    setCss(value.css)
    setPlacement(value.placement)
    setScope(value.scope)
    setLabels(value.labels)
    setKinds(value.kinds)
    setConstraints(value.constraints)
    setChangelog(value.changelog)
    setOrganization(null)
    setBeforeOrganization(null)
    setReport(null)
    setPreviewed(null)
    setError(null)
  }
  useNavigationGuard(() => ({
    dirty,
    pending: busy || inFlight.current,
    draft: { label: 'HTML section' + (name.trim() ? ' “' + name.trim() + '”' : ''), saveDraft: save, discard },
  }))
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (dirty || inFlight.current) {
        event.preventDefault()
        event.returnValue = ''
      }
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])
  function organize() {
    const checked = SlotDef.array().safeParse(slots)
    if (!checked.success) {
      setError('Correct the existing field names and kinds before organizing.')
      return
    }
    const proposed = organizeSource(html, css, checked.data)
    setOrganization(current =>
      current && !current.blocking.length
        ? { ...proposed, originalHtml: current.originalHtml, originalCss: current.originalCss }
        : proposed,
    )
    setError(null)
    if (proposed.blocking.length) return
    setBeforeOrganization(current => current ?? { html, css, labels, kinds, constraints })
    setHtml(proposed.sourceHtml)
    setCss(proposed.sourceCss)
    setLabels(current => ({ ...current, ...Object.fromEntries(proposed.fields.map(field => [field.id, field.label])) }))
    setKinds(current => ({ ...current, ...Object.fromEntries(proposed.fields.map(field => [field.id, field.kind])) }))
    setConstraints(current => ({
      ...current,
      ...Object.fromEntries(proposed.fields.map(field => [field.id, field.constraints])),
    }))
    setPreviewed(null)
    setReport(null)
  }

  const step = saved !== null ? 4 : previewIsCurrent ? 3 : slots.length > 0 ? 2 : 1

  async function preview() {
    if (inFlight.current) return
    inFlight.current = true
    setBusy(true)
    onBusy?.(true)
    setError(null)
    try {
      const result = await compileSectionDraft(draft)
      setReport(result)
      setPreviewed(result.ok ? fingerprint : null)
    } catch (problem) {
      setError(`The preview could not be made: ${(problem as Error).message}`)
    } finally {
      inFlight.current = false
      setBusy(false)
      onBusy?.(false)
    }
  }

  async function save() {
    if (inFlight.current) return { ok: false, message: 'Wait for the current section action to finish.' }
    if (!previewIsCurrent) return { ok: false, message: 'Use Check and preview before saving and leaving.' }
    if (!changelog.trim()) return { ok: false, message: 'Describe what changed before saving and leaving.' }
    inFlight.current = true
    setBusy(true)
    onBusy?.(true)
    setError(null)
    try {
      const result = await saveSectionDefinition(draft)
      if (result.ok) setSaved(result.message)
      else setError(result.message)
      return { ok: result.ok, message: result.message }
    } catch (problem) {
      const message = `It could not be saved: ${(problem as Error).message}`
      setError(message)
      return { ok: false, message }
    } finally {
      inFlight.current = false
      setBusy(false)
      onBusy?.(false)
    }
  }

  if (saved !== null)
    return (
      <SectionSaved
        siteId={siteId}
        siteName={siteName}
        definitionId={initial?.id}
        placement={placement}
        message={saved}
        onCreateAnother={
          !initial
            ? () => {
                const blank = {
                  name: '',
                  slug: '',
                  touchedSlug: false,
                  category,
                  html: STARTER_HTML,
                  css: STARTER_CSS,
                  placement: 'page' as const,
                  scope,
                  labels: {},
                  kinds: {},
                  constraints: {},
                  changelog: '',
                }
                opening.current = blank
                setOpeningSignature(JSON.stringify(blank))
                setSaved(null)
                setName('')
                setSlug('')
                setTouchedSlug(false)
                setKinds({})
                setLabels({})
                setConstraints({})
                setOrganization(null)
                setBeforeOrganization(null)
                setChangelog('')
                setPlacement('page')
                setHtml(STARTER_HTML)
                setCss(STARTER_CSS)
                setReport(null)
                setPreviewed(null)
              }
            : undefined
        }
      />
    )

  return (
    <>
      <PageHeader
        crumbs={[
          { label: 'All sites', href: '/' },
          { label: siteName, href: `/sites/${siteId}` },
          { label: 'Sections', href: `/sites/${siteId}/sections` },
          { label: initial ? initial.name : 'New section' },
        ]}
        title={initial ? `Edit ${initial.name} (version ${initial.version})` : 'Create an HTML section'}
        lede={
          <>
            Paste the markup for one band of a page and choose “Organize into blocks” to propose editable fields. You
            can also write <code className="mono">{'{{a-name}}'}</code> to make a field somebody can edit without
            touching any code.
          </>
        }
      />

      {modeSwitch}

      {/* A real sequence, so numbering it says something true: each step is
          only reachable once the one before it has produced something. */}
      <ol className="steps" aria-label="Steps">
        {STEPS.map((label, i) => {
          const n = i + 1
          const state = step === n ? 'on' : step > n ? 'done' : ''
          return (
            <li key={label} className={state} aria-current={step === n ? 'step' : undefined}>
              <span className="step-n" aria-hidden="true">
                {step > n ? <IconCheck size={11} /> : n}
              </span>
              {label}
            </li>
          )
        })}
      </ol>

      {error && (
        <p className="notice notice-error" role="alert">
          <IconAlert size={16} />
          <span className="notice-body">{error}</span>
        </p>
      )}
      {initial?.cssPolicyVersion === null && (
        <p className="notice notice-warn">
          This older section has unlabelled stylesheet provenance. Check its styles in the preview before saving a new
          version.
        </p>
      )}

      <div className="creator">
        <div>
          <div className="card">
            <div className="card-head">
              <h2>
                <IconCode size={16} /> The markup
              </h2>
            </div>
            <label htmlFor="sec-html">HTML</label>
            <textarea
              id="sec-html"
              className="code"
              value={html}
              spellCheck={false}
              disabled={busy}
              onChange={event => setHtml(event.target.value)}
            />
            <div className="actions">
              <button type="button" className="secondary" disabled={busy} onClick={organize}>
                Organize into blocks
              </button>
              {beforeOrganization && (
                <button
                  type="button"
                  className="secondary"
                  disabled={busy}
                  onClick={() => {
                    setHtml(beforeOrganization.html)
                    setCss(beforeOrganization.css)
                    setLabels(beforeOrganization.labels)
                    setKinds(beforeOrganization.kinds)
                    setConstraints(beforeOrganization.constraints)
                    setBeforeOrganization(null)
                    setOrganization(null)
                    setPreviewed(null)
                    setReport(null)
                  }}
                >
                  Restore pre-organization draft
                </button>
              )}
            </div>
            {organization && (
              <div aria-live="polite">
                {organization.blocking.map((message, index) => (
                  <p className="notice notice-error" role="alert" key={index}>
                    {message}
                  </p>
                ))}
                {!organization.blocking.length && (
                  <p className="notice notice-ok" role="status">
                    Editable fields proposed. Review the fields and samples, then check the preview.
                  </p>
                )}
                <ul>
                  {organization.notes.map((message, index) => (
                    <li key={index}>{message}</li>
                  ))}
                </ul>
                <details>
                  <summary>Compare with original source</summary>
                  <label htmlFor="original-source-html">Original HTML</label>
                  <textarea id="original-source-html" className="code" readOnly value={organization.originalHtml} />
                  <label htmlFor="original-source-css">Original CSS</label>
                  <textarea id="original-source-css" className="code" readOnly value={organization.originalCss} />
                </details>
              </div>
            )}
            <p className="hint">
              Write <code className="mono">{'{{heading}}'}</code> anywhere you want an editable field. Scripts, forms
              and embeds are not allowed here — a section that could run code is a section nobody could safely hand to a
              contributor.
            </p>

            <label htmlFor="sec-css" style={{ marginTop: '1rem' }}>
              CSS
            </label>
            <textarea
              id="sec-css"
              className="code"
              value={css}
              spellCheck={false}
              disabled={busy}
              onChange={event => setCss(event.target.value)}
            />
            <p className="hint">
              Your rules are confined to this section automatically, so they cannot leak out and change the rest of the
              page.
            </p>
          </div>

          <div className="card">
            <div className="field">
              <label htmlFor="sec-name">What is this section called?</label>
              <input
                id="sec-name"
                type="text"
                value={name}
                placeholder="Promo band"
                disabled={busy}
                onChange={event => setName(event.target.value)}
              />
              <p className="hint">People pick sections by this name when they add one to a page.</p>
            </div>
            <div className="row2">
              <div className="field" style={{ marginBottom: 0 }}>
                <label htmlFor="sec-slug">Short name</label>
                <input
                  id="sec-slug"
                  type="text"
                  value={effectiveSlug}
                  placeholder="promo-band"
                  disabled={busy || !!initial}
                  onChange={event => {
                    setTouchedSlug(true)
                    setSlug(event.target.value)
                  }}
                />
              </div>
              <div className="field" style={{ marginBottom: 0 }}>
                <label htmlFor="sec-category">Group it under</label>
                <input
                  id="sec-category"
                  type="text"
                  value={category}
                  disabled={busy}
                  onChange={event => setCategory(event.target.value)}
                />
              </div>
            </div>
            <p className="hint">
              The short name is used behind the scenes and cannot be changed later, because your styles are attached to
              it.
            </p>
          </div>

          <div className="card">
            <div className="card-head">
              <h2>Fields</h2>
              {slots.length > 0 && <span className="muted">{slots.length} derived from the markup</span>}
            </div>
            {slots.length === 0 ? (
              <p className="muted" style={{ margin: 0 }}>
                No fields yet. Add <code className="mono">{'{{a-name}}'}</code> to the markup above and it will appear
                here. A section with no fields is allowed — it is just the same on every page that uses it.
              </p>
            ) : (
              <div className="table-scroll">
                <table className="slot-table">
                  <thead>
                    <tr>
                      <th>In the markup</th>
                      <th>Editors will see</th>
                      <th>Holds</th>
                    </tr>
                  </thead>
                  <tbody>
                    {slots.map(slot => (
                      <tr key={slot.id}>
                        <td>
                          <code className="mono">{`{{${slot.id}}}`}</code>
                        </td>
                        <td>
                          <label className="sr-only" htmlFor={`label-${slot.id}`}>
                            Label for {slot.id}
                          </label>
                          <input
                            id={`label-${slot.id}`}
                            type="text"
                            value={slot.label}
                            disabled={busy}
                            onChange={event => setLabels(current => ({ ...current, [slot.id]: event.target.value }))}
                          />
                        </td>
                        <td>
                          <label className="sr-only" htmlFor={`kind-${slot.id}`}>
                            What {slot.id} holds
                          </label>
                          <span className="kind-cell">
                            <SlotIcon kind={slot.kind} size={15} />
                            <select
                              id={`kind-${slot.id}`}
                              value={slot.kind}
                              disabled={busy}
                              onChange={event => setKinds(current => ({ ...current, [slot.id]: event.target.value }))}
                            >
                              {KINDS.filter(
                                kind => kind.id !== 'navigation' || placement !== 'page' || slot.kind === 'navigation',
                              ).map(kind => (
                                <option key={kind.id} value={kind.id}>
                                  {kind.label}
                                </option>
                              ))}
                            </select>
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {slots.some(slot => constraints[slot.id]?.sourceSample !== undefined) && (
            <section className="card">
              <h2>Starting content</h2>
              <p>
                These examples are copied into new sections. Existing pages keep their own content. Review image
                permissions and links before using this section in another site.
              </p>
              {slots
                .filter(slot => constraints[slot.id]?.sourceSample !== undefined)
                .map(slot => (
                  <SourceSampleEditor
                    key={slot.id}
                    id={slot.id}
                    label={slot.label}
                    kind={slot.kind}
                    value={constraints[slot.id]?.sourceSample}
                    disabled={busy}
                    onChange={value =>
                      setConstraints(current => ({
                        ...current,
                        [slot.id]: { ...current[slot.id], sourceSample: value },
                      }))
                    }
                  />
                ))}
            </section>
          )}
          <div className="card">
            <div className="field">
              <label htmlFor="sec-placement">Used as</label>
              <select
                id="sec-placement"
                value={placement}
                disabled={busy || !rights.global}
                onChange={event => setPlacement(event.target.value as typeof placement)}
              >
                <option value="page">Page section</option>
                <option value="header">Site header</option>
                <option value="footer">Site footer</option>
              </select>
              <p className="hint">
                {placement === 'page'
                  ? 'Page sections are added separately to each page.'
                  : 'This component is chosen and edited in Header & footer once for the whole site. Use a Site menu field between tags to render governed Navigation.'}
                {initial
                  ? ' Placement can change only while the definition is unused.'
                  : ' Only a super admin can create a site frame component.'}
              </p>
            </div>
          </div>
          <div className="card">
            <div className="card-head">
              <h2>Who can use it</h2>
            </div>
            <label className="choice">
              <input
                type="radio"
                name="scope"
                checked={scope === 'site'}
                onChange={() => setScope('site')}
                disabled={busy || !rights.site || !!initial}
              />
              <span>
                <strong>Only {siteName}</strong>
                <span className="muted">It appears in this site’s library and nowhere else.</span>
              </span>
            </label>
            <label className="choice">
              <input
                type="radio"
                name="scope"
                checked={scope === 'global'}
                onChange={() => setScope('global')}
                disabled={busy || !rights.global || !!initial}
              />
              <span>
                <strong>Every site</strong>
                <span className="muted">
                  {rights.global
                    ? 'Anybody editing any site here can add it to a page.'
                    : 'Only a super admin can make a section available to every site.'}
                </span>
              </span>
            </label>
          </div>
        </div>

        <div className="creator-aside">
          <div className="card">
            <div className="card-head">
              <h2>
                <IconEye size={16} /> Preview
              </h2>
            </div>
            {appearance}
            <p className="hint" style={{ marginTop: 0 }}>
              Every section is checked and previewed before it can be saved, so nothing reaches a page without somebody
              having seen it.
            </p>
            <div className="actions" style={{ marginTop: '.75rem' }}>
              <button type="button" className="navy wide" onClick={preview} disabled={busy || effectiveSlug === ''}>
                {busy ? 'Checking…' : previewIsCurrent ? 'Preview again' : 'Check and preview'}
              </button>
            </div>

            {report && report.blocking.length > 0 && (
              <div className="notice notice-error" role="alert" style={{ marginTop: '1rem' }}>
                <IconAlert size={16} />
                <div className="notice-body">
                  <strong>This cannot be saved yet.</strong>
                  <ul>
                    {report.blocking.map(problem => (
                      <li key={problem}>{problem}</li>
                    ))}
                  </ul>
                </div>
              </div>
            )}
            {report && report.problems.length > 0 && (
              <div className="notice notice-warn" style={{ marginTop: '1rem' }}>
                <IconAlert size={16} />
                <div className="notice-body">
                  <strong>Worth fixing.</strong>
                  <ul>
                    {report.problems.map(problem => (
                      <li key={problem}>{problem}</li>
                    ))}
                  </ul>
                </div>
              </div>
            )}
            {report?.carriesTrustedCode && (
              <div className="notice notice-warn" style={{ marginTop: '1rem' }}>
                <IconAlert size={16} />
                <span className="notice-body">
                  {placement === 'page'
                    ? 'This section contains custom code. It can be saved, but every page that uses it needs a super admin’s approval before that page can go live.'
                    : 'Site headers and footers are scriptless. Remove the custom code before saving this component.'}
                </span>
              </div>
            )}

            {previewIsCurrent && report?.previewHtml && (
              <div className="creator-preview" style={{ marginTop: '1rem' }}>
                {/* `sandbox` with nothing enabled: no scripts, no forms, no
                    same-origin access. The markup has already been through the
                    compiler, and this is the second, independent reason nothing
                    in a pasted blob can reach the admin session. */}
                <p className="hint">
                  Sample content with {sitePreviewPhrase(previewContext)}. Saving this component does not publish the
                  site design.
                </p>
                <ScriptlessPreview title="Section preview" srcDoc={report.previewHtml} />
              </div>
            )}
            {report && !report.previewHtml && report.blocking.length === 0 && (
              <p className="muted">Nothing to show yet.</p>
            )}
            {!previewIsCurrent && report !== null && report.blocking.length === 0 && (
              <p className="hint">You have changed something since this preview. Check it again before saving.</p>
            )}

            <div className="field">
              <label htmlFor="source-change-note">What changed?</label>
              <textarea
                id="source-change-note"
                value={changelog}
                disabled={busy}
                maxLength={1000}
                onChange={event => setChangelog(event.target.value)}
                required
              />
            </div>
            <div
              className="actions"
              style={{ marginTop: '1.25rem', paddingTop: '1rem', borderTop: '1px solid var(--line-soft)' }}
            >
              <button
                type="button"
                className="wide"
                onClick={save}
                disabled={busy || !previewIsCurrent || name.trim() === '' || !changelog.trim()}
              >
                Save this section
              </button>
            </div>
            {!previewIsCurrent && <p className="hint">Preview it first — that is what the button is waiting for.</p>}
          </div>
        </div>
      </div>
    </>
  )
}

/**
 * A first guess at what a field holds, from what the author called it.
 *
 * Only a default. Getting it wrong costs one click on a select that is right
 * beside the name; not guessing at all costs a click on every field of every
 * section anybody ever makes.
 */
function guessKind(id: string): string {
  if (/(^|-)(image|img|photo|picture|logo|icon)($|-)/.test(id)) return 'image'
  if (/(^|-)(button|cta)($|-)/.test(id)) return 'button'
  if (/(^|-)(link|url|href)($|-)/.test(id)) return 'link'
  if (/(^|-)(body|copy|content|text|description|intro)($|-)/.test(id)) return 'richtext'
  return 'text'
}

function titleCase(id: string): string {
  const words = id.replace(/[-_]+/g, ' ').trim()
  return words.charAt(0).toUpperCase() + words.slice(1)
}
