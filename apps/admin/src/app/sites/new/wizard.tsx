'use client'

import { GuardedLink as Link } from '../../../components/guarded-link.tsx'
import { useNavigationGuard } from '../../../components/navigation-guard.ts'
import { useEffect, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { GLOBAL_ELEMENT_LIMITS, SITE_SETUP_FOOTER_PAGES, SiteSetup, type SiteSetupPage } from '@cms/schema'
import { CORE_PAGE_TEMPLATES } from '@cms/seeds/core-templates'
import { starterSiteSetup } from '@cms/seeds/archetypes'
import { ConfirmDialog } from '../../../components/confirm.tsx'
import { lookSummary } from '../../../lib/site-look.ts'
import { createSite, type SiteCreationResult } from './actions.ts'
import { LookChoices, SitePreview } from './look.tsx'

const STEPS = ['Name', 'Look', 'Pages', 'Header & footer', 'Review']
const FIELDS = [['name', 'slug', 'kind'], ['theme'], ['pages'], ['header', 'footer']] as const
const LAYOUTS: Record<SiteSetupPage['layout'], string> = {
  content: 'Text page',
  resources: 'Resource list',
  speakers: 'Speaker list',
  program: 'Program',
}
// The header's starting designs (reference 24), drawn rather than named.
const HEADER_LAYOUTS: { value: SiteSetup['header']['preset']; name: string; description: string }[] = [
  {
    value: 'standard',
    name: 'Name left, menu right',
    description: 'The site name on the left and the menu beside it.',
  },
  { value: 'centered', name: 'Centred', description: 'The name centred, with the menu beneath it.' },
  { value: 'compact', name: 'Compact', description: 'A slimmer bar, for sites with many pages.' },
  { value: 'minimal', name: 'Minimal', description: 'No brand rule; the bar spans the full width.' },
]
const HEADER_SURFACES: { value: SiteSetup['header']['surface']; name: string }[] = [
  { value: 'page', name: 'Page colour' },
  { value: 'soft', name: 'Soft band' },
  { value: 'primary', name: 'Brand colour' },
  { value: 'accent', name: 'Accent colour' },
]

/** Progress kept in this browser, as V1 did (reference 25): a person can leave
 * the wizard and come back to it. Per signed-in account, never sent anywhere,
 * cleared when the site is created or on request. */
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
      step: Math.min(Math.max(Number(saved.step) || 0, 0), STEPS.length - 1),
      slugTouched: saved.slugTouched === true,
      pagesTouched: saved.pagesTouched === true,
      description: typeof saved.description === 'string' ? saved.description : null,
    }
  } catch {
    return null
  }
}
const savedTime = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
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

/** A link every page shows, to a web address; the site's own pages are linked
 * after creation, when they exist (SPEC §6: “optional … shared links”). */
