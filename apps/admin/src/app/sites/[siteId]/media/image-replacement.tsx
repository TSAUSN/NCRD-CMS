'use client'
import { useEffect, useRef, useState } from 'react'
import { Button, Dialog, EmptyState } from '../../../../components/ui/index.ts'
import { MediaPicker } from '../../../pages/[pageId]/media-picker.tsx'
import type { ImageReplacementReview } from '../../../../lib/media-replacement.ts'
import type { ImagePlacementValue, MediaAsset } from '../../../../lib/media-library.ts'
import { useNavigationGuard } from '../../../../components/navigation-guard.ts'
import { prepareImageReplacement, saveImageReplacement } from './replacement-actions.ts'
import styles from './media-workspace.module.css'
function ReplacementPreview({ src }: { src: string | null }) {
  const [failed, setFailed] = useState<string | null>(null)
  return (
    <div className={styles.replacementPreview}>
      {src && src !== failed ? <img src={src} alt="" onError={() => setFailed(src)} /> : <p>Preview unavailable</p>}
    </div>
  )
}
export function ImageReplacement({
  siteId,
  source,
  assets,
  onClose,
  onSaved,
}: {
  siteId: string
  source: MediaAsset
  assets: MediaAsset[]
  onClose: () => void
  onSaved: () => void
}) {
  const [image, setImage] = useState<ImagePlacementValue | null>(null)
  const [review, setReview] = useState<ImageReplacementReview | null>(null)
  const [keys, setKeys] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [retry, setRetry] = useState(0)
  const [saved, setSaved] = useState<number | null>(null)
  const [replacementName, setReplacementName] = useState('Replacement')
  const lock = useRef(false)
  useNavigationGuard(() => ({ dirty: false, pending: busy }))
  useEffect(() => {
    const leave = (event: BeforeUnloadEvent) => {
      if (busy) event.preventDefault()
    }
    window.addEventListener('beforeunload', leave)
    return () => window.removeEventListener('beforeunload', leave)
  }, [busy])
  useEffect(() => {
    if (!image?.media_id) return
    let active = true
    setReview(null)
    setError(null)
    setBusy(true)
    void prepareImageReplacement({ siteId, from: source.id, to: image.media_id })
      .then(result => {
        if (!active) return
        if (!result.ok) setError(result.message)
        else {
          setReview(result.review)
          setKeys(result.review.targets.filter(target => target.available).map(target => target.key))
        }
      })
      .catch(() => {
        if (active) setError('The replacement could not be reviewed. Try again.')
      })
      .finally(() => {
        if (active) setBusy(false)
      })
    return () => {
      active = false
    }
  }, [siteId, source.id, image?.media_id, retry])
  async function save() {
    if (lock.current || !review || !image?.media_id) return
    lock.current = true
    setBusy(true)
    setError(null)
    try {
      const result = await saveImageReplacement({
        siteId,
        from: source.id,
        to: image.media_id,
        fingerprint: review.fingerprint,
        keys,
      })
      if (!result.ok) {
        setError(result.message)
        setReview(null)
      } else setSaved(result.count)
    } catch {
      setError('The save could not be confirmed. Review again before retrying.')
      setReview(null)
    } finally {
      lock.current = false
      setBusy(false)
    }
  }
  if (!image)
    return (
      <MediaPicker
        onSelectedAsset={asset => setReplacementName(asset.name)}
        mode="replacement"
        excludeId={source.id}
        siteId={siteId}
        initialAssets={assets.filter(asset => asset.id !== source.id)}
        onChoose={setImage}
        onClose={onClose}
        confirmLabel={`Review replacement for ${source.name}`}
      />
    )
  return (
    <Dialog
      title={saved === null ? 'Replace image in saved drafts' : 'Image replacement saved'}
      onClose={saved === null ? onClose : onSaved}
      pending={busy}
      footer={
        saved === null ? (
          <>
            <Button variant="secondary" disabled={busy} onClick={() => setImage(null)}>
              Choose another image
            </Button>
            <Button loading={busy} disabled={!review || !keys.length} onClick={() => void save()}>
              Replace in {keys.length} {keys.length === 1 ? 'destination' : 'destinations'}
            </Button>
          </>
        ) : (
          <Button onClick={onSaved}>Done</Button>
        )
      }
    >
      {saved !== null ? (
        <EmptyState
          title={`Saved in ${saved} ${saved === 1 ? 'destination' : 'destinations'}`}
          action={
            <a className={styles.replacementLink} href={`/sites/${siteId}/publishing`}>
              Review changes in Publish
            </a>
          }
        >
          Visitors still see the current image. Publish the selected pages, lists or Site look when ready. The original
          image and saved history are kept.
        </EmptyState>
      ) : (
        <div className={styles.replacement}>
          <div className={styles.replacementImages}>
            <figure>
              <ReplacementPreview src={source.previewUrl ?? source.deliveryUrl} />
              <figcaption>Current · {source.name}</figcaption>
            </figure>
            <figure>
              <ReplacementPreview src={image.src} />
              <figcaption>Replacement · {replacementName}</figcaption>
            </figure>
          </div>
          <p>
            Choose where to replace this image. Changes are saved as drafts; visitors keep seeing the current version
            until you publish.
          </p>
          <p>
            Each placement keeps its existing description and decorative choice. Check those descriptions before
            publishing the new picture.
          </p>
          {busy && !review && <p role="status">Finding current uses…</p>}
          {error && (
            <div role="alert">
              <p>{error}</p>
              <Button variant="secondary" disabled={busy} onClick={() => setRetry(value => value + 1)}>
                Review again
              </Button>
            </div>
          )}
          {review?.targets.length === 0 && (
            <EmptyState title="No current uses">
              This image is not used in a current page, list or Site look draft. Earlier saved versions keep the
              original image. Choose a picture directly in the page where you want it.
            </EmptyState>
          )}
          {review && review.targets.length > 0 && (
            <fieldset className={styles.replacementTargets} disabled={busy}>
              <legend>Replace in</legend>
              {review.targets.map(target => (
                <label key={target.key}>
                  <input
                    type="checkbox"
                    disabled={!target.available}
                    checked={keys.includes(target.key)}
                    onChange={event =>
                      setKeys(current =>
                        event.target.checked ? [...current, target.key] : current.filter(key => key !== target.key),
                      )
                    }
                  />
                  <span>
                    <strong>{target.name}</strong>
                    <small>
                      {target.area}
                      {!target.available ? ' · An administrator needs to change this destination' : ''}
                    </small>
                  </span>
                  <a href={target.href} target="_blank" rel="noreferrer">
                    Open<span className="sr-only"> {target.name}</span>
                  </a>
                </label>
              ))}
            </fieldset>
          )}
        </div>
      )}
    </Dialog>
  )
}
