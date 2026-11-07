'use client'
import { useEffect, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { GuardedLink as Link } from '../../../../components/guarded-link.tsx'
import { useNavigationGuard, requestLocalDraftNavigation } from '../../../../components/navigation-guard.ts'
import { NationalSiteStart, NationalStartRequestId } from '@cms/schema'
import { Button, Card, Dialog, Field, PageHeader, Note, ActionNote } from '../../../../components/ui/index.ts'
import { TemplateUpdateSites } from '../../../../components/template-update-sites.tsx'
import type { NationalSiteReview } from '../../../../lib/national-template.ts'
import { previewTemplateSite, reviewTemplateUpdate, createTemplateDrafts, createNationalSite } from './actions.ts'
import { ScriptlessPreview } from '../../../../components/scriptless-preview.tsx'
import { IconLock, IconCheck } from '../../../../components/icons.tsx'
import styles from '../../../../components/workspace.module.css'
import recordTableStyles from '../../../../components/workspace-styles/record-table.module.css'
import siteSummaryStyles from '../../../../components/workspace-styles/site-summary.module.css'
import listInspectorStyles from '../../../../components/workspace-styles/list-inspector.module.css'
import ownedStyles from './workspace-styles.module.css'
const shared = [
  ['Colours and buttons', 'National red, navy and button styles'],
  ['Approved fonts', 'Fonts from the Adobe Fonts kit'],
  ['Header and footer design', 'Floating header, navy footer'],
  ['Page rule', 'All content sits in a white box on the grey page'],
  ['Hover and motion', 'Tile outline, hero chevrons, reduced motion'],
  ['Shared sections', 'Hero, cards, tiles, stories, FAQ, contact and more'],
]
const own = [
  ['Logo', 'Each site uploads its own'],
  ['Heading font', 'Chosen from the approved fonts'],
  ['Menu', 'Each site builds its own'],
  ['Footer text and links', 'Each site writes its own'],
  ['Pages and content', 'Words, photos and stories'],
  ['Tags', 'Each site names its own'],
]
export function NationalTemplateWorkspace({
  initial,
  siteId,
  actorId,
}: {
  initial: NationalSiteReview[]
  siteId: string
  actorId: string
}) {
  const router = useRouter(),
    [sites, setSites] = useState(initial),
    [open, setOpen] = useState<'start' | 'review' | null>(null),
    [pending, start] = useTransition(),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [selected, setSelected] = useState<string[]>([])
  const [name, setName] = useState(''),
    [slug, setSlug] = useState(''),
    [slugTouched, setSlugTouched] = useState(false),
    [source, setSource] = useState<'copy' | 'templates' | 'home'>(initial.length ? 'copy' : 'templates'),
    [copy, setCopy] = useState(initial[0]?.id ?? ''),
    [words, setWords] = useState(false),
    [stories, setStories] = useState(false),
    request = useRef<string | null>(null)
  useEffect(() => setSites(initial), [initial])
  const [baseline, setBaseline] = useState(''),
    [restored, setRestored] = useState(false),
    creating = useRef(false),
    created = useRef(false)
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
  const [preview, setPreview] = useState<{ beforeHtml: string; html: string; pageTitle: string } | null>(null),
    [previewSite, setPreviewSite] = useState('')
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
  return (
    <>
      <PageHeader
        density="compact"
        showWayfinding={false}
        title="National template"
        lede="The one design SAWSO and Echelon share. Change it here and it can be rolled out to both."
        actions={
          <>
            <Button variant={sites.length ? 'secondary' : 'primary'} onClick={startSite}>
              Start a site from this
            </Button>
            {!!sites.length && <Button onClick={review}>Review an update</Button>}
          </>
        }
      />
      <Note icon={<IconLock size={16} />}>
        Only Super admins see this screen. Editors never change the template, so sites stay matched to the national
        look.
      </Note>
      {notice && (
        <p role="status" className="notice">
          {notice}
        </p>
      )}
      <div className={styles.threeColumns}>
        <Card density="summary" title="Sites using it">
          {!sites.length && <p>No sites use this template yet. Start a site from this to add one.</p>}
          <ul className={siteSummaryStyles.rowList}>
            {sites.map(site => (
              <li key={site.id}>
                <div className={recordTableStyles.rowCopy}>
                  <Link href={'/sites/' + site.id}>{site.name}</Link>
                </div>
                <span className="muted">
                  {!site.connected
                    ? 'Ready to connect'
                    : site.themeChanged || site.changedPages.length
                      ? 'Update waiting'
                      : 'Up to date'}
                </span>
              </li>
            ))}
          </ul>
          <p className="muted">
            Sites brought in with their own design, like Better Together 2027, don't use this template.
          </p>
        </Card>
        <Card density="summary" title="Comes from the template">
          <p className="muted">The same on every site.</p>
          <ul className={siteSummaryStyles.rowList}>
            {shared.map(([title, text]) => (
              <li key={title}>
                <IconLock size={14} />
                <div className={recordTableStyles.rowCopy}>
                  <strong>
                    {title === 'Shared sections' ? <Link href={'/sites/' + siteId + '/sections'}>{title}</Link> : title}
                  </strong>
                  <span className="muted">{text}</span>
                </div>
              </li>
            ))}
          </ul>
        </Card>
        <Card density="summary" title="Each site sets its own">
          <p className="muted">Editors with the right role can change these.</p>
          <ul className={siteSummaryStyles.rowList}>
            {own.map(([title, text]) => (
              <li key={title}>
                <IconCheck size={14} />
                <div className={recordTableStyles.rowCopy}>
                  <strong>{title}</strong>
                  <span className="muted">{text}</span>
                </div>
              </li>
            ))}
          </ul>
          <p>Sites may change their colours</p>
          <p className="muted">
            {sites.some(site => site.mayChangeColours)
              ? 'Allowed only on sites with that permission.'
              : 'Off for these sites.'}
          </p>
        </Card>
      </div>
      {open === 'review' && (
        <Dialog
          size="large"
          title="Review the national template update"
          pending={pending}
          onClose={close}
          footer={
            <>
              <Button variant="secondary" onClick={close} disabled={pending}>
                Not now
              </Button>
              <Button onClick={apply} disabled={pending || !selected.length || !preview || !!error}>
                {pending && applying
                  ? 'Creating drafts…'
                  : `Create drafts on ${selected.length} ${selected.length === 1 ? 'site' : 'sites'}`}
              </Button>
            </>
          }
        >
          <p>Applying creates a draft on each chosen site, so it can be checked first.</p>
          {pending && (
            <p role="status">
              {applying
                ? 'Creating private drafts. This may take up to a minute.'
                : 'Preparing the preview. This may take up to a minute.'}
            </p>
          )}
          {error && <p role="alert">{error}</p>}
          {!!sites.length && (
            <Field id="national-preview-site" label="Preview on">
              <select
                value={previewSite}
                disabled={pending}
                onChange={event =>
                  start(async () => {
                    setError('')
                    await loadPreview(event.target.value)
                  })
                }
              >
                {sites.map(site => (
                  <option key={site.id} value={site.id}>
                    {site.name}
                  </option>
                ))}
              </select>
            </Field>
          )}
          {preview && (
            <>
              <p>{preview.pageTitle}</p>
              <div className={styles.grid}>
                <div>
                  <strong>Before</strong>
                  <ScriptlessPreview
                    className={ownedStyles.comparisonFrame}
                    title="Before national template update"
                    srcDoc={preview.beforeHtml}
                  />
                </div>
                <div>
                  <strong>After</strong>
                  <ScriptlessPreview
                    className={ownedStyles.comparisonFrame}
                    title="After national template update"
                    srcDoc={preview.html}
                  />
                </div>
              </div>
            </>
          )}
          <TemplateUpdateSites
            sites={sites}
            selected={selected}
            pending={pending}
            onSelect={(id, checked) =>
              setSelected(ids => (checked ? [...ids, id] : ids.filter(selected => selected !== id)))
            }
          />
        </Dialog>
      )}
      {open === 'start' && (
        <Dialog
          title="Start a site from the national template"
          pending={pending}
          onClose={close}
          footer={
            <>
              <ActionNote>
                Save draft and leave keeps these choices only in this browser. It creates no site.
              </ActionNote>
              <Button variant="secondary" onClick={close} disabled={pending}>
                Cancel
              </Button>
              <Button
                onClick={create}
                disabled={
                  pending ||
                  !name.trim() ||
                  !slug ||
                  (source === 'copy' && (!copy || !sites.some(site => site.id === copy)))
                }
              >
                {pending ? 'Creating private site…' : 'Create private site'}
              </Button>
            </>
          }
        >
          <fieldset disabled={pending} className={listInspectorStyles.formStack + ' ' + ownedStyles.plainFieldset}>
            {restored && (
              <p role="status">Setup restored from this browser. Check its source and choices before creating.</p>
            )}
            {restored && (
              <Button
                variant="secondary"
                onClick={() => {
                  if (clearSaved()) startSite()
                }}
              >
                Clear saved setup
              </Button>
            )}
            <Field id="national-site-name" label="Site name" required>
              <input
                value={name}
                maxLength={120}
                onChange={event => {
                  setName(event.target.value)
                  if (!slugTouched)
                    setSlug(
                      event.target.value
                        .toLowerCase()
                        .replace(/[^a-z0-9]+/g, '-')
                        .replace(/^-|-$/g, '')
                        .slice(0, 40),
                    )
                }}
              />
            </Field>
            <Field
              id="national-site-address"
              label="Test address"
              help="The site stays private until its first publish."
              required
            >
              <input
                value={slug}
                maxLength={40}
                onChange={event => {
                  setSlugTouched(true)
                  setSlug(event.target.value)
                }}
              />
            </Field>
            <p className="muted">{slug || '[site-name]'}.staging.localhost</p>
            <fieldset>
              <legend>Start with the pages from</legend>
              {(
                [
                  ['copy', 'A copy of a site'],
                  ['templates', 'A saved set of page templates'],
                  ['home', 'Home page only'],
                ] as const
              )
                .filter(([value]) => value !== 'copy' || sites.length > 0)
                .map(([value, label]) => (
                  <label key={value}>
                    <input
                      type="radio"
                      name="national-source"
                      checked={source === value}
                      onChange={() => setSource(value)}
                    />{' '}
                    {label}
                  </label>
                ))}
            </fieldset>
            {source === 'copy' && (
              <Field id="national-copy-source" label="Site to copy">
                <select value={copy} onChange={event => setCopy(event.target.value)}>
                  {!sites.some(site => site.id === copy) && (
                    <option value={copy} disabled>
                      Saved source is unavailable — choose a current site
                    </option>
                  )}
                  {sites.map(site => (
                    <option key={site.id} value={site.id}>
                      {site.name}
                    </option>
                  ))}
                </select>
              </Field>
            )}
            <label>
              <input type="checkbox" checked={words} onChange={event => setWords(event.target.checked)} /> Bring the
              words too
            </label>
            {source === 'copy' && (
              <label>
                <input type="checkbox" checked={stories} onChange={event => setStories(event.target.checked)} /> Bring
                the stories and tags
              </label>
            )}
            <p>
              Next you'll add the logo, build the menu and write the footer. The new site stays private until its first
              publish.
            </p>
            {pending && <p role="status">Creating the site and checking its content. This may take up to a minute.</p>}
            {error && <p role="alert">{error}</p>}
          </fieldset>
        </Dialog>
      )}
    </>
  )
}
