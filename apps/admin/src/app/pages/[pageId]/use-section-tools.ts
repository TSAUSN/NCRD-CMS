import { useEffect, useRef, useState, useTransition } from 'react'
import type { SectionToolSource, SectionLinkReview } from '../../../lib/section-tools-commands.ts'
import { validSectionAnchor } from '@cms/schema'
import { useNavigationGuard, requestLocalDraftNavigation } from '../../../components/navigation-guard.ts'
import {
  loadSectionLink,
  loadSectionCopyChoices,
  saveSectionCopy,
  type saveSectionLink,
} from './section-tools-actions.ts'

type CopyPage = { id: string; title: string; revision: string; sections: { label: string }[] }
export type SectionToolsProps = {
  kind: 'link' | 'copy'
  source: SectionToolSource | null
  origin: string | null
  siteId: string
  onClose: (reload?: boolean) => void
  onRename: (
    input: SectionToolSource & { name: string; fingerprint: string },
  ) => Promise<Awaited<ReturnType<typeof saveSectionLink>>>
}

export function useSectionTools({ kind, source, origin, onClose, onRename }: SectionToolsProps) {
  const [review, setReview] = useState<SectionLinkReview | null>(null)
  const [pages, setPages] = useState<CopyPage[]>([])
  const [name, setName] = useState('')
  const [targetId, setTargetId] = useState('')
  const [at, setAt] = useState('')
  const [loading, setLoading] = useState(true)
  const [actionPending, setPending] = useState(false)
  const [transitionPending, startTransition] = useTransition()
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [retry, setRetry] = useState(0)
  const [copied, setCopied] = useState<{ pageId: string; title: string } | null>(null)
  const [done, setDone] = useState(false)
  const busy = useRef(false)
  const applied = useRef(false)
  const touched = useRef(false)
  const addressInput = useRef<HTMLInputElement>(null)
  const reloadSource = useRef(false)
  const pending = actionPending || transitionPending
  const target = pages.find(page => page.id === targetId)
  const dirty = !done && (kind === 'link' ? Boolean(review && name !== review.name) : Boolean(targetId))
  const valid =
    kind === 'link'
      ? Boolean(review && !review.unsafe && validSectionAnchor(name))
      : Boolean(
          target &&
          at !== '' &&
          Number.isInteger(Number(at)) &&
          Number(at) >= 0 &&
          Number(at) <= target.sections.length,
        )
  const address = review ? (origin ?? '') + review.path + '#' + name : ''
  useEffect(() => {
    let active = true
    if (!source) return
    setLoading(true)
    setError('')
    setNotice('')
    const request = kind === 'link' ? loadSectionLink(source) : loadSectionCopyChoices(source)
    void request
      .then(result => {
        if (!active) return
        if (!result.ok) {
          if (result.kind === 'conflict') reloadSource.current = true
          setError(result.message)
          return
        }
        if ('fingerprint' in result) {
          setReview(result)
          if (!touched.current) setName(result.name || result.suggested)
        } else {
          setPages(result.pages)
          setAt('')
        }
      })
      .catch(() => {
        if (active) setError('This section step could not be loaded. Try again, or return to the section.')
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [source, kind, retry])
  function save(): Promise<{ ok: boolean; message?: string }> {
    return new Promise(resolve =>
      startTransition(async () => {
        resolve(await performSave())
      }),
    )
  }
  async function performSave() {
    if (done || applied.current) return { ok: true }
    if (!source || busy.current) return { ok: false, message: 'Wait for this section step to finish.' }
    if (!valid) {
      const message =
        kind === 'link'
          ? 'Use a unique link name starting with a letter, with lowercase letters, numbers and hyphens.'
          : 'Choose a page and a place for the copy.'
      setError(message)
      return { ok: false, message }
    }
    busy.current = true
    setPending(true)
    setError('')
    try {
      if (kind === 'link') {
        const result = await onRename({ ...source, name, fingerprint: review!.fingerprint })
        if (!result.ok) {
          if (result.kind === 'conflict') reloadSource.current = true
          setError(result.message)
          return { ok: false, message: result.message }
        }
        applied.current = true
        setDone(true)
        setNotice(result.message)
        return { ok: true }
      }
      const result = await saveSectionCopy({
        ...source,
        targetPageId: target!.id,
        targetRevision: target!.revision,
        at: Number(at),
      })
      if (!result.ok) {
        if (result.kind === 'conflict') reloadSource.current = true
        setError(result.message)
        return { ok: false, message: result.message }
      }
      applied.current = true
      setCopied({ pageId: result.pageId, title: result.title })
      setDone(true)
      setNotice(result.message)
      return { ok: true }
    } catch {
      const message = 'The result could not be confirmed. Check the affected page drafts before trying again.'
      setError(message)
      return { ok: false, message }
    } finally {
      busy.current = false
      setPending(false)
    }
  }
  const read = () => ({
    dirty: dirty && !applied.current,
    pending: pending || busy.current,
    draft: {
      label: kind === 'link' ? 'Section link name' : 'Section copy',
      saved: false,
      saveDraft: save,
      discard: () => {
        setName(review?.name ?? '')
        setTargetId('')
        setAt('')
      },
    },
  })
  useNavigationGuard(read)
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if ((dirty && !applied.current) || busy.current) event.preventDefault()
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])
  function close() {
    const leave = () => onClose(reloadSource.current || (kind === 'link' && applied.current))
    if (requestLocalDraftNavigation(read, leave)) leave()
  }
  function changeName(value: string) {
    touched.current = true
    setName(value.toLowerCase())
  }
  function chooseTarget(id: string) {
    setTargetId(id)
    setAt('')
  }
  function retryStep() {
    setRetry(value => value + 1)
  }
  function cancel() {
    onClose(reloadSource.current)
  }
  async function copyLink() {
    if (!address || (name !== review?.name && !done)) return
    try {
      await navigator.clipboard.writeText(address)
      setNotice('Section link copied. Publish any changes before sharing it.')
    } catch {
      addressInput.current?.focus()
      addressInput.current?.select()
      setError('The link could not be copied automatically. Select the link address and copy it.')
    }
  }
  return {
    review,
    pages,
    name,
    targetId,
    target,
    at,
    setAt,
    loading,
    pending,
    error,
    notice,
    copied,
    done,
    addressInput,
    valid,
    address,
    close,
    save,
    copyLink,
    changeName,
    chooseTarget,
    retryStep,
    cancel,
  }
}
