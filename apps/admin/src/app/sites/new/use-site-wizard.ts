'use client'
import { notifySiteChoicesChanged } from '../../../components/sidebar-data.tsx'
import { useNavigationGuard } from '../../../components/navigation-guard.ts'
import { useEffect, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { SiteSetup } from '@cms/schema'
import { starterSiteSetup } from '@cms/seeds/archetypes'
import { createSite, type SiteCreationResult } from './actions.ts'

export const WIZARD_STEPS = ['Name', 'Look', 'Pages', 'Header & footer', 'Review']
const FIELDS = [['name', 'slug', 'kind'], ['theme'], ['pages'], ['header', 'footer']] as const

/** Private, per-account setup saved in this browser. */
type SavedProgress = {
  version: 1
  savedAt: string
  setup: unknown
  step: number
  slugTouched: boolean
  pagesTouched: boolean
  description: string | null
}
function readProgress(key: string): (Omit<SavedProgress, 'setup'> & { setup: SiteSetup }) | null {
  try {
    const raw = window.localStorage.getItem(key)
    if (!raw) return null
    const saved = JSON.parse(raw) as Partial<SavedProgress>
    const setup = SiteSetup.safeParse(saved.setup)
    if (saved.version !== 1 || !setup.success || typeof saved.savedAt !== 'string') {
      window.localStorage.removeItem(key)
      return null
    }
    return {
      version: 1,
      savedAt: saved.savedAt,
      setup: setup.data,
      step: Math.min(Math.max(Number(saved.step) || 0, 0), WIZARD_STEPS.length - 1),
      slugTouched: saved.slugTouched === true,
      pagesTouched: saved.pagesTouched === true,
      description: typeof saved.description === 'string' ? saved.description : null,
    }
  } catch {
    return null
  }
}
function setupProblem(path: readonly PropertyKey[]): string {
  switch (path[0]) {
    case 'name':
      return 'Enter a site name of up to 120 characters.'
    case 'slug':
      return 'Use lowercase words separated by hyphens for the short address, up to 40 characters.'
    case 'kind':
      return 'Choose a starting point for this site.'
    case 'theme':
      return 'Check the Look choices before saving this setup.'
    case 'pages':
      return typeof path[1] === 'number'
        ? `Check the title, address and layout for page ${path[1] + 1} in Pages.`
        : 'Check the planned pages and their addresses before saving.'
    case 'header':
    case 'footer':
      return 'Check the site name and links in Header & footer before saving.'
    default:
      return 'Complete the required setup fields before saving.'
  }
}

/**
 * These shared links can use web addresses. Links to pages on this site can be added after those
 * pages exist.
 */
function downloadSetup(setup: SiteSetup): string | undefined {
  const parsed = SiteSetup.safeParse(setup)
  if (!parsed.success) {
    return `Check the setup before saving it: ${parsed.error.issues[0]?.message}`
  }
  const url = URL.createObjectURL(new Blob([JSON.stringify(parsed.data, null, 2)], { type: 'application/json' }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `${setup.slug || 'new-site'}-setup.json`
  anchor.click()
  setTimeout(() => URL.revokeObjectURL(url), 0)
}

export function useSiteWizard(stagingBase: string | null, progressKey: string | undefined) {
  const router = useRouter()
  const [setup, setSetup] = useState(() => starterSiteSetup('resource'))
  const [step, setStep] = useState(0)
  const [slugTouched, setSlugTouched] = useState(false)
  const [pagesTouched, setPagesTouched] = useState(false)
  // The one line typed on the Name step, kept if the starter is switched.
  const [description, setDescription] = useState<string | null>(null)
  const [switchKind, setSwitchKind] = useState<SiteSetup['kind'] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<SiteCreationResult | null>(null)
  const [pending, startTransition] = useTransition()
  const inFlight = useRef(false)
  const requestId = useRef<string | null>(null)
  const heading = useRef<HTMLHeadingElement>(null)
  const file = useRef<HTMLInputElement>(null)
  const [savedAt, setSavedAt] = useState<string | null>(null)
  const [savedSignature, setSavedSignature] = useState<string | null>(null)
  const [reading, setReading] = useState(false)
  const [saveProblem, setSaveProblem] = useState('')
  const readingFile = useRef(false)
  const restored = useRef(false)
  const justRestored = useRef(false)
  const starter = useRef(JSON.stringify(setup))
  const snapshot = JSON.stringify({ setup, step, slugTouched, pagesTouched, description })
  const hasProgress =
    JSON.stringify(setup) !== starter.current || step !== 0 || slugTouched || pagesTouched || description !== null
  const browserSaved = Boolean(savedAt) && savedSignature === snapshot

  // Come back to where this browser left off.
  useEffect(() => {
    if (!progressKey || restored.current) return
    restored.current = true
    const saved = readProgress(progressKey)
    if (!saved) return
    setSetup(saved.setup)
    setStep(saved.step)
    setSlugTouched(saved.slugTouched)
    setPagesTouched(saved.pagesTouched)
    setDescription(saved.description)
    setSavedAt(saved.savedAt)
    setSavedSignature(
      JSON.stringify({
        setup: saved.setup,
        step: saved.step,
        slugTouched: saved.slugTouched,
        pagesTouched: saved.pagesTouched,
        description: saved.description,
      }),
    )
    justRestored.current = true
  }, [progressKey])
  function saveProgress(): { ok: boolean; message?: string } {
    const parsed = SiteSetup.safeParse(setup)
    if (!parsed.success) {
      setSavedAt(null)
      return { ok: false, message: setupProblem(parsed.error.issues[0]?.path ?? []) }
    }
    if (!progressKey) {
      const message =
        'This setup cannot be saved for this account in this browser. Save choices to a file or keep editing.'
      setSavedAt(null)
      setSaveProblem(message)
      return { ok: false, message }
    }
    const at = new Date().toISOString()
    try {
      window.localStorage.setItem(
        progressKey,
        JSON.stringify({
          version: 1,
          savedAt: at,
          setup,
          step,
          slugTouched,
          pagesTouched,
          description,
        } satisfies SavedProgress),
      )
      setSavedAt(at)
      setSavedSignature(snapshot)
      setSaveProblem('')
      return { ok: true }
    } catch {
      const message =
        'This browser could not save the setup. Keep editing, save choices to a file, or discard the setup.'
      setSavedAt(null)
      setSaveProblem(message)
      return { ok: false, message }
    }
  }
  // Keep a validated, recoverable private setup; untouched starters need no copy.
  useEffect(() => {
    if (!progressKey || !restored.current || result?.ok) return
    if (justRestored.current) {
      justRestored.current = false
      return
    }
    if (!hasProgress || (snapshot === savedSignature && savedAt)) return
    saveProgress()
  }, [progressKey, snapshot, result?.ok])
  function clearProgress(): { ok: boolean; message?: string } {
    if (inFlight.current || readingFile.current)
      return { ok: false, message: 'Wait for the current setup action to finish.' }
    try {
      if (progressKey) window.localStorage.removeItem(progressKey)
    } catch {
      const message = 'The browser could not clear this setup. Keep editing or try clearing it again.'
      setError(message)
      return { ok: false, message }
    }
    const fresh = starterSiteSetup('resource')
    starter.current = JSON.stringify(fresh)
    setSetup(fresh)
    setStep(0)
    setSlugTouched(false)
    setPagesTouched(false)
    setDescription(null)
    setSwitchKind(null)
    setError(null)
    setSavedAt(null)
    setSavedSignature(null)
    setSaveProblem('')
    setTimeout(() => heading.current?.focus(), 0)
    return { ok: true }
  }
  useNavigationGuard(() => ({
    dirty: hasProgress && !result?.ok,
    nativeDirty: hasProgress && !browserSaved && !result?.ok,
    pending: pending || inFlight.current || reading || readingFile.current,
    draft: {
      label: 'Site setup (saved only in this browser)',
      saved: browserSaved,
      saveDraft: async () => saveProgress(),
      discard: clearProgress,
    },
  }))
  useEffect(() => {
    if (typeof window === 'undefined') return
    const warn = (event: BeforeUnloadEvent) => {
      if (
        (hasProgress && !browserSaved && !result?.ok) ||
        pending ||
        inFlight.current ||
        reading ||
        readingFile.current
      )
        event.preventDefault()
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [hasProgress, browserSaved, result?.ok, pending, reading])

  function move(to: number) {
    if (to > step) {
      const parsed = SiteSetup.safeParse(setup)
      const relevant = new Set<string>(FIELDS.slice(0, to).flat())
      const problem = parsed.success ? null : parsed.error.issues.find(issue => relevant.has(String(issue.path[0])))
      if (problem) {
        setError(problem.message)
        return
      }
    }
    setStep(to)
    setError(null)
    setTimeout(() => heading.current?.focus(), 0)
  }
  function chooseKind(next: SiteSetup['kind']) {
    if (pagesTouched) setSwitchKind(next)
    else kind(next)
  }
  function kind(next: SiteSetup['kind']) {
    setSetup(current => ({
      ...current,
      kind: next,
      pages: starterSiteSetup(next).pages.map(page =>
        page.slug === '' && description !== null ? { ...page, intro: description } : page,
      ),
    }))
    setPagesTouched(false)
    setSwitchKind(null)
  }
  /** The one line about the site opens the home page (and is its search
   * description), and starts the footer's introduction until that is changed. */
  function describe(text: string) {
    setDescription(text)
    setSetup(old => {
      const previous = old.pages.find(page => page.slug === '')?.intro ?? ''
      const blurb = old.footer.brand.blurb === '' || old.footer.brand.blurb === previous ? text : old.footer.brand.blurb
      return {
        ...old,
        pages: old.pages.map(page => (page.slug === '' ? { ...page, intro: text } : page)),
        footer: { ...old.footer, brand: { ...old.footer.brand, blurb } },
      }
    })
  }
  async function importSetup(selected: File | undefined) {
    if (!selected || readingFile.current || inFlight.current) return
    if (selected.size > 200_000) {
      setError('A setup file must be smaller than 200 KB.')
      return
    }
    readingFile.current = true
    setReading(true)
    try {
      const parsed = SiteSetup.safeParse(JSON.parse(await selected.text()))
      if (!parsed.success) {
        setError(`This is not a supported setup file: ${parsed.error.issues[0]?.message}`)
        return
      }
      setSetup(parsed.data)
      setSlugTouched(true)
      setPagesTouched(true)
      setStep(0)
      setError(null)
    } catch {
      setError('The setup file could not be read as JSON.')
    } finally {
      readingFile.current = false
      setReading(false)
    }
  }
  function exportSetup() {
    const error = downloadSetup(setup)
    if (error) setError(error)
  }
  function submit() {
    if (inFlight.current || readingFile.current) return
    const parsed = SiteSetup.safeParse(setup)
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Check the setup.')
      return
    }
    if (!stagingBase) {
      setError('A staging address must be configured before this site can be created.')
      return
    }
    requestId.current ??= crypto.randomUUID()
    inFlight.current = true
    setError(null)
    startTransition(async () => {
      try {
        const outcome = await createSite(requestId.current!, parsed.data)
        setResult(outcome)
        if (outcome.ok) {
          notifySiteChoicesChanged()
          try {
            if (progressKey) window.localStorage.removeItem(progressKey)
          } catch {
            /* nothing kept */
          }
          router.push(`/sites/${outcome.siteId}?siteCreated=1`)
        }
      } catch {
        setError('The connection was interrupted. Try again; this setup request will not create a duplicate site.')
      } finally {
        inFlight.current = false
      }
    })
  }
  return {
    setup,
    setSetup,
    step,
    slugTouched,
    setSlugTouched,
    error,
    result,
    pending,
    heading,
    file,
    savedAt,
    reading,
    saveProblem,
    hasProgress,
    browserSaved,
    clearProgress,
    move,
    chooseKind,
    describe,
    setPagesTouched,
    setDescription,
    importSetup,
    exportSetup,
    submit,
    switchKind,
    setSwitchKind,
    kind,
  }
}
