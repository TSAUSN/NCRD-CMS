import { useEffect, useRef, useState } from 'react'
import { notifySiteChoicesChanged } from '../../../components/sidebar-data.tsx'
import { useNavigationGuard, requestLocalDraftNavigation } from '../../../components/navigation-guard.ts'
import {
  readImportRecovery,
  saveImportRecovery,
  removeImportRecovery,
  type ImportRecovery,
} from '../../../lib/site-import-recovery.ts'
import {
  MAX_SITE_ARCHIVE_BYTES,
  parseSiteArchive,
  requiresSiteFileReview,
  SiteArchiveDestination,
  type SiteArchive,
} from '@cms/schema'

type ImportDraft = {
  archive: SiteArchive | null
  source: string
  sourceId: string
  fileName: string
  name: string
  slug: string
  reviewedSiteFiles: boolean
}
const EMPTY_IMPORT_DRAFT: ImportDraft = {
  archive: null,
  source: '',
  sourceId: '',
  fileName: '',
  name: '',
  slug: '',
  reviewedSiteFiles: false,
}

function importSignature({
  sourceId,
  name,
  slug,
  reviewedSiteFiles,
}: Pick<ImportDraft, 'sourceId' | 'name' | 'slug' | 'reviewedSiteFiles'>) {
  return JSON.stringify({ sourceId, name, slug, reviewedSiteFiles })
}

function parseRecovery(record: ImportRecovery): ImportDraft {
  if (
    record.version !== 1 ||
    typeof record.source !== 'string' ||
    new Blob([record.source]).size > MAX_SITE_ARCHIVE_BYTES ||
    typeof record.sourceId !== 'string' ||
    typeof record.fileName !== 'string' ||
    record.fileName.length > 255 ||
    typeof record.name !== 'string' ||
    record.name.length > 120 ||
    typeof record.slug !== 'string' ||
    record.slug.length > 40
  )
    throw new Error('Invalid recovery')

  return {
    archive: parseSiteArchive(JSON.parse(record.source)),
    source: record.source,
    sourceId: record.sourceId,
    fileName: record.fileName,
    name: record.name,
    slug: record.slug,
    reviewedSiteFiles: false,
  }
}

