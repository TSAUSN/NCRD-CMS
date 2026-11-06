'use client'
import { ImageFocusControl } from '../../../../components/image-focus-control.tsx'
import { picturePreviewUrl } from '../../../../lib/site-image-previews.ts'
import contentEditorStyles from '../../../../components/content-editor.module.css'
import { Disclosure } from '../../../../components/ui/index.ts'
import { useState } from 'react'
import { safeUrl } from '@cms/renderer'
import { IconAlert, IconPlus } from '../../../../components/icons.tsx'
import type { ImagePlacementValue, MediaAsset } from '../../../../lib/media-library.ts'
import { MediaPicker } from '../media-picker.tsx'

/**
 * An image: where it is, and what it says.
 *
 * SPEC §6.11 makes alt text required at upload "unless explicitly decorative",
 * and this is the same rule at the other end of the pipe. There is no third
 * state: an image is described or it is declared decorative, and the renderer
 * treats an empty description as decorative whatever this form thinks — so the
 * checkbox is not a preference, it is the author saying out loud what the page
 * is going to do anyway.
 *
 * Intrinsic dimensions are shown and not edited, deliberately. Width and height
 * are governed on the *definition* — structured schema v2's `staticAttributes`,
 * where they reserve the space so the page does not jump while the image loads —
 * and a page instance has no say in them. Offering a box here would offer a
 * control the renderer discards.
 */
export function ImageField({
  id,
  value,
  siteId,
  mediaAssets,
  imagePreviews = {},
  originalDesign = false,
  supportsFocus = false,
  onChange,
}: {
  id: string
  value: unknown
  siteId: string
  mediaAssets: MediaAsset[]
  imagePreviews?: Record<string, string>
  originalDesign?: boolean
  supportsFocus?: boolean
  onChange: (value: unknown) => void
}) {
  const [pickerOpen, setPickerOpen] = useState(false)
  const current = (typeof value === 'object' && value !== null ? value : {}) as Record<string, unknown>
  const src = String(current['src'] ?? '')
  const alt = String(current['alt'] ?? '')
  const decorative = current['decorative'] === true
  const refused = src.trim() !== '' && safeUrl(src) === '#'
  const previewSrc = picturePreviewUrl(src, imagePreviews, originalDesign)

  // A picture from the media library is named by an internal address nobody
  // needs to read; the address box is for the rare picture hosted elsewhere.
  const fromLibrary =
    src.trim() === '' ||
    src.startsWith('/media/') ||
    Object.hasOwn(imagePreviews, src) ||
    (originalDesign && src.startsWith('/')) ||
    /^\/cms-samples\/r8-(?:landscape|square|four-three)\.png$/.test(src)
  return (
    <div className="subfields">
      {src.trim() !== '' && !refused && previewSrc && supportsFocus && (
        <ImageFocusControl
          src={previewSrc}
          value={current['focal']}
          onChange={focal => onChange({ ...current, focal })}
        />
      )}
      {src.trim() !== '' && !refused && previewSrc && !supportsFocus && (
        <button
          type="button"
          className="image-preview-button"
          aria-label="Choose a different picture"
          onClick={() => setPickerOpen(true)}
        >
          <img src={previewSrc} alt="" className="image-preview" />
        </button>
      )}
      {src.trim() !== '' && !refused && !previewSrc && (
        <p className="notice">The original picture is unavailable. Choose a picture from the media library.</p>
      )}
      <button type="button" className="secondary media-field-choose" onClick={() => setPickerOpen(true)}>
        <IconPlus size={14} /> Choose from media library
      </button>
      <Disclosure
        className={contentEditorStyles.disclosure}
        open={!fromLibrary}
        title="Use a picture from another website"
      >
        <label htmlFor={`${id}-src`}>Picture address</label>
        <input
          id={`${id}-src`}
          type="text"
          value={src}
          placeholder="https://example.org/team.jpg"
          onChange={event => onChange({ ...current, src: event.target.value })}
        />
      </Disclosure>
      {refused && (
        <p className="error-inline">
          <IconAlert size={14} />
          <span>This address will not be used, so no picture will appear.</span>
        </p>
      )}

      <label htmlFor={`${id}-alt`}>Describe the picture</label>
      <input
        id={`${id}-alt`}
        type="text"
        disabled={decorative}
        value={alt}
        aria-describedby={`${id}-alt-note`}
        onChange={event => onChange({ ...current, alt: event.target.value })}
      />
      <p className="hint" id={`${id}-alt-note`}>
        What somebody who cannot see it needs to know. “Two volunteers sorting food parcels”, not “photo”.
      </p>
      <label className="checkbox">
        <input
          type="checkbox"
          checked={decorative}
          onChange={event =>
            onChange({ ...current, decorative: event.target.checked, alt: event.target.checked ? '' : alt })
          }
        />
        <span>
          This picture is decoration and says nothing the words do not
          <br />
          <span className="muted">Screen readers will skip it entirely.</span>
        </span>
      </label>
      {!decorative && alt.trim() === '' && src.trim() !== '' && (
        <p className="warn-inline">
          <IconAlert size={14} />
          <span>
            Without a description this picture is skipped by screen readers anyway. Describe it, or tick the box to say
            that is what you meant.
          </span>
        </p>
      )}
      {pickerOpen && (
        <MediaPicker
          siteId={siteId}
          initialAssets={mediaAssets}
          currentValue={current as Partial<ImagePlacementValue>}
          onClose={() => setPickerOpen(false)}
          onChoose={next => {
            onChange({ ...current, ...next, focal: next.focal ?? null })
            setPickerOpen(false)
          }}
        />
      )}
    </div>
  )
}
