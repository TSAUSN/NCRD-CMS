import { useEffect, useRef, useState, type ReactNode } from 'react'
import { StructuredDocument } from '@cms/schema'
import { useNavigationGuard } from '../../../../components/navigation-guard.ts'
import type { AuthoringRights } from '../../../../lib/queries.ts'
import type { DefinitionSource } from '../../../../lib/definition-source.ts'
import type { SitePreviewContext } from '../../../../lib/preview-context.ts'
import { visualSourceCss } from '../../../../lib/visual-authoring.ts'
import { BUILDER_CSS, includeNewBlockStyles, newStructuredSection } from '../../../../lib/structured-builder.ts'
import {
  compileSectionDraft,
  saveSectionDefinition,
  type SectionCompileReport,
  type SectionDraft,
} from '../../../actions/section-definitions.ts'

export type VisualSectionProps = {
  siteId: string
  siteName: string
  rights: AuthoringRights
  initial?: DefinitionSource
  previewContext: SitePreviewContext
  onBusy: (busy: boolean) => void
  modeSwitch: ReactNode
  appearance: ReactNode
}

export function useVisualSectionDraft({ siteId, rights, initial, previewContext, onBusy }: VisualSectionProps) {
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
  const fields = { name, slug, touchedSlug, category, document, css, placement, scope, changelog }
  const signature = JSON.stringify(fields)
  const opening = useRef(fields)
  const openingSignature = useRef(signature)
  const dirty = saved === null && signature !== openingSignature.current
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

  function changeStructure(next: StructuredDocument) {
    setCss(current =>
      rights.global ? includeNewBlockStyles(document, next, current) : visualSourceCss(next, initial?.sourceCss),
    )
    setDocument(next)
  }

  function editSlug(value: string) {
    setTouchedSlug(true)
    setSlug(value)
  }

  return {
    name,
    setName,
    effectiveSlug,
    editSlug,
    category,
    setCategory,
    previewWidth,
    setPreviewWidth,
    document,
    changeStructure,
    css,
    setCss,
    placement,
    setPlacement,
    scope,
    setScope,
    changelog,
    setChangelog,
    report,
    previewed,
    currentPreview,
    error,
    saved,
    busy,
    structureFile,
    run,
    loadStructure,
    downloadStructure,
  }
}
export type VisualSectionDraft = ReturnType<typeof useVisualSectionDraft>