export function useSiteImportDraft(actorId: string) {
  const [reviewedSiteFiles, setReviewedSiteFiles] = useState(false)
  const [archive, setArchive] = useState<SiteArchive | null>(null)
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const [siteId, setSiteId] = useState<string | null>(null)
  const request = useRef<string | null>(null)
  const submitting = useRef(false)
  const reading = useRef(false)
  const [recovering, setRecovering] = useState(true)
  const [saving, setSaving] = useState(false)
  const [hasRecovery, setHasRecovery] = useState(false)
  const [recoveryError, setRecoveryError] = useState('')
  const [sourceId, setSourceId] = useState('')
  const [fileName, setFileName] = useState('')
  const baselineRequest = useRef<string | null>(null)
  const source = useRef('')
  const accepted = useRef(false)
  const baseline = useRef(EMPTY_IMPORT_DRAFT)
  const [baselineSignature, setBaselineSignature] = useState(importSignature(EMPTY_IMPORT_DRAFT))
  const signature = importSignature({ sourceId, name, slug, reviewedSiteFiles })
  const dirty = !accepted.current && signature !== baselineSignature
  const busy = pending || recovering || saving
  function restore(value: ImportDraft) {
    setArchive(value.archive)
    source.current = value.source
    setSourceId(value.sourceId)
    setFileName(value.fileName)
    setName(value.name)
    setSlug(value.slug)
    setReviewedSiteFiles(value.reviewedSiteFiles)
    baseline.current = value
    setBaselineSignature(importSignature(value))
    setError(null)
    setRecoveryError('')
  }
  useEffect(() => {
    let active = true
    setRecovering(true)
    void (async () => {
      try {
        const record = (await readImportRecovery(actorId)) as ImportRecovery | undefined
        if (!active || !record) return
        setHasRecovery(true)
        restore(parseRecovery(record))
        baselineRequest.current = request.current =
          typeof record.requestId === 'string' &&
          /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(record.requestId)
            ? record.requestId
            : null
      } catch {
        if (active)
          setError('Saved import setup could not be opened in this browser. Keep the original archive and try again.')
      } finally {
        if (active) setRecovering(false)
      }
    })()
    return () => {
      active = false
    }
  }, [actorId])
  const saveSetup = async () => {
    if (!archive || !source.current)
      return { ok: false, message: 'Choose a supported content archive before saving this setup.' }
    setSaving(true)
    try {
      await saveImportRecovery(actorId, {
        version: 1,
        source: source.current,
        sourceId,
        fileName,
        name,
        slug,
        requestId: request.current,
      })
      baseline.current = { archive, source: source.current, sourceId, fileName, name, slug, reviewedSiteFiles }
      setBaselineSignature(signature)
      baselineRequest.current = request.current
      setHasRecovery(true)
      return { ok: true }
    } catch {
      return {
        ok: false,
        message:
          'This browser could not save the archive setup. Keep editing, keep the original file, or discard the changes.',
      }
    } finally {
      setSaving(false)
    }
  }
  const leaveState = () => ({
    dirty,
    pending: busy || submitting.current || reading.current,
    draft: {
      label: 'Import setup and archive (saved only in this browser)',
      saveDraft: saveSetup,
      discard: () => {
        restore(baseline.current)
        request.current = baselineRequest.current
      },
    },
  })
  useNavigationGuard(leaveState)
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (dirty || busy || submitting.current || reading.current) event.preventDefault()
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty, busy])
  async function clearSaved() {
    if (busy || reading.current) return
    setSaving(true)
    setError(null)
    setRecoveryError('')
    try {
      await removeImportRecovery(actorId)
      setHasRecovery(false)
      restore(EMPTY_IMPORT_DRAFT)
      baselineRequest.current = request.current = null
      accepted.current = false
      setSiteId(null)
    } catch {
      setRecoveryError('The saved import setup could not be cleared. Keep your choices here and try again.')
    } finally {
      setSaving(false)
    }
  }
  function changed() {
    request.current = null
    setSiteId(null)
    setError(null)
  }
  async function load(file?: File) {
    if (!file || busy || reading.current || submitting.current) return
    const choose = () => void readFile(file)
    if (requestLocalDraftNavigation(leaveState, choose)) choose()
  }
  async function readFile(file: File) {
    if (file.size > MAX_SITE_ARCHIVE_BYTES) {
      setError('Choose a content archive of 64 MB or smaller.')
      return
    }
    reading.current = true
    setSaving(true)
    setError(null)
    try {
      const text = await file.text(),
        content = parseSiteArchive(JSON.parse(text))
      changed()
      accepted.current = false
      source.current = text
      setArchive(content)
      setSourceId(crypto.randomUUID())
      setFileName(file.name)
      setReviewedSiteFiles(false)
      setName(`${content.content.site.name} copy`.slice(0, 120))
      setSlug(`${content.content.site.slug.slice(0, 35)}-copy`)
    } catch {
      setError(
        'This file is not a supported site content archive. Export one from Site settings; wizard setup files use a separate format.',
      )
    } finally {
      reading.current = false
      setSaving(false)
    }
  }
  const needsFileReview = archive !== null && requiresSiteFileReview(archive.content)

  async function submit() {
    if (!archive || submitting.current || busy || reading.current) return
    if (needsFileReview && !reviewedSiteFiles) {
      setError('Review every site file, its size and source before importing it.')
      return
    }
    const destination = SiteArchiveDestination.safeParse({ name, slug })
    if (!destination.success) {
      setError(
        destination.error.issues[0]?.path[0] === 'slug'
          ? 'Use lowercase words separated by hyphens for the new short address, up to 40 characters.'
          : 'Enter a new site name of up to 120 characters.',
      )
      return
    }
    submitting.current = true
    setPending(true)
    setError(null)
    request.current ??= crypto.randomUUID()
    try {
      const response = await fetch('/api/sites/import', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          requestId: request.current,
          destination: destination.data,
          archive,
          ...(needsFileReview ? { reviewedSiteFiles } : {}),
        }),
      })
      const result = (await response.json()) as { siteId?: string; message?: string }
      if (!response.ok || !result.siteId)
        throw new Error(result.message ?? 'Import could not be confirmed. Retry with the same file and destination.')
      accepted.current = true
      notifySiteChoicesChanged()
      setSiteId(result.siteId)
      baseline.current = EMPTY_IMPORT_DRAFT
      baselineRequest.current = null
      try {
        await removeImportRecovery(actorId)
        setHasRecovery(false)
      } catch {
        /* The imported site and request result are authoritative. */
      }
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Import could not be confirmed. Retry with the same file and destination.',
      )
    } finally {
      submitting.current = false
      setPending(false)
    }
  }

  return {
    archive,
    name,
    setName,
    slug,
    setSlug,
    reviewedSiteFiles,
    setReviewedSiteFiles,
    needsFileReview,
    error,
    pending,
    siteId,
    recovering,
    hasRecovery,
    recoveryError,
    fileName,
    busy,
    clearSaved,
    changed,
    load,
    submit,
  }
}

export type SiteImportDraft = ReturnType<typeof useSiteImportDraft>
