import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useNavigationGuard, requestClientNavigation } from '../../../components/navigation-guard.ts'
import { createNativePage } from './page-list-actions.ts'

export type NewPageSource = { id: string; title: string; revision: string }

export function useNativeNewPageDraft({
  siteId,
  pages,
  onClose,
  onCreated,
}: {
  siteId: string
  pages: NewPageSource[]
  onClose: () => void
  onCreated: (message: string) => void
}) {
  const router = useRouter()
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [address, setAddress] = useState<string | null>(null)
  const [start, setStart] = useState<'blank' | 'design' | 'copy' | 'website'>('blank')
  const [template, setTemplate] = useState('landing')
  const [sourceId, setSourceId] = useState(pages[0]?.id ?? '')
  const [url, setUrl] = useState('')
  const [inMenu, setInMenu] = useState(false)
  const [parentId, setParentId] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const [unknown, setUnknown] = useState(false)
  const busy = useRef(false)
  const created = useRef<{ pageId: string | null } | null>(null)
  const titleInput = useRef<HTMLInputElement>(null)
  const slug =
    address ??
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
  const dirty = Boolean(title || description || address || url || parentId || inMenu || start !== 'blank')
  const valid = Boolean(
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
      const source = pages.find(page => page.id === sourceId)
      const result = await createNativePage({
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
        parentId: parentId || null,
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
  function checkPages() {
    created.current = { pageId: null }
    onClose()
    router.refresh()
  }
  return {
    title,
    setTitle,
    description,
    setDescription,
    address,
    setAddress,
    start,
    setStart,
    template,
    setTemplate,
    sourceId,
    setSourceId,
    url,
    setUrl,
    inMenu,
    setInMenu,
    parentId,
    setParentId,
    pending,
    error,
    unknown,
    titleInput,
    slug,
    valid,
    close,
    submit,
    checkPages,
  }
}