type SharedLink = { label: string; target: { type: 'url'; url: string } | { type: 'page'; page_id: string } }
function SharedLinks({
  id,
  legend,
  hint,
  links,
  max,
  add,
  disabled,
  onChange,
}: {
  id: string
  legend: string
  hint: string
  links: readonly SharedLink[]
  max: number
  add: string
  disabled: boolean
  onChange: (links: SharedLink[]) => void
}) {
  const set = (index: number, patch: Partial<{ label: string; url: string }>) =>
    onChange(
      links.map((link, at) =>
        at !== index
          ? link
          : {
              label: patch.label ?? link.label,
              target: { type: 'url', url: patch.url ?? (link.target.type === 'url' ? link.target.url : '') },
            },
      ),
    )
  return (
    <fieldset className="look-group wizard-links" disabled={disabled}>
      <legend>{legend}</legend>
      <p className="hint">{hint}</p>
      {links.map((link, index) => (
        <fieldset className="wizard-link" key={index}>
          <legend className="sr-only">{`${legend} ${index + 1}`}</legend>
          <div className="field">
            <label htmlFor={`${id}-label-${index}`}>Link text</label>
            <input
              type="text"
              id={`${id}-label-${index}`}
              value={link.label}
              maxLength={GLOBAL_ELEMENT_LIMITS.linkLabel}
              onChange={event => set(index, { label: event.target.value })}
            />
          </div>
          <div className="field">
            <label htmlFor={`${id}-url-${index}`}>Web address</label>
            <input
              type="text"
              inputMode="url"
              id={`${id}-url-${index}`}
              placeholder="https://… or /a-page"
              value={link.target.type === 'url' ? link.target.url : ''}
              onChange={event => set(index, { url: event.target.value.trim() })}
            />
          </div>
          <button
            type="button"
            className="secondary small"
            aria-label={`Remove ${link.label.trim() || `${legend.toLowerCase()} ${index + 1}`}`}
            onClick={() => onChange(links.filter((_, at) => at !== index))}
          >
            Remove
          </button>
        </fieldset>
      ))}
      <button
        type="button"
        className="secondary small"
        disabled={links.length >= max}
        onClick={() => onChange([...links, { label: '', target: { type: 'url', url: '' } }])}
      >
        {add}
      </button>
    </fieldset>
  )
}

/** The page a nested page sits under: the closest page above it that is not
 * nested, unless that is the home page (V1 reference 23). */
function nestParent(pages: readonly SiteSetupPage[], index: number): SiteSetupPage | null {
  const above = pages
    .slice(0, index)
    .reverse()
    .find(page => !page.nested)
  return above && above.slug !== '' && pages[index]?.slug !== '' ? above : null
}
/** After a move or removal, a page that can no longer be nested comes back to the top level. */
const keepNestingValid = (pages: SiteSetupPage[]) =>
  pages.map((page, index) => (page.nested && !nestParent(pages, index) ? { ...page, nested: false } : page))
/** What a page's plan says beyond its layout, in the summary and the review. */
function pageNotes(pages: readonly SiteSetupPage[], index: number): string {
  const page = pages[index]!
  const parent = page.nested ? nestParent(pages, index) : null
  return [
    parent ? `under ${parent.title || 'the page above'}` : '',
    page.menu ? '' : 'not in the menu',
    page.footer ? 'in the footer' : '',
  ]
    .filter(Boolean)
    .map(note => ` · ${note}`)
    .join('')
}

