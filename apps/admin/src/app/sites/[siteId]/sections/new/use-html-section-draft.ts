import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  compileSectionDraft,
  saveSectionDefinition,
  type SectionCompileReport,
  type SectionDraft,
} from '../../../../actions/section-definitions.ts'
import type { AuthoringRights } from '../../../../../lib/queries.ts'
import type { DefinitionSource } from '../../../../../lib/definition-source.ts'
import { SlotDef } from '@cms/schema'
import { organizeSource, type OrganizedSource } from '@cms/renderer/source-organizer'
import { useNavigationGuard } from '../../../../../components/navigation-guard.ts'
import { type SitePreviewContext } from '../../../../../lib/preview-context.ts'

const TOKEN = /\{\{\s*([\w-]+)\s*\}\}/g
const STARTER_HTML = `<section class="promo">
  <h2>{{heading}}</h2>
  <div class="promo-body">{{body}}</div>
  <p class="promo-action"><a href="{{action}}">Find out more</a></p>
</section>`

const STARTER_CSS = `.promo { padding: 3rem 1.5rem; text-align: center; }
.promo h2 { font-size: 2rem; margin: 0 0 1rem; }
.promo-body { max-width: 38rem; margin: 0 auto; }`

type SlotRow = { id: string; kind: string; label: string; constraints?: Record<string, unknown> }
export type SectionCreatorProps = {
  siteId: string
  siteName: string
  rights: AuthoringRights
  initial?: DefinitionSource
  previewContext?: SitePreviewContext
  onBusy?: (busy: boolean) => void
  /** The choice of tool and the preview's appearance, from the authoring page. */
  modeSwitch?: ReactNode
  appearance?: ReactNode
}

export function useHtmlSectionDraft({ siteId, initial, onBusy, previewContext = 'published' }: SectionCreatorProps) {
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
    const ids = new Set<string>()
    for (const match of html.matchAll(TOKEN)) {
      const id = match[1]!
      ids.add(id)
    }
    return [...ids].map(id => ({
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
  }
  const signature = JSON.stringify(fields)
  const opening = useRef(fields)
  const [openingSignature, setOpeningSignature] = useState(signature)
  const dirty = saved === null && signature !== openingSignature
  function resetDraft(value: typeof fields) {
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
    draft: {
      label: 'HTML section' + (name.trim() ? ' “' + name.trim() + '”' : ''),
      saveDraft: save,
      discard: () => resetDraft(opening.current),
    },
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

  function createAnother() {
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
    resetDraft(blank)
  }
  function restoreOrganization() {
    if (!beforeOrganization) return
    setHtml(beforeOrganization.html)
    setCss(beforeOrganization.css)
    setLabels(beforeOrganization.labels)
    setKinds(beforeOrganization.kinds)
    setConstraints(beforeOrganization.constraints)
    setBeforeOrganization(null)
    setOrganization(null)
    setPreviewed(null)
    setReport(null)
  }
  return {
    name,
    setName,
    setSlug,
    setTouchedSlug,
    category,
    setCategory,
    html,
    setHtml,
    css,
    setCss,
    placement,
    setPlacement,
    scope,
    setScope,
    setLabels,
    setKinds,
    constraints,
    setConstraints,
    organization,
    beforeOrganization,
    changelog,
    setChangelog,
    report,
    busy,
    saved,
    error,
    effectiveSlug,
    slots,
    previewIsCurrent,
    organize,
    step,
    preview,
    save,
    restoreOrganization,
    createAnother,
  }
}
export type HtmlSectionDraft = ReturnType<typeof useHtmlSectionDraft>

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
