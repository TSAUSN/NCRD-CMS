import { useEffect, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { useNavigationGuard, requestLocalDraftNavigation } from '../../../../components/navigation-guard.ts'
import { NationalSiteStart, NationalStartRequestId } from '@cms/schema'
import type { NationalSiteReview } from '../../../../lib/national-template.ts'
import { previewTemplateSite, reviewTemplateUpdate, createTemplateDrafts, createNationalSite } from './actions.ts'

export type NationalTemplateProps = { initial: NationalSiteReview[]; siteId: string; actorId: string }

export function useNationalTemplate({ initial, siteId, actorId }: NationalTemplateProps) {
  const router = useRouter()
  const [sites, setSites] = useState(initial)
  const [open, setOpen] = useState<'start' | 'review' | null>(null)
  const [pending, start] = useTransition()
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [selected, setSelected] = useState<string[]>([])
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [slugTouched, setSlugTouched] = useState(false)
  const [source, setSource] = useState<'copy' | 'templates' | 'home'>(initial.length ? 'copy' : 'templates')
  const [copy, setCopy] = useState(initial[0]?.id ?? '')
  const [words, setWords] = useState(false)
  const [stories, setStories] = useState(false)
  const request = useRef<string | null>(null)
  useEffect(() => setSites(initial), [initial])
  const [baseline, setBaseline] = useState('')
  const [restored, setRestored] = useState(false)
  const creating = useRef(false)
  const created = useRef(false)
  const key = 'cms.template-start.' + actorId + '.' + siteId,
    input = {
      name,
      slug,
      source,
      ...(source === 'copy' ? { sourceSiteId: copy } : {}),
      bringWords: words,
      bringStories: stories,
    },
    signature = JSON.stringify({ input, slugTouched }),
    dirty = open === 'start' && !created.current && signature !== baseline
  const saveSetup = async () => {
    const parsed = NationalSiteStart.safeParse(input)
    if (!parsed.success) {
      const field = parsed.error.issues[0]?.path[0]
      return {
        ok: false,
        message:
          field === 'name'
            ? 'Enter a site name of up to 120 characters.'
            : field === 'slug'
              ? 'Use lowercase words separated by hyphens for the test address, up to 40 characters.'
              : 'Choose a starting point and a current site to copy.',
      }
    }
    if (source === 'copy' && !sites.some(site => site.id === copy))
      return { ok: false, message: 'Choose a current site to copy before saving this setup.' }
    try {
      localStorage.setItem(key, JSON.stringify({ version: 1, input, slugTouched, requestId: request.current }))
      setBaseline(signature)
      setRestored(true)
      return { ok: true }
    } catch {
      return {
        ok: false,
        message: 'This browser could not save the setup. Keep editing, copy your choices, or discard these changes.',
      }
    }
  }
  const restoreInput = (value: typeof input, touched: boolean) => {
    setName(value.name)
    setSlug(value.slug)
    setSlugTouched(touched)
    setSource(value.source)
    setCopy(value.sourceSiteId ?? sites[0]?.id ?? '')
    setWords(value.bringWords)
    setStories(value.bringStories)
    setBaseline(JSON.stringify({ input: value, slugTouched: touched }))
  }
  const discardSetup = () => {
    try {
      const value = JSON.parse(baseline) as { input: typeof input; slugTouched: boolean }
      restoreInput(value.input, value.slugTouched)
      setError('')
    } catch {
      setName('')
      setSlug('')
      setWords(false)
      setStories(false)
    }
  }
  const leaveState = () => ({
    dirty,
    pending: pending || creating.current,
    draft: { label: 'Template site setup (saved only in this browser)', saveDraft: saveSetup, discard: discardSetup },
  })
  useNavigationGuard(leaveState)
  useEffect(() => {
    if (typeof window === 'undefined') return
    const warn = (event: BeforeUnloadEvent) => {
      if (dirty || pending || creating.current) event.preventDefault()
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty, pending])
  function clearSaved() {
    try {
      localStorage.removeItem(key)
      setRestored(false)
      return true
    } catch {
      setError('The saved browser setup could not be cleared. Keep your choices here and try again.')
      return false
    }
  }

  function startSite() {
    const fresh = {
      name: '',
      slug: '',
      source: sites.length ? ('copy' as const) : ('templates' as const),
      ...(sites.length ? { sourceSiteId: copy || sites[0]!.id } : {}),
      bringWords: false,
      bringStories: false,
    }
    created.current = false
    request.current = null
    setError('')
    setRestored(false)
    restoreInput(fresh, false)
    try {
      const saved = JSON.parse(localStorage.getItem(key) ?? 'null'),
        parsed = NationalSiteStart.safeParse(saved?.input)
      if (saved?.version === 1 && parsed.success) {
        restoreInput(parsed.data, saved.slugTouched === true)
        request.current = NationalStartRequestId.safeParse(saved.requestId).success ? saved.requestId : null
        setRestored(true)
        if (parsed.data.source === 'copy' && !sites.some(site => site.id === parsed.data.sourceSiteId))
          setError('The saved source site is unavailable. Choose a current site before creating or saving.')
      }
    } catch {
      /* Browser recovery is optional until explicitly saved. */
    }
    setOpen('start')
  }
  const [applying, setApplying] = useState(false)
  const [preview, setPreview] = useState<{ beforeHtml: string; html: string; pageTitle: string } | null>(null)
  const [previewSite, setPreviewSite] = useState('')
  async function loadPreview(id: string) {
    setPreviewSite(id)
    setError('')
    setPreview(null)
    const result = await previewTemplateSite(id)
    if (!result.ok) {
      setError(result.message)
      setPreview(null)
      return
    }
    setPreview(result)
  }
  function review() {
    setOpen('review')
    setError('')
    setPreview(null)
    start(async () => {
      const result = await reviewTemplateUpdate()
      if (!result.ok) {
        setError(result.message)
        return
      }
      setSites(result.sites)
      const chosen = result.sites.filter(site => site.themeChanged || site.changedPages.length)
      setSelected(chosen.map(site => site.id))
      const first = chosen[0] ?? result.sites[0]
      if (first) await loadPreview(first.id)
    })
  }
  function close() {
    if (pending || creating.current) return
    const proceed = () => {
      setOpen(null)
      setError('')
    }
    if (requestLocalDraftNavigation(leaveState, proceed)) proceed()
  }
  function apply() {
    setError('')
    setApplying(true)
    start(async () => {
      try {
        const result = await createTemplateDrafts(
          sites.filter(site => selected.includes(site.id)).map(({ id, fingerprint }) => ({ id, fingerprint })),
        )
        if (!result.ok) {
          setError(result.message)
          return
        }
        setNotice(
          `Created drafts on ${result.sites} ${result.sites === 1 ? 'site' : 'sites'}. Open Publish on each site to review them.`,
        )
        setOpen(null)
        router.refresh()
      } finally {
        setApplying(false)
      }
    })
  }
  function create() {
    if (creating.current) return
    creating.current = true
    setError('')
    start(async () => {
      try {
        request.current ??= crypto.randomUUID()
        const result = await createNationalSite(request.current, input)
        if (!result.ok) {
          setError(result.message)
          return
        }
        created.current = true
        try {
          localStorage.removeItem(key)
        } catch {
          /* The created site and request result are authoritative. */
        }
        router.push('/sites/' + result.siteId)
      } catch {
        setError('Creation could not be confirmed. Check Sites before retrying; this setup keeps the same request.')
      } finally {
        creating.current = false
      }
    })
  }

  function editName(value: string) {
    setName(value)
    if (!slugTouched)
      setSlug(
        value
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-|-$/g, '')
          .slice(0, 40),
      )
  }

  function editSlug(value: string) {
    setSlugTouched(true)
    setSlug(value)
  }

  function choosePreview(id: string) {
    start(() => loadPreview(id))
  }

  function selectSite(id: string, checked: boolean) {
    setSelected(ids => (checked ? [...ids, id] : ids.filter(selected => selected !== id)))
  }

  return {
    sites,
    open,
    pending,
    error,
    notice,
    selected,
    name,
    slug,
    source,
    setSource,
    copy,
    setCopy,
    words,
    setWords,
    stories,
    setStories,
    restored,
    applying,
    preview,
    previewSite,
    startSite,
    close,
    review,
    apply,
    create,
    editName,
    editSlug,
    choosePreview,
    selectSite,
    clearSetup: () => {
      if (clearSaved()) startSite()
    },
  }
}

export type NationalTemplateModel = ReturnType<typeof useNationalTemplate>
