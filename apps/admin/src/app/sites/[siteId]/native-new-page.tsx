'use client'
import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { CORE_PAGE_TEMPLATES } from '@cms/seeds/core-templates'
import { Button, Dialog, Field } from '../../../components/ui/index.ts'
import { IconPlus } from '../../../components/icons.tsx'
import { useNavigationGuard, requestClientNavigation } from '../../../components/navigation-guard.ts'
import { createNativePage } from './page-list-actions.ts'
import shared from '../../../components/workspace.module.css'
type PageChoice = { id: string; title: string; revision: string }
export function NativeNewPage({
  siteId,
  canAdmin,
  pages,
  asTask = false,
}: {
  siteId: string
  canAdmin: boolean
  pages: PageChoice[]
  asTask?: boolean
}) {
  const [open, setOpen] = useState(false),
    [notice, setNotice] = useState('')
  const openDialog = () => {
    setNotice('')
    setOpen(true)
  }
  return (
    <>
      {asTask ? (
        <button type="button" className={shared.task} onClick={openDialog}>
          <span className={shared.taskIcon}>
            <IconPlus size={18} />
          </span>
          <strong>Add a page</strong>
        </button>
      ) : (
        <Button onClick={openDialog}>
          <IconPlus size={16} />
          New page
        </Button>
      )}
      {open && (
        <NewPageDialog
          siteId={siteId}
          canAdmin={canAdmin}
          pages={pages}
          onClose={() => setOpen(false)}
          onCreated={setNotice}
        />
      )}
      {notice && <p role="status">{notice}</p>}
    </>
  )
}
function NewPageDialog({
  siteId,
  canAdmin,
  pages,
  onClose,
  onCreated,
}: {
  siteId: string
  canAdmin: boolean
  pages: PageChoice[]
  onClose: () => void
  onCreated: (message: string) => void
}) {
  const router = useRouter(),
    [title, setTitle] = useState(''),
    [description, setDescription] = useState(''),
    [address, setAddress] = useState<string | null>(null),
    [changeAddress, setChangeAddress] = useState(false),
    [start, setStart] = useState<'blank' | 'design' | 'copy' | 'website'>('blank'),
    [template, setTemplate] = useState('landing'),
    [sourceId, setSourceId] = useState(pages[0]?.id ?? ''),
    [url, setUrl] = useState(''),
    [inMenu, setInMenu] = useState(false),
    [pending, setPending] = useState(false),
    [error, setError] = useState(''),
    [unknown, setUnknown] = useState(false),
    busy = useRef(false),
    created = useRef<{ pageId: string | null } | null>(null),
    titleInput = useRef<HTMLInputElement>(null)
  const slug =
      address ??
      title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, ''),
    dirty = Boolean(title || description || address || url || start !== 'blank'),
    valid = Boolean(
      title.trim() &&
      title.length <= 90 &&
      description.length <= 155 &&
      (start === 'website' ? /^https:\/\//.test(url) : slug && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) &&
      (start !== 'copy' || sourceId),
    )
  async function save() {
    if (created.current) return { ok: true }
    if (busy.current) return { ok: false, message: 'Wait for the draft to finish saving.' }
    if (unknown)
      return { ok: false, message: 'Check Pages before trying again. The previous result could not be confirmed.' }
    if (!valid) {
      const message = 'Complete the title and destination before saving.'
      setError(message)
      return { ok: false, message }
    }
    busy.current = true
    setPending(true)
    setError('')
    try {
      const source = pages.find(page => page.id === sourceId),
        result = await createNativePage({
          siteId,
          title,
          address: slug,
          description,
          start,
          template,
          sourceId,
          sourceRevision: source?.revision,
          url,
          inMenu,
        })
      if (!result.ok) {
        setError(result.message)
        if (result.message.includes('could not be confirmed')) setUnknown(true)
        return { ok: false, message: result.message }
      }
      created.current = { pageId: result.pageId }
      return { ok: true }
    } catch {
      const message = 'The draft could not be confirmed. Check Pages before trying again.'
      setUnknown(true)
      setError(message)
      return { ok: false, message }
    } finally {
      busy.current = false
      setPending(false)
    }
  }
  useNavigationGuard(() => ({
    dirty: dirty && !created.current,
    pending: pending || busy.current,
    draft: {
      label: start === 'website' ? 'New menu link' : 'New page',
      saved: false,
      saveDraft: save,
      discard: () => {
        created.current = { pageId: null }
      },
    },
  }))
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if ((dirty && !created.current) || busy.current) event.preventDefault()
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])
  const close = () => {
    if (requestClientNavigation(onClose)) onClose()
  }
  async function submit() {
    const saved = await save()
    if (saved.ok) {
      const id = created.current?.pageId
      if (!id) onCreated('Website link added to the menu draft. There is no page to edit. Review it in Publish.')
      onClose()
      if (id) router.push('/pages/' + id)
      else router.refresh()
    }
  }
  return (
    <Dialog
      title="New page"
      size="medium"
      onClose={close}
      pending={pending}
      initialFocus={titleInput}
      footer={
        <>
          <Button variant="secondary" disabled={pending} onClick={close}>
            Cancel
          </Button>
          <Button disabled={!valid || pending || unknown} onClick={() => void submit()}>
            {pending ? 'Creating draft…' : start === 'website' ? 'Add to menu draft' : 'Create draft'}
          </Button>
        </>
      }
    >
      <div className={shared.formStack}>
        <Field id="new-page-title" label="Page title" counter={title.length + ' of 90'}>
          <input
            ref={titleInput}
            required
            maxLength={90}
            value={title}
            onChange={event => setTitle(event.target.value)}
            disabled={pending}
          />
        </Field>
        {start !== 'website' && (
          <>
            <div className={shared.actions}>
              <span>Web address: /{slug}</span>
              <Button variant="tertiary" size="s" disabled={pending} onClick={() => setChangeAddress(value => !value)}>
                Change
              </Button>
            </div>
            {changeAddress && (
              <Field
                id="new-page-address"
                label="Web address"
                error={
                  address !== null && (!slug || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug))
                    ? 'Use lowercase letters, numbers and hyphens — for example about-us.'
                    : undefined
                }
              >
                <input
                  value={slug}
                  maxLength={160}
                  disabled={pending}
                  onChange={event => setAddress(event.target.value)}
                />
              </Field>
            )}
            <Field id="new-page-description" label="Description for search" counter={description.length + ' of 155'}>
              <input
                maxLength={155}
                disabled={pending}
                value={description}
                onChange={event => setDescription(event.target.value)}
                placeholder="One or two plain sentences about this page"
              />
            </Field>
          </>
        )}
        <Field id="new-page-start" label="Start from">
          <div className={shared.choiceRows} role="radiogroup" aria-labelledby="new-page-start-label">
            {[
              ['blank', 'A blank page', 'A title and some text'],
              ['design', 'A page design', 'Sector page, news page, event and more'],
              ['copy', 'A copy of a page', 'Any page on this site'],
              ...(canAdmin
                ? [['website', 'A link to another website', 'Adds it to the menu. There is no page to edit.']]
                : []),
            ].map(([value, label, hint]) => (
              <label key={value} className={shared.rowActions}>
                <input
                  className={shared.visuallyHidden}
                  type="radio"
                  name="page-start"
                  value={value}
                  checked={start === value}
                  disabled={pending}
                  onChange={() => setStart(value as typeof start)}
                />
                <span className={shared.rowCopy}>
                  <strong>{label}</strong>
                  <small>{hint}</small>
                </span>
              </label>
            ))}
          </div>
        </Field>
        {start === 'design' && (
          <Field id="new-page-design" label="Page design">
            <select value={template} disabled={pending} onChange={event => setTemplate(event.target.value)}>
              {CORE_PAGE_TEMPLATES.filter(item => item.id !== 'blank').map(item => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </Field>
        )}
        {start === 'copy' && (
          <Field id="new-page-source" label="Page to copy">
            <select value={sourceId} disabled={pending} onChange={event => setSourceId(event.target.value)}>
              <option value="">Choose a page</option>
              {pages.map(page => (
                <option key={page.id} value={page.id}>
                  {page.title}
                </option>
              ))}
            </select>
          </Field>
        )}
        {start === 'website' && (
          <Field id="new-page-website" label="Website address">
            <input
              type="url"
              value={url}
              disabled={pending}
              onChange={event => setUrl(event.target.value)}
              placeholder="https://example.org"
            />
          </Field>
        )}
        {canAdmin && start !== 'website' && (
          <label className={shared.toggleRow}>
            <span className={shared.rowCopy}>
              <strong>Add to the menu when it’s published</strong>
              <small>You can change this later.</small>
            </span>
            <input
              type="checkbox"
              checked={inMenu}
              disabled={pending}
              onChange={event => setInMenu(event.target.checked)}
            />
          </label>
        )}
        {error && <p role="alert">{error}</p>}
        {unknown && (
          <Button
            variant="secondary"
            onClick={() => {
              created.current = { pageId: null }
              onClose()
              router.refresh()
            }}
          >
            Check Pages
          </Button>
        )}
      </div>
    </Dialog>
  )
}
