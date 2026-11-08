import { MediaThumbnail } from '../../../components/media-thumbnail.tsx'
import { IconAlert, IconImage } from '../../../components/icons.tsx'
import { formatBytes, formatDimensions, mediaStatusLabel } from '../../../lib/media-library.ts'
import type { MediaPickerModel } from './media-picker-state.ts'

export function MediaPickerSelection({ picker, headingId }: { picker: MediaPickerModel; headingId: string }) {
  const {
    selected,
    selectedVerified,
    refreshing,
    mode,
    requireDescription,
    decorative,
    setDecorative,
    altText,
    setAltText,
  } = picker
  return (
    <aside className="media-picker-choice" aria-label="Selection options">
      {selected ? (
        <>
          <div className="media-picker-preview">
            <MediaThumbnail readyOnly asset={selected} />
          </div>
          <div>
            <p className="eyebrow">Selected</p>
            <h3>{selected.name}</h3>
            <p>
              {formatDimensions(selected)} · {formatBytes(selected.bytes)}
            </p>
          </div>

          {!selectedVerified && (
            <p className="hint" role="status">
              {refreshing
                ? 'Checking this image’s current availability…'
                : 'Refresh the library to verify this image before using it.'}
            </p>
          )}
          {selected.status !== 'ready' ? (
            <p className="media-inline-error">
              <IconAlert size={16} />
              <span>
                This image is {mediaStatusLabel(selected.status).toLocaleLowerCase()} and cannot be placed yet.
              </span>
            </p>
          ) : mode === 'placement' ? (
            <fieldset className="media-purpose media-picker-purpose">
              <legend>In this use, the image…</legend>
              <label className="media-choice">
                <input type="radio" name="picker-purpose" checked={!decorative} onChange={() => setDecorative(false)} />
                <span>
                  <strong>Communicates information</strong>
                  <small>Announce a useful description.</small>
                </span>
              </label>
              {!requireDescription && (
                <label className="media-choice">
                  <input
                    type="radio"
                    name="picker-purpose"
                    checked={decorative}
                    onChange={() => {
                      setDecorative(true)
                      setAltText('')
                    }}
                  />
                  <span>
                    <strong>Is decorative</strong>
                    <small>People using screen readers can skip it.</small>
                  </span>
                </label>
              )}
            </fieldset>
          ) : (
            <p className="hint">
              {mode === 'site-logo'
                ? 'The logo description is set in Header & menu. Image descriptions in the library stay unchanged.'
                : 'Each destination keeps its current description. Review those descriptions before publishing the replacement.'}
            </p>
          )}

          {mode === 'placement' && selected.status === 'ready' && !decorative && (
            <div className="field">
              <label htmlFor={`${headingId}-alt`}>Image description</label>
              <input
                id={`${headingId}-alt`}
                value={altText}
                maxLength={requireDescription ? 1000 : undefined}
                required={requireDescription}
                onChange={event => setAltText(event.target.value)}
              />
              <p className="hint">Describe what matters in this use, not every visual detail.</p>
            </div>
          )}
          {selected.status === 'ready' && !selected.deliveryUrl && (
            <p className="media-delivery-note">
              <IconAlert size={15} />
              <span>This image has a private preview but is not ready to use on the site.</span>
            </p>
          )}
        </>
      ) : (
        <div className="media-detail-empty">
          <IconImage size={25} />
          <p>Select an image to continue.</p>
        </div>
      )}
    </aside>
  )
}
