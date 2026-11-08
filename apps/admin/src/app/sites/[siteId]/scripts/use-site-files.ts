import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { SiteFileView, type SiteFileBundle, type SiteFileKind } from '@cms/schema'
import { useNavigationGuard } from '../../../../components/navigation-guard.ts'
import { addReviewedFile, fileMoveTarget } from '../../../../lib/site-file-bundle.ts'
import { approveSiteFiles } from './actions.ts'

type FileView = import('@cms/schema').SiteFileView
type Version = { id: string; version: string; bundle: SiteFileBundle; reviewed_at: string }
export type SiteFilesProps = {
  nativeResources: { kind: 'media' | 'asset'; id: string; name: string; bytes: number; source: string }[]
  siteId: string
  siteName: string
  archived: boolean
  revision: string
  draftVersionId: string | null
  publishedVersionId: string | null
  files: FileView[]
  bundle: SiteFileBundle
  versions: Version[]
  pages: { id: string; title: string }[]
}

export function useSiteFiles(props: SiteFilesProps) {
  const [bundle, setBundle] = useState(props.bundle)
  const [baseline, setBaseline] = useState(props.bundle)
  const [revision, setRevision] = useState(props.revision)
  const [savedVersion, setSavedVersion] = useState(props.draftVersionId)
  const [files, setFiles] = useState(props.files)
  const [localFile, setLocalFile] = useState<File | null>(null)
  const [source, setSource] = useState('')
  const [kind, setKind] = useState<SiteFileKind>('script')
  const [replacement, setReplacement] = useState<string | undefined>()
  const [busy, setBusy] = useState(false)
  const [review, setReview] = useState(false)
  const [ack, setAck] = useState(false)
  const [notice, setNotice] = useState<{ error: boolean; text: string } | null>(null)
  const inFlight = useRef(false)
  const fileInput = useRef<HTMLInputElement>(null)
  const alert = useRef<HTMLParagraphElement>(null)
  const dirty = JSON.stringify(bundle) !== JSON.stringify(baseline)
  const unsaved = useRef(dirty || !!localFile)
  useLayoutEffect(() => {
    unsaved.current = dirty || !!localFile
  }, [dirty, localFile])
  const byId = new Map(files.map(file => [file.id, file]))
  useNavigationGuard(() => ({ dirty: unsaved.current, pending: inFlight.current }))
  useEffect(() => {
    if (notice?.error) alert.current?.focus()
  }, [notice])
  useEffect(() => {
    const guard = (event: BeforeUnloadEvent) => {
      if (unsaved.current || inFlight.current) {
        event.preventDefault()
        event.returnValue = ''
      }
    }
    window.addEventListener('beforeunload', guard)
    return () => window.removeEventListener('beforeunload', guard)
  }, [])
  function beginReview() {
    setAck(false)
    setNotice(null)
    setReview(true)
  }
  async function upload() {
    if (inFlight.current || !localFile || props.archived) return
    inFlight.current = true
    setBusy(true)
    setNotice(null)
    try {
      const response = await fetch('/api/sites/' + props.siteId + '/files', {
        method: 'POST',
        headers: {
          'content-type': 'application/octet-stream',
          'x-site-file-name': encodeURIComponent(localFile.name),
          'x-site-file-source': encodeURIComponent(source),
          'x-site-file-kind': kind,
        },
        body: localFile,
      })
      const result = await response.json()
      if (!response.ok)
        throw new Error(typeof result.error === 'string' ? result.error : 'The file could not be added.')
      const file = SiteFileView.parse(result.file)
      setBundle(current => addReviewedFile(current, file, replacement))
      setFiles(current => (current.some(old => old.id === file.id) ? current : [...current, file]))
      setLocalFile(null)
      setSource('')
      setReplacement(undefined)
      if (fileInput.current) fileInput.current.value = ''
      setNotice({
        error: false,
        text: 'File added to your choices. Review the complete list before approving it; nothing has been published.',
      })
    } catch (error) {
      setNotice({ error: true, text: error instanceof Error ? error.message : 'The file could not be added.' })
    } finally {
      inFlight.current = false
      setBusy(false)
    }
  }
  async function approve() {
    if (inFlight.current || !ack || props.archived) return
    inFlight.current = true
    setBusy(true)
    try {
      const result = await approveSiteFiles(props.siteId, revision, bundle, ack)
      if (!result.ok) {
        setNotice({ error: true, text: result.message })
        return
      }
      setRevision(result.revision)
      setSavedVersion(result.versionId)
      unsaved.current = !!localFile
      setBaseline(structuredClone(bundle))
      setReview(false)
      setNotice({ error: false, text: 'Reviewed version saved. Publish it through the site release when ready.' })
    } catch {
      setNotice({
        error: true,
        text: 'The review could not be confirmed. Your choices are still here; refresh the current version before retrying.',
      })
    } finally {
      inFlight.current = false
      setBusy(false)
    }
  }
  function move(index: number, direction: -1 | 1, type: 'scripts' | 'styles') {
    setBundle(current => {
      const next = structuredClone(current)
      const items = next[type]
      const target = fileMoveTarget(current, type, index, direction)
      if (target < 0) return current
      ;[items[index], items[target]] = [items[target]!, items[index]!]
      return next
    })
  }
  function scope(type: 'scripts' | 'styles', index: number, pages: string[]) {
    setBundle(current => ({
      ...current,
      [type]: current[type].map((item, at) => (at === index ? { ...item, pages } : item)),
    }))
  }
  function futureScope(type: 'scripts' | 'styles', index: number, newPages: boolean) {
    setBundle(current => ({
      ...current,
      [type]: current[type].map((item, at) => (at === index ? { ...item, newPages } : item)),
    }))
  }
  return {
    bundle,
    setBundle,
    baseline,
    savedVersion,
    files,
    localFile,
    setLocalFile,
    source,
    setSource,
    setKind,
    replacement,
    setReplacement,
    busy,
    review,
    setReview,
    ack,
    setAck,
    notice,
    setNotice,
    fileInput,
    alert,
    dirty,
    byId,
    beginReview,
    upload,
    approve,
    move,
    scope,
    futureScope,
  }
}
export type SiteFilesModel = ReturnType<typeof useSiteFiles>
