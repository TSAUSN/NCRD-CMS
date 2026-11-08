'use client'

import { Button, Card, CardHeading, CardContent, Field, IconButton } from '../../../../components/ui/index.ts'
import listInspectorStyles from '../../../../components/workspace-styles/list-inspector.module.css'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useNavigationGuard, requestLocalDraftNavigation } from '../../../../components/navigation-guard.ts'
import type { NavigationGuardState } from '../../../../lib/navigation-guard.ts'
import { IconAlert, IconArrowUp, IconCheck, IconClose, IconImage } from '../../../../components/icons.tsx'
import {
  formatBytes,
  MediaRequestError,
  uploadMedia,
  type MediaUploadReceipt,
  type UploadProgress,
} from '../../../../lib/media-library.ts'

const ACCEPTED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp'])

export function MediaUploadPanel({
  siteId,
  defaultFolder,
  onAccepted,
  onClose,
  droppedFile,
  leaveRef,
}: {
  leaveRef?: { current: (() => NavigationGuardState) | null }
  droppedFile?: File | null
  siteId: string
  defaultFolder?: string
  onAccepted: (receipt: MediaUploadReceipt) => void
  onClose?: () => void
}) {
  const input = useRef<HTMLInputElement>(null)
  const description = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [decorative, setDecorative] = useState(false)
  const [altText, setAltText] = useState('')
  const [dragging, setDragging] = useState(false)
  const [progress, setProgress] = useState<UploadProgress | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  const inFlight = useRef(false)
  const accepted = useRef(false)
  const busy = progress !== null
  const leaveState = (): NavigationGuardState => ({
    dirty: Boolean(file) && !done && !accepted.current,
    pending: busy || inFlight.current,
    draft: { label: 'Image upload', saveMode: 'library', saveDraft: submit, discard: clear },
  })
  useNavigationGuard(leaveState)
  useLayoutEffect(() => {
    if (leaveRef) leaveRef.current = leaveState
    return () => {
      if (leaveRef) leaveRef.current = null
    }
  })
  useEffect(() => {
    if (typeof window === 'undefined') return
    const warn = (event: BeforeUnloadEvent) => {
      const state = leaveState()
      if (state.dirty || state.pending) event.preventDefault()
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [file, done, busy])
  function leave(proceed: () => void) {
    if (requestLocalDraftNavigation(leaveState, proceed)) proceed()
  }
  function dismiss() {
    if (onClose) leave(onClose)
  }
  useEffect(() => {
    if (file) description.current?.focus()
  }, [file])

  function choose(next: File | undefined) {
    if (!next) return
    if (!ACCEPTED_TYPES.has(next.type)) {
      setError('Choose a JPEG, PNG or WebP image.')
      return
    }
    leave(() => {
      accepted.current = false
      setFile(next)
      setAltText('')
      setDecorative(false)
      setError(null)
      setDone(false)
    })
  }

  useEffect(() => {
    if (droppedFile) choose(droppedFile)
  }, [droppedFile])

  function clear() {
    accepted.current = false
    setFile(null)
    setAltText('')
    setDecorative(false)
    setProgress(null)
    setError(null)
    setDone(false)
    if (input.current) input.current.value = ''
  }

  async function submit(): Promise<{ ok: boolean; message?: string }> {
    if (accepted.current) return { ok: true }
    if (!file || busy || inFlight.current)
      return { ok: false, message: 'Choose an image or wait for the current upload to finish.' }
    if (!decorative && altText.trim().length === 0) {
      const message = 'Describe the image, or mark it as decorative.'
      setError(message)
      return { ok: false, message }
    }
    inFlight.current = true
    setError(null)
    setDone(false)
    try {
      const receipt = await uploadMedia({
        siteId,
        file,
        altText,
        decorative,
        folder: defaultFolder,
        onProgress: setProgress,
      })
      accepted.current = true
      setProgress(null)
      setDone(true)
      onAccepted(receipt)
      return { ok: true }
    } catch (reason) {
      setProgress(null)
      const message = reason instanceof MediaRequestError ? reason.message : 'The image could not be uploaded.'
      setError(message)
      return { ok: false, message }
    } finally {
      inFlight.current = false
    }
  }

  const progressLabel =
    progress?.phase === 'preparing'
      ? 'Preparing upload…'
      : progress?.phase === 'processing'
        ? 'Upload complete. Verifying image…'
        : progress?.percent === null
          ? 'Uploading…'
          : `Uploading… ${progress?.percent}%`

  return (
    <div role="region" aria-labelledby="media-upload-title">
      <Card density="compact">
        <CardHeading>
          <div>
            <h2 id="media-upload-title">Upload an image</h2>
            <p>
              JPEG, PNG or WebP. Saving an upload adds it to Media without putting it on a page. The media service
              verifies the file before it becomes ready.
              {defaultFolder?.trim() ? ` It will be filed in ${defaultFolder.trim()}.` : ''}
            </p>
          </div>
          {onClose && (
            <IconButton tooltip="Close upload panel" variant="tertiary" onClick={dismiss}>
              <IconClose size={18} />
            </IconButton>
          )}
        </CardHeading>
        <CardContent>
          {!file ? (
            <div
              className={`media-drop ${dragging ? 'is-dragging' : ''}`}
              onDragEnter={event => {
                event.preventDefault()
                setDragging(true)
              }}
              onDragOver={event => event.preventDefault()}
              onDragLeave={event => {
                if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false)
              }}
              onDrop={event => {
                event.preventDefault()
                setDragging(false)
                choose(event.dataTransfer.files[0])
              }}
            >
              <span className="media-drop-mark">
                <IconArrowUp size={22} />
              </span>
              <strong>Drop an image here</strong>
              <span>or choose one from your computer</span>
              <Button variant="secondary" type="button" className="secondary" onClick={() => input.current?.click()}>
                Choose an image
              </Button>
              <input
                ref={input}
                className="sr-only"
                type="file"
                accept="image/jpeg,image/png,image/webp"
                aria-label="Choose an image to upload"
                onChange={event => choose(event.target.files?.[0])}
              />
            </div>
          ) : (
            <div className={listInspectorStyles.formStack}>
              <div className="media-file">
                <span className="media-file-icon">
                  <IconImage size={20} />
                </span>
                <span className="media-file-name">
                  <strong>{file.name}</strong>
                  <small>{formatBytes(file.size)}</small>
                </span>
                <Button
                  variant="secondary"
                  type="button"
                  className="icon-btn"
                  aria-label={`Remove ${file.name}`}
                  disabled={busy || done}
                  onClick={clear}
                >
                  <IconClose size={16} />
                </Button>
              </div>

              <fieldset className="media-purpose">
                <legend>What does this image do?</legend>
                <label className="media-choice">
                  <input
                    type="radio"
                    name="upload-purpose"
                    checked={!decorative}
                    onChange={() => setDecorative(false)}
                    disabled={busy || done}
                  />
                  <span>
                    <strong>It communicates information</strong>
                    <small>Give it a concise description for people who cannot see it.</small>
                  </span>
                </label>
                <label className="media-choice">
                  <input
                    type="radio"
                    name="upload-purpose"
                    checked={decorative}
                    onChange={() => setDecorative(true)}
                    disabled={busy || done}
                  />
                  <span>
                    <strong>It is decorative</strong>
                    <small>People using screen readers can skip it.</small>
                  </span>
                </label>
              </fieldset>

              {!decorative && (
                <Field id="media-upload-alt" label="Image description" density="compact">
                  <input
                    ref={description}
                    id="media-upload-alt"
                    value={altText}
                    disabled={busy || done}
                    onChange={event => setAltText(event.target.value)}
                    placeholder="Describe what matters in this image"
                  />
                </Field>
              )}

              {progress && (
                <div className="media-progress" role="status" aria-live="polite">
                  <span>{progressLabel}</span>
                  <progress max={100} value={progress.percent ?? undefined} aria-label={progressLabel} />
                </div>
              )}
              {error && (
                <p className="media-inline-error" role="alert">
                  <IconAlert size={16} /> <span>{error}</span>
                </p>
              )}
              {done && (
                <p className="media-inline-success" role="status">
                  <IconCheck size={16} />
                  <span>
                    Upload received. Verification and responsive image processing are running in the background.
                  </span>
                </p>
              )}

              <div className="actions media-upload-actions">
                {done ? (
                  <Button variant="secondary" type="button" className="secondary" onClick={clear}>
                    Upload another
                  </Button>
                ) : (
                  <Button variant="primary" type="button" disabled={busy || done} onClick={submit}>
                    <IconArrowUp size={16} /> {error ? 'Try upload again' : 'Upload image'}
                  </Button>
                )}
              </div>
            </div>
          )}
          {!file && error && (
            <p className="media-inline-error" role="alert">
              <IconAlert size={16} /> <span>{error}</span>
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
