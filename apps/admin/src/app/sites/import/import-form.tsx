'use client'
import { Button, ButtonLink, Card, Field } from '../../../components/ui/index.ts'
import styles from './import.module.css'
import { useNavigationGuard, requestLocalDraftNavigation } from '../../../components/navigation-guard.ts'
import {
  readImportRecovery,
  saveImportRecovery,
  removeImportRecovery,
  type ImportRecovery,
} from '../../../lib/site-import-recovery.ts'
import { useEffect, useRef, useState } from 'react'
import {
  MAX_SITE_ARCHIVE_BYTES,
  parseSiteArchive,
  requiresSiteFileReview,
  SiteArchiveDestination,
  type SiteArchive,
} from '@cms/schema'
export function SiteImportForm({ actorId }: { actorId: string }) {
  const [reviewedSiteFiles, setReviewedSiteFiles] = useState(false)
  const [archive, setArchive] = useState<SiteArchive | null>(null)
  const [name, setName] = useState(''),
    [slug, setSlug] = useState('')
  const [error, setError] = useState<string | null>(null),
    [pending, setPending] = useState(false)
  const [siteId, setSiteId] = useState<string | null>(null)
  const request = useRef<string | null>(null),
    errorRef = useRef<HTMLParagraphElement | null>(null)
  useEffect(() => {
    if (error) {
      errorRef.current?.focus()
      errorRef.current?.scrollIntoView({ block: 'center' })
    }
  }, [error])
  const submitting = useRef(false),
    reading = useRef(false)
  const [recovering, setRecovering] = useState(true),
    [saving, setSaving] = useState(false),
    [hasRecovery, setHasRecovery] = useState(false),
    [recoveryError, setRecoveryError] = useState(''),
    [sourceId, setSourceId] = useState(''),
    [fileName, setFileName] = useState('')
  const baselineRequest = useRef<string | null>(null),
    source = useRef(''),
    accepted = useRef(false),
    empty = {
      archive: null as SiteArchive | null,
      source: '',
      sourceId: '',
      fileName: '',
      name: '',
      slug: '',
      reviewedSiteFiles: false,
    },
    baseline = useRef(empty),
    [baselineSignature, setBaselineSignature] = useState(
      JSON.stringify({ sourceId: '', name: '', slug: '', reviewedSiteFiles: false }),
    )
  const signature = JSON.stringify({ sourceId, name, slug, reviewedSiteFiles }),
    dirty = !accepted.current && signature !== baselineSignature,
    busy = pending || recovering || saving
  function restore(value: typeof empty) {
    setArchive(value.archive)
    source.current = value.source
    setSourceId(value.sourceId)
    setFileName(value.fileName)
    setName(value.name)
    setSlug(value.slug)
    setReviewedSiteFiles(value.reviewedSiteFiles)
    baseline.current = value
    setBaselineSignature(
      JSON.stringify({
        sourceId: value.sourceId,
        name: value.name,
        slug: value.slug,
        reviewedSiteFiles: value.reviewedSiteFiles,
      }),
    )
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
        const archive = parseSiteArchive(JSON.parse(record.source))
        restore({
          archive,
          source: record.source,
          sourceId: record.sourceId,
          fileName: record.fileName,
          name: record.name,
          slug: record.slug,
          reviewedSiteFiles: false,
        })
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
      restore(empty)
      baselineRequest.current = request.current = null
      accepted.current = false
      setSiteId(null)
    } catch {
      setRecoveryError('The saved import setup could not be cleared. Keep your choices here and try again.')
    } finally {
      setSaving(false)
    }
  }
  const fileCount = archive?.content.site_files?.length ?? 0,
    versionCount = archive?.content.site_file_versions?.length ?? 0
  const originalPages = [
    ...new Set(
      archive?.content.site_file_versions?.flatMap(
        version => version.bundle.original?.pages.map(page => page.pageId) ?? [],
      ) ?? [],
    ),
  ]
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
  async function submit() {
    if (!archive || submitting.current || busy || reading.current) return
    if (requiresSiteFileReview(archive.content) && !reviewedSiteFiles) {
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
          ...(requiresSiteFileReview(archive.content) ? { reviewedSiteFiles } : {}),
        }),
      })
      const result = (await response.json()) as { siteId?: string; message?: string }
      if (!response.ok || !result.siteId)
        throw new Error(result.message ?? 'Import could not be confirmed. Retry with the same file and destination.')
      accepted.current = true
      setSiteId(result.siteId)
      baseline.current = empty
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
  return (
    <Card title="Choose a content archive">
      <p>
        The new site starts with private drafts. Review and publish its pages, design, navigation, and header/footer
        when ready.
      </p>
      <p>
        Save draft and leave keeps this setup and archive only in this browser. It creates no site. Keep the original
        archive file too.
      </p>
      {recovering && <p role="status">Checking this browser for saved import setup…</p>}
      {hasRecovery && (
        <>
          <p>
            Import setup is available in this browser. Review the destination and any site files again before creating a
            copy.
          </p>
          <Button variant="secondary" disabled={busy} onClick={() => void clearSaved()}>
            Clear saved import setup
          </Button>
          {recoveryError && (
            <p role="alert" className={styles.error}>
              {recoveryError}
            </p>
          )}
        </>
      )}
      <p className="hint">
        Images and saved content versions are included. People, permissions, domains, schedules, and trusted-code
        approvals are set up separately.
      </p>
      <Field id="site-content-archive" label="Content archive (.json, up to 64 MB)">
        <input
          type="file"
          accept=".json,application/json"
          disabled={busy}
          onChange={event => {
            const file = event.target.files?.[0]
            event.target.value = ''
            void load(file)
          }}
        />
      </Field>
      {archive && <p>Loaded archive: {fileName || 'Saved content archive'}</p>}
      {archive && (
        <div className={styles.review}>
          <h3>Review this import</h3>
          <p>
            {archive.content.pages.length} pages · {archive.content.page_versions.length} saved page versions ·{' '}
            {archive.content.collections.length} lists · {archive.content.collection_entries.length} items ·{' '}
            {archive.content.media.length} images
          </p>
          <Field id="import-site-name" label="New site name">
            <input
              value={name}
              maxLength={120}
              disabled={busy || Boolean(siteId)}
              onChange={event => {
                changed()
                setName(event.target.value)
              }}
            />
          </Field>
          <Field
            id="import-site-address"
            label="New short address"
            help="Lowercase words separated by hyphens. This reserves a CMS address; it does not connect a public hostname."
          >
            <input
              aria-label="New short address"
              value={slug}
              maxLength={40}
              disabled={busy || Boolean(siteId)}
              onChange={event => {
                changed()
                setSlug(event.target.value)
              }}
            />
          </Field>
          {requiresSiteFileReview(archive.content) && (
            <div className={styles.files}>
              <h3>{fileCount ? "Review the site's files" : 'Review original page layouts'}</h3>
              <p>
                {fileCount
                  ? "These files include scripts that run on the site's pages. Review every file below."
                  : 'These choices preserve the source page structure and document attributes.'}{' '}
                The copy keeps {versionCount} saved {versionCount === 1 ? 'version' : 'versions'}; publishing still
                requires a separate site release.
              </p>
              {fileCount > 0 && (
                <ol>
                  {archive.content.site_files!.map(file => (
                    <li key={file.id}>
                      <strong>{file.name}</strong>
                      <dl>
                        <dt>Size</dt>
                        <dd>{file.bytes.toLocaleString()} bytes</dd>
                        <dt>Source</dt>
                        <dd>{file.source}</dd>
                      </dl>
                    </li>
                  ))}
                </ol>
              )}
              {originalPages.length > 0 && (
                <>
                  <p>
                    Original page layouts are included for these pages. Review their choices in Site scripts before
                    publishing.
                  </p>
                  <ul>
                    {originalPages.map(id => (
                      <li key={id}>
                        {archive.content.pages.find(page => page.id === id)?.title ?? 'Saved page'}
                        {archive.content.site_file_versions?.some(version =>
                          version.bundle.original?.pages.some(page => page.pageId === id && page.quirks),
                        )
                          ? ' · Original browser layout'
                          : ''}
                      </li>
                    ))}
                  </ul>
                </>
              )}
              <label className={styles.ack}>
                <input
                  type="checkbox"
                  checked={reviewedSiteFiles}
                  disabled={busy || Boolean(siteId)}
                  onChange={event => {
                    setReviewedSiteFiles(event.target.checked)
                  }}
                />
                {fileCount
                  ? 'I reviewed every site file, its size and source.'
                  : 'I reviewed the original page layouts.'}
                {fileCount && originalPages.length > 0 ? ' I also reviewed the original page layouts.' : ''}
              </label>
            </div>
          )}
          {!siteId && (
            <Button
              disabled={
                busy || Boolean(siteId) || Boolean(requiresSiteFileReview(archive.content) && !reviewedSiteFiles)
              }
              onClick={() => void submit()}
            >
              {pending ? 'Importing content…' : 'Create private draft copy'}
            </Button>
          )}
        </div>
      )}
      {error && (
        <p ref={errorRef} tabIndex={-1} role="alert" className={styles.error}>
          {error}
        </p>
      )}
      {siteId && (
        <div role="status">
          <p>Your site content was imported as private drafts.</p>
          <ButtonLink href={`/sites/${siteId}`}>Open imported site</ButtonLink>
        </div>
      )}
    </Card>
  )
}