export function SiteWizard({
  stagingBase,
  managedStaging = false,
  progressKey,
}: {
  stagingBase: string | null
  managedStaging?: boolean
  progressKey?: string | undefined
}) {
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
  const [savedSignature, setSavedSignature] = useState<string | null>(null),
    [reading, setReading] = useState(false),
    [saveProblem, setSaveProblem] = useState('')
  const readingFile = useRef(false)
  const restored = useRef(false)
  const justRestored = useRef(false)
  const starter = useRef(JSON.stringify(setup))
  const snapshot = JSON.stringify({ setup, step, slugTouched, pagesTouched, description }),
    hasProgress =
      JSON.stringify(setup) !== starter.current || step !== 0 || slugTouched || pagesTouched || description !== null,
    browserSaved = Boolean(savedAt) && savedSignature === snapshot

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
  function updatePage(index: number, patch: Partial<SiteSetupPage>) {
    setPagesTouched(true)
    if (patch.intro !== undefined && setup.pages[index]?.slug === '') setDescription(patch.intro)
    setSetup(current => ({
      ...current,
      pages: current.pages.map((page, at) => (at === index ? { ...page, ...patch } : page)),
    }))
  }
  function orderPage(index: number, delta: number) {
    const next = [...setup.pages]
    const target = index + delta
    if (!next[target]) return
    ;[next[index], next[target]] = [next[target]!, next[index]!]
    setPagesTouched(true)
    setSetup({ ...setup, pages: keepNestingValid(next) })
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
    const parsed = SiteSetup.safeParse(setup)
    if (!parsed.success) {
      setError(`Check the setup before saving it: ${parsed.error.issues[0]?.message}`)
      return
    }
    const url = URL.createObjectURL(new Blob([JSON.stringify(parsed.data, null, 2)], { type: 'application/json' }))
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `${setup.slug || 'new-site'}-setup.json`
    anchor.click()
    setTimeout(() => URL.revokeObjectURL(url), 0)
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
  return (
    <div className="site-wizard">
      {hasProgress && (
        <div className="wizard-progress" role="status">
          <p>
            {browserSaved && savedAt
              ? `Progress saved in this browser at ${savedTime(savedAt)}. You can come back to it.`
              : saveProblem ||
                'Current changes are not saved in this browser. Complete required fields before leaving.'}
          </p>
          <button type="button" className="ghost small" disabled={pending || reading} onClick={clearProgress}>
            Clear saved draft
          </button>
        </div>
      )}
      <ol className="steps" aria-label="Site setup steps">
        {STEPS.map((label, index) => (
          <li key={label} className={index === step ? 'on' : index < step ? 'done' : ''}>
            <button
              type="button"
              disabled={pending || reading}
              aria-current={index === step ? 'step' : undefined}
              onClick={() => move(index)}
            >
              <span className="step-n">{index + 1}</span>
              {label}
            </button>
          </li>
        ))}
      </ol>
      {(error || (result && !result.ok)) && (
        <div className="notice notice-error" role="alert">
          <p>{error || (result && !result.ok ? result.message : '')}</p>
          {result && !result.ok && result.reauthenticate && (
            <a href="/sign-in?reauth=1" target="_blank" rel="noopener">
              Confirm sign-in in another tab
            </a>
          )}
        </div>
      )}
      {!stagingBase && (
        <p className="notice notice-error">
          The installation needs a staging address before sites can be created. You can prepare and save the setup now.
        </p>
      )}
      <div className="site-wizard-layout">
        <section className="card" aria-labelledby="wizard-step-title">
          <h2 id="wizard-step-title" tabIndex={-1} ref={heading}>
            {STEPS[step]}
          </h2>
          <fieldset disabled={pending || reading}>
            {step === 0 && (
              <>
                <div className="field">
                  <label htmlFor="site-name">Site name</label>
                  <input
                    type="text"
                    id="site-name"
                    value={setup.name}
                    maxLength={120}
                    onChange={event => {
                      const name = event.target.value
                      setSetup(old => ({
                        ...old,
                        name,
                        slug: slugTouched
                          ? old.slug
                          : name
                              .toLowerCase()
                              .replace(/[^a-z0-9]+/g, '-')
                              .replace(/^-|-$/g, '')
                              .slice(0, 40)
                              .replace(/-$/, ''),
                        header: {
                          ...old.header,
                          brand: {
                            ...old.header.brand,
                            siteName: old.header.brand.siteName === old.name ? name : old.header.brand.siteName,
                          },
                        },
                        footer: {
                          ...old.footer,
                          brand: {
                            ...old.footer.brand,
                            siteName: old.footer.brand.siteName === old.name ? name : old.footer.brand.siteName,
                          },
                        },
                      }))
                    }}
                  />
                </div>
                <div className="field">
                  <label htmlFor="site-slug">{managedStaging ? 'Short name' : 'Short address'}</label>
                  <input
                    type="text"
                    id="site-slug"
                    value={setup.slug}
                    maxLength={40}
                    onChange={event => {
                      setSlugTouched(true)
                      setSetup({ ...setup, slug: event.target.value })
                    }}
                  />
                  <p className="hint">
                    {managedStaging
                      ? 'Used to identify this site. A secure test address will be assigned automatically.'
                      : `${setup.slug || 'your-site'}.${stagingBase || 'staging address pending'}`}
                  </p>
                </div>
                <div className="field">
                  <label htmlFor="site-description">One line about the site</label>
                  <input
                    type="text"
                    id="site-description"
                    value={setup.pages.find(page => page.slug === '')?.intro ?? ''}
                    maxLength={500}
                    aria-describedby="site-description-hint"
                    onChange={event => describe(event.target.value)}
                  />
                  <p className="hint" id="site-description-hint">
                    Opens the home page and becomes its search description. It also starts the footer’s introduction.
                    Each can be changed later.
                  </p>
                </div>
                <fieldset className="site-kind">
                  <legend>Starting point</legend>
                  {(['resource', 'event'] as const).map(value => (
                    <label key={value}>
                      <input
                        type="radio"
                        name="starter-kind"
                        checked={setup.kind === value}
                        onChange={() => (pagesTouched ? setSwitchKind(value) : kind(value))}
                      />
                      <span>
                        <strong>{value === 'resource' ? 'Resource site' : 'Event site'}</strong>
                        <small>
                          {value === 'resource'
                            ? 'Resources, context, and project information'
                            : 'Speakers, program, and visitor information'}
                        </small>
                      </span>
                    </label>
                  ))}
                </fieldset>
                <p className="hint">
                  The starter includes editable example text. Its lists begin empty so fictional entries are never
                  mistaken for real information.
                </p>
              </>
            )}
            {step === 1 && (
              <LookChoices theme={setup.theme} onChange={theme => setSetup(current => ({ ...current, theme }))} />
            )}
            {step === 2 && (
              <>
                <p>Arrange the initial pages and adjust their titles and introductions.</p>
                {setup.pages.map((page, index) => (
                  <details className={`wizard-page${page.nested ? ' is-nested' : ''}`} key={index} open={index === 0}>
                    <summary>
                      {page.title || 'Untitled page'} <span className="muted">/{page.slug}</span>
                      <span className="wizard-page-meta">
                        {CORE_PAGE_TEMPLATES.find(
                          template =>
                            template.id === (page.template ?? (page.layout !== 'content' ? page.layout : 'blank')),
                        )?.name ?? LAYOUTS[page.layout]}
                        {pageNotes(setup.pages, index)}
                      </span>
                    </summary>
                    <div className="field">
                      <label htmlFor={`setup-page-title-${index}`}>Page title</label>
                      <input
                        type="text"
                        id={`setup-page-title-${index}`}
                        value={page.title}
                        maxLength={80}
                        onChange={event => updatePage(index, { title: event.target.value })}
                      />
                    </div>
                    <div className="field">
                      <label htmlFor={`setup-page-slug-${index}`}>Page address</label>
                      <input
                        type="text"
                        id={`setup-page-slug-${index}`}
                        value={page.slug}
                        readOnly={page.slug === ''}
                        maxLength={160}
                        onChange={event => updatePage(index, { slug: event.target.value })}
                      />
                    </div>
                    <div className="field">
                      <label htmlFor={`setup-page-intro-${index}`}>Introduction</label>
                      <textarea
                        id={`setup-page-intro-${index}`}
                        value={page.intro}
                        maxLength={500}
                        onChange={event => updatePage(index, { intro: event.target.value })}
                      />
                    </div>
                    <div className="field">
                      <label htmlFor={`page-template-${index}`}>Page template</label>
                      <select
                        id={`page-template-${index}`}
                        value={page.template ?? (page.layout !== 'content' ? page.layout : 'blank')}
                        onChange={event =>
                          updatePage(index, {
                            template: event.target.value as NonNullable<SiteSetupPage['template']>,
                            layout: ['speakers', 'program', 'resources'].includes(event.target.value)
                              ? (event.target.value as SiteSetupPage['layout'])
                              : 'content',
                          })
                        }
                      >
                        {CORE_PAGE_TEMPLATES.map(template => (
                          <option key={template.id} value={template.id}>
                            {template.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    {page.layout === 'content' && (
                      <div className="field">
                        <label htmlFor={`setup-page-body-${index}`}>Body text</label>
                        <textarea
                          id={`setup-page-body-${index}`}
                          value={page.body}
                          maxLength={5000}
                          onChange={event => updatePage(index, { body: event.target.value })}
                        />
                      </div>
                    )}
                    <div className="wizard-page-choices">
                      <label className="checkbox">
                        <input
                          type="checkbox"
                          checked={page.menu}
                          onChange={event => updatePage(index, { menu: event.target.checked })}
                        />
                        <span>
                          Show in the site menu
                          <small>A page left out still exists; add it to the menu later in Navigation.</small>
                        </span>
                      </label>
                      <label className="checkbox">
                        <input
                          type="checkbox"
                          checked={page.footer}
                          disabled={
                            !page.footer && setup.pages.filter(item => item.footer).length >= SITE_SETUP_FOOTER_PAGES
                          }
                          onChange={event => updatePage(index, { footer: event.target.checked })}
                        />
                        <span>
                          Show in the footer
                          <small>Listed among the footer’s links, up to {SITE_SETUP_FOOTER_PAGES} pages.</small>
                        </span>
                      </label>
                    </div>
                    <div className="actions">
                      <button
                        type="button"
                        className="secondary small"
                        disabled={index === 0}
                        onClick={() => orderPage(index, -1)}
                      >
                        Move up
                      </button>
                      <button
                        type="button"
                        className="secondary small"
                        disabled={index === setup.pages.length - 1}
                        onClick={() => orderPage(index, 1)}
                      >
                        Move down
                      </button>
                      {page.nested ? (
                        <button
                          type="button"
                          className="secondary small"
                          onClick={() => updatePage(index, { nested: false })}
                        >
                          Un-nest
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="secondary small"
                          disabled={
                            !nestParent(
                              setup.pages.map((item, at) => (at === index ? { ...item, nested: true } : item)),
                              index,
                            )
                          }
                          onClick={() => updatePage(index, { nested: true })}
                        >
                          Nest under the page above
                        </button>
                      )}
                      {page.slug !== '' && (
                        <button
                          type="button"
                          className="danger small"
                          onClick={() => {
                            setPagesTouched(true)
                            setSetup({ ...setup, pages: keepNestingValid(setup.pages.filter((_, at) => at !== index)) })
                          }}
                        >
                          Remove page
                        </button>
                      )}
                    </div>
                  </details>
                ))}
                <button
                  type="button"
                  className="secondary"
                  disabled={setup.pages.length >= 12}
                  onClick={() => {
                    let number = setup.pages.length + 1
                    while (setup.pages.some(page => page.slug === `page-${number}`)) number++
                    setPagesTouched(true)
                    setSetup({
                      ...setup,
                      pages: [
                        ...setup.pages,
                        {
                          title: 'New page',
                          slug: `page-${number}`,
                          intro: '',
                          body: '',
                          layout: 'content',
                          menu: true,
                          nested: false,
                          footer: false,
                        },
                      ],
                    })
                  }}
                >
                  Add a page
                </button>
                <p className="hint">
                  <strong>Nest</strong> puts a page under the one above it, which is how a drop-down appears in the
                  menu. Pages go one level deep, and the home page always stays at the top.
                </p>
              </>
            )}
            {step === 3 && (
              <>
                <div className="field">
                  <label>
                    <input
                      type="checkbox"
                      checked={setup.header.enabled}
                      onChange={event =>
                        setSetup({ ...setup, header: { ...setup.header, enabled: event.target.checked } })
                      }
                    />{' '}
                    Show the site header
                  </label>
                </div>
                <p className="wizard-lede">
                  These appear on every page. The menu fills itself from the pages you planned; logos and links to the
                  site’s own pages are added after the site is created.
                </p>
                <fieldset className="look-group" disabled={!setup.header.enabled}>
                  <legend>Header layout</legend>
                  <div className="look-options look-headers">
                    {HEADER_LAYOUTS.map(layout => {
                      const id = `header-layout-${layout.value}`
                      return (
                        <label className="look-option" key={layout.value}>
                          <input
                            type="radio"
                            name="header-layout"
                            checked={setup.header.preset === layout.value}
                            aria-labelledby={id}
                            aria-describedby={`${id}-about`}
                            onChange={() => setSetup({ ...setup, header: { ...setup.header, preset: layout.value } })}
                          />
                          <span className={`header-sketch is-${layout.value}`} aria-hidden="true">
                            <i />
                            <b />
                            <b />
                            <b />
                          </span>
                          <span className="look-option-copy">
                            <strong id={id}>{layout.name}</strong>
                            <small id={`${id}-about`}>{layout.description}</small>
                          </span>
                        </label>
                      )
                    })}
                  </div>
                </fieldset>
                <fieldset className="look-group" disabled={!setup.header.enabled}>
                  <legend>Header colour</legend>
                  <div className="look-options look-shapes">
                    {HEADER_SURFACES.map(surface => {
                      const id = `header-surface-${surface.value}`
                      const fill =
                        surface.value === 'primary'
                          ? setup.theme.colors.primary
                          : surface.value === 'accent'
                            ? setup.theme.colors.accent
                            : surface.value === 'soft'
                              ? setup.theme.colors.surfaceAlt
                              : setup.theme.colors.surface
                      return (
                        <label className="look-option look-shape" key={surface.value}>
                          <input
                            type="radio"
                            name="header-surface"
                            checked={setup.header.surface === surface.value}
                            aria-labelledby={id}
                            onChange={() => setSetup({ ...setup, header: { ...setup.header, surface: surface.value } })}
                          />
                          <span
                            className="look-button-sample header-surface-sample"
                            aria-hidden="true"
                            style={{ background: fill }}
                          />
                          <strong id={id}>{surface.name}</strong>
                        </label>
                      )
                    })}
                  </div>
                </fieldset>
                <div className="field">
                  <label>
                    <input
                      type="checkbox"
                      checked={setup.footer.enabled}
                      onChange={event =>
                        setSetup({ ...setup, footer: { ...setup.footer, enabled: event.target.checked } })
                      }
                    />{' '}
                    Show the site footer
                  </label>
                </div>
                <div className="field">
                  <label htmlFor="setup-footer-blurb">Footer introduction</label>
                  <textarea
                    id="setup-footer-blurb"
                    value={setup.footer.brand.blurb}
                    maxLength={500}
                    onChange={event =>
                      setSetup({
                        ...setup,
                        footer: { ...setup.footer, brand: { ...setup.footer.brand, blurb: event.target.value } },
                      })
                    }
                  />
                </div>
                <div className="field">
                  <label htmlFor="setup-copyright">Copyright line</label>
                  <input
                    type="text"
                    id="setup-copyright"
                    value={setup.footer.legal.copyright}
                    maxLength={200}
                    onChange={event =>
                      setSetup({
                        ...setup,
                        footer: { ...setup.footer, legal: { ...setup.footer.legal, copyright: event.target.value } },
                      })
                    }
                  />
                </div>
                <fieldset className="look-group wizard-partner" disabled={!setup.header.enabled}>
                  <legend>Partner</legend>
                  <label className="checkbox">
                    <input
                      type="checkbox"
                      checked={!!setup.header.partner}
                      onChange={event =>
                        setSetup({
                          ...setup,
                          header: {
                            ...setup.header,
                            partner: event.target.checked
                              ? { label: 'In partnership with', name: '', url: null }
                              : null,
                          },
                        })
                      }
                    />
                    <span>
                      Name a partner in the header
                      <small>Shown beside the site name, as in “In partnership with …”, and hidden on phones.</small>
                    </span>
                  </label>
                  {setup.header.partner && (
                    <div className="wizard-link">
                      <div className="field">
                        <label htmlFor="setup-partner-label">Words before the name</label>
                        <input
                          type="text"
                          id="setup-partner-label"
                          value={setup.header.partner.label}
                          maxLength={GLOBAL_ELEMENT_LIMITS.linkLabel}
                          onChange={event =>
                            setSetup({
                              ...setup,
                              header: {
                                ...setup.header,
                                partner: { ...setup.header.partner!, label: event.target.value },
                              },
                            })
                          }
                        />
                      </div>
                      <div className="field">
                        <label htmlFor="setup-partner-name">Partner’s name</label>
                        <input
                          type="text"
                          id="setup-partner-name"
                          value={setup.header.partner.name}
                          maxLength={GLOBAL_ELEMENT_LIMITS.siteName}
                          onChange={event =>
                            setSetup({
                              ...setup,
                              header: {
                                ...setup.header,
                                partner: { ...setup.header.partner!, name: event.target.value },
                              },
                            })
                          }
                        />
                      </div>
                      <div className="field">
                        <label htmlFor="setup-partner-url">Web address (optional)</label>
                        <input
                          type="text"
                          inputMode="url"
                          id="setup-partner-url"
                          placeholder="https://…"
                          value={setup.header.partner.url ?? ''}
                          onChange={event =>
                            setSetup({
                              ...setup,
                              header: {
                                ...setup.header,
                                partner: { ...setup.header.partner!, url: event.target.value.trim() || null },
                              },
                            })
                          }
                        />
                      </div>
                    </div>
                  )}
                </fieldset>
                <SharedLinks
                  id="setup-header-links"
                  legend="Header links"
                  add="Add a header link"
                  max={GLOBAL_ELEMENT_LIMITS.utilityLinks}
                  disabled={!setup.header.enabled}
                  hint={`Small links above the menu on every page, such as Donate or Contact — up to ${GLOBAL_ELEMENT_LIMITS.utilityLinks}.`}
                  links={setup.header.utilityLinks}
                  onChange={utilityLinks => setSetup({ ...setup, header: { ...setup.header, utilityLinks } })}
                />
                <SharedLinks
                  id="setup-footer-links"
                  legend="Footer links"
                  add="Add a footer link"
                  max={GLOBAL_ELEMENT_LIMITS.footerGroupLinks}
                  disabled={!setup.footer.enabled}
                  hint={`A “Useful links” list in the footer of every page — up to ${GLOBAL_ELEMENT_LIMITS.footerGroupLinks}. Pages chosen for the footer are listed separately.`}
                  links={setup.footer.groups[0]?.links ?? []}
                  onChange={links =>
                    setSetup({
                      ...setup,
                      footer: {
                        ...setup.footer,
                        groups: links.length
                          ? [{ heading: setup.footer.groups[0]?.heading ?? 'Useful links', links }]
                          : [],
                      },
                    })
                  }
                />
                <p className="hint">
                  Add logos, contact details, and links to the site’s own pages in Header & footer after the site is
                  created.
                </p>
              </>
            )}
            {step === 4 && (
              <>
                <p className="wizard-lede">
                  This creates the site and its {setup.pages.length} pages as private drafts. Nothing is visible to the
                  public yet.
                </p>
                <dl className="wizard-review">
                  <div>
                    <dt>Name</dt>
                    <dd>{setup.name}</dd>
                  </div>
                  <div>
                    <dt>Address</dt>
                    <dd>
                      {managedStaging
                        ? 'A secure test address will be assigned when you create the site.'
                        : `${setup.slug}.${stagingBase || 'staging address pending'}`}
                    </dd>
                  </div>
                  <div>
                    <dt>Look</dt>
                    <dd>{lookSummary(setup.theme)}</dd>
                  </div>
                  <div>
                    <dt>Pages</dt>
                    <dd>
                      {setup.pages.length} {setup.pages.length === 1 ? 'page' : 'pages'}
                    </dd>
                  </div>
                  {setup.header.partner && (
                    <div>
                      <dt>Partner</dt>
                      <dd>
                        {setup.header.partner.label} {setup.header.partner.name}
                      </dd>
                    </div>
                  )}
                  {(setup.header.utilityLinks.length > 0 || setup.footer.groups.length > 0) && (
                    <div>
                      <dt>Links on every page</dt>
                      <dd>
                        {[
                          setup.header.utilityLinks.length
                            ? `Header: ${setup.header.utilityLinks.map(link => link.label).join(', ')}`
                            : '',
                          setup.footer.groups.length
                            ? `Footer: ${setup.footer.groups
                                .flatMap(group => group.links)
                                .map(link => link.label)
                                .join(', ')}`
                            : '',
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </dd>
                    </div>
                  )}
                </dl>
                <ul className="wizard-review-pages" aria-label="Planned pages">
                  {setup.pages.map((page, index) => (
                    <li key={index}>
                      <strong>{page.title || 'Untitled page'}</strong> <code>/{page.slug}</code>
                      <span>
                        {CORE_PAGE_TEMPLATES.find(
                          template =>
                            template.id === (page.template ?? (page.layout !== 'content' ? page.layout : 'blank')),
                        )?.name ?? LAYOUTS[page.layout]}
                        {pageNotes(setup.pages, index)}
                      </span>
                    </li>
                  ))}
                </ul>
                <p className="notice notice-info">
                  <span className="notice-body">
                    <strong>What happens next.</strong> The site is created privately. Open its home page, make it
                    yours, and press Publish: the site goes live with everything you chose here. Until then only your
                    team can see it.
                  </span>
                </p>
              </>
            )}
          </fieldset>
          <div className="actions wizard-actions">
            {step > 0 && (
              <button type="button" className="secondary" disabled={pending || reading} onClick={() => move(step - 1)}>
                Back
              </button>
            )}
            {step < 4 ? (
              <button type="button" disabled={pending || reading} onClick={() => move(step + 1)}>
                Continue
              </button>
            ) : (
              <button type="button" className="navy" disabled={pending || reading || !stagingBase} onClick={submit}>
                {pending ? 'Creating site…' : 'Create site'}
              </button>
            )}
            {!pending && (
              <Link className="btn ghost" href="/">
                Cancel setup
              </Link>
            )}
          </div>
        </section>
        <aside className={`wizard-summary card${step === 1 ? ' is-look' : ''}`} aria-label="Site setup summary">
          <SitePreview setup={setup} />
          {step !== 1 && (
            <>
              <h3>Planned pages</h3>
              <ol>
                {setup.pages.map((page, index) => (
                  <li key={index}>{page.title || 'Untitled page'}</li>
                ))}
              </ol>
            </>
          )}
          <details className="wizard-summary-tools">
            <summary>Reuse these choices for another site</summary>
            <p className="hint">
              Save these choices as a file, or start from a file saved earlier. To move a whole site with its pages and
              files, use Import an existing site instead.
            </p>
            <div className="cluster">
              <button type="button" className="secondary small" disabled={pending || reading} onClick={exportSetup}>
                Save choices
              </button>
              <button
                type="button"
                className="secondary small"
                disabled={pending || reading}
                onClick={() => file.current?.click()}
              >
                Load choices
              </button>
            </div>
          </details>
          <input
            disabled={pending || reading}
            ref={file}
            type="file"
            accept="application/json,.json"
            hidden
            onChange={event => {
              const selected = event.target.files?.[0]
              event.target.value = ''
              void importSetup(selected)
            }}
          />
        </aside>
      </div>
      {switchKind && (
        <ConfirmDialog
          title="Replace the planned pages?"
          what="Changing the starter replaces the pages currently planned in this setup."
          reassurance="Your site name, colours, header, and footer choices stay unchanged. No site has been created yet."
          confirmLabel="Replace planned pages"
          onCancel={() => setSwitchKind(null)}
          onConfirm={() => kind(switchKind)}
        />
      )}
    </div>
  )
}
